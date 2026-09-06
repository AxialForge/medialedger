'use strict';
// SQLite store using Node's built-in node:sqlite (Electron 38 ships Node 22.x).
// No native addon build step, which matters on this machine (Node 24 / ClangCL).
//
// Schema changes go through MIGRATIONS below. The database file lives in the
// user's AppData and is never touched by the installer, so it carries over
// between versions; a copy is taken before any migration runs.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  id            INTEGER PRIMARY KEY,
  root_id       TEXT NOT NULL,
  library_type  TEXT NOT NULL,          -- tv | anime | movie
  rel_path      TEXT NOT NULL,
  abs_path      TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  ext           TEXT,
  size          INTEGER,
  mtime_ms      INTEGER,
  first_seen    TEXT,
  last_seen     TEXT,
  missing       INTEGER DEFAULT 0,      -- 1 when not found on the latest scan
  parse_ok      INTEGER DEFAULT 0,
  parse_note    TEXT,
  show_name     TEXT,
  season        INTEGER,
  episode       INTEGER,
  episode_end   INTEGER,
  episode_title TEXT,
  movie_title   TEXT,
  movie_year    INTEGER,
  edition_tag   TEXT,
  group_key     TEXT,
  probed_at     TEXT,
  probe_ok      INTEGER DEFAULT 0,
  probe_error   TEXT,
  container     TEXT,
  duration_s    REAL,
  bitrate_kbps  INTEGER,
  width         INTEGER,
  height        INTEGER,
  resolution    TEXT,
  fps           REAL,
  video_codec   TEXT,
  video_profile TEXT,
  bit_depth     INTEGER,
  hdr           TEXT,
  audio_count   INTEGER,
  audio_codecs  TEXT,
  audio_langs   TEXT,
  audio_channels TEXT,
  sub_count     INTEGER,
  sub_codecs    TEXT,
  sub_langs     TEXT,
  sub_forced    INTEGER,
  sidecar_subs  TEXT,
  has_captions  INTEGER,
  UNIQUE(root_id, rel_path)
);
CREATE INDEX IF NOT EXISTS idx_files_type ON files(library_type, missing);
CREATE INDEX IF NOT EXISTS idx_files_show ON files(show_name, season, episode);
CREATE INDEX IF NOT EXISTS idx_files_group ON files(group_key);

CREATE TABLE IF NOT EXISTS scans (
  id          INTEGER PRIMARY KEY,
  started     TEXT NOT NULL,
  finished    TEXT,
  status      TEXT,
  trigger     TEXT,
  files_seen  INTEGER DEFAULT 0,
  added       INTEGER DEFAULT 0,
  removed     INTEGER DEFAULT 0,
  modified    INTEGER DEFAULT 0,
  probed      INTEGER DEFAULT 0,
  errors      INTEGER DEFAULT 0,
  note        TEXT
);

CREATE TABLE IF NOT EXISTS changes (
  id        INTEGER PRIMARY KEY,
  scan_id   INTEGER NOT NULL,
  ts        TEXT NOT NULL,
  kind      TEXT NOT NULL,
  library_type TEXT,
  path      TEXT,
  detail    TEXT
);
CREATE INDEX IF NOT EXISTS idx_changes_scan ON changes(scan_id);
`;

// Each migration runs once, in order, inside a transaction. Never edit an old one.
const MIGRATIONS = [
  {
    version: 1, name: 'overrides, exports, ignored files, fix tracking',
    sql: `
      -- Manual corrections keyed by root+path. Re-applied on every scan, so a
      -- fixed file stays fixed no matter how often the library is rescanned.
      CREATE TABLE IF NOT EXISTS overrides (
        id            INTEGER PRIMARY KEY,
        root_id       TEXT NOT NULL,
        rel_path      TEXT NOT NULL,
        library_type  TEXT,
        show_name     TEXT,
        season        INTEGER,
        episode       INTEGER,
        episode_end   INTEGER,
        episode_title TEXT,
        movie_title   TEXT,
        movie_year    INTEGER,
        edition_tag   TEXT,
        ignore        INTEGER DEFAULT 0,   -- 1 = not a media file we care about
        note          TEXT,
        created       TEXT,
        updated       TEXT,
        UNIQUE(root_id, rel_path)
      );
      ALTER TABLE files ADD COLUMN has_override INTEGER DEFAULT 0;
      ALTER TABLE files ADD COLUMN ignored INTEGER DEFAULT 0;
      CREATE TABLE IF NOT EXISTS exports (
        id        INTEGER PRIMARY KEY,
        ts        TEXT NOT NULL,
        scan_id   INTEGER,
        dir       TEXT,
        files     TEXT,
        rows      INTEGER,
        trigger   TEXT
      );
      ALTER TABLE scans ADD COLUMN duration_ms INTEGER;
      ALTER TABLE scans ADD COLUMN threads INTEGER;
    `,
  },
  {
    version: 2, name: 'series metadata, duplicate keep marks, rename history',
    sql: `
      -- Expected episode counts per series from TVmaze / AniList (or entered by hand).
      CREATE TABLE IF NOT EXISTS series_meta (
        id            INTEGER PRIMARY KEY,
        library_type  TEXT NOT NULL,
        show_name     TEXT NOT NULL,
        source        TEXT,               -- tvmaze | anilist | manual | none
        source_id     TEXT,
        matched_title TEXT,
        status        TEXT,               -- Running | Ended | RELEASING | FINISHED …
        seasons       TEXT,               -- JSON {"1": 12, "2": 13}
        total_episodes INTEGER,
        url           TEXT,
        fetched_at    TEXT,
        locked        INTEGER DEFAULT 0,  -- 1 = user chose the match / entered counts; never auto-overwritten
        note          TEXT,
        UNIQUE(library_type, show_name)
      );
      ALTER TABLE overrides ADD COLUMN keep INTEGER;   -- duplicate review: 1 keep, 0 discard candidate, NULL undecided
      CREATE TABLE IF NOT EXISTS renames (
        id        INTEGER PRIMARY KEY,
        ts        TEXT NOT NULL,
        root_id   TEXT,
        from_rel  TEXT,
        to_rel    TEXT,
        ok        INTEGER,
        error     TEXT
      );
    `,
  },
  {
    version: 3, name: 'movie rename batches with undo journal, manual source override',
    sql: `
      ALTER TABLE overrides ADD COLUMN source TEXT;
      CREATE TABLE IF NOT EXISTS rename_batches (
        id         INTEGER PRIMARY KEY,
        ts         TEXT NOT NULL,
        mode       TEXT NOT NULL,
        layout     TEXT NOT NULL,
        status     TEXT NOT NULL,
        planned    INTEGER DEFAULT 0,
        done       INTEGER DEFAULT 0,
        failed     INTEGER DEFAULT 0,
        undone     INTEGER DEFAULT 0,
        finished   TEXT,
        note       TEXT
      );
      CREATE TABLE IF NOT EXISTS rename_items (
        id          INTEGER PRIMARY KEY,
        batch_id    INTEGER NOT NULL,
        file_id     INTEGER,
        root_id     TEXT,
        from_rel    TEXT NOT NULL,
        to_rel      TEXT NOT NULL,
        from_abs    TEXT NOT NULL,
        to_abs      TEXT NOT NULL,
        size        INTEGER,
        status      TEXT NOT NULL,
        error       TEXT,
        ts          TEXT,
        undone_ts   TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_rename_items_batch ON rename_items(batch_id);
    `,
  },
];

class Db {
  constructor(file, { log } = {}) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.file = file;
    this.log = log || (() => {});
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.db.exec(BASE_SCHEMA);
    this._stmts = new Map();
    this.migrate();
  }

  get userVersion() { return Number(this.db.prepare('PRAGMA user_version').get().user_version); }

  migrate() {
    const current = this.userVersion;
    const pending = MIGRATIONS.filter(m => m.version > current);
    if (!pending.length) return;
    this.backup('pre-migration-v' + current);
    for (const m of pending) {
      this.log(`db migrate → v${m.version} (${m.name})`);
      this.db.exec('BEGIN');
      try {
        // Strip comments first (they may contain semicolons or unicode), then split into statements.
        const stripped = m.sql.replace(/--[^\n]*/g, '');
        for (const stmt of stripped.split(';').map(s => s.trim()).filter(Boolean)) {
          try { this.db.exec(stmt); }
          catch (e) { if (!/duplicate column name/i.test(e.message)) throw new Error(`${e.message} in: ${stmt.slice(0, 80)}`); }
        }
        this.db.exec(`PRAGMA user_version = ${m.version}`);
        this.db.exec('COMMIT');
      } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    }
  }

  // Copy the database (checkpointed first) to <file>.backups/<stamp>-<label>.db
  backup(label = 'manual') {
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
    const dir = this.file + '.backups';
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(dir, `${stamp}-${label}.db`);
    fs.copyFileSync(this.file, dest);
    // keep the newest 10
    const all = fs.readdirSync(dir).filter(f => f.endsWith('.db')).sort();
    for (const f of all.slice(0, Math.max(0, all.length - 10))) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ } }
    return dest;
  }
  listBackups() {
    const dir = this.file + '.backups';
    try { return fs.readdirSync(dir).filter(f => f.endsWith('.db')).sort().reverse().map(f => { const st = fs.statSync(path.join(dir, f)); return { file: path.join(dir, f), name: f, size: st.size, mtime: st.mtime.toISOString() }; }); }
    catch { return []; }
  }
  checkpoint() { try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ } }
  stats() {
    const st = fs.statSync(this.file);
    return { file: this.file, size: st.size, version: this.userVersion, files: this.get('SELECT COUNT(*) n FROM files').n, scans: this.get('SELECT COUNT(*) n FROM scans').n, changes: this.get('SELECT COUNT(*) n FROM changes').n, overrides: this.get('SELECT COUNT(*) n FROM overrides').n, backups: this.listBackups().length };
  }

  prep(sql) {
    let s = this._stmts.get(sql);
    if (!s) { s = this.db.prepare(sql); this._stmts.set(sql, s); }
    return s;
  }
  run(sql, ...args) { return this.prep(sql).run(...args); }
  get(sql, ...args) { return this.prep(sql).get(...args); }
  all(sql, ...args) { return this.prep(sql).all(...args); }
  exec(sql) { return this.db.exec(sql); }
  transaction(fn) {
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  close() { this.checkpoint(); this.db.close(); }

  // ---- files -------------------------------------------------------------
  getFileByPath(rootId, relPath) {
    return this.get('SELECT * FROM files WHERE root_id = ? AND rel_path = ?', rootId, relPath);
  }
  allFilesForRoot(rootId) {
    return this.all('SELECT id, rel_path, size, mtime_ms, missing, probe_ok, sub_count FROM files WHERE root_id = ?', rootId);
  }
  upsertFile(rec) {
    const cols = Object.keys(rec);
    const sql = `INSERT INTO files (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
      ON CONFLICT(root_id, rel_path) DO UPDATE SET ${cols.filter(c => c !== 'root_id' && c !== 'rel_path' && c !== 'first_seen').map(c => `${c}=excluded.${c}`).join(',')}`;
    return this.run(sql, ...cols.map(c => rec[c] ?? null));
  }
  updateFile(id, patch) {
    const cols = Object.keys(patch);
    if (!cols.length) return;
    this.run(`UPDATE files SET ${cols.map(c => `${c}=?`).join(',')} WHERE id=?`, ...cols.map(c => patch[c] ?? null), id);
  }
  markMissing(ids, ts) {
    if (!ids.length) return;
    const s = this.prep('UPDATE files SET missing=1, last_seen=? WHERE id=?');
    for (const id of ids) s.run(ts, id);
  }

  // ---- overrides -----------------------------------------------------------
  allOverridesForRoot(rootId) {
    return new Map(this.all('SELECT * FROM overrides WHERE root_id = ?', rootId).map(o => [o.rel_path, o]));
  }
  getOverride(rootId, relPath) { return this.get('SELECT * FROM overrides WHERE root_id=? AND rel_path=?', rootId, relPath); }
  saveOverride(o) {
    const now = new Date().toISOString();
    const cols = ['root_id', 'rel_path', 'library_type', 'show_name', 'season', 'episode', 'episode_end', 'episode_title', 'movie_title', 'movie_year', 'edition_tag', 'ignore', 'note', 'keep', 'source'];
    const vals = cols.map(c => o[c] ?? null);
    this.run(`INSERT INTO overrides (${cols.join(',')}, created, updated) VALUES (${cols.map(() => '?').join(',')}, ?, ?)
      ON CONFLICT(root_id, rel_path) DO UPDATE SET ${cols.filter(c => c !== 'root_id' && c !== 'rel_path').map(c => `${c}=excluded.${c}`).join(',')}, updated=excluded.updated`, ...vals, now, now);
    return this.getOverride(o.root_id, o.rel_path);
  }
  deleteOverride(id) { return this.run('DELETE FROM overrides WHERE id=?', id).changes; }
  listOverrides() { return this.all('SELECT o.*, f.id AS file_id, f.parse_ok FROM overrides o LEFT JOIN files f ON f.root_id=o.root_id AND f.rel_path=o.rel_path ORDER BY o.updated DESC'); }

  // ---- series metadata ------------------------------------------------------
  getSeriesMeta(type, show) { return this.get('SELECT * FROM series_meta WHERE library_type=? AND show_name=?', type, show); }
  allSeriesMeta(type) { return new Map(this.all('SELECT * FROM series_meta WHERE library_type=?', type).map(m => [m.show_name, m])); }
  saveSeriesMeta(m) {
    const cols = ['library_type', 'show_name', 'source', 'source_id', 'matched_title', 'status', 'seasons', 'total_episodes', 'url', 'fetched_at', 'locked', 'note'];
    const vals = cols.map(c => c === 'seasons' && m[c] && typeof m[c] !== 'string' ? JSON.stringify(m[c]) : (m[c] ?? null));
    this.run(`INSERT INTO series_meta (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
      ON CONFLICT(library_type, show_name) DO UPDATE SET ${cols.filter(c => c !== 'library_type' && c !== 'show_name').map(c => `${c}=excluded.${c}`).join(',')}`, ...vals);
    return this.getSeriesMeta(m.library_type, m.show_name);
  }
  deleteSeriesMeta(type, show) { return this.run('DELETE FROM series_meta WHERE library_type=? AND show_name=?', type, show).changes; }
  // ---- movie rename batches ------------------------------------------------
  createBatch(mode, layout, note) { return Number(this.run('INSERT INTO rename_batches (ts, mode, layout, status, note) VALUES (?,?,?,?,?)', new Date().toISOString(), mode, layout, 'running', note || null).lastInsertRowid); }
  finishBatch(id, patch) { const cols = Object.keys(patch); this.run(`UPDATE rename_batches SET finished=?, ${cols.map(c => `${c}=?`).join(',')} WHERE id=?`, new Date().toISOString(), ...cols.map(c => patch[c]), id); }
  addBatchItem(it) { return Number(this.run('INSERT INTO rename_items (batch_id, file_id, root_id, from_rel, to_rel, from_abs, to_abs, size, status, error, ts) VALUES (?,?,?,?,?,?,?,?,?,?,?)', it.batch_id, it.file_id, it.root_id, it.from_rel, it.to_rel, it.from_abs, it.to_abs, it.size, it.status, it.error || null, new Date().toISOString()).lastInsertRowid); }
  updateBatchItem(id, patch) { const cols = Object.keys(patch); this.run(`UPDATE rename_items SET ${cols.map(c => `${c}=?`).join(',')} WHERE id=?`, ...cols.map(c => patch[c]), id); }
  listBatches(limit = 50) { return this.all('SELECT * FROM rename_batches ORDER BY id DESC LIMIT ?', limit); }
  batchItems(batchId) { return this.all('SELECT * FROM rename_items WHERE batch_id=? ORDER BY id', batchId); }
  getBatch(id) { return this.get('SELECT * FROM rename_batches WHERE id=?', id); }

  addRename(rec) { this.run('INSERT INTO renames (ts, root_id, from_rel, to_rel, ok, error) VALUES (?,?,?,?,?,?)', new Date().toISOString(), rec.root_id, rec.from_rel, rec.to_rel, rec.ok ? 1 : 0, rec.error || null); }
  listRenames(limit = 500) { return this.all('SELECT * FROM renames ORDER BY id DESC LIMIT ?', limit); }

  // ---- scans / changes / exports ------------------------------------------
  startScan(trigger, threads) {
    const r = this.run('INSERT INTO scans (started, status, trigger, threads) VALUES (?, ?, ?, ?)', new Date().toISOString(), 'running', trigger, threads ?? null);
    return Number(r.lastInsertRowid);
  }
  finishScan(id, patch) {
    const cols = Object.keys(patch);
    this.run(`UPDATE scans SET finished=?, ${cols.map(c => `${c}=?`).join(',')} WHERE id=?`, new Date().toISOString(), ...cols.map(c => patch[c]), id);
  }
  addChange(scanId, kind, libraryType, p, detail) {
    this.run('INSERT INTO changes (scan_id, ts, kind, library_type, path, detail) VALUES (?,?,?,?,?,?)',
      scanId, new Date().toISOString(), kind, libraryType, p, detail ? JSON.stringify(detail) : null);
  }
  recentScans(limit = 30) { return this.all('SELECT * FROM scans ORDER BY id DESC LIMIT ?', limit); }
  changesForScan(scanId, limit = 5000) { return this.all('SELECT * FROM changes WHERE scan_id = ? ORDER BY id LIMIT ?', scanId, limit); }
  recentChanges(limit = 200) { return this.all('SELECT c.*, s.started AS scan_started FROM changes c JOIN scans s ON s.id = c.scan_id ORDER BY c.id DESC LIMIT ?', limit); }
  addExport(rec) { this.run('INSERT INTO exports (ts, scan_id, dir, files, rows, trigger) VALUES (?,?,?,?,?,?)', new Date().toISOString(), rec.scan_id ?? null, rec.dir, JSON.stringify(rec.files), rec.rows ?? null, rec.trigger || 'manual'); }
  listExports(limit = 50) { return this.all('SELECT * FROM exports ORDER BY id DESC LIMIT ?', limit); }
}

module.exports = { Db, MIGRATIONS };
