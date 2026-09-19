'use strict';
// Plex Media Server integration (local HTTP API, no Plex account needed).
//
//   testConnection(cfg)            → { ok, message, machine, version }
//   listSections(cfg)              → [{ key, title, type }]
//   syncLibrary(db, cfg, opts)     → walks every movie/show section, joins each
//                                    Plex item to a MediaLedger file by path and
//                                    stores title, year, ids, ratings and watched
//                                    state on the file row (+ show-level rows).
//
// Path mapping: Plex reports files as it sees them on its own host, e.g.
// "/media/Anime/Show/ep.mp4". MediaLedger knows the same file as
// "\\nas\share\Anime\Show\ep.mp4". `pathMap` is a list of { plex, local }
// prefixes; `deriveMapping()` proposes one from the first file whose tail matches.
// Pure helpers (mapPath, deriveMapping, matchItems) are exported for tests.

const PLEX_HEADERS = tok => ({ 'X-Plex-Token': tok, Accept: 'application/json', 'X-Plex-Product': 'MediaLedger', 'X-Plex-Client-Identifier': 'medialedger-desktop', 'X-Plex-Version': '1' });

async function api(cfg, path, timeout = 20000) {
  const url = cfg.baseUrl.replace(/\/$/, '') + path;
  const res = await fetch(url, { headers: PLEX_HEADERS(cfg.token), signal: AbortSignal.timeout(timeout) });
  if (res.status === 401) throw new Error('Plex rejected the token (401)');
  if (!res.ok) throw new Error(`Plex answered HTTP ${res.status} for ${path}`);
  const j = await res.json();
  return j.MediaContainer || {};
}

async function testConnection(cfg) {
  if (!cfg || !cfg.baseUrl) return { ok: false, message: 'No Plex URL configured' };
  if (!cfg.token) return { ok: false, message: 'No Plex token configured' };
  try {
    const mc = await api(cfg, '/identity', 8000);
    const sections = await listSections(cfg).catch(() => []);
    return { ok: true, message: `Connected: Plex ${mc.version || '?'} · ${sections.length} librar${sections.length === 1 ? 'y' : 'ies'}: ${sections.map(s => `${s.title} (${s.type})`).join(', ')}`, machine: mc.machineIdentifier, version: mc.version, sections };
  } catch (e) {
    return { ok: false, message: 'Could not reach Plex: ' + e.message };
  }
}

async function listSections(cfg) {
  const mc = await api(cfg, '/library/sections');
  return (mc.Directory || []).map(d => ({ key: String(d.key), title: d.title, type: d.type, agent: d.agent, locations: (d.Location || []).map(l => l.path) }));
}

// ---- path mapping ----------------------------------------------------------------
const norm = p => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

function mapPath(plexFile, pathMap) {
  const f = String(plexFile || '');
  for (const m of pathMap || []) {
    if (!m.plex || !m.local) continue;
    const pre = m.plex.replace(/[\\/]+$/, '');
    if (f.toLowerCase().startsWith(pre.toLowerCase())) {
      return (m.local.replace(/[\\/]+$/, '') + f.slice(pre.length)).replace(/\//g, '\\');
    }
  }
  return null;
}

// Propose { plex, local } from one Plex file path and one local abs path that share a tail.
function deriveMapping(plexFile, localAbs) {
  const p = String(plexFile).split(/[\\/]/), l = String(localAbs).split(/[\\/]/);
  let i = p.length - 1, j = l.length - 1, tail = 0;
  while (i >= 0 && j >= 0 && p[i].toLowerCase() === l[j].toLowerCase()) { i--; j--; tail++; }
  if (tail < 2) return null; // need at least folder + file to be confident
  return { plex: p.slice(0, i + 1).join('/') || '/', local: l.slice(0, j + 1).join('\\') };
}

// ---- matching -----------------------------------------------------------------------
// items: [{ ratingKey, type, title, year, guid, guids[], userRating, audienceRating, rating, viewCount, lastViewedAt, viewOffset, duration, addedAt, file, showTitle, showKey, seasonIndex, index }]
// files: Map lower(abs_path) → { id, ... }
function matchItems(items, filesByPath, pathMap) {
  const matched = [], unmatched = [];
  for (const it of items) {
    if (!it.file) { unmatched.push({ ...it, reason: 'no file part' }); continue; }
    const local = mapPath(it.file, pathMap);
    if (!local) { unmatched.push({ ...it, reason: 'no path mapping' }); continue; }
    const f = filesByPath.get(norm(local));
    if (!f) { unmatched.push({ ...it, reason: 'not in MediaLedger', local }); continue; }
    matched.push({ item: it, file: f, local });
  }
  return { matched, unmatched };
}

const ids = (g) => (g || []).map(x => x.id || x).filter(Boolean);
const pick = (o, k) => o && o[k] != null ? o[k] : null;
function flattenVideo(v, section) {
  const media = v.Media || [];
  const part = media[0] && media[0].Part && media[0].Part[0];
  return {
    ratingKey: String(v.ratingKey), type: v.type, title: v.title, year: pick(v, 'year'), guid: v.guid, guids: ids(v.Guid),
    userRating: pick(v, 'userRating'), audienceRating: pick(v, 'audienceRating'), rating: pick(v, 'rating'),
    viewCount: pick(v, 'viewCount') || 0, lastViewedAt: pick(v, 'lastViewedAt'), viewOffset: pick(v, 'viewOffset'), duration: pick(v, 'duration'), addedAt: pick(v, 'addedAt'),
    file: part ? part.file : null, section: section.title, sectionKey: section.key,
    showTitle: v.grandparentTitle || null, showKey: v.grandparentRatingKey ? String(v.grandparentRatingKey) : null, seasonIndex: pick(v, 'parentIndex'), index: pick(v, 'index'),
    contentRating: v.contentRating || null, originallyAvailableAt: v.originallyAvailableAt || null,
    genres: Array.isArray(v.Genre) ? v.Genre.map(g => g.tag).filter(Boolean) : [],
  };
}

// Fetch every item of a section. Movies: /all. Shows: /all?type=4 (episodes) plus /all (shows) for show-level ratings.
async function fetchSection(cfg, section, onProgress = () => {}) {
  const out = { videos: [], shows: [] };
  if (section.type === 'movie') {
    const mc = await api(cfg, `/library/sections/${section.key}/all?includeGuids=1`, 120000);
    out.videos = (mc.Metadata || []).map(v => flattenVideo(v, section));
  } else if (section.type === 'show') {
    const shows = await api(cfg, `/library/sections/${section.key}/all?includeGuids=1`, 120000);
    out.shows = (shows.Metadata || []).map(s => ({ ratingKey: String(s.ratingKey), title: s.title, year: pick(s, 'year'), guids: ids(s.Guid), userRating: pick(s, 'userRating'), audienceRating: pick(s, 'audienceRating'), rating: pick(s, 'rating'), leafCount: pick(s, 'leafCount'), viewedLeafCount: pick(s, 'viewedLeafCount'), childCount: pick(s, 'childCount'), contentRating: s.contentRating || null, section: section.title, genres: Array.isArray(s.Genre) ? s.Genre.map(g => g.tag).filter(Boolean) : [] }));
    // Episodes in pages of 500 so a 12k-episode section doesn't need one giant response.
    let start = 0; const size = 500;
    for (;;) {
      const mc = await api(cfg, `/library/sections/${section.key}/all?type=4&includeGuids=1&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${size}`, 120000);
      const page = (mc.Metadata || []).map(v => flattenVideo(v, section));
      out.videos.push(...page);
      onProgress({ section: section.title, fetched: out.videos.length, total: mc.totalSize || null });
      if (page.length < size) break;
      start += size;
    }
  }
  return out;
}

/**
 * Full sync. opts: { log, onProgress, sections (keys to include; default all movie/show) }
 * Returns { sections, items, matched, unmatched, shows, mappingSuggested }
 */
async function syncLibrary(db, cfg, opts = {}) {
  const log = opts.log || (() => {}), onProgress = opts.onProgress || (() => {});
  const sections = (await listSections(cfg)).filter(s => ['movie', 'show'].includes(s.type) && (!opts.sections || opts.sections.includes(s.key)));
  const filesByPath = new Map(db.all('SELECT id, root_id, abs_path, library_type, show_name, group_key FROM files WHERE missing=0').map(f => [norm(f.abs_path), f]));
  let pathMap = (cfg.pathMap || []).filter(m => m.plex && m.local);
  let mappingSuggested = null;
  const stats = { sections: sections.length, items: 0, matched: 0, unmatched: 0, shows: 0, unmatchedSamples: [], bySection: [] };
  const now = new Date().toISOString();

  for (const sec of sections) {
    onProgress({ phase: 'fetch', section: sec.title, message: `Fetching ${sec.title} from Plex…` });
    const { videos, shows } = await fetchSection(cfg, sec, p => onProgress({ phase: 'fetch', ...p, message: `Fetching ${sec.title}: ${p.fetched.toLocaleString()}${p.total ? ' / ' + p.total.toLocaleString() : ''}` }));
    stats.items += videos.length;

    // No mapping yet? Derive one from the first Plex file whose tail exists locally.
    if (!pathMap.length && videos.length) {
      for (const v of videos.slice(0, 200)) {
        if (!v.file) continue;
        const tail = v.file.split(/[\\/]/).slice(-2).join('\\').toLowerCase();
        for (const [k, f] of filesByPath) { if (k.endsWith('\\' + tail)) { const m = deriveMapping(v.file, f.abs_path); if (m) { pathMap = [m]; mappingSuggested = m; log(`plex: derived path mapping ${m.plex} → ${m.local}`); } break; } }
        if (pathMap.length) break;
      }
    }

    const { matched, unmatched } = matchItems(videos, filesByPath, pathMap);
    stats.matched += matched.length; stats.unmatched += unmatched.length;
    { const reasons = {}; for (const u of unmatched) reasons[u.reason] = (reasons[u.reason] || 0) + 1;
      stats.bySection.push({ section: sec.title, type: sec.type, items: videos.length, matched: matched.length, unmatched: unmatched.length, reasons, sample: unmatched[0] ? { file: unmatched[0].file, local: unmatched[0].local || null } : null, locations: sec.locations || [] }); }
    for (const u of unmatched.slice(0, 5 - stats.unmatchedSamples.length)) stats.unmatchedSamples.push({ title: u.showTitle ? `${u.showTitle} S${u.seasonIndex}E${u.index}` : u.title, file: u.file, reason: u.reason });

    onProgress({ phase: 'store', section: sec.title, message: `Storing ${matched.length.toLocaleString()} matches for ${sec.title}…` });
    db.transaction(() => {
      const upd = db.prep(`UPDATE files SET plex_rating_key=?, plex_title=?, plex_year=?, plex_show_key=?, plex_guids=?, plex_user_rating=?, plex_audience_rating=?, plex_view_count=?, plex_last_viewed=?, plex_view_offset_ms=?, plex_section=?, plex_synced_at=?, plex_genres=? WHERE id=?`);
      for (const { item: it, file: f } of matched) {
        upd.run(it.ratingKey, it.showTitle || it.title, it.year, it.showKey, JSON.stringify(it.guids), it.userRating, it.audienceRating, it.viewCount, it.lastViewedAt ? new Date(it.lastViewedAt * 1000).toISOString() : null, it.viewOffset, it.section, now, it.type === 'movie' && it.genres && it.genres.length ? JSON.stringify(it.genres) : null, f.id);
      }
      const ups = db.prep(`INSERT INTO plex_shows (rating_key, section, title, year, guids, user_rating, audience_rating, rating, leaf_count, viewed_leaf_count, content_rating, synced_at, genres) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(rating_key) DO UPDATE SET section=excluded.section, title=excluded.title, year=excluded.year, guids=excluded.guids, user_rating=excluded.user_rating, audience_rating=excluded.audience_rating, rating=excluded.rating, leaf_count=excluded.leaf_count, viewed_leaf_count=excluded.viewed_leaf_count, content_rating=excluded.content_rating, synced_at=excluded.synced_at, genres=excluded.genres`);
      for (const s of shows) ups.run(s.ratingKey, s.section, s.title, s.year, JSON.stringify(s.guids), s.userRating, s.audienceRating, s.rating, s.leafCount, s.viewedLeafCount, s.contentRating, now, s.genres && s.genres.length ? JSON.stringify(s.genres) : null);
      stats.shows += shows.length;
    });
    log(`plex: ${sec.title}: ${videos.length} items, ${matched.length} matched, ${unmatched.length} unmatched`);
  }
  // Files Plex no longer has: clear stale links from earlier syncs
  db.run('UPDATE files SET plex_rating_key=NULL WHERE plex_synced_at IS NOT NULL AND plex_synced_at < ?', now);
  return { ...stats, pathMap, mappingSuggested, synced_at: now };
}

// ---- play history (every account on the server) ---------------------------------------
// GET /status/sessions/history/all lists one row per play with accountID; /accounts names them.
async function fetchAccounts(cfg) {
  const mc = await api(cfg, '/accounts', 15000).catch(() => ({}));
  return (mc.Account || []).map(a => ({ id: Number(a.id), name: a.name || a.title || `Account ${a.id}` }));
}
async function fetchDevices(cfg) {
  const mc = await api(cfg, '/devices', 15000).catch(() => ({}));
  const m = new Map(); for (const d of mc.Device || []) m.set(Number(d.id), d.name || d.platform || null); return m;
}
async function fetchHistory(cfg, sinceUnix, onProgress = () => {}) {
  const out = []; let start = 0; const size = 500;
  const since = sinceUnix ? `&viewedAt%3E%3D=${Math.floor(sinceUnix)}` : '';
  for (;;) {
    const mc = await api(cfg, `/status/sessions/history/all?sort=viewedAt:desc${since}&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${size}`, 120000);
    const page = mc.Metadata || [];
    out.push(...page); onProgress({ fetched: out.length, total: mc.totalSize || null });
    if (page.length < size) break;
    start += size;
  }
  return out;
}
const historyKeyOf = (h) => String(h.historyKey || `${h.ratingKey}-${h.accountID}-${h.viewedAt}`).replace(/^\/status\/sessions\/history\//, '');

/** Pull new plays since the newest stored one (with a day of overlap) and store them with account names. */
async function syncHistory(db, cfg, opts = {}) {
  const log = opts.log || (() => {}), onProgress = opts.onProgress || (() => {});
  const accounts = await fetchAccounts(cfg);
  const now = new Date().toISOString();
  db.transaction(() => { for (const a of accounts) db.run('INSERT INTO plex_accounts (id, name, synced_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, synced_at=excluded.synced_at', a.id, a.name, now); });
  const names = new Map(db.all('SELECT id, name FROM plex_accounts').map(a => [a.id, a.name]));
  const devices = await fetchDevices(cfg);
  const newest = db.get("SELECT MAX(viewed_at) v FROM plex_history WHERE history_key NOT LIKE 'wh-%'").v;
  const since = newest ? new Date(newest).getTime() / 1000 - 86400 : 0;
  onProgress({ phase: 'history', message: 'Fetching play history from Plex…' });
  const rows = await fetchHistory(cfg, since, p => onProgress({ phase: 'history', message: `Fetching play history: ${p.fetched.toLocaleString()}${p.total ? ' / ' + p.total.toLocaleString() : ''}` }));
  const sections = new Map((await listSections(cfg).catch(() => [])).map(s => [String(s.key), s.title]));
  const fileOf = db.prep('SELECT id, library_type, duration_s FROM files WHERE plex_rating_key=? LIMIT 1');
  let added = 0;
  db.transaction(() => {
    const ins = db.prep('INSERT OR IGNORE INTO plex_history (history_key, rating_key, account_id, account_name, device, type, title, show_title, season, episode, section, viewed_at, duration_s, file_id, library_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const dropWh = db.prep("DELETE FROM plex_history WHERE history_key LIKE 'wh-%' AND rating_key=? AND account_id=? AND ABS(strftime('%s', viewed_at) - strftime('%s', ?)) < 1800");
    for (const h of rows) {
      if (!h.viewedAt) continue;
      const rk = h.ratingKey ? String(h.ratingKey) : null;
      const f = rk ? fileOf.get(rk) : null;
      const viewed = new Date(Number(h.viewedAt) * 1000).toISOString();
      const acc = Number(h.accountID) || 0;
      if (rk) dropWh.run(rk, acc, viewed);
      const r = ins.run(historyKeyOf(h), rk, acc, names.get(acc) || `Account ${acc}`, devices.get(Number(h.deviceID)) || null, h.type || null, h.title || null, h.grandparentTitle || null, pick(h, 'parentIndex'), pick(h, 'index'), sections.get(String(h.librarySectionID)) || null, viewed, f && f.duration_s ? f.duration_s : (h.duration ? h.duration / 1000 : null), f ? f.id : null, f ? f.library_type : null);
      added += r.changes;
    }
    // Link plays that arrived before their file was matched.
    db.run('UPDATE plex_history SET file_id=(SELECT id FROM files WHERE plex_rating_key=plex_history.rating_key LIMIT 1), library_type=(SELECT library_type FROM files WHERE plex_rating_key=plex_history.rating_key LIMIT 1), duration_s=COALESCE(duration_s,(SELECT duration_s FROM files WHERE plex_rating_key=plex_history.rating_key LIMIT 1)) WHERE file_id IS NULL AND rating_key IS NOT NULL');
  });
  log(`plex history: ${rows.length} rows fetched, ${added} new, ${accounts.length} accounts`);
  return { fetched: rows.length, added, accounts: accounts.length };
}

// ---- webhooks ---------------------------------------------------------------------------
// Plex Pass webhooks POST multipart/form-data with a JSON "payload" part. We act on:
//   library.new                 something was added → a scan should run soon
//   media.scrobble              watched past 90 % → play count + last viewed on the linked file
//   media.rate                  the user rated it → plex_user_rating on the file or show
// Returns what was done so the caller can log it and decide whether to scan.
function applyWebhookEvent(db, payload) {
  const ev = String((payload || {}).event || '');
  const md = (payload || {}).Metadata || {};
  const out = { event: ev, title: md.grandparentTitle ? `${md.grandparentTitle} – ${md.title}` : md.title || null, type: md.type || null, ratingKey: md.ratingKey ? String(md.ratingKey) : null, matched: false, scan: false, updated: null };
  if (ev === 'library.new') { out.scan = true; return out; }
  if (!out.ratingKey) return out;
  const f = db.get('SELECT id, plex_view_count FROM files WHERE plex_rating_key=?', out.ratingKey);
  if (ev === 'media.scrobble') {
    const now = new Date().toISOString();
    if (f) { db.run('UPDATE files SET plex_view_count=COALESCE(plex_view_count,0)+1, plex_last_viewed=? WHERE id=?', now, f.id); out.matched = true; out.updated = 'watched'; }
    // Record who watched it, so the Watched tab is current between syncs. The next sync replaces this row with Plex's own.
    const acc = payload.Account || {}, player = payload.Player || {};
    const accId = Number(acc.id) || 0;
    if (accId && acc.title) db.run('INSERT INTO plex_accounts (id, name, synced_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name', accId, acc.title, now);
    const fi = f ? db.get('SELECT library_type, duration_s FROM files WHERE id=?', f.id) : null;
    db.run('INSERT OR IGNORE INTO plex_history (history_key, rating_key, account_id, account_name, device, type, title, show_title, season, episode, section, viewed_at, duration_s, file_id, library_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      `wh-${Date.now()}-${accId}-${out.ratingKey}-${Math.random().toString(36).slice(2, 7)}`, out.ratingKey, accId, acc.title || `Account ${accId}`, player.title || null, md.type || null, md.title || null, md.grandparentTitle || null, md.parentIndex != null ? Number(md.parentIndex) : null, md.index != null ? Number(md.index) : null, md.librarySectionTitle || null, now, fi && fi.duration_s ? fi.duration_s : (md.duration ? md.duration / 1000 : null), f ? f.id : null, fi ? fi.library_type : null);
    out.who = acc.title || null;
  } else if (ev === 'media.rate') {
    const rating = md.rating != null ? Number(md.rating) : (payload.rating != null ? Number(payload.rating) : null);
    if (f && rating != null) { db.run('UPDATE files SET plex_user_rating=? WHERE id=?', rating, f.id); out.matched = true; out.updated = 'rating'; }
    else if (rating != null && md.type === 'show') { const n = db.run('UPDATE plex_shows SET user_rating=? WHERE rating_key=?', rating, out.ratingKey).changes; if (n) { out.matched = true; out.updated = 'show rating'; } }
  }
  return out;
}

/** Pull the JSON "payload" part out of a multipart/form-data body without a parser dependency. */
function parseWebhookBody(contentType, body) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) { try { return JSON.parse(body.toString('utf8')); } catch { return null; } }
  const boundary = '--' + (m[1] || m[2]).trim();
  const text = body.toString('latin1');
  for (const part of text.split(boundary)) {
    const i = part.indexOf('\r\n\r\n'); if (i < 0) continue;
    const head = part.slice(0, i);
    if (!/name="payload"/i.test(head)) continue;
    const raw = part.slice(i + 4).replace(/\r\n$/, '');
    try { return JSON.parse(Buffer.from(raw, 'latin1').toString('utf8')); } catch { return null; }
  }
  return null;
}

module.exports = { syncHistory, fetchHistory, fetchAccounts, historyKeyOf, testConnection, listSections, syncLibrary, mapPath, deriveMapping, matchItems, flattenVideo, applyWebhookEvent, parseWebhookBody };
