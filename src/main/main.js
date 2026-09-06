'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Settings } = require('./settings');
const { Db } = require('./db');
const { Scanner } = require('./scanner');
const { Scheduler } = require('./scheduler');
const { Watcher } = require('./watcher');
const { exportAll } = require('./exportCsv');
const { findFfprobe } = require('./ffprobe');
const { PARSER_VERSION } = require('./parse');
const ffmpegdl = require('./ffmpegdl');
const updater = require('./updater');
const metadata = require('./metadata');
const renamer = require('./renamer');
const { planMovieNames } = require('./movieNamer');
const movieRename = require('./movieRename');
const plex = require('./plex');

const HEADLESS = process.argv.includes('--scan');
// `--profile=<dir>`: use a separate data folder (dev/testing next to an installed copy).
const profileArg = process.argv.find(a => a.startsWith('--profile='));
if (profileArg) app.setPath('userData', profileArg.slice('--profile='.length));
const gotLock = app.requestSingleInstanceLock({ scan: HEADLESS });

if (!gotLock) {
  // Another instance is open; it receives our argv via 'second-instance' and runs the scan itself.
  app.quit();
} else {
  let win = null;
  let settings, db, scanner, scheduler, watcher;
  let updateStatus = { state: 'idle' };
  let metaJob = { running: false, done: 0, total: 0, message: '' };
  const userData = app.getPath('userData');
  const logFile = path.join(userData, 'medialedger.log');
  const log = (...a) => { const line = `[${new Date().toISOString()}] ${a.join(' ')}\n`; try { fs.appendFileSync(logFile, line); } catch { /* ignore */ } if (!app.isPackaged) process.stdout.write(line); };
  const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

  function exportDir() { return settings.get().csvOutputDir || path.join(userData, 'exports'); }
  function ffprobePath() { return findFfprobe(settings.get().ffprobePath) || ffmpegdl.installedFfprobe(userData); }

  function runExport(scanId, trigger) {
    const out = exportAll(db, exportDir(), scanId, settings.get());
    db.addExport({ scan_id: scanId, dir: out.dir, files: out.files, rows: out.rows, trigger });
    return out;
  }

  // Exclusive lock held while a live movie-rename batch runs; scans and the watcher back off.
  let renameLock = null; // { rootId, since }

  async function runScan(trigger) {
    if (scanner.running) return { skipped: true, reason: 'already running' };
    if (renameLock) { log(`scan (${trigger}) skipped: rename batch in progress on ${renameLock.rootId}`); return { skipped: true, reason: 'a rename batch is running; try again when it finishes' }; }
    log(`scan start (${trigger})`);
    const result = await scanner.scan(trigger);
    scheduler.noteRun();
    log(`scan ${result.status} in ${Math.round(result.duration_ms / 1000)}s: seen=${result.files_seen} added=${result.added} removed=${result.removed} modified=${result.modified} probed=${result.probed} errors=${result.errors}`);
    if (result.status === 'done' && settings.get().metadata.enabled) {
      try { await refreshMetadata({ onlyNew: true }); } catch (e) { log('metadata failed: ' + e.message); }
    }
    if (settings.get().autoExportAfterScan && result.status === 'done') {
      try { const out = runExport(result.scanId, trigger); log('exported to ' + out.dir); result.export = out; }
      catch (e) { log('export failed: ' + e.message); }
    }
    db.checkpoint();
    return result;
  }

  // ---- series metadata (expected episode counts) ---------------------------------
  async function refreshMetadata({ onlyNew = true, type = null, shows = null } = {}) {
    if (metaJob.running) return { skipped: true };
    const cfg = settings.get().metadata;
    const types = type ? [type] : ['tv', 'anime'];
    const todo = [];
    const staleBefore = new Date(Date.now() - (Number(cfg.refreshDays) || 14) * 86400000).toISOString();
    for (const t of types) {
      const have = db.allSeriesMeta(t);
      const series = db.all(`SELECT DISTINCT show_name FROM files WHERE library_type=? AND missing=0 AND ignored=0 AND show_name IS NOT NULL ORDER BY show_name`, t).map(r => r.show_name);
      for (const s of series) {
        if (shows && !shows.includes(s)) continue;
        const m = have.get(s);
        if (m && m.locked) continue;
        if (onlyNew && m && m.fetched_at && !(m.status && /running|releasing|airing/i.test(m.status) && m.fetched_at < staleBefore)) continue;
        todo.push({ type: t, show: s });
      }
    }
    metaJob = { running: true, done: 0, total: todo.length, message: 'Looking up expected episode counts…' };
    send('meta:progress', metaJob);
    let found = 0, missed = 0, failed = 0;
    try {
      for (const { type: t, show } of todo) {
        try {
          const r = await metadata.lookupSeries(t, show);
          if (r.found) { found++; db.saveSeriesMeta({ library_type: t, show_name: show, source: r.source, source_id: r.source_id, matched_title: r.matched_title, status: r.status, seasons: r.seasons, total_episodes: r.total_episodes, url: r.url, fetched_at: new Date().toISOString(), locked: 0 }); }
          else { missed++; db.saveSeriesMeta({ library_type: t, show_name: show, source: 'none', fetched_at: new Date().toISOString(), locked: 0, note: r.candidates ? 'no confident match' : 'not found' }); }
        } catch (e) { failed++; log(`metadata ${t} "${show}": ${e.message}`); if (/HTTP 429/.test(e.message)) await new Promise(r => setTimeout(r, 10000)); }
        metaJob.done++; metaJob.message = `Looking up ${t === 'anime' ? 'AniList' : 'TVmaze'}: ${show}`;
        if (metaJob.done % 3 === 0 || metaJob.done === metaJob.total) send('meta:progress', metaJob);
        await new Promise(r => setTimeout(r, t === 'anime' ? 800 : 550)); // stay under both rate limits
      }
    } finally {
      metaJob = { running: false, done: metaJob.done, total: metaJob.total, message: `Done: ${found} matched, ${missed} unmatched, ${failed} errors` };
      send('meta:progress', metaJob);
      log(`metadata: ${found} matched, ${missed} unmatched, ${failed} errors of ${todo.length}`);
    }
    return { found, missed, failed, total: todo.length };
  }

  // Missing-episode summary for every series of a type (used by dashboard, series list, CSV, Missing view).
  function missingSummary(type) {
    const metas = db.allSeriesMeta(type);
    const rows = db.all(`SELECT show_name, season, episode, episode_end FROM files WHERE library_type=? AND missing=0 AND ignored=0 AND parse_ok=1`, type);
    const byShow = new Map();
    for (const r of rows) { if (!byShow.has(r.show_name)) byShow.set(r.show_name, []); byShow.get(r.show_name).push(r); }
    const out = [];
    for (const [show, list] of byShow) {
      const m = metas.get(show);
      const res = m && m.seasons ? metadata.missingEpisodes(list, m.seasons) : { missing: [], missingCount: 0, expectedTotal: 0, haveTotal: 0, absolute: false };
      out.push({ library_type: type, show_name: show, source: m ? m.source : null, matched_title: m ? m.matched_title : null, status: m ? m.status : null, url: m ? m.url : null, locked: m ? m.locked : 0, note: m ? m.note : null,
        expected: res.expectedTotal, have: res.haveTotal, missing_count: res.missingCount, missing: res.missing, absolute: res.absolute, seasons: m && m.seasons ? JSON.parse(m.seasons) : null });
    }
    return out.sort((a, b) => b.missing_count - a.missing_count || a.show_name.localeCompare(b.show_name));
  }

  function qualityReport() {
    const thr = settings.get().quality.minKbps || {};
    const mixed = db.all(`SELECT library_type, show_name, COUNT(*) files, COUNT(DISTINCT resolution) res_n, GROUP_CONCAT(DISTINCT resolution) resolutions, COUNT(DISTINCT video_codec) codec_n, GROUP_CONCAT(DISTINCT video_codec) codecs
      FROM files WHERE missing=0 AND ignored=0 AND probe_ok=1 AND library_type IN ('tv','anime') GROUP BY library_type, show_name HAVING res_n > 1 ORDER BY res_n DESC, files DESC`);
    const perSeasonMixed = db.all(`SELECT library_type, show_name, season, COUNT(*) files, GROUP_CONCAT(DISTINCT resolution) resolutions FROM files WHERE missing=0 AND ignored=0 AND probe_ok=1 AND library_type IN ('tv','anime') GROUP BY library_type, show_name, season HAVING COUNT(DISTINCT resolution) > 1 ORDER BY show_name, season`);
    const all = db.all(`SELECT id, root_id, library_type, rel_path, file_name, show_name, movie_title, movie_year, resolution, bitrate_kbps, video_codec, duration_s, size FROM files WHERE missing=0 AND ignored=0 AND probe_ok=1 AND bitrate_kbps IS NOT NULL AND resolution IS NOT NULL`);
    const low = all.filter(f => thr[f.resolution] && f.bitrate_kbps < thr[f.resolution]).sort((a, b) => (a.bitrate_kbps / thr[a.resolution]) - (b.bitrate_kbps / thr[b.resolution]));
    const undAudio = db.all(`SELECT library_type, COUNT(*) n FROM files WHERE missing=0 AND ignored=0 AND probe_ok=1 AND (audio_langs IS NULL OR audio_langs='und') GROUP BY library_type`);
    const short = db.all(`SELECT id, root_id, library_type, rel_path, file_name, duration_s, size FROM files WHERE missing=0 AND ignored=0 AND probe_ok=1 AND duration_s < 120 ORDER BY duration_s LIMIT 500`);
    const noAudio = db.all(`SELECT id, root_id, library_type, rel_path, file_name FROM files WHERE missing=0 AND ignored=0 AND probe_ok=1 AND (audio_count IS NULL OR audio_count=0) LIMIT 500`);
    return { thresholds: thr, mixed, perSeasonMixed, low: low.slice(0, 2000), lowTotal: low.length, undAudio, short, noAudio };
  }

  function createWindow() {
    win = new BrowserWindow({
      width: 1400, height: 900, minWidth: 980, minHeight: 620,
      title: 'MediaLedger',
      backgroundColor: '#0f1115',
      autoHideMenuBar: true,
      icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    win.on('closed', () => { win = null; });
  }

  let promotedToGui = false;
  app.on('second-instance', (_e, argv, _cwd, extra) => {
    const wantsScan = (extra && extra.scan) || (argv || []).includes('--scan');
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    else if (!wantsScan) { promotedToGui = true; createWindow(); scheduler.start(); watcher.apply(); }
    if (wantsScan) runScan('task').catch(e => log('task scan failed: ' + e.message));
  });

  app.whenReady().then(async () => {
    settings = new Settings(userData);
    db = new Db(path.join(userData, 'medialedger.db'), { log });
    scanner = new Scanner(db, settings, { log });
    scheduler = new Scheduler(app, settings, runScan);
    watcher = new Watcher(settings, runScan, log);
    scanner.onProgress(p => send('scan:progress', p));
    if (settings.get().parserVersion !== PARSER_VERSION) {
      const n = scanner.reparseAll();
      settings.set({ parserVersion: PARSER_VERSION });
      log(`parser v${PARSER_VERSION}: re-parsed ${n} indexed files`);
    }

    if (HEADLESS) {
      try { await runScan('task'); } catch (e) { log('headless scan failed: ' + e.message); }
      if (!promotedToGui) app.quit();
      return;
    }

    createWindow();
    const shotArg = process.argv.find(a => a.startsWith('--screenshots='));
    if (shotArg) { captureScreenshots(shotArg.slice('--screenshots='.length)).then(() => app.quit()); return; }
    scheduler.start();
    watcher.apply();
    const s = settings.get();
    if (s.githubToken) { try { const { autoUpdater } = require('electron-updater'); autoUpdater.setFeedURL({ provider: 'github', owner: 'AxialForge', repo: 'medialedger', private: true, token: s.githubToken }); } catch (e) { log('feed url: ' + e.message); } }
    updater.start({ enabled: s.updates.enabled, onStatus: st => {
      // A private repository answers 404 to the update feed; say so instead of the generic message.
      if (st.state === 'error' && /No update information/i.test(st.message || '') && !settings.get().githubToken) st = { ...st, message: 'The update feed is not reachable: the GitHub repository is private and no token is set. Add a read-only token under Settings → Updates, or make the repository public.' };
      updateStatus = st; log('update: ' + JSON.stringify(st)); send('update:status', st);
    } });
    // First-time metadata fill runs in the background once the window is up.
    if (s.metadata.enabled) setTimeout(() => refreshMetadata({ onlyNew: true }).catch(e => log('metadata: ' + e.message)), 4000);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  // `--screenshots=<dir>`: render each view with the live database and save PNGs (used for the README).
  async function captureScreenshots(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const shots = [
      ['dashboard', '#dashboard'], ['tv', '#tv'], ['anime', '#anime'], ['movies', '#movies'],
      ['episodes', '#anime/' + encodeURIComponent('One Piece')], ['movie-versions', '#movies/' + encodeURIComponent('pacificrim|2013')],
      ['missing', '#missing'], ['duplicates', '#duplicates'], ['movienames', '#movienames'], ['quality', '#quality'], ['rename', '#rename'],
      ['changes', '#changes'], ['problems', '#problems'], ['export', '#export'], ['settings', '#settings'], ['about', '#about'],
    ];
    await new Promise(r => win.webContents.once('did-finish-load', r));
    await sleep(1500);
    const social = (process.argv.find(a => a.startsWith('--social=')) || '').slice('--social='.length);
    if (/^\d+x\d+$/.test(social)) {
      const [w, hgt] = social.split('x').map(Number);
      win.setContentSize(w, hgt); await sleep(1500);
      fs.writeFileSync(path.join(dir, `social-preview-${w}x${hgt}.png`), (await win.webContents.capturePage()).resize({ width: w, height: hgt, quality: 'best' }).toPNG());
      log('screenshot social preview'); return;
    }
    const settle = async (hash) => {
      await win.webContents.executeJavaScript(`(() => { document.querySelector('#view').textContent = 'Loading…'; if (location.hash === ${JSON.stringify(hash)}) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = ${JSON.stringify(hash)}; })()`);
      for (let i = 0; i < 100; i++) {
        const ok = await win.webContents.executeJavaScript(`location.hash === ${JSON.stringify(hash)} && !document.querySelector('#view')?.textContent.startsWith('Loading')`);
        if (ok) break;
        await sleep(100);
      }
      await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
      await sleep(400);
    };
    const capture = async (file) => {
      for (let i = 0; i < 5; i++) {
        const img = await win.webContents.capturePage();
        if (!img.isEmpty()) { fs.writeFileSync(file, img.toPNG()); return true; }
        await sleep(300);
      }
      log('screenshot FAILED (empty capture): ' + file); return false;
    };
    for (const [name, hash] of shots) {
      await settle(hash);
      if (await capture(path.join(dir, `${name}.png`))) log('screenshot ' + name);
    }
    await settle('#problems');
    const opened = await win.webContents.executeJavaScript(`(() => { const b = document.querySelector('.fixbtn'); if (!b) return false; b.click(); return true; })()`);
    if (opened) { await sleep(1200); await capture(path.join(dir, 'fix-modal.png')); log('screenshot fix-modal'); }
  }

  app.on('window-all-closed', () => { app.quit(); });
  app.on('before-quit', () => { scheduler && scheduler.stop(); watcher && watcher.stop(); try { db && db.close(); } catch { /* ignore */ } });

  // ---- IPC ---------------------------------------------------------------------
  const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => fn(...args));

  h('app:info', async () => ({
    version: app.getVersion(), electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome,
    platform: `${os.type()} ${os.release()} (${os.arch()})`, cpus: os.cpus().length, userData, logFile, dbFile: db.file, exportDir: exportDir(),
    ffprobe: ffprobePath(), ffprobeVersion: await ffmpegdl.ffprobeVersion(ffprobePath()), packaged: app.isPackaged, repo: 'https://github.com/AxialForge/medialedger',
    updateStatus, db: db.stats(), watch: watcher.status(), metaJob,
  }));
  h('settings:get', () => settings.get());
  h('settings:set', (patch) => { const s = settings.set(patch); watcher.apply(); return s; });
  h('settings:replace', (next) => { const s = settings.replace(next); watcher.apply(); return s; });
  h('dialog:pickFolder', async (initial) => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: initial || undefined }); return r.canceled ? null : r.filePaths[0]; });
  h('dialog:pickFile', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'ffprobe', extensions: ['exe'] }] }); return r.canceled ? null : r.filePaths[0]; });
  h('shell:open', (p) => shell.openPath(p));
  h('shell:openExternal', (u) => /^https:\/\//.test(u) ? shell.openExternal(u) : false);
  h('shell:showItem', (p) => shell.showItemInFolder(p));

  h('scan:start', (trigger) => runScan(trigger || 'manual'));
  h('scan:cancel', () => { scanner.cancel(); return true; });
  h('scan:status', () => ({ running: scanner.running, progress: scanner.progress }));
  h('scan:list', (limit) => db.recentScans(limit || 30));

  h('export:run', () => runExport(null, 'manual'));
  h('export:list', () => db.listExports(50));

  h('schedule:taskStatus', () => scheduler.taskStatus());
  h('schedule:installTask', async () => { const r = await scheduler.installTask(); if (r.ok) settings.set({ schedule: { taskSchedulerEnabled: true } }); return r; });
  h('schedule:removeTask', async () => { const r = await scheduler.removeTask(); settings.set({ schedule: { taskSchedulerEnabled: false } }); return r; });
  h('schedule:runTaskNow', () => scheduler.runTaskNow());
  h('schedule:nextInApp', () => scheduler.nextInAppRun());
  h('watch:status', () => watcher.status());

  h('ffmpeg:download', async () => {
    const p = await ffmpegdl.downloadFfmpeg(userData, prog => send('ffmpeg:progress', prog));
    settings.set({ ffprobePath: p });
    return { ok: true, path: p, version: await ffmpegdl.ffprobeVersion(p) };
  });

  h('update:check', async () => {
    if (!app.isPackaged) return { state: 'error', message: 'Updates only run in the installed app.' };
    try { const { autoUpdater } = require('electron-updater'); await autoUpdater.checkForUpdates(); return updateStatus; }
    catch (e) { updateStatus = { state: 'error', message: e.message }; return updateStatus; }
  });
  h('update:install', () => updater.installNow());
  h('update:status', () => updateStatus);

  h('db:backup', () => db.backup('manual'));
  h('db:backups', () => db.listBackups());
  h('db:stats', () => db.stats());

  h('plex:test', (cfg) => plex.testConnection(cfg || settings.get().plex));

  // ---- overrides (manual fixes) --------------------------------------------------
  h('override:list', () => db.listOverrides());
  h('override:save', (o) => { const saved = db.saveOverride(o); const file = scanner.reapplyOverride(o.root_id, o.rel_path); return { override: saved, file }; });
  h('override:delete', (id) => { const ov = db.get('SELECT * FROM overrides WHERE id=?', id); if (!ov) return false; db.deleteOverride(id); scanner.reapplyOverride(ov.root_id, ov.rel_path); return true; });
  h('override:suggest', (rootId, relPath) => {
    const f = db.getFileByPath(rootId, relPath);
    if (!f) return null;
    return { file: f, override: db.getOverride(rootId, relPath), shows: db.all(`SELECT DISTINCT show_name FROM files WHERE library_type=? AND show_name IS NOT NULL ORDER BY show_name`, f.library_type).map(r => r.show_name) };
  });

  // ---- expected episodes / missing ------------------------------------------------
  h('meta:refresh', (opts) => refreshMetadata(opts || {}));
  h('meta:status', () => metaJob);
  h('meta:get', (type, show) => db.getSeriesMeta(type, show));
  h('meta:search', (type, q) => metadata.searchCandidates(type, q));
  h('meta:setMatch', async (type, show, source, id) => {
    const r = await metadata.fetchById(source, id);
    if (!r.found) throw new Error('That entry could not be loaded');
    return db.saveSeriesMeta({ library_type: type, show_name: show, source: r.source, source_id: r.source_id, matched_title: r.matched_title, status: r.status, seasons: r.seasons, total_episodes: r.total_episodes, url: r.url, fetched_at: new Date().toISOString(), locked: 1 });
  });
  h('meta:setManual', (type, show, seasons, note) => db.saveSeriesMeta({ library_type: type, show_name: show, source: 'manual', seasons, total_episodes: Object.entries(seasons).filter(([s]) => s !== '0').reduce((a, [, n]) => a + Number(n || 0), 0), fetched_at: new Date().toISOString(), locked: 1, note }));
  h('meta:setNone', (type, show) => db.saveSeriesMeta({ library_type: type, show_name: show, source: 'none', fetched_at: new Date().toISOString(), locked: 1, note: 'no expected counts' }));
  h('meta:unlock', (type, show) => { db.deleteSeriesMeta(type, show); return true; });
  h('data:missing', (type) => type ? missingSummary(type) : [...missingSummary('tv'), ...missingSummary('anime')]);

  // ---- duplicates review -------------------------------------------------------------
  h('data:duplicates', () => {
    const groups = db.all(`SELECT library_type, show_name, season, episode, COUNT(*) n FROM files WHERE missing=0 AND ignored=0 AND library_type IN ('tv','anime') AND parse_ok=1 GROUP BY library_type, show_name, season, episode HAVING n>1 ORDER BY show_name, season, episode`);
    const out = [];
    for (const g of groups) {
      const files = db.all(`SELECT f.id, f.root_id, f.rel_path, f.abs_path, f.file_name, f.size, f.resolution, f.width, f.height, f.video_codec, f.bit_depth, f.hdr, f.bitrate_kbps, f.duration_s, f.audio_langs, f.audio_codecs, f.sub_count, f.sub_langs, f.ext, o.keep
        FROM files f LEFT JOIN overrides o ON o.root_id=f.root_id AND o.rel_path=f.rel_path WHERE f.library_type=? AND f.show_name=? AND f.season=? AND f.episode=? AND f.missing=0 AND f.ignored=0 ORDER BY f.size DESC`, g.library_type, g.show_name, g.season, g.episode);
      out.push({ ...g, decided: files.some(f => f.keep === 1), files });
    }
    return out;
  });
  h('dup:keep', (rootId, relPath, keepId) => {
    // Mark one file as keep=1 and the rest of its group keep=0 (nothing is deleted).
    const f = db.getFileByPath(rootId, relPath); if (!f) return false;
    const group = db.all(`SELECT id, root_id, rel_path, library_type FROM files WHERE library_type=? AND show_name=? AND season=? AND episode=? AND missing=0 AND ignored=0`, f.library_type, f.show_name, f.season, f.episode);
    db.transaction(() => { for (const g of group) { const ov = db.getOverride(g.root_id, g.rel_path) || { root_id: g.root_id, rel_path: g.rel_path, library_type: g.library_type }; db.saveOverride({ ...ov, keep: g.id === keepId ? 1 : 0 }); } });
    return true;
  });
  h('dup:clear', (rootId, relPath) => {
    const f = db.getFileByPath(rootId, relPath); if (!f) return false;
    const group = db.all(`SELECT id, root_id, rel_path FROM files WHERE library_type=? AND show_name=? AND season=? AND episode=? AND missing=0 AND ignored=0`, f.library_type, f.show_name, f.season, f.episode);
    db.transaction(() => { for (const g of group) { const ov = db.getOverride(g.root_id, g.rel_path); if (ov) db.saveOverride({ ...ov, keep: null }); } });
    return true;
  });

  // ---- quality ------------------------------------------------------------------------
  h('data:quality', () => qualityReport());

  // ---- movie naming engine ---------------------------------------------------------------
  function moviePlan() {
    const rows = db.all(`SELECT f.*, o.source AS source_override FROM files f LEFT JOIN overrides o ON o.root_id=f.root_id AND o.rel_path=f.rel_path WHERE f.library_type='movie' AND f.missing=0 ORDER BY f.movie_title COLLATE NOCASE, f.file_name`);
    return planMovieNames(rows);
  }
  h('movie:plan', () => ({ plan: moviePlan(), lock: renameLock, settings: settings.get().movieRename }));
  h('movie:run', async (ids, opts) => {
    const cfg = settings.get();
    if (opts.live && !cfg.movieRename.enabled) throw new Error('Live renaming is switched off in this tab. Turn on "Allow live renames" first.');
    if (renameLock) throw new Error('Another rename batch is still running');
    if (scanner.running) throw new Error('A scan is running; wait for it to finish before renaming');
    const wanted = new Set(ids);
    const items = moviePlan().filter(p => wanted.has(p.id) && p.ok && !p.unchanged);
    if (!items.length) throw new Error('Nothing selected is ready to rename');
    const rootIds = [...new Set(items.map(i => i.root_id))];
    if (rootIds.length !== 1) throw new Error('A batch must stay within one root');
    const root = cfg.roots.find(r => r.id === rootIds[0]);
    if (!root) throw new Error('Root not found in settings');
    if (opts.live) renameLock = { rootId: root.id, since: new Date().toISOString() };
    try {
      return movieRename.runBatch(db, items, { live: !!opts.live, layout: opts.layout || cfg.movieRename.layout || 'inplace', rootPath: root.path, limit: Number(cfg.movieRename.batchLimit) || 200, log, onProgress: p => send('movie:progress', p) });
    } finally { renameLock = null; db.checkpoint(); }
  });
  h('movie:undo', (batchId) => {
    if (renameLock) throw new Error('Another rename batch is still running');
    renameLock = { rootId: 'undo', since: new Date().toISOString() };
    try { return movieRename.undoBatch(db, batchId, log); } finally { renameLock = null; db.checkpoint(); }
  });
  h('movie:batches', () => db.listBatches(50));
  h('movie:batchItems', (id) => db.batchItems(id));

  // ---- rename tool (opt-in) -------------------------------------------------------------
  h('rename:proposals', (opts) => { if (!settings.get().renaming.enabled) return { disabled: true, list: [] }; return { list: renamer.proposals(db, opts || {}) }; });
  h('rename:apply', (ids) => { if (!settings.get().renaming.enabled) throw new Error('Renaming is disabled in Settings'); return renamer.applyRenames(db, ids, log); });
  h('rename:history', () => db.listRenames(500));

  // ---- data queries ------------------------------------------------------------------
  h('data:dashboard', () => {
    const byType = db.all(`SELECT library_type, COUNT(*) files, SUM(size) bytes, SUM(duration_s) seconds,
        SUM(CASE WHEN probe_ok=1 THEN 1 ELSE 0 END) probed, SUM(CASE WHEN has_captions=1 THEN 1 ELSE 0 END) captioned,
        SUM(CASE WHEN parse_ok=0 THEN 1 ELSE 0 END) unparsed, SUM(CASE WHEN probed_at IS NOT NULL AND probe_ok=0 THEN 1 ELSE 0 END) probe_errors,
        AVG(bitrate_kbps) avg_kbps, AVG(duration_s) avg_seconds
      FROM files WHERE missing=0 AND ignored=0 GROUP BY library_type`);
    const titles = {
      tv: db.get(`SELECT COUNT(DISTINCT show_name) n FROM files WHERE library_type='tv' AND missing=0 AND ignored=0`).n,
      anime: db.get(`SELECT COUNT(DISTINCT show_name) n FROM files WHERE library_type='anime' AND missing=0 AND ignored=0`).n,
      movie: db.get(`SELECT COUNT(DISTINCT group_key) n FROM files WHERE library_type='movie' AND missing=0 AND ignored=0`).n,
    };
    const multiples = db.get(`SELECT COUNT(*) n, COALESCE(SUM(c-1),0) extra, COALESCE(SUM(b),0) bytes FROM (SELECT group_key, COUNT(*) c, SUM(size) b FROM files WHERE library_type='movie' AND missing=0 AND ignored=0 GROUP BY group_key HAVING c>1)`);
    const breakdown = (col) => db.all(`SELECT library_type, ${col} k, COUNT(*) n FROM files WHERE missing=0 AND ignored=0 AND probe_ok=1 GROUP BY library_type, ${col} ORDER BY n DESC`);
    const missing = [...missingSummary('tv'), ...missingSummary('anime')];
    const q = qualityReport();
    const dups = db.get(`SELECT COUNT(*) n FROM (SELECT 1 FROM files WHERE missing=0 AND ignored=0 AND library_type IN ('tv','anime') AND parse_ok=1 GROUP BY library_type, show_name, season, episode HAVING COUNT(*)>1)`).n;
    return {
      byType, titles, multiples,
      resolution: breakdown('resolution'), videoCodec: breakdown('video_codec'), container: breakdown('ext'),
      audioCodec: breakdown('audio_codecs'), hdr: breakdown('hdr'), fps: breakdown('ROUND(fps)'),
      audioLang: db.all(`SELECT library_type, COALESCE(NULLIF(audio_langs,'und'),'undefined') k, COUNT(*) n FROM files WHERE missing=0 AND ignored=0 AND probe_ok=1 GROUP BY library_type, k ORDER BY n DESC LIMIT 40`),
      subLang: db.all(`SELECT library_type, COALESCE(sub_langs,'none') k, COUNT(*) n FROM files WHERE missing=0 AND ignored=0 AND probe_ok=1 GROUP BY library_type, sub_langs ORDER BY n DESC LIMIT 40`),
      lastScans: db.recentScans(8),
      recentChanges: db.recentChanges(25),
      missingFiles: db.get('SELECT COUNT(*) n FROM files WHERE missing=1').n,
      overrides: db.get('SELECT COUNT(*) n FROM overrides').n,
      biggestShows: db.all(`SELECT library_type, show_name, COUNT(*) episodes, SUM(size) bytes, SUM(duration_s) seconds FROM files WHERE missing=0 AND ignored=0 AND library_type IN ('tv','anime') GROUP BY library_type, show_name ORDER BY bytes DESC LIMIT 10`),
      biggestMovies: db.all(`SELECT movie_title, movie_year, size, resolution, video_codec FROM files WHERE missing=0 AND ignored=0 AND library_type='movie' ORDER BY size DESC LIMIT 10`),
      recentlyAdded: db.all(`SELECT library_type, show_name, movie_title, movie_year, season, episode, file_name, first_seen, size FROM files WHERE missing=0 AND ignored=0 ORDER BY first_seen DESC, id DESC LIMIT 12`),
      lowRes: db.all(`SELECT library_type, COUNT(*) n FROM files WHERE missing=0 AND ignored=0 AND probe_ok=1 AND resolution IN ('SD','480p','576p') GROUP BY library_type`),
      missingEpisodes: { series: missing.filter(m => m.missing_count > 0).length, episodes: missing.reduce((a, m) => a + m.missing_count, 0), matched: missing.filter(m => m.expected > 0).length, unmatched: missing.filter(m => m.source === 'none').length, pending: missing.filter(m => !m.source).length, top: missing.filter(m => m.missing_count > 0).slice(0, 12) },
      quality: { mixedSeries: q.mixed.length, lowBitrate: q.lowTotal, undAudio: q.undAudio.reduce((a, r) => a + r.n, 0), short: q.short.length, noAudio: q.noAudio.length },
      duplicates: dups,
      lastExport: db.listExports(1)[0] || null,
      watch: watcher.status(),
    };
  });

  h('data:series', (type) => {
    const rows = db.all(`SELECT show_name, COUNT(*) episodes, COUNT(DISTINCT season) seasons, MIN(season) min_season, MAX(season) max_season,
      SUM(size) bytes, SUM(duration_s) seconds, SUM(CASE WHEN probe_ok=1 THEN 1 ELSE 0 END) probed,
      SUM(CASE WHEN has_captions=1 THEN 1 ELSE 0 END) captioned, SUM(CASE WHEN parse_ok=0 THEN 1 ELSE 0 END) unparsed,
      GROUP_CONCAT(DISTINCT resolution) resolutions, GROUP_CONCAT(DISTINCT video_codec) codecs, GROUP_CONCAT(DISTINCT audio_langs) audio_langs, GROUP_CONCAT(DISTINCT sub_langs) sub_langs,
      MAX(last_seen) last_seen
    FROM files WHERE library_type=? AND missing=0 AND ignored=0 GROUP BY show_name ORDER BY show_name COLLATE NOCASE`, type);
    const miss = new Map(missingSummary(type).map(m => [m.show_name, m]));
    return rows.map(r => { const m = miss.get(r.show_name); return { ...r, expected: m ? m.expected : 0, missing_count: m ? m.missing_count : 0, meta_source: m ? m.source : null, meta_status: m ? m.status : null }; });
  });
  h('data:episodes', (type, show) => ({ files: db.all(`SELECT * FROM files WHERE library_type=? AND show_name=? AND ignored=0 ORDER BY missing, season, episode, file_name`, type, show), missing: missingSummary(type).find(m => m.show_name === show) || null }));
  h('data:movies', () => db.all(`SELECT group_key, MIN(movie_title) title, MIN(movie_year) year, COUNT(*) files, SUM(size) bytes, MAX(duration_s) seconds,
      GROUP_CONCAT(DISTINCT resolution) resolutions, GROUP_CONCAT(DISTINCT video_codec) codecs, GROUP_CONCAT(DISTINCT audio_langs) audio_langs, GROUP_CONCAT(DISTINCT sub_langs) sub_langs,
      MAX(has_captions) has_captions, SUM(CASE WHEN probe_ok=1 THEN 1 ELSE 0 END) probed, GROUP_CONCAT(edition_tag, ' | ') editions
    FROM files WHERE library_type='movie' AND missing=0 AND ignored=0 GROUP BY group_key ORDER BY title COLLATE NOCASE, year`));
  h('data:movieFiles', (groupKey) => db.all(`SELECT * FROM files WHERE library_type='movie' AND group_key=? ORDER BY missing, file_name`, groupKey));

  h('data:changes', (scanId, limit) => scanId ? db.changesForScan(scanId, limit || 5000) : db.recentChanges(limit || 500));
  h('data:changeStats', () => ({
    byKind: db.all(`SELECT kind, COUNT(*) n FROM changes GROUP BY kind`),
    last7: db.all(`SELECT kind, COUNT(*) n FROM changes WHERE ts >= datetime('now','-7 days') GROUP BY kind`),
    perDay: db.all(`SELECT substr(ts,1,10) day, SUM(kind='added') added, SUM(kind='removed') removed, SUM(kind='modified') modified FROM changes WHERE ts >= datetime('now','-30 days') GROUP BY day ORDER BY day`),
    scans: db.get(`SELECT COUNT(*) n, AVG(duration_ms) avg_ms, MAX(finished) last FROM scans WHERE status='done' AND duration_ms IS NOT NULL`),
  }));
  h('data:search', (q) => db.all(`SELECT id, library_type, show_name, season, episode, movie_title, movie_year, file_name, rel_path, resolution, duration_s, size, missing FROM files
      WHERE file_name LIKE ? OR show_name LIKE ? OR movie_title LIKE ? ORDER BY missing, library_type, file_name LIMIT 300`, `%${q}%`, `%${q}%`, `%${q}%`));
  h('data:problems', () => ({
    unparsed: db.all(`SELECT id, root_id, library_type, rel_path, file_name, parse_note, show_name, season, episode, movie_title, movie_year FROM files WHERE missing=0 AND ignored=0 AND parse_ok=0 ORDER BY library_type, rel_path LIMIT 2000`),
    probeErrors: db.all(`SELECT id, root_id, library_type, rel_path, probe_error FROM files WHERE missing=0 AND ignored=0 AND probed_at IS NOT NULL AND probe_ok=0 ORDER BY library_type, rel_path LIMIT 2000`),
    missing: db.all(`SELECT id, root_id, library_type, rel_path, last_seen FROM files WHERE missing=1 ORDER BY last_seen DESC LIMIT 2000`),
    duplicates: db.get(`SELECT COUNT(*) n FROM (SELECT 1 FROM files WHERE missing=0 AND ignored=0 AND library_type IN ('tv','anime') AND parse_ok=1 GROUP BY library_type, show_name, season, episode HAVING COUNT(*)>1)`).n,
    ignored: db.all(`SELECT id, root_id, library_type, rel_path FROM files WHERE ignored=1 ORDER BY rel_path LIMIT 2000`),
    overrides: db.listOverrides(),
  }));
  h('data:purgeMissing', () => db.run('DELETE FROM files WHERE missing=1').changes);
}
