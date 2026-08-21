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

/**
 * Parse a DATABASE_URL into individual components so we can pass them
 * to the Pool individually. This sidesteps a very common Supabase/Neon
 * problem: if the database password contains special characters like
 * @ : / # ! $ & and the user did NOT percent-encode them, the native
 * `connectionString` parser silently mangles the URL and the connection
 * fails with a confusing error. By parsing manually and passing explicit
 * `user / password / host / port / database` to the Pool we are immune
 * to that class of bug.
 */
function parseDbUrl(rawUrl) {
  try {
    let url = (rawUrl || '').trim();
    // Match scheme://user:password@host:port/database
    // The password can contain @, #, !, $, etc. — so we match from the
    // RIGHT side: find the LAST @ that precedes host:port/database.
    // Strategy: match scheme, then user, then everything up to the last
    // "@host:port/db" pattern.
    const m = url.match(/^(postgresql|postgres):\/\/([^:]+):(.+)@([^:@]+):(\d+)\/([^?]+)/);
    if (m) {
      const [, , user, password, host, port, database] = m;
      // The .+ is greedy, so it will grab as much as possible — but we need
      // it to match the LAST @ before the host. Use a non-greedy approach
      // by finding the last @ manually instead.
    }
    // More robust approach: manually find the last "@" that is followed by host:port
    const schemeMatch = url.match(/^(postgresql|postgres):\/\//);
    if (!schemeMatch) {
      return { connectionString: url, ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false } };
    }
    const afterScheme = url.slice(schemeMatch[0].length);
    // Find user:password — everything up to the LAST @ that is followed by host:port/db
    // The host:port pattern is: something.com:12345/
    const hostPortPattern = /@([^:@]+):(\d+)\/([^?]+)/;
    // Find the LAST match of @host:port/db
    let lastMatch = null;
    let searchStr = afterScheme;
    let match;
    const hostRegex = /@([^:@]+):(\d+)\/([^?]+)/g;
    while ((match = hostRegex.exec(searchStr)) !== null) {
      lastMatch = match;
    }
    if (lastMatch) {
      const atIndex = afterScheme.lastIndexOf('@' + lastMatch[1] + ':' + lastMatch[2] + '/');
      const userPass = afterScheme.slice(0, atIndex);
      const colonIdx = userPass.indexOf(':');
      if (colonIdx === -1) {
        return { connectionString: url, ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false } };
      }
      const user = userPass.slice(0, colonIdx);
      const password = userPass.slice(colonIdx + 1);
      const host = lastMatch[1];
      const port = parseInt(lastMatch[2], 10);
      const database = lastMatch[3];
      return {
        user: decodeURIComponent(user),
        password: decodeURIComponent(password),
        host: host,
        port: port,
        database: database,
        ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }
      };
    }
    // Fallback: let pg parse it natively
    return { connectionString: url, ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false } };
  } catch (e) {
    console.error('PG URL parse error:', e.message);
    return { connectionString: (rawUrl || '').trim(), ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false } };
  }
}

function getPool() {
  if (!pool) {
    const poolConfig = parseDbUrl(process.env.DATABASE_URL);
    poolConfig.max = 5;
    poolConfig.idleTimeoutMillis = 30000;
    poolConfig.connectionTimeoutMillis = 10000;
    pool = new Pool(poolConfig);
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
  const MAX_RETRIES = 5;
  const RETRY_DELAY = 3000; // 3 seconds between retries
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const client = getPool();
      await ensureSchema(client);
      const res = await client.query(
        `SELECT data FROM ${STATE_TABLE} WHERE key = $1`, [STATE_KEY]
      );
      if (res.rows.length === 0) {
        // First boot: seed from db.js defaults
        db = dbFile.makeFreshDb();
        await persistNow();
        console.log('Postgres: seeded fresh database');
      } else {
        db = res.rows[0].data;
        // Run any lightweight migration backfill on the hydrated object
        dbFile.backfill(db);
        console.log('Postgres: loaded existing database state');
      }
      return db;
    } catch (err) {
      lastErr = err;
      console.error(`PG load attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      // Reset the pool so the next attempt creates a fresh connection
      if (pool) { try { await pool.end(); } catch (e) {} pool = null; }
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY));
      }
    }
  }
  throw new Error(`PostgreSQL connection failed after ${MAX_RETRIES} attempts: ${lastErr ? lastErr.message : 'unknown error'}`);
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
    // If load() failed (PG unavailable), fall back to the JSON db so the
    // app keeps working in read-only-ish mode instead of crashing every
    // endpoint that calls getDb(). The JSON db shares the same shape.
    console.warn('getDb() called before load() — using JSON fallback db');
    db = dbFile.getDb();
  }
  return db;
}

// --- Activity / notification / email helpers (mirror db.js) ----------
function logActivity(kind, label, detail) {
  try {
    const d = getDb();
    d.activity.unshift({ id: uid('a'), kind, label, detail, at: new Date().toISOString() });
    if (d.activity.length > 500) d.activity = d.activity.slice(0, 500);
    save();
  } catch (e) { /* DB not loaded — skip activity log */ }
}
function notify(type, title, message, userId) {
  try {
    const d = getDb();
    d.notifications.unshift({ id: uid('n'), type, title, message, read: false, at: new Date().toISOString(), userId: userId || null });
    if (d.notifications.length > 100) d.notifications = d.notifications.slice(0, 100);
    save();
  } catch (e) { /* DB not loaded — skip notification */ }
}
async function sendEmail(to, subject, body) {
  // Try to record in outbox, but don't let DB issues block the actual send
  let d = null;
  let mail = { id: uid('e'), to, subject, body, at: new Date().toISOString(), status: 'queued' };
  try {
    d = getDb();
    if (!d.emails) d.emails = [];
    d.emails.unshift(mail);
    if (d.emails.length > 200) d.emails = d.emails.slice(0, 200);
    save();
  } catch (dbErr) {
    // DB not loaded yet — still send the email, just can't record in outbox
  }

  // Attempt real delivery via Resend (always runs, regardless of DB state)
  try {
    const mailer = require('./mailer');
    const result = await mailer.sendOne(to, subject, body);
    if (d) {
      const stored = d.emails.find(e => e.id === mail.id);
      if (stored) {
        stored.status = result.status;
        stored.messageId = result.messageId;
        stored.error = result.error;
        stored.sentAt = result.status === 'sent' ? new Date().toISOString() : undefined;
        save();
      }
    }
    return { ...mail, ...result };
  } catch (err) {
    if (d) {
      const stored = d.emails.find(e => e.id === mail.id);
      if (stored) {
        stored.status = 'failed';
        stored.error = String(err.message || err).slice(0, 300);
        save();
      }
    }
    return { ...mail, status: 'failed', error: String(err.message || err).slice(0, 300) };
  }
}
function logAiActivity(type, actor, action, detail) {
  try {
    const d = getDb();
    d.aiActivity.unshift({ id: uid('ai'), type, actor, action, detail, at: new Date().toISOString() });
    if (d.aiActivity.length > 300) d.aiActivity = d.aiActivity.slice(0, 300);
    save();
  } catch (e) { /* DB not loaded */ }
}
function aiAuditLog(userId, message, reason) {
  try {
    const d = getDb();
    d.aiAudit.unshift({ id: uid('au'), userId, message, reason, at: new Date().toISOString() });
    if (d.aiAudit.length > 200) d.aiAudit = d.aiAudit.slice(0, 200);
    save();
  } catch (e) { /* DB not loaded */ }
}
function logPriceChange(serviceId, serviceName, packageId, packageName, oldPrice, newPrice, by) {
  try {
    const d = getDb();
    if (!d.priceHistory) d.priceHistory = [];
    d.priceHistory.unshift({ id: uid('ph'), serviceId, serviceName, packageId, packageName, oldPrice, newPrice, by, at: new Date().toISOString() });
    if (d.priceHistory.length > 200) d.priceHistory = d.priceHistory.slice(0, 200);
    save();
  } catch (e) { /* DB not loaded — price still changed, just not logged */ }
}
function markNotificationRead(id) {
  try {
    const d = getDb();
    const n = d.notifications.find(x => x.id === id);
    if (n) { n.read = true; save(); }
  } catch (e) { /* DB not loaded */ }
}
function markAllNotificationsRead() {
  try {
    const d = getDb();
    d.notifications.forEach(n => { n.read = true; });
    save();
  } catch (e) { /* DB not loaded */ }
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
