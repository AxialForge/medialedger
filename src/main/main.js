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

  // Adult content is hidden from every query unless the sidebar switch is on. Resets each launch.
  let showAdult = false;
  const AF = (alias = '') => showAdult ? '' : ` AND ${alias}adult=0`;

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
    if (result.status === 'done' && settings.get().plex.enabled && settings.get().plex.token) {
      try { await runPlexSync(trigger); } catch { /* logged */ }
    }
    if (settings.get().autoExportAfterScan && result.status === 'done') {
      try { const out = runExport(result.scanId, trigger); log('exported to ' + out.dir); result.export = out; }
      catch (e) { log('export failed: ' + e.message); }
    }
    db.checkpoint();
    return result;
  }

  // ---- Plex sync ---------------------------------------------------------------------
  let plexJob = { running: false, message: '' };
  async function runPlexSync(trigger = 'manual') {
    if (plexJob.running) return { skipped: true };
    const cfg = settings.get().plex;
    if (!cfg.token) throw new Error('No Plex token set (Settings → Plex)');
    plexJob = { running: true, message: 'Connecting to Plex…' }; send('plex:progress', plexJob);
    try {
      const r = await plex.syncLibrary(db, cfg, { log, onProgress: p => { plexJob = { running: true, ...p }; send('plex:progress', plexJob); } });
      if (r.mappingSuggested && !(cfg.pathMap || []).length) settings.set({ plex: { pathMap: [r.mappingSuggested] } });
      db.run('INSERT INTO plex_syncs (ts, sections, items, matched, unmatched, note) VALUES (?,?,?,?,?,?)', r.synced_at, r.sections, r.items, r.matched, r.unmatched, trigger);
      plexJob = { running: false, message: `Plex sync: ${r.matched.toLocaleString()} of ${r.items.toLocaleString()} items matched`, result: r }; send('plex:progress', plexJob);
      log(`plex sync (${trigger}): ${r.matched}/${r.items} matched, ${r.unmatched} unmatched, ${r.shows} shows`);
      return r;
    } catch (e) {
      plexJob = { running: false, message: 'Plex sync failed: ' + e.message, error: e.message }; send('plex:progress', plexJob);
      log('plex sync failed: ' + e.message);
      throw e;
    }
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
          if (r.found) { found++; db.saveSeriesMeta({ library_type: t, show_name: show, source: r.source, source_id: r.source_id, matched_title: r.matched_title, status: r.status, seasons: r.seasons, total_episodes: r.total_episodes, url: r.url, rating: r.rating ?? null, rating_votes: r.rating_votes ?? null, fetched_at: new Date().toISOString(), locked: 0 }); }
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
    const rows = db.all(`SELECT show_name, season, episode, episode_end FROM files WHERE library_type=? AND missing=0 AND ignored=0${AF()} AND parse_ok=1`, type);
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
      FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 AND library_type IN ('tv','anime') GROUP BY library_type, show_name HAVING res_n > 1 ORDER BY res_n DESC, files DESC`);
    const perSeasonMixed = db.all(`SELECT library_type, show_name, season, COUNT(*) files, GROUP_CONCAT(DISTINCT resolution) resolutions FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 AND library_type IN ('tv','anime') GROUP BY library_type, show_name, season HAVING COUNT(DISTINCT resolution) > 1 ORDER BY show_name, season`);
    const all = db.all(`SELECT id, root_id, library_type, rel_path, file_name, show_name, movie_title, movie_year, resolution, bitrate_kbps, video_codec, duration_s, size FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 AND bitrate_kbps IS NOT NULL AND resolution IS NOT NULL`);
    const low = all.filter(f => thr[f.resolution] && f.bitrate_kbps < thr[f.resolution]).sort((a, b) => (a.bitrate_kbps / thr[a.resolution]) - (b.bitrate_kbps / thr[b.resolution]));
    const undAudio = db.all(`SELECT library_type, COUNT(*) n FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 AND (audio_langs IS NULL OR audio_langs='und') GROUP BY library_type`);
    const short = db.all(`SELECT id, root_id, library_type, rel_path, file_name, duration_s, size FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 AND duration_s < 120 ORDER BY duration_s LIMIT 500`);
    const noAudio = db.all(`SELECT id, root_id, library_type, rel_path, file_name FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 AND (audio_count IS NULL OR audio_count=0) LIMIT 500`);
    return { thresholds: thr, mixed, perSeasonMixed, low: low.slice(0, 2000), lowTotal: low.length, undAudio, short, noAudio };
  }

  // Point electron-updater at the private API when a token is set, or back at the public feed when it is not.
// Called at launch and again on every manual check so a token pasted into Settings works without a restart.
function applyUpdateFeed() {
  try {
    const { autoUpdater } = require('electron-updater');
    const token = settings.get().githubToken;
    const feed = { provider: 'github', owner: 'AxialForge', repo: 'medialedger' };
    autoUpdater.setFeedURL(token ? { ...feed, private: true, token } : feed);
  } catch (e) { log('feed url: ' + e.message); }
}

// A private repository answers 404 to the update feed; say what to do instead of the generic message.
function explainUpdateError(msg) {
  if (!/No update information|404/i.test(msg || '')) return msg;
  return settings.get().githubToken
    ? 'GitHub answered 404 to the update check. The token is rejected or lacks read access to AxialForge/medialedger (fine-grained token, repository permission "Contents: read").'
    : 'The update feed is not reachable: the GitHub repository is private and no token is set. Add a read-only token under Settings → Updates, or make the repository public.';
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
    applyUpdateFeed();
    updater.start({ enabled: s.updates.enabled, onStatus: st => {
      if (st.state === 'error') st = { ...st, message: explainUpdateError(st.message) };
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
      ['missing', '#missing'], ['duplicates', '#duplicates'], ['movienames', '#movienames'], ['web', '#web'], ['ratings', '#ratings'], ['quality', '#quality'], ['rename', '#rename'],
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
    applyUpdateFeed(); // pick up a token typed into Settings since launch
    try { const { autoUpdater } = require('electron-updater'); await autoUpdater.checkForUpdates(); return updateStatus; }
    catch (e) { updateStatus = { state: 'error', message: explainUpdateError(updater.friendlyError(e)) }; return updateStatus; }
  });
  h('update:install', () => updater.installNow());
  h('update:status', () => updateStatus);

  h('db:backup', () => db.backup('manual'));
  h('db:backups', () => db.listBackups());
  h('db:stats', () => db.stats());

  h('plex:test', (cfg) => plex.testConnection(cfg || settings.get().plex));
  h('plex:sync', () => runPlexSync('manual'));
  h('plex:status', () => {
    const last = db.get('SELECT * FROM plex_syncs ORDER BY id DESC LIMIT 1');
    const linked = db.get('SELECT COUNT(*) n FROM files WHERE plex_rating_key IS NOT NULL AND missing=0').n;
    const total = db.get('SELECT COUNT(*) n FROM files WHERE missing=0 AND ignored=0').n;
    const watched = db.get('SELECT COUNT(*) n FROM files WHERE plex_view_count > 0 AND missing=0').n;
    const rated = db.get('SELECT COUNT(*) n FROM files WHERE plex_user_rating IS NOT NULL AND missing=0').n + db.get('SELECT COUNT(*) n FROM plex_shows WHERE user_rating IS NOT NULL').n;
    const unlinked = db.all(`SELECT library_type, show_name, movie_title, movie_year, rel_path FROM files WHERE plex_rating_key IS NULL AND missing=0 AND ignored=0 AND library_type IN ('tv','anime','movie')${AF()} ORDER BY library_type, rel_path LIMIT 300`);
    return { job: plexJob, last, linked, total, watched, rated, unlinked, pathMap: settings.get().plex.pathMap || [] };
  });

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
    return db.saveSeriesMeta({ library_type: type, show_name: show, source: r.source, source_id: r.source_id, matched_title: r.matched_title, status: r.status, seasons: r.seasons, total_episodes: r.total_episodes, url: r.url, rating: r.rating ?? null, rating_votes: r.rating_votes ?? null, fetched_at: new Date().toISOString(), locked: 1 });
  });
  h('meta:setManual', (type, show, seasons, note) => db.saveSeriesMeta({ library_type: type, show_name: show, source: 'manual', seasons, total_episodes: Object.entries(seasons).filter(([s]) => s !== '0').reduce((a, [, n]) => a + Number(n || 0), 0), fetched_at: new Date().toISOString(), locked: 1, note }));
  h('meta:setNone', (type, show) => db.saveSeriesMeta({ library_type: type, show_name: show, source: 'none', fetched_at: new Date().toISOString(), locked: 1, note: 'no expected counts' }));
  h('meta:unlock', (type, show) => { db.deleteSeriesMeta(type, show); return true; });
  h('data:missing', (type) => type ? missingSummary(type) : [...missingSummary('tv'), ...missingSummary('anime')]);

  // ---- duplicates review -------------------------------------------------------------
  h('data:duplicates', () => {
    const groups = db.all(`SELECT library_type, show_name, season, episode, COUNT(*) n FROM files WHERE missing=0 AND ignored=0${AF()} AND library_type IN ('tv','anime') AND parse_ok=1 GROUP BY library_type, show_name, season, episode HAVING n>1 ORDER BY show_name, season, episode`);
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
    const group = db.all(`SELECT id, root_id, rel_path, library_type FROM files WHERE library_type=? AND show_name=? AND season=? AND episode=? AND missing=0 AND ignored=0${AF()}`, f.library_type, f.show_name, f.season, f.episode);
    db.transaction(() => { for (const g of group) { const ov = db.getOverride(g.root_id, g.rel_path) || { root_id: g.root_id, rel_path: g.rel_path, library_type: g.library_type }; db.saveOverride({ ...ov, keep: g.id === keepId ? 1 : 0 }); } });
    return true;
  });
  h('dup:clear', (rootId, relPath) => {
    const f = db.getFileByPath(rootId, relPath); if (!f) return false;
    const group = db.all(`SELECT id, root_id, rel_path FROM files WHERE library_type=? AND show_name=? AND season=? AND episode=? AND missing=0 AND ignored=0${AF()}`, f.library_type, f.show_name, f.season, f.episode);
    db.transaction(() => { for (const g of group) { const ov = db.getOverride(g.root_id, g.rel_path); if (ov) db.saveOverride({ ...ov, keep: null }); } });
    return true;
  });

  // ---- quality ------------------------------------------------------------------------
  h('data:quality', () => qualityReport());

  // ---- movie naming engine ---------------------------------------------------------------
  function moviePlan() {
    const truth = (settings.get().movieRename || {}).truth || 'parser';
    const rows = db.all(`SELECT f.*, o.source AS source_override FROM files f LEFT JOIN overrides o ON o.root_id=f.root_id AND o.rel_path=f.rel_path WHERE f.library_type='movie' AND f.missing=0${AF('f.')} ORDER BY f.movie_title COLLATE NOCASE, f.file_name`);
    return planMovieNames(rows.map(r => ({ ...r, truth })));
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

  // ---- adult visibility -------------------------------------------------------------------
  const adultCount = () => db.get('SELECT COUNT(*) n FROM files WHERE adult=1 AND missing=0 AND ignored=0').n;
  h('adult:status', () => ({ showAdult, count: adultCount(), rootConfigured: (settings.get().roots || []).some(r => r.type === 'adult' && r.enabled) }));
  h('adult:toggle', (on) => { showAdult = !!on; return { showAdult, count: adultCount() }; });
  h('adult:dashboard', () => ({
    byType: db.all(`SELECT library_type, COUNT(*) files, SUM(size) bytes, SUM(duration_s) seconds, SUM(CASE WHEN probe_ok=1 THEN 1 ELSE 0 END) probed, SUM(CASE WHEN has_captions=1 THEN 1 ELSE 0 END) captioned, SUM(CASE WHEN parse_ok=0 THEN 1 ELSE 0 END) unparsed FROM files WHERE adult=1 AND missing=0 AND ignored=0 GROUP BY library_type`),
    series: db.all(`SELECT library_type, show_name, COUNT(*) episodes, COUNT(DISTINCT season) seasons, SUM(size) bytes, SUM(duration_s) seconds, GROUP_CONCAT(DISTINCT resolution) resolutions, SUM(CASE WHEN has_captions=1 THEN 1 ELSE 0 END) captioned, SUM(CASE WHEN parse_ok=0 THEN 1 ELSE 0 END) unparsed FROM files WHERE adult=1 AND missing=0 AND ignored=0 AND library_type IN ('tv','anime') GROUP BY library_type, show_name ORDER BY show_name COLLATE NOCASE`),
    movies: db.all(`SELECT group_key, MIN(movie_title) title, MIN(movie_year) year, COUNT(*) files, SUM(size) bytes, GROUP_CONCAT(DISTINCT resolution) resolutions FROM files WHERE adult=1 AND missing=0 AND ignored=0 AND library_type='movie' GROUP BY group_key ORDER BY title COLLATE NOCASE`),
    resolution: db.all(`SELECT library_type, resolution k, COUNT(*) n FROM files WHERE adult=1 AND missing=0 AND ignored=0 AND probe_ok=1 GROUP BY library_type, resolution ORDER BY n DESC`),
    recent: db.all(`SELECT library_type, show_name, movie_title, season, episode, file_name, first_seen FROM files WHERE adult=1 AND missing=0 AND ignored=0 ORDER BY first_seen DESC, id DESC LIMIT 12`),
    unparsed: db.all(`SELECT id, root_id, library_type, rel_path, parse_note FROM files WHERE adult=1 AND missing=0 AND ignored=0 AND parse_ok=0 ORDER BY rel_path LIMIT 500`),
  }));

  // ---- web videos ---------------------------------------------------------------------------
  h('web:channels', () => db.all(`SELECT COALESCE(channel,'(no channel)') channel, COUNT(*) videos, SUM(size) bytes, SUM(duration_s) seconds, MIN(upload_date) first_upload, MAX(upload_date) last_upload, GROUP_CONCAT(DISTINCT resolution) resolutions, SUM(CASE WHEN probe_ok=1 THEN 1 ELSE 0 END) probed, MAX(first_seen) last_added FROM files WHERE library_type='web' AND missing=0 AND ignored=0${AF()} GROUP BY COALESCE(channel,'(no channel)') ORDER BY channel COLLATE NOCASE`));
  h('web:videos', (channel) => db.all(`SELECT * FROM files WHERE library_type='web' AND ignored=0 AND COALESCE(channel,'(no channel)')=?${AF()} ORDER BY missing, upload_date DESC, movie_title`, channel));

  // ---- ratings ------------------------------------------------------------------------------
  h('ratings:list', () => {
    const ur = new Map(db.userRatings().map(u => [u.library_type + '|' + u.title_key, u]));
    const out = [];
    const plexShows = new Map(db.all('SELECT rating_key, user_rating, audience_rating, rating, leaf_count, viewed_leaf_count FROM plex_shows').map(s => [s.rating_key, s]));
    for (const t of ['tv', 'anime']) {
      const metas = db.allSeriesMeta(t);
      for (const r of db.all(`SELECT show_name, COUNT(*) files, SUM(size) bytes, MAX(plex_show_key) plex_show_key, SUM(CASE WHEN plex_view_count>0 THEN 1 ELSE 0 END) watched FROM files WHERE library_type=? AND missing=0 AND ignored=0${AF()} GROUP BY show_name`, t)) {
        const m = metas.get(r.show_name), u = ur.get(t + '|' + r.show_name), ps = r.plex_show_key ? plexShows.get(r.plex_show_key) : null;
        out.push({ library_type: t, key: r.show_name, title: r.show_name, files: r.files, bytes: r.bytes, online: m ? m.rating : null, online_source: m && m.rating != null ? m.source : null, online_votes: m ? m.rating_votes : null, url: m ? m.url : null, stars: u ? u.stars : null, note: u ? u.note : null, updated: u ? u.updated : null,
          plex_user: ps ? ps.user_rating : null, plex_audience: ps ? (ps.audience_rating ?? ps.rating) : null, watched: r.watched, plex_linked: !!r.plex_show_key });
      }
    }
    for (const r of db.all(`SELECT group_key, MIN(movie_title) title, MIN(movie_year) year, COUNT(*) files, SUM(size) bytes, MAX(plex_user_rating) plex_user, MAX(plex_audience_rating) plex_audience, MAX(plex_view_count) watched, MAX(plex_rating_key) plex_key FROM files WHERE library_type='movie' AND missing=0 AND ignored=0${AF()} GROUP BY group_key`)) {
      const u = ur.get('movie|' + r.group_key);
      out.push({ library_type: 'movie', key: r.group_key, title: r.year ? `${r.title} (${r.year})` : r.title, files: r.files, bytes: r.bytes, online: null, online_source: null, online_votes: null, url: null, stars: u ? u.stars : null, note: u ? u.note : null, updated: u ? u.updated : null,
        plex_user: r.plex_user, plex_audience: r.plex_audience, watched: r.watched ? 1 : 0, plex_linked: !!r.plex_key });
    }
    for (const r of db.all(`SELECT COALESCE(channel,'(no channel)') channel, COUNT(*) files, SUM(size) bytes FROM files WHERE library_type='web' AND missing=0 AND ignored=0${AF()} GROUP BY COALESCE(channel,'(no channel)')`)) {
      const u = ur.get('web|' + r.channel);
      out.push({ library_type: 'web', key: r.channel, title: r.channel, files: r.files, bytes: r.bytes, online: null, online_source: null, online_votes: null, url: null, stars: u ? u.stars : null, note: u ? u.note : null, updated: u ? u.updated : null });
    }
    return out;
  });
  h('ratings:setUser', (type, key, title, stars, note) => db.setUserRating(type, key, title, stars == null || stars === '' ? null : Number(stars), note || null));

  // ---- bulk source for the movie naming engine ----------------------------------------------
  h('override:bulkSource', (ids, source) => {
    if (!/^(web|rip|)$/i.test(source || '')) throw new Error('Source must be web, rip or empty');
    const rows = db.all(`SELECT id, root_id, rel_path, library_type FROM files WHERE id IN (${ids.map(() => '?').join(',')}) AND library_type='movie'`, ...ids);
    db.transaction(() => { for (const f of rows) { const ov = db.getOverride(f.root_id, f.rel_path) || { root_id: f.root_id, rel_path: f.rel_path, library_type: 'movie' }; db.saveOverride({ ...ov, source: source ? source.toLowerCase() : null }); } });
    return rows.length;
  });

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
      FROM files WHERE missing=0 AND ignored=0${AF()} GROUP BY library_type`);
    const titles = {
      tv: db.get(`SELECT COUNT(DISTINCT show_name) n FROM files WHERE library_type='tv' AND missing=0 AND ignored=0${AF()}`).n,
      anime: db.get(`SELECT COUNT(DISTINCT show_name) n FROM files WHERE library_type='anime' AND missing=0 AND ignored=0${AF()}`).n,
      movie: db.get(`SELECT COUNT(DISTINCT group_key) n FROM files WHERE library_type='movie' AND missing=0 AND ignored=0${AF()}`).n,
    };
    const multiples = db.get(`SELECT COUNT(*) n, COALESCE(SUM(c-1),0) extra, COALESCE(SUM(b),0) bytes FROM (SELECT group_key, COUNT(*) c, SUM(size) b FROM files WHERE library_type='movie' AND missing=0 AND ignored=0${AF()} GROUP BY group_key HAVING c>1)`);
    const breakdown = (col) => db.all(`SELECT library_type, ${col} k, COUNT(*) n FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 GROUP BY library_type, ${col} ORDER BY n DESC`);
    const missing = [...missingSummary('tv'), ...missingSummary('anime')];
    const q = qualityReport();
    const dups = db.get(`SELECT COUNT(*) n FROM (SELECT 1 FROM files WHERE missing=0 AND ignored=0${AF()} AND library_type IN ('tv','anime') AND parse_ok=1 GROUP BY library_type, show_name, season, episode HAVING COUNT(*)>1)`).n;
    return {
      byType, titles, multiples,
      resolution: breakdown('resolution'), videoCodec: breakdown('video_codec'), container: breakdown('ext'),
      audioCodec: breakdown('audio_codecs'), hdr: breakdown('hdr'), fps: breakdown('ROUND(fps)'),
      audioLang: db.all(`SELECT library_type, COALESCE(NULLIF(audio_langs,'und'),'undefined') k, COUNT(*) n FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 GROUP BY library_type, k ORDER BY n DESC LIMIT 40`),
      subLang: db.all(`SELECT library_type, COALESCE(sub_langs,'none') k, COUNT(*) n FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 GROUP BY library_type, sub_langs ORDER BY n DESC LIMIT 40`),
      lastScans: db.recentScans(8),
      recentChanges: db.recentChanges(25),
      missingFiles: db.get('SELECT COUNT(*) n FROM files WHERE missing=1').n,
      overrides: db.get('SELECT COUNT(*) n FROM overrides').n,
      biggestShows: db.all(`SELECT library_type, show_name, COUNT(*) episodes, SUM(size) bytes, SUM(duration_s) seconds FROM files WHERE missing=0 AND ignored=0${AF()} AND library_type IN ('tv','anime') GROUP BY library_type, show_name ORDER BY bytes DESC LIMIT 10`),
      biggestMovies: db.all(`SELECT movie_title, movie_year, size, resolution, video_codec FROM files WHERE missing=0 AND ignored=0${AF()} AND library_type='movie' ORDER BY size DESC LIMIT 10`),
      recentlyAdded: db.all(`SELECT library_type, show_name, movie_title, movie_year, season, episode, file_name, first_seen, size FROM files WHERE missing=0 AND ignored=0${AF()} ORDER BY first_seen DESC, id DESC LIMIT 12`),
      lowRes: db.all(`SELECT library_type, COUNT(*) n FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 AND resolution IN ('SD','480p','576p') GROUP BY library_type`),
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
      MAX(last_seen) last_seen, SUM(CASE WHEN plex_view_count>0 THEN 1 ELSE 0 END) watched, MAX(plex_show_key) plex_show_key, SUM(CASE WHEN plex_rating_key IS NOT NULL THEN 1 ELSE 0 END) plex_linked
    FROM files WHERE library_type=? AND missing=0 AND ignored=0${AF()} GROUP BY show_name ORDER BY show_name COLLATE NOCASE`, type);
    const plexShows = new Map(db.all('SELECT rating_key, user_rating FROM plex_shows').map(s => [s.rating_key, s]));
    const miss = new Map(missingSummary(type).map(m => [m.show_name, m]));
    const metas = db.allSeriesMeta(type);
    const ur = new Map(db.userRatings(type).map(u => [u.title_key, u]));
    return rows.map(r => { const m = miss.get(r.show_name); const sm = metas.get(r.show_name); const u = ur.get(r.show_name); const ps = r.plex_show_key ? plexShows.get(r.plex_show_key) : null; return { ...r, expected: m ? m.expected : 0, missing_count: m ? m.missing_count : 0, meta_source: m ? m.source : null, meta_status: m ? m.status : null, online_rating: sm ? sm.rating : null, my_rating: u ? u.stars : null, plex_user: ps ? ps.user_rating : null }; });
  });
  h('data:episodes', (type, show) => ({ files: db.all(`SELECT * FROM files WHERE library_type=? AND show_name=? AND ignored=0${AF()} ORDER BY missing, season, episode, file_name`, type, show), missing: missingSummary(type).find(m => m.show_name === show) || null }));
  h('data:movies', () => db.all(`SELECT group_key, MIN(movie_title) title, MIN(movie_year) year, COUNT(*) files, SUM(size) bytes, MAX(duration_s) seconds,
      GROUP_CONCAT(DISTINCT resolution) resolutions, GROUP_CONCAT(DISTINCT video_codec) codecs, GROUP_CONCAT(DISTINCT audio_langs) audio_langs, GROUP_CONCAT(DISTINCT sub_langs) sub_langs,
      MAX(has_captions) has_captions, SUM(CASE WHEN probe_ok=1 THEN 1 ELSE 0 END) probed, GROUP_CONCAT(edition_tag, ' | ') editions
    FROM files WHERE library_type='movie' AND missing=0 AND ignored=0${AF()} GROUP BY group_key ORDER BY title COLLATE NOCASE, year`));
  h('data:movieFiles', (groupKey) => db.all(`SELECT * FROM files WHERE library_type='movie' AND group_key=?${AF()} ORDER BY missing, file_name`, groupKey));

  h('data:changes', (scanId, limit) => scanId ? db.changesForScan(scanId, limit || 5000) : db.recentChanges(limit || 500));
  h('data:changeStats', () => ({
    byKind: db.all(`SELECT kind, COUNT(*) n FROM changes GROUP BY kind`),
    last7: db.all(`SELECT kind, COUNT(*) n FROM changes WHERE ts >= datetime('now','-7 days') GROUP BY kind`),
    perDay: db.all(`SELECT substr(ts,1,10) day, SUM(kind='added') added, SUM(kind='removed') removed, SUM(kind='modified') modified FROM changes WHERE ts >= datetime('now','-30 days') GROUP BY day ORDER BY day`),
    scans: db.get(`SELECT COUNT(*) n, AVG(duration_ms) avg_ms, MAX(finished) last FROM scans WHERE status='done' AND duration_ms IS NOT NULL`),
  }));
  h('data:search', (q) => db.all(`SELECT id, library_type, show_name, season, episode, movie_title, movie_year, file_name, rel_path, resolution, duration_s, size, missing FROM files
      WHERE (file_name LIKE ? OR show_name LIKE ? OR movie_title LIKE ?)${AF()} ORDER BY missing, library_type, file_name LIMIT 300`, `%${q}%`, `%${q}%`, `%${q}%`));
  h('data:problems', () => ({
    unparsed: db.all(`SELECT id, root_id, library_type, rel_path, file_name, parse_note, show_name, season, episode, movie_title, movie_year FROM files WHERE missing=0 AND ignored=0${AF()} AND parse_ok=0 ORDER BY library_type, rel_path LIMIT 2000`),
    probeErrors: db.all(`SELECT id, root_id, library_type, rel_path, probe_error FROM files WHERE missing=0 AND ignored=0${AF()} AND probed_at IS NOT NULL AND probe_ok=0 ORDER BY library_type, rel_path LIMIT 2000`),
    missing: db.all(`SELECT id, root_id, library_type, rel_path, last_seen FROM files WHERE missing=1 ORDER BY last_seen DESC LIMIT 2000`),
    duplicates: db.get(`SELECT COUNT(*) n FROM (SELECT 1 FROM files WHERE missing=0 AND ignored=0${AF()} AND library_type IN ('tv','anime') AND parse_ok=1 GROUP BY library_type, show_name, season, episode HAVING COUNT(*)>1)`).n,
    ignored: db.all(`SELECT id, root_id, library_type, rel_path FROM files WHERE ignored=1 ORDER BY rel_path LIMIT 2000`),
    overrides: db.listOverrides(),
  }));
  h('data:purgeMissing', () => db.run('DELETE FROM files WHERE missing=1').changes);
}
