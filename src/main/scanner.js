'use strict';
// Walks each configured root, diffs against the database, applies manual
// overrides, probes new/changed files with ffprobe, and writes a change log.
//
// Two walk strategies, chosen in Settings:
//   - single-threaded: one recursive walk per root (simple, gentle on the NAS)
//   - multi-threaded:  the root's top-level folders are dealt out to N worker
//     threads (src/main/scanWorker.js) that readdir/stat/parse in parallel, so
//     SMB round-trips overlap. On a 24k-file share this is the difference
//     between minutes and seconds for the listing phase.
// ffprobe is always a pool of child processes; its size is a separate setting.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { Worker } = require('worker_threads');
const { parseEpisode, parseMovie, parseFor, movieGroupKey } = require('./parse');
const { findFfprobe, probe } = require('./ffprobe');

function globToRe(g) {
  return new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
}

// Merge a manual override into a parse result. Only non-null override fields win.
function applyOverride(parsed, ov, type) {
  type = parsed.library_type || type;
  if (!ov) return { ...parsed, has_override: 0 };
  const out = { ...parsed, has_override: 1 };
  const fields = type === 'movie' ? ['movie_title', 'movie_year', 'edition_tag'] : ['show_name', 'season', 'episode', 'episode_end', 'episode_title', 'edition_tag'];
  for (const f of fields) if (ov[f] !== null && ov[f] !== undefined && ov[f] !== '') out[f] = ov[f];
  if (type === 'movie') { out.group_key = movieGroupKey(out.movie_title, out.movie_year); out.parse_ok = out.movie_title ? 1 : 0; }
  else if (type === 'web') out.parse_ok = 1;
  else out.parse_ok = (out.episode != null && out.season != null) ? 1 : 0;
  if (out.parse_ok) out.parse_note = 'manual override';
  return out;
}

class Scanner {
  constructor(db, settings, { log } = {}) {
    this.db = db;
    this.settings = settings;
    this.log = log || (() => {});
    this.running = false;
    this.cancelRequested = false;
    this.progress = null;
    this.listeners = new Set();
    this.workers = [];
  }

  onProgress(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(p) { this.progress = { ...p, ts: Date.now() }; for (const fn of this.listeners) { try { fn(this.progress); } catch { /* ignore */ } } }
  cancel() { if (this.running) this.cancelRequested = true; }

  // ---- walking -------------------------------------------------------------
  async _walkSingle(root, cfg, onCount) {
    const videoExt = new Set(cfg.videoExtensions.map(e => e.toLowerCase()));
    const subExt = new Set(cfg.subtitleExtensions.map(e => e.toLowerCase()));
    const ignore = (cfg.ignorePatterns || []).map(globToRe);
    const videos = [], sidecars = [], errors = [];
    const walk = async (dir, rel) => {
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
      catch (e) { errors.push({ rel, message: 'readdir failed: ' + e.message }); return; }
      for (const d of entries) {
        if (this.cancelRequested) return;
        if (ignore.some(re => re.test(d.name))) continue;
        const abs = path.join(dir, d.name);
        const r = rel ? rel + '\\' + d.name : d.name;
        if (d.isDirectory()) { await walk(abs, r); continue; }
        if (!d.isFile()) continue;
        const ext = path.extname(d.name).slice(1).toLowerCase();
        if (videoExt.has(ext)) {
          let st; try { st = await fsp.stat(abs); } catch { continue; }
          videos.push({ rel: r, abs, ext, name: d.name, size: st.size, mtime: Math.floor(st.mtimeMs), parsed: parseFor(root.type, r, cfg.adult && cfg.adult.defaultSubtype) });
          if (videos.length % 250 === 0) onCount(videos.length);
        } else if (subExt.has(ext)) {
          const base = d.name.replace(/\.[^.]+$/, '');
          const stem = base.replace(/\.(eng|en|jpn|ja|jp|spa|es|fre|fr|ger|de|forced|sdh|cc)(\.[a-z]{2,6})*$/i, '');
          sidecars.push({ key: (rel + '|' + stem).toLowerCase(), name: d.name });
        }
      }
    };
    await walk(root.path, '');
    return { videos, sidecars, errors };
  }

  _startWorkers(n, cfg) {
    const data = { videoExt: cfg.videoExtensions.map(e => e.toLowerCase()), subExt: cfg.subtitleExtensions.map(e => e.toLowerCase()), ignore: cfg.ignorePatterns || [], statConcurrency: 8, adultDefault: cfg.adult && cfg.adult.defaultSubtype };
    this.workers = Array.from({ length: n }, () => ({ w: new Worker(path.join(__dirname, 'scanWorker.js'), { workerData: data }), busy: false }));
  }
  _stopWorkers() { for (const { w } of this.workers) { try { w.postMessage({ type: 'exit' }); w.terminate(); } catch { /* ignore */ } } this.workers = []; }

  async _walkThreaded(root, cfg, onCount) {
    // Deal top-level folders (shows) to workers; loose files at the root go in one job.
    let top;
    try { top = await fsp.readdir(root.path, { withFileTypes: true }); }
    catch (e) { return { videos: [], sidecars: [], errors: [{ rel: '', message: 'readdir failed: ' + e.message }] }; }
    const ignore = (cfg.ignorePatterns || []).map(globToRe);
    const jobs = top.filter(d => d.isDirectory() && !ignore.some(re => re.test(d.name))).map(d => ({ rootPath: root.path, rootType: root.type, startRel: d.name }));

    const videos = [], sidecars = [], errors = [];
    let counted = 0, nextId = 1;
    const results = new Map();
    const perWorkerCount = new Map();
    const runJob = (slot, job) => new Promise(resolve => {
      const id = nextId++;
      const onMsg = (m) => {
        if (m.type === 'progress') { perWorkerCount.set(id, m.count); const total = [...perWorkerCount.values()].reduce((a, b) => a + b, 0) + counted; onCount(total); }
        if (m.type === 'result' && m.id === id) { slot.w.off('message', onMsg); perWorkerCount.delete(id); resolve(m); }
      };
      slot.w.on('message', onMsg);
      slot.w.postMessage({ type: 'walk', id, job });
    });

    const looseFiles = top.filter(d => d.isFile() && !ignore.some(re => re.test(d.name)));
    if (looseFiles.length) {
      // Split loose files across workers too (the Movies root is 1.5k flat files)
      const chunk = Math.ceil(looseFiles.length / Math.max(1, this.workers.length));
      for (let i = 0; i < looseFiles.length; i += chunk) jobs.push({ rootPath: root.path, rootType: root.type, startRel: '', files: looseFiles.slice(i, i + chunk).map(d => d.name) });
    }
    const queue = jobs.slice();
    const runners = this.workers.map(async (slot) => {
      while (queue.length && !this.cancelRequested) {
        const job = queue.shift();
        const r = await runJob(slot, job);
        videos.push(...r.videos); sidecars.push(...r.sidecars); errors.push(...r.errors);
        counted = videos.length; onCount(counted);
      }
    });
    await Promise.all(runners);
    return { videos, sidecars, errors };
  }

  // ---- main entry ------------------------------------------------------------
  async scan(trigger = 'manual') {
    if (this.running) throw new Error('A scan is already running');
    this.running = true;
    this.cancelRequested = false;
    const t0 = Date.now();
    const cfg = this.settings.get();
    const db = this.db;
    const threads = cfg.multiThreaded ? Math.max(2, Math.min(32, Number(cfg.scanThreads) || Math.max(2, os.cpus().length - 1))) : 1;
    const scanId = db.startScan(trigger, threads);
    const nowIso = new Date().toISOString();
    const counters = { files_seen: 0, added: 0, removed: 0, modified: 0, probed: 0, errors: 0 };
    const probeQueue = [];

    try {
      const ffprobePath = findFfprobe(cfg.ffprobePath);
      if (!ffprobePath) db.addChange(scanId, 'warning', null, null, { message: 'ffprobe not found; files were indexed but not probed' });
      if (threads > 1) this._startWorkers(threads, cfg);

      for (const root of cfg.roots.filter(r => r.enabled)) {
        if (this.cancelRequested) break;
        this._emit({ phase: 'walk', root: root.label, done: 0, total: 0, message: `Listing files… (${threads > 1 ? threads + ' threads' : '1 thread'})` });

        let stat;
        try { stat = await fsp.stat(root.path); } catch { stat = null; }
        if (!stat || !stat.isDirectory()) {
          db.addChange(scanId, 'root_offline', root.type, root.path, { message: 'Root not reachable; its files were left untouched' });
          counters.errors++;
          continue;
        }

        const onCount = n => this._emit({ phase: 'walk', root: root.label, done: n, total: 0, message: `Listing files… ${n.toLocaleString()}` });
        const { videos, sidecars, errors } = threads > 1 ? await this._walkThreaded(root, cfg, onCount) : await this._walkSingle(root, cfg, onCount);
        for (const e of errors) { db.addChange(scanId, 'probe_error', root.type, e.rel || root.path, { message: e.message }); counters.errors++; }
        if (this.cancelRequested) break;
        counters.files_seen += videos.length;

        const sidecarMap = new Map();
        for (const s of sidecars) { if (!sidecarMap.has(s.key)) sidecarMap.set(s.key, []); sidecarMap.get(s.key).push(s.name); }

        // ---- diff against db -------------------------------------------------
        const existing = new Map(db.allFilesForRoot(root.id).map(r => [r.rel_path, r]));
        const overrides = db.allOverridesForRoot(root.id);
        const seen = new Set();
        this._emit({ phase: 'index', root: root.label, done: 0, total: videos.length, message: 'Indexing…' });

        db.transaction(() => {
          let i = 0;
          for (const v of videos) {
            seen.add(v.rel);
            const dirRel = v.rel.includes('\\') ? v.rel.slice(0, v.rel.lastIndexOf('\\')) : '';
            const stem = v.name.replace(/\.[^.]+$/, '');
            const sidecar = sidecarMap.get((dirRel + '|' + stem).toLowerCase()) || [];
            const ov = overrides.get(v.rel);
            const parsed = applyOverride(v.parsed, ov, root.type);
            const prev = existing.get(v.rel);
            const rec = {
              root_id: root.id, library_type: root.type, rel_path: v.rel, abs_path: v.abs, file_name: v.name, ext: v.ext,
              size: v.size, mtime_ms: v.mtime, first_seen: nowIso, last_seen: nowIso, missing: 0,
              sidecar_subs: sidecar.join(';') || null, ignored: ov && ov.ignore ? 1 : 0,
              ...parsed,
            };
            let kind = null;
            if (!prev) { kind = 'added'; counters.added++; }
            else if (prev.missing) { kind = 'returned'; }
            else if (prev.size !== v.size || prev.mtime_ms !== v.mtime) { kind = 'modified'; counters.modified++; }
            db.upsertFile(rec);
            const id = prev ? prev.id : db.getFileByPath(root.id, v.rel).id;
            const needsProbe = ffprobePath && !rec.ignored && (kind === 'added' || kind === 'modified' || !prev || !prev.probe_ok || cfg.reprobeUnchanged);
            if (needsProbe) {
              probeQueue.push({ id, abs: v.abs, rel: v.rel, type: root.type, kind, before: prev ? db.get('SELECT resolution, duration_s, size, video_codec, sub_count FROM files WHERE id=?', id) : null });
            } else {
              if (kind) db.addChange(scanId, kind, root.type, v.rel, { size: v.size, prev_size: prev ? prev.size : undefined });
              db.updateFile(id, { has_captions: (sidecar.length > 0 || (prev && prev.sub_count > 0)) ? 1 : (prev && prev.probe_ok ? 0 : null) });
            }
            if (++i % 500 === 0) this._emit({ phase: 'index', root: root.label, done: i, total: videos.length, message: 'Indexing…' });
          }
          const gone = [];
          for (const [rel, row] of existing) if (!seen.has(rel) && !row.missing) { gone.push(row.id); db.addChange(scanId, 'removed', root.type, rel, { size: row.size }); }
          db.markMissing(gone, nowIso);
          counters.removed += gone.length;
        });
      }
      this._stopWorkers();

      // ---- probe -----------------------------------------------------------
      if (!this.cancelRequested && probeQueue.length) {
        const total = probeQueue.length;
        let done = 0, idx = 0;
        const conc = Math.max(1, Math.min(32, Number(cfg.probeConcurrency) || 4));
        const started = Date.now();
        this._emit({ phase: 'probe', done, total, message: `Probing ${total.toLocaleString()} files…` });
        const worker = async () => {
          while (!this.cancelRequested) {
            const job = probeQueue[idx++];
            if (!job) return;
            const res = await probe(ffprobePath, job.abs);
            const row = db.get('SELECT sidecar_subs FROM files WHERE id=?', job.id);
            const hasSidecar = !!(row && row.sidecar_subs);
            const patch = { ...res, probed_at: new Date().toISOString() };
            patch.has_captions = res.probe_ok ? ((res.sub_count > 0 || hasSidecar) ? 1 : 0) : (hasSidecar ? 1 : null);
            db.updateFile(job.id, patch);
            counters.probed++;
            if (!res.probe_ok) { counters.errors++; db.addChange(scanId, 'probe_error', job.type, job.rel, { message: res.probe_error }); }
            if (job.kind) {
              const after = { resolution: res.resolution, duration_s: res.duration_s, video_codec: res.video_codec, sub_count: res.sub_count };
              db.addChange(scanId, job.kind, job.type, job.rel, job.before ? { before: job.before, after } : after);
            }
            done++;
            if (done % 10 === 0 || done === total) {
              const rate = done / Math.max(1, (Date.now() - started) / 1000);
              const eta = rate > 0 ? Math.round((total - done) / rate) : null;
              this._emit({ phase: 'probe', done, total, message: `Probing ${done.toLocaleString()}/${total.toLocaleString()} · ${rate.toFixed(1)}/s${eta != null ? ' · ~' + fmtEta(eta) + ' left' : ''}`, file: job.rel });
            }
          }
        };
        await Promise.all(Array.from({ length: conc }, worker));
      }

      const status = this.cancelRequested ? 'cancelled' : 'done';
      db.finishScan(scanId, { status, duration_ms: Date.now() - t0, ...counters });
      this._emit({ phase: 'done', status, scanId, duration_ms: Date.now() - t0, ...counters, message: status === 'done' ? 'Scan complete' : 'Scan cancelled' });
      return { scanId, status, duration_ms: Date.now() - t0, ...counters };
    } catch (e) {
      counters.errors++;
      db.finishScan(scanId, { status: 'failed', note: e.stack || String(e), duration_ms: Date.now() - t0, ...counters });
      this._emit({ phase: 'done', status: 'failed', message: e.message });
      throw e;
    } finally {
      this._stopWorkers();
      this.running = false;
    }
  }

  // Re-run the parser (plus overrides) over every indexed row. Used when the
  // parser improves so users get the fix without waiting for a rescan.
  _rootType(rootId, fallback) { const r = (this.settings.get().roots || []).find(x => x.id === rootId); return r ? r.type : fallback; }
  reparseAll() {
    const rows = this.db.all('SELECT id, root_id, rel_path, library_type FROM files');
    const ovCache = new Map();
    let changed = 0;
    this.db.transaction(() => {
      for (const f of rows) {
        if (!ovCache.has(f.root_id)) ovCache.set(f.root_id, this.db.allOverridesForRoot(f.root_id));
        const ov = ovCache.get(f.root_id).get(f.rel_path);
        const base = parseFor(this._rootType(f.root_id, f.library_type), f.rel_path, this.settings.get().adult && this.settings.get().adult.defaultSubtype);
        const merged = applyOverride(base, ov, f.library_type);
        this.db.updateFile(f.id, { ...merged, ignored: ov && ov.ignore ? 1 : 0 });
        changed++;
      }
    });
    return changed;
  }

  // Re-apply overrides to already-indexed rows without touching the share.
  reapplyOverride(rootId, relPath) {
    const f = this.db.getFileByPath(rootId, relPath);
    if (!f) return null;
    const ov = this.db.getOverride(rootId, relPath);
    const base = parseFor(this._rootType(rootId, f.library_type), relPath, this.settings.get().adult && this.settings.get().adult.defaultSubtype);
    const merged = applyOverride(base, ov, f.library_type);
    this.db.updateFile(f.id, { ...merged, ignored: ov && ov.ignore ? 1 : 0 });
    return this.db.getFileByPath(rootId, relPath);
  }
}

function fmtEta(s) { if (s < 90) return s + 's'; const m = Math.round(s / 60); return m < 90 ? m + 'm' : (m / 60).toFixed(1) + 'h'; }

module.exports = { Scanner, applyOverride };
