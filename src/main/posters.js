'use strict';
// Posters: one small image per title, kept in a folder of your choice (the NAS is a good place).
//
// Sources, in order:
//   1. Plex, through its own resizer (/photo/:/transcode), so the file is already the right size;
//   2. AniList (anime) and TVmaze (TV) for series that carry an online match but no Plex link.
// Adult titles are skipped entirely: there is nothing on disk that a guest view or the portal could show.
//
// Files are named by a hash of the title key, so odd characters in a title never reach the file system:
//   <dir>/<type>/<sha1(key)>.<jpg|png|webp>
// The posters table remembers what was tried, so a title without art is not asked for again every run.
//
//   createPosters({ db, settings, userData, log, send }) → { run, status, index, fileOf, dataUrl, dir, clear }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const hashOf = (key) => crypto.createHash('sha1').update(String(key)).digest('hex');
const RETRY_DAYS = 14;
const MAX_BYTES = 3 * 1024 * 1024;

/** What kind of image is this? Trust the bytes, not the header. */
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return { ext: 'png', mime: 'image/png' };
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

async function getImage(url, headers = {}, timeout = 20000) {
  const res = await fetch(url, { headers: { 'User-Agent': 'MediaLedger (https://github.com/AxialForge/medialedger)', Accept: 'image/jpeg,image/png,image/webp,image/*', ...headers }, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
  if (res.status === 404) return null;
  if (res.status === 429) { const e = new Error('rate limited'); e.retryAfter = Number(res.headers.get('retry-after')) || 10; throw e; }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`image too large (${Math.round(buf.length / 1024)} KB)`);
  const kind = sniff(buf);
  if (!kind) throw new Error('not an image');
  return { buf, ...kind };
}
async function getJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { Accept: 'application/json', 'User-Agent': 'MediaLedger (https://github.com/AxialForge/medialedger)', ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000) });
  if (res.status === 404) return null;
  if (res.status === 429) { const e = new Error('rate limited'); e.retryAfter = Number(res.headers.get('retry-after')) || 10; throw e; }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

// ---- sources ----------------------------------------------------------------------------------------
const plexUrl = (cfg, ratingKey, width) => `${cfg.baseUrl.replace(/\/$/, '')}/photo/:/transcode?width=${width}&height=${Math.round(width * 1.5)}&minSize=1&upscale=0&url=${encodeURIComponent(`/library/metadata/${ratingKey}/thumb`)}`;
async function fromPlex(cfg, ratingKey, width) {
  if (!cfg || !cfg.token || !cfg.baseUrl || !ratingKey) return null;
  return getImage(plexUrl(cfg, ratingKey, width), { 'X-Plex-Token': cfg.token, 'X-Plex-Product': 'MediaLedger', 'X-Plex-Client-Identifier': 'medialedger-desktop' });
}
async function fromAniList(id) {
  const j = await getJson('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'query($id:Int){Media(id:$id,type:ANIME){coverImage{extraLarge large}}}', variables: { id: Number(id) } }) });
  const c = j && j.data && j.data.Media && j.data.Media.coverImage; const url = c && (c.large || c.extraLarge);
  return url && /^https:\/\//.test(url) ? getImage(url) : null;
}
async function fromTvmaze(id) {
  const j = await getJson(`https://api.tvmaze.com/shows/${encodeURIComponent(id)}`);
  const url = j && j.image && (j.image.medium || j.image.original);
  return url ? getImage(String(url).replace(/^http:\/\//, 'https://')) : null;
}

function createPosters({ db, settings, userData, log = () => {}, send = () => {} }) {
  const cfg = () => ({ enabled: true, dir: '', width: 300, online: true, ...(settings.get().posters || {}) });
  const dir = () => { const d = String(cfg().dir || '').trim(); return d || path.join(userData, 'posters'); };
  let job = { running: false, message: '' };

  /** Every title that should have a poster. Adult titles are left out on purpose. */
  function titles() {
    const movies = db.all(`SELECT 'movie' type, group_key key, MIN(movie_title) title, MAX(plex_rating_key) plex FROM files WHERE library_type='movie' AND missing=0 AND ignored=0 AND adult=0 AND group_key IS NOT NULL GROUP BY group_key`);
    const series = db.all(`SELECT library_type type, show_name key, show_name title, MAX(plex_show_key) plex FROM files WHERE library_type IN ('tv','anime') AND missing=0 AND ignored=0 AND adult=0 AND show_name IS NOT NULL GROUP BY library_type, show_name`);
    return [...movies, ...series];
  }
  const rowOf = (type, key) => db.get('SELECT * FROM posters WHERE library_type=? AND title_key=?', type, key);
  const remember = (t, r) => db.run(`INSERT INTO posters (library_type, title_key, status, source, file, mime, bytes, fetched_at, tries, note) VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(library_type, title_key) DO UPDATE SET status=excluded.status, source=excluded.source, file=excluded.file, mime=excluded.mime, bytes=excluded.bytes, fetched_at=excluded.fetched_at, tries=posters.tries+1, note=excluded.note`,
    t.type, t.key, r.status, r.source || null, r.file || null, r.mime || null, r.bytes || null, new Date().toISOString(), 1, r.note || null);

  function store(t, img, source) {
    const rel = path.join(t.type, `${hashOf(t.key)}.${img.ext}`);
    const abs = path.join(dir(), rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = abs + '.part';
    fs.writeFileSync(tmp, img.buf); fs.renameSync(tmp, abs);
    // A title whose art changed type leaves the old file behind; remove it.
    for (const e of ['jpg', 'png', 'webp']) if (e !== img.ext) { try { fs.unlinkSync(path.join(dir(), t.type, `${hashOf(t.key)}.${e}`)); } catch { /* none */ } }
    remember(t, { status: 'ok', source, file: rel.replace(/\\/g, '/'), mime: img.mime, bytes: img.buf.length });
  }

  async function fetchOne(t, c, plexCfg) {
    let img = null, source = null, note = null;
    try { img = await fromPlex(plexCfg, t.plex, c.width); if (img) source = 'plex'; } catch (e) { if (e.retryAfter) throw e; note = 'plex: ' + e.message; }
    if (!img && c.online && t.type !== 'movie') {
      const m = db.get('SELECT source, source_id FROM series_meta WHERE library_type=? AND show_name=?', t.type, t.key);
      if (m && m.source_id && (m.source === 'anilist' || m.source === 'tvmaze')) {
        await sleep(700); // the online services ask for about one request a second
        try { img = m.source === 'anilist' ? await fromAniList(m.source_id) : await fromTvmaze(m.source_id); if (img) source = m.source; } catch (e) { if (e.retryAfter) throw e; note = `${m.source}: ${e.message}`; }
      }
    }
    if (img) { store(t, img, source); return 'ok'; }
    remember(t, { status: note ? 'error' : 'none', note });
    return note ? 'error' : 'none';
  }

  /** opts: { all: re-fetch everything, retry: also titles that had none, limit } */
  async function run(opts = {}) {
    if (job.running) return { skipped: true };
    const c = cfg(); if (!c.enabled && !opts.force) return { skipped: true, reason: 'posters are switched off' };
    const target = dir();
    try { fs.mkdirSync(target, { recursive: true }); fs.accessSync(target, fs.constants.W_OK); } catch (e) { const msg = `The posters folder is not writable: ${target} (${e.code || e.message})`; job = { running: false, message: msg, error: msg }; send('posters:progress', job); throw new Error(msg); }
    const known = new Map(db.all('SELECT library_type, title_key, status, fetched_at, file FROM posters').map(r => [r.library_type + '|' + r.title_key, r]));
    const stale = new Date(Date.now() - RETRY_DAYS * 86400000).toISOString();
    let todo = titles().filter(t => {
      const k = known.get(t.type + '|' + t.key);
      if (opts.all) return true;
      if (!k) return true;
      if (k.status === 'ok') return !fs.existsSync(path.join(target, k.file || 'x'));   // the file went missing: fetch again
      return opts.retry || k.fetched_at < stale;
    });
    if (Array.isArray(opts.types)) todo = todo.filter(t => opts.types.includes(t.type));
    if (opts.limit) todo = todo.slice(0, Number(opts.limit));
    const plexCfg = settings.get().plex;
    const stats = { wanted: todo.length, ok: 0, none: 0, error: 0 };
    job = { running: true, done: 0, total: todo.length, message: `Fetching ${todo.length.toLocaleString()} posters…` }; send('posters:progress', job);
    log(`posters: ${todo.length} to fetch into ${target}`);
    try {
      // Plex is on the LAN and resizes for us, so four at a time is fine; the online fallbacks pace themselves.
      let i = 0;
      const worker = async () => {
        for (;;) {
          const t = todo[i++]; if (!t) return;
          for (let attempt = 0; ; attempt++) {
            try { stats[await fetchOne(t, c, plexCfg)]++; break; }
            catch (e) { if (e.retryAfter && attempt < 3) { await sleep(e.retryAfter * 1000); continue; } remember(t, { status: 'error', note: e.message }); stats.error++; if (e.code === 'ENOSPC' || e.code === 'EACCES' || e.code === 'EROFS') throw e; break; }
          }
          job.done++;
          if (job.done % 10 === 0 || job.done === todo.length) { job.message = `Posters: ${job.done.toLocaleString()} of ${todo.length.toLocaleString()}`; send('posters:progress', { ...job }); }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      // Titles that left the library take their posters with them.
      const live = new Set(titles().map(t => t.type + '|' + t.key)); let removed = 0;
      for (const r of db.all('SELECT library_type, title_key, file FROM posters')) if (!live.has(r.library_type + '|' + r.title_key)) { if (r.file) { try { fs.unlinkSync(path.join(target, r.file)); } catch { /* gone */ } } db.run('DELETE FROM posters WHERE library_type=? AND title_key=?', r.library_type, r.title_key); removed++; }
      stats.removed = removed;
      settings.set({ posters: { ...(settings.get().posters || {}), lastRun: new Date().toISOString(), lastError: null } });
      job = { running: false, message: `Posters: ${stats.ok} fetched, ${stats.none} without art, ${stats.error} failed${removed ? `, ${removed} removed` : ''}`, result: stats };
      log(`posters: ${stats.ok} fetched, ${stats.none} none, ${stats.error} errors, ${removed} removed`);
    } catch (e) {
      settings.set({ posters: { ...(settings.get().posters || {}), lastError: e.message } });
      job = { running: false, message: 'Posters stopped: ' + e.message, error: e.message }; log('posters failed: ' + e.message);
      send('posters:progress', job); throw e;
    }
    send('posters:progress', job);
    return stats;
  }

  function status() {
    const c = cfg(); const all = titles().length;
    const by = Object.fromEntries(db.all('SELECT status, COUNT(*) n, COALESCE(SUM(bytes),0) b FROM posters GROUP BY status').map(r => [r.status, r]));
    const bySource = db.all("SELECT source, COUNT(*) n FROM posters WHERE status='ok' GROUP BY source");
    let writable = false, exists = false; try { exists = fs.existsSync(dir()); fs.accessSync(dir(), fs.constants.W_OK); writable = true; } catch { /* reported */ }
    return { enabled: !!c.enabled, dir: dir(), custom: !!String(c.dir || '').trim(), width: c.width, online: !!c.online, exists, writable, titles: all, have: by.ok ? by.ok.n : 0, none: by.none ? by.none.n : 0, errors: by.error ? by.error.n : 0, bytes: by.ok ? by.ok.b : 0, bySource, lastRun: c.lastRun || null, lastError: c.lastError || null, job };
  }
  /** { 'movie|alien|1979': 'stamp', … } for every title with a poster; the stamp changes when the image does. */
  const index = () => Object.fromEntries(db.all("SELECT library_type, title_key, fetched_at FROM posters WHERE status='ok'").map(r => [r.library_type + '|' + r.title_key, String(new Date(r.fetched_at).getTime().toString(36))]));
  function fileOf(type, key) {
    const r = db.get("SELECT file, mime, fetched_at, bytes FROM posters WHERE library_type=? AND title_key=? AND status='ok'", String(type), String(key));
    if (!r || !r.file || /\.\.|^[\\/]|:/.test(r.file)) return null;
    const abs = path.join(dir(), r.file);
    if (!abs.startsWith(path.resolve(dir()) + path.sep) && !abs.startsWith(dir())) return null;
    if (!fs.existsSync(abs)) return null;
    return { abs, mime: r.mime || 'image/jpeg', stamp: String(new Date(r.fetched_at).getTime().toString(36)), bytes: r.bytes };
  }
  const dataUrl = (type, key) => { const f = fileOf(type, key); if (!f) return null; return `data:${f.mime};base64,${fs.readFileSync(f.abs).toString('base64')}`; };
  function clear() { const n = db.get('SELECT COUNT(*) n FROM posters').n; for (const r of db.all('SELECT file FROM posters WHERE file IS NOT NULL')) { try { fs.unlinkSync(path.join(dir(), r.file)); } catch { /* gone */ } } db.run('DELETE FROM posters'); return n; }

  return { run, status, index, fileOf, dataUrl, dir, clear, titles, get job() { return job; } };
}

module.exports = { createPosters, sniff, hashOf, plexUrl };
