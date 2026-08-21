// ============================================================
// CreatiHub — Automatic Database Backup
// ------------------------------------------------------------
// Snapshots data/db.json to data/backups/db-YYYY-MM-DD-HHMMSS.json
// - Runs immediately on boot (so there's always a fresh snapshot)
// - Runs on a 24h interval (configurable via BACKUP_INTERVAL_HOURS)
// - Keeps the most recent N backups (default 30) and prunes the rest
// - Also exposes a manual trigger via require('./backup').backupNow()
//
// This protects user data even on hosts with ephemeral filesystems:
// if a redeploy wipes the live db.json, the latest backup can be
// restored from data/backups/ (or from an attached persistent disk).
// ============================================================
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = parseInt(process.env.BACKUP_MAX_FILES || '30', 10);
const INTERVAL_HOURS = parseFloat(process.env.BACKUP_INTERVAL_HOURS || '24');
const INTERVAL_MS = Math.max(1, INTERVAL_HOURS) * 60 * 60 * 1000;

let intervalHandle = null;

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Create a timestamped backup of db.json. Returns { ok, file, size, ts } or { ok:false, error }
function backupNow() {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) {
    return { ok: false, error: 'db.json does not exist yet (nothing to back up)' };
  }
  const ts = new Date();
  const stamp = ts.toISOString().replace(/[:.]/g, '-').slice(0, 19); // 2026-08-21T00-05-18
  const file = path.join(BACKUP_DIR, 'db-' + stamp + '.json');
  try {
    const data = fs.readFileSync(DB_FILE);
    fs.writeFileSync(file, data);
    prune();
    return { ok: true, file: path.basename(file), size: data.length, ts: ts.toISOString() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Keep only the most recent MAX_BACKUPS files (newest first by mtime)
function prune() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('db-') && f.endsWith('.json'))
      .map(f => ({ f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length <= MAX_BACKUPS) return { kept: files.length, removed: 0 };
    const toRemove = files.slice(MAX_BACKUPS);
    toRemove.forEach(({ f }) => {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch {}
    });
    return { kept: MAX_BACKUPS, removed: toRemove.length };
  } catch {
    return { kept: 0, removed: 0 };
  }
}

// List available backups (newest first)
function listBackups() {
  ensureDirs();
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('db-') && f.endsWith('.json'))
      .map(f => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { file: f, size: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
  } catch {
    return [];
  }
}

// Read a specific backup file (for download / restore)
function getBackupPath(filename) {
  if (!filename || !/^db-[0-9T-]+\.json$/.test(filename)) return null; // sanitize
  const p = path.join(BACKUP_DIR, filename);
  return fs.existsSync(p) ? p : null;
}

// Start the scheduled backup loop. Safe to call once on server boot.
function startScheduler() {
  ensureDirs();
  // Immediate backup on boot (if a db.json already exists)
  const first = backupNow();
  if (first.ok) console.log(`📦 Backup created on boot: ${first.file}`);
  // Recurring schedule
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(() => {
    const r = backupNow();
    if (r.ok) console.log(`📦 Scheduled backup created: ${r.file} (${(r.size / 1024).toFixed(1)} KB)`);
  }, INTERVAL_MS);
  console.log(`🕑 Auto-backup scheduled every ${INTERVAL_HOURS}h (keeping last ${MAX_BACKUPS})`);
}

module.exports = { backupNow, listBackups, getBackupPath, startScheduler, prune };
