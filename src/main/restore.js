'use strict';
// Full backups and restore. A backup set is up to three files sharing one stamp:
//   medialedger-<stamp>.db              the database (always)
//   medialedger-<stamp>.settings.json   settings.json
//   medialedger-<stamp>.web.json        web accounts, sessions, 2FA secrets (web server only)
//
// Restoring never touches a live database. stageRestore() validates the set and copies it to
// <data>/restore-pending/; the shell restarts; applyPendingRestore() runs first thing on startup,
// before anything opens the files, moves the current ones aside into <data>/pre-restore-<stamp>/
// and puts the staged ones in place.
const fs = require('fs');
const path = require('path');

const SET_RE = /^medialedger-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.(db|settings\.json|web\.json)$/;
const stampNow = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/** Copy the companions of a database backup next to it. Returns the files written. */
function copyCompanions(dataDir, destDir, stamp) {
  const out = [];
  for (const [src, suffix] of [['settings.json', 'settings.json'], ['web.json', 'web.json']]) {
    const from = path.join(dataDir, src);
    if (!fs.existsSync(from)) continue;
    const to = path.join(destDir, `medialedger-${stamp}.${suffix}`);
    fs.copyFileSync(from, to);
    try { fs.chmodSync(to, 0o600); } catch { /* windows / cifs */ }
    out.push(to);
  }
  return out;
}

/** Group a folder's backup files into sets, newest first. */
function listSets(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const sets = new Map();
  for (const f of fs.readdirSync(dir)) {
    const m = SET_RE.exec(f); if (!m) continue;
    const s = sets.get(m[1]) || { stamp: m[1], files: {}, bytes: 0 };
    const st = fs.statSync(path.join(dir, f));
    s.files[m[2] === 'db' ? 'db' : m[2] === 'web.json' ? 'web' : 'settings'] = f; s.bytes += st.size;
    sets.set(m[1], s);
  }
  return [...sets.values()].filter(s => s.files.db).sort((a, b) => b.stamp.localeCompare(a.stamp))
    .map(s => ({ ...s, when: s.stamp.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3Z') }));
}

/** Delete every set beyond the newest `keep`. */
function pruneSets(dir, keep) {
  const sets = listSets(dir); const drop = sets.slice(Math.max(1, Number(keep) || 7));
  for (const s of drop) for (const f of Object.values(s.files)) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ } }
  return drop.length;
}

/** Open a backup read-only and check it is a healthy MediaLedger database no newer than this build understands. */
function validateDb(file, maxVersion) {
  const { DatabaseSync } = require('node:sqlite');
  const d = new DatabaseSync(file, { readOnly: true });
  try {
    const ok = d.prepare('PRAGMA integrity_check').get();
    if (!ok || Object.values(ok)[0] !== 'ok') throw new Error('The backup failed its integrity check');
    const v = Number(d.prepare('PRAGMA user_version').get().user_version);
    if (maxVersion != null && v > maxVersion) throw new Error(`The backup is schema v${v}; this build understands up to v${maxVersion}. Update MediaLedger first.`);
    const files = d.prepare('SELECT COUNT(*) n FROM files').get().n;
    return { version: v, files };
  } finally { d.close(); }
}

/** Validate a set and copy it to <data>/restore-pending/. what: { settings: bool, web: bool } */
function stageRestore(dataDir, dir, stamp, what = {}, maxVersion = null) {
  const set = listSets(dir).find(s => s.stamp === stamp);
  if (!set) throw new Error('That backup is no longer in the folder');
  const info = validateDb(path.join(dir, set.files.db), maxVersion);
  const pend = path.join(dataDir, 'restore-pending');
  fs.rmSync(pend, { recursive: true, force: true }); fs.mkdirSync(pend, { recursive: true });
  fs.copyFileSync(path.join(dir, set.files.db), path.join(pend, 'medialedger.db'));
  if (what.settings && set.files.settings) { JSON.parse(fs.readFileSync(path.join(dir, set.files.settings), 'utf8')); fs.copyFileSync(path.join(dir, set.files.settings), path.join(pend, 'settings.json')); }
  if (what.web && set.files.web) { JSON.parse(fs.readFileSync(path.join(dir, set.files.web), 'utf8')); fs.copyFileSync(path.join(dir, set.files.web), path.join(pend, 'web.json')); }
  fs.writeFileSync(path.join(pend, 'READY'), JSON.stringify({ stamp, staged: new Date().toISOString(), ...info }));
  return { ...info, stamp, restored: fs.readdirSync(pend).filter(f => f !== 'READY') };
}

/** Run before anything opens the data files. Returns what was restored, or null. Never throws. */
function applyPendingRestore(dataDir, log = () => {}) {
  const pend = path.join(dataDir, 'restore-pending');
  try {
    if (!fs.existsSync(path.join(pend, 'READY'))) { if (fs.existsSync(pend)) fs.rmSync(pend, { recursive: true, force: true }); return null; }
    const meta = JSON.parse(fs.readFileSync(path.join(pend, 'READY'), 'utf8'));
    const aside = path.join(dataDir, 'pre-restore-' + stampNow()); fs.mkdirSync(aside, { recursive: true });
    const done = [];
    for (const f of ['medialedger.db', 'settings.json', 'web.json']) {
      const staged = path.join(pend, f); if (!fs.existsSync(staged)) continue;
      const live = path.join(dataDir, f);
      if (fs.existsSync(live)) fs.renameSync(live, path.join(aside, f));
      if (f === 'medialedger.db') for (const ext of ['-wal', '-shm']) { try { fs.renameSync(live + ext, path.join(aside, f + ext)); } catch { /* none */ } }
      fs.renameSync(staged, live);
      if (f === 'web.json') { try { fs.chmodSync(live, 0o600); } catch { /* windows */ } }
      done.push(f);
    }
    fs.rmSync(pend, { recursive: true, force: true });
    log(`restore: backup ${meta.stamp} put in place (${done.join(', ')}); the previous files are in ${aside}`);
    return { stamp: meta.stamp, files: done, aside };
  } catch (e) {
    log('restore failed, nothing changed beyond what is logged: ' + e.message);
    try { fs.rmSync(pend, { recursive: true, force: true }); } catch { /* ignore */ }
    return null;
  }
}

module.exports = { copyCompanions, listSets, pruneSets, validateDb, stageRestore, applyPendingRestore, stampNow };
