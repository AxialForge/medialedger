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
    out.shows = (shows.Metadata || []).map(s => ({ ratingKey: String(s.ratingKey), title: s.title, year: pick(s, 'year'), guids: ids(s.Guid), userRating: pick(s, 'userRating'), audienceRating: pick(s, 'audienceRating'), rating: pick(s, 'rating'), leafCount: pick(s, 'leafCount'), viewedLeafCount: pick(s, 'viewedLeafCount'), childCount: pick(s, 'childCount'), contentRating: s.contentRating || null, section: section.title }));
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
  const stats = { sections: sections.length, items: 0, matched: 0, unmatched: 0, shows: 0, unmatchedSamples: [] };
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
    for (const u of unmatched.slice(0, 5 - stats.unmatchedSamples.length)) stats.unmatchedSamples.push({ title: u.showTitle ? `${u.showTitle} S${u.seasonIndex}E${u.index}` : u.title, file: u.file, reason: u.reason });

    onProgress({ phase: 'store', section: sec.title, message: `Storing ${matched.length.toLocaleString()} matches for ${sec.title}…` });
    db.transaction(() => {
      const upd = db.prep(`UPDATE files SET plex_rating_key=?, plex_title=?, plex_year=?, plex_show_key=?, plex_guids=?, plex_user_rating=?, plex_audience_rating=?, plex_view_count=?, plex_last_viewed=?, plex_view_offset_ms=?, plex_section=?, plex_synced_at=? WHERE id=?`);
      for (const { item: it, file: f } of matched) {
        upd.run(it.ratingKey, it.showTitle || it.title, it.year, it.showKey, JSON.stringify(it.guids), it.userRating, it.audienceRating, it.viewCount, it.lastViewedAt ? new Date(it.lastViewedAt * 1000).toISOString() : null, it.viewOffset, it.section, now, f.id);
      }
      const ups = db.prep(`INSERT INTO plex_shows (rating_key, section, title, year, guids, user_rating, audience_rating, rating, leaf_count, viewed_leaf_count, content_rating, synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(rating_key) DO UPDATE SET section=excluded.section, title=excluded.title, year=excluded.year, guids=excluded.guids, user_rating=excluded.user_rating, audience_rating=excluded.audience_rating, rating=excluded.rating, leaf_count=excluded.leaf_count, viewed_leaf_count=excluded.viewed_leaf_count, content_rating=excluded.content_rating, synced_at=excluded.synced_at`);
      for (const s of shows) ups.run(s.ratingKey, s.section, s.title, s.year, JSON.stringify(s.guids), s.userRating, s.audienceRating, s.rating, s.leafCount, s.viewedLeafCount, s.contentRating, now);
      stats.shows += shows.length;
    });
    log(`plex: ${sec.title}: ${videos.length} items, ${matched.length} matched, ${unmatched.length} unmatched`);
  }
  // Files Plex no longer has: clear stale links from earlier syncs
  db.run('UPDATE files SET plex_rating_key=NULL WHERE plex_synced_at IS NOT NULL AND plex_synced_at < ?', now);
  return { ...stats, pathMap, mappingSuggested, synced_at: now };
}

module.exports = { testConnection, listSections, syncLibrary, mapPath, deriveMapping, matchItems, flattenVideo };
