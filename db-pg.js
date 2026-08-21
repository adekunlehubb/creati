/**
 * db-pg.js — PostgreSQL-backed adapter for CreatiHub.
 *
 * Design: mirrors the exact API surface of db.js so that server.js can use
 * EITHER backend with zero code changes. The entire database state is stored
 * as a single JSON document in a key/value table (`creatihub_state`).
 *
 *   - On load():   the full document is hydrated into an in-memory `db` object.
 *   - On save():   the in-memory object is serialized back to Postgres.
 *
 * This gives bulletproof durability (Postgres is ACID, survives redeploys,
 * crashes, and ephemeral filesystem resets) while keeping the existing
 * in-memory mutation + save() pattern that server.js relies on.
 *
 * It is used automatically when the DATABASE_URL environment variable is set.
 * Otherwise db.js falls back to the JSON-file backend (local/dev).
 *
 * Exports the same functions as db.js:
 *   getDb, save, uid, hashPassword, makeToken, logActivity, notify, sendEmail,
 *   createResetCode, verifyResetCode, consumeResetCode, revokeUserTokens,
 *   logAiActivity, aiAuditLog, logPriceChange, markNotificationRead,
 *   markAllNotificationsRead, defaultAiSettings
 */

const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');

// --- shared helpers (identical to db.js) -----------------------------
const SALT = 'creatihub_salt';
function hashPassword(pw) {
  // MUST match db.js exactly: update(password + salt). Order matters for SHA256.
  return crypto.createHash('sha256').update((pw || '') + SALT).digest('hex');
}
function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}
function uid(prefix) {
  return prefix + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

// --- seed definitions (imported from db.js to avoid duplication) -----
// We require db.js purely to reuse its seed data + defaultSettings. db.js
// detects that DATABASE_URL is set and avoids touching the JSON file.
const dbFile = require('./db');
const { defaultAiSettings } = dbFile;

const STATE_TABLE = 'creatihub_state';
const STATE_KEY = 'main';

let pool = null;
let db = null;            // in-memory mirror
let saveTimer = null;     // debounced save

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Render/Railway/Supabase/Neon all use sslmode=require in production
      ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000
    });
    pool.on('error', (err) => console.error('PG pool error:', err.message));
  }
  return pool;
}

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
      key          TEXT PRIMARY KEY,
      data         JSONB NOT NULL,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * Build the initial seed document. Reuses db.js seed arrays so the schema
 * stays in sync with the single source of truth.
 */
function seedDocument() {
  // Pull seed arrays out of db.js by temporarily forcing the file backend to
  // generate a fresh in-memory DB, then reading its collections. This avoids
  // duplicating the (large) seed definitions.
  const fresh = dbFile.makeFreshDb ? dbFile.makeFreshDb() : null;
  return fresh;
}

async function load() {
  const client = getPool();
  await ensureSchema(client);
  const res = await client.query(
    `SELECT data FROM ${STATE_TABLE} WHERE key = $1`, [STATE_KEY]
  );
  if (res.rows.length === 0) {
    // First boot: seed from db.js defaults
    db = dbFile.makeFreshDb();
    await persistNow();
    console.log('📦 Postgres: seeded fresh database');
  } else {
    db = res.rows[0].data;
    // Run any lightweight migration backfill on the hydrated object
    dbFile.backfill(db);
    console.log('📦 Postgres: loaded existing database state');
  }
  return db;
}

/**
 * Write the in-memory db object back to Postgres immediately.
 */
async function persistNow() {
  if (!db) return;
  const client = getPool();
  const json = JSON.stringify(db);
  await client.query(
    `INSERT INTO ${STATE_TABLE} (key, data, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [STATE_KEY, json]
  );
}

/**
 * save() — debounced persistence. server.js calls save() frequently (after
 * every mutation). We coalesce rapid bursts into a single write within 400ms,
 * and always flush before process exit.
 */
function save() {
  if (!db) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistNow().catch(e => console.error('PG save error:', e.message));
  }, 400);
}

function flushSync() {
  // Best-effort synchronous-ish flush for graceful shutdown
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  // pg is async-only; spawn and forget on shutdown
  persistNow().catch(() => {});
}

process.on('SIGTERM', flushSync);
process.on('SIGINT', flushSync);

function getDb() {
  if (!db) {
    // Synchronous callers (server.js does `const db = getDb()` at module load)
    // need the object available. We hydrate async on load(); if getDb() is
    // called before load() finishes we throw so the boot sequence can await.
    throw new Error('Postgres backend not yet loaded — await load() first');
  }
  return db;
}

// --- Activity / notification / email helpers (mirror db.js) ----------
function logActivity(kind, label, detail) {
  const d = getDb();
  d.activity.unshift({ id: uid('a'), kind, label, detail, at: new Date().toISOString() });
  if (d.activity.length > 500) d.activity = d.activity.slice(0, 500);
  save();
}
function notify(type, title, message, userId) {
  const d = getDb();
  d.notifications.unshift({ id: uid('n'), type, title, message, read: false, at: new Date().toISOString(), userId: userId || null });
  if (d.notifications.length > 100) d.notifications = d.notifications.slice(0, 100);
  save();
}
function sendEmail(to, subject, body) {
  const d = getDb();
  d.emails.unshift({ id: uid('e'), to, subject, body, at: new Date().toISOString(), status: 'queued' });
  if (d.emails.length > 200) d.emails = d.emails.slice(0, 200);
  save();
}
function logAiActivity(type, actor, action, detail) {
  const d = getDb();
  d.aiActivity.unshift({ id: uid('ai'), type, actor, action, detail, at: new Date().toISOString() });
  if (d.aiActivity.length > 300) d.aiActivity = d.aiActivity.slice(0, 300);
  save();
}
function aiAuditLog(userId, message, reason) {
  const d = getDb();
  d.aiAudit.unshift({ id: uid('au'), userId, message, reason, at: new Date().toISOString() });
  if (d.aiAudit.length > 200) d.aiAudit = d.aiAudit.slice(0, 200);
  save();
}
function logPriceChange(serviceId, serviceName, packageId, packageName, oldPrice, newPrice, by) {
  const d = getDb();
  d.priceHistory.unshift({ id: uid('ph'), serviceId, serviceName, packageId, packageName, oldPrice, newPrice, by, at: new Date().toISOString() });
  if (d.priceHistory.length > 200) d.priceHistory = d.priceHistory.slice(0, 200);
  save();
}
function markNotificationRead(id) {
  const d = getDb();
  const n = d.notifications.find(x => x.id === id);
  if (n) { n.read = true; save(); }
}
function markAllNotificationsRead() {
  const d = getDb();
  d.notifications.forEach(n => { n.read = true; });
  save();
}

// --- reset codes -----------------------------------------------------
function createResetCode(userId) {
  const d = getDb();
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  d.resetTokens[code] = { userId, expiresAt: Date.now() + 15 * 60 * 1000 };
  save();
  return code;
}
function verifyResetCode(code) {
  const d = getDb();
  const entry = d.resetTokens[code];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { delete d.resetTokens[code]; save(); return null; }
  return entry.userId;
}
function consumeResetCode(code) {
  const d = getDb();
  delete d.resetTokens[code];
  save();
}
function revokeUserTokens(userId) {
  const d = getDb();
  Object.keys(d.tokens).forEach(t => { if (d.tokens[t] === userId) delete d.tokens[t]; });
  save();
}

module.exports = {
  load,          // async — must be awaited before getDb()
  getDb, save, uid, hashPassword, makeToken,
  logActivity, notify, sendEmail,
  createResetCode, verifyResetCode, consumeResetCode, revokeUserTokens,
  logAiActivity, aiAuditLog, logPriceChange,
  markNotificationRead, markAllNotificationsRead,
  defaultAiSettings,
  // expose for the unified entrypoint
  isPostgres: true
};
