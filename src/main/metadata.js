'use strict';
// Expected episode counts from free, keyless APIs:
//   TV    → TVmaze  (https://api.tvmaze.com, 20 requests / 10 s)
//   Anime → AniList (https://graphql.anilist.co, 90 requests / min)
// The result per series is a map { season: episodeCount } stored in series_meta.
// Nothing here is required for scanning; it only turns "numbering gaps" into
// "missing episodes" on the dashboard, series list and CSVs.

const TVMAZE = 'https://api.tvmaze.com';
const ANILIST = 'https://graphql.anilist.co';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

// Strip things the share adds to folder names that the APIs won't know.
function cleanTitle(show) {
  return String(show)
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\s*\((19|20)\d{2}\)\s*$/, '')
    .replace(/\s*-\s*(complete|season \d+.*|the complete series)$/i, '')
    .replace(/\s+/g, ' ').trim();
}

function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.startsWith(b) || b.startsWith(a)) return 0.9;
  const ta = new Set(a.split(' ')), tb = new Set(b.split(' '));
  let common = 0; for (const t of ta) if (tb.has(t)) common++;
  return common / Math.max(ta.size, tb.size);
}

async function getJson(url, opts = {}, retries = 2) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { ...opts, headers: { Accept: 'application/json', 'User-Agent': 'MediaLedger (https://github.com/AxialForge/medialedger)', ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000) });
    if (res.status === 429 && i < retries) { const wait = Number(res.headers.get('retry-after')) || 5; await sleep(wait * 1000); continue; }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res.json();
  }
}

// ---- TVmaze ---------------------------------------------------------------------
async function lookupTvmaze(show) {
  const q = cleanTitle(show);
  const results = await getJson(`${TVMAZE}/search/shows?q=${encodeURIComponent(q)}`);
  if (!results || !results.length) return { source: 'tvmaze', found: false };
  const best = results.map(r => ({ r: r.show, s: similarity(q, r.show.name) + (r.score || 0) / 100 })).sort((a, b) => b.s - a.s)[0];
  if (best.s < 0.5) return { source: 'tvmaze', found: false, candidates: results.slice(0, 5).map(r => ({ id: r.show.id, title: r.show.name, year: (r.show.premiered || '').slice(0, 4), url: r.show.url })) };
  return fetchTvmazeById(best.r.id, best.r);
}
async function fetchTvmazeById(id, showObj) {
  const show = showObj || await getJson(`${TVMAZE}/shows/${id}`);
  if (!show) return { source: 'tvmaze', found: false };
  const eps = await getJson(`${TVMAZE}/shows/${id}/episodes?specials=1`) || [];
  const seasons = {};
  const today = new Date().toISOString().slice(0, 10);
  // Episodes that have not aired yet are not "missing": they are listed as the next airing instead.
  const future = eps.filter(e => e.airdate && e.airdate > today).sort((a, b) => a.airdate.localeCompare(b.airdate));
  for (const e of eps) {
    if (e.airdate && e.airdate > today) continue;
    const s = e.type === 'regular' ? e.season : 0; // specials/insignificant → season 0
    if (e.type !== 'regular') { seasons[0] = (seasons[0] || 0) + 1; continue; }
    seasons[s] = Math.max(seasons[s] || 0, e.number || 0);
  }
  const total = Object.entries(seasons).filter(([s]) => s !== '0').reduce((a, [, n]) => a + n, 0);
  return { source: 'tvmaze', found: true, source_id: String(show.id), matched_title: show.name, status: show.status, seasons, total_episodes: total, url: show.url, rating: show.rating && show.rating.average != null ? Number(show.rating.average) : null, rating_votes: null, genres: Array.isArray(show.genres) ? show.genres : [], online_tags: [show.language && show.language !== 'English' ? show.language : null, show.type && show.type !== 'Scripted' ? show.type : null].filter(Boolean), next_airing: future[0] ? future[0].airdate : null, next_episode: future[0] ? (future[0].type === 'regular' ? `S${String(future[0].season).padStart(2, '0')}E${String(future[0].number || 0).padStart(2, '0')}` : 'special') : null };
}

// ---- AniList ---------------------------------------------------------------------
const ANILIST_SEARCH = `query ($search: String) { Page(perPage: 8) { media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
  id title { romaji english } format episodes status seasonYear siteUrl averageScore popularity nextAiringEpisode { episode airingAt } genres tags { name rank isMediaSpoiler }
  relations { edges { relationType node { id title { romaji english } format episodes status seasonYear siteUrl } } } } } }`;
const ANILIST_BY_ID = `query ($id: Int) { Media(id: $id, type: ANIME) {
  id title { romaji english } format episodes status seasonYear siteUrl averageScore popularity nextAiringEpisode { episode airingAt } genres tags { name rank isMediaSpoiler }
  relations { edges { relationType node { id title { romaji english } format episodes status seasonYear siteUrl } } } } }`;

async function anilist(query, variables) {
  const j = await getJson(ANILIST, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (j && j.errors) throw new Error(j.errors.map(e => e.message).join('; '));
  return j && j.data;
}
const aniTitle = m => (m.title && (m.title.english || m.title.romaji)) || '';
// Ongoing series have episodes=null; the next airing episode number tells us how many exist so far.
const aniCount = m => m.episodes || (m.nextAiringEpisode && m.nextAiringEpisode.episode ? m.nextAiringEpisode.episode - 1 : 0);
// AniList lists split-cour seasons as separate entries ("Part 2", "Cour 2", "2nd Half"); folders usually don't.
const isPart = m => /(part|cour)\s*\d|(2nd|second|final) half|part (two|three|ii|iii)/i.test(`${m.title?.english || ''} ${m.title?.romaji || ''}`);

// Walk PREQUEL links back to the first TV entry, then SEQUEL links forward,
// counting each TV / TV_SHORT entry as one season. ONA/OVA/movies become season 0.
async function buildAnilistSeasons(root) {
  const seen = new Set();
  let first = root;
  for (let i = 0; i < 12; i++) {
    const prev = (first.relations?.edges || []).find(e => e.relationType === 'PREQUEL' && ['TV', 'TV_SHORT'].includes(e.node.format));
    if (!prev || seen.has(prev.node.id)) break;
    seen.add(prev.node.id);
    const d = await anilist(ANILIST_BY_ID, { id: prev.node.id }); await sleep(700);
    if (!d || !d.Media) break;
    first = d.Media;
  }
  const seasons = {}; let cur = first, n = 1; const chain = new Set([first.id]);
  let specials = 0;
  for (let i = 0; i < 20 && cur; i++) {
    if (i > 0 && isPart(cur)) seasons[n] = (seasons[n] || 0) + aniCount(cur); // continue the same season
    else { if (i > 0) n++; seasons[n] = aniCount(cur); }
    for (const e of cur.relations?.edges || []) if (e.relationType === 'SIDE_STORY' || (e.relationType === 'SEQUEL' && ['OVA', 'ONA', 'SPECIAL', 'MOVIE'].includes(e.node.format))) specials += aniCount(e.node) || 1;
    const next = (cur.relations?.edges || []).find(e => e.relationType === 'SEQUEL' && ['TV', 'TV_SHORT'].includes(e.node.format) && !chain.has(e.node.id));
    if (!next) break;
    chain.add(next.node.id);
    const d = await anilist(ANILIST_BY_ID, { id: next.node.id }); await sleep(700);
    if (!d || !d.Media) break;
    cur = d.Media;
  }
  if (specials) seasons[0] = specials;
  const total = Object.entries(seasons).filter(([s]) => s !== '0').reduce((a, [, c]) => a + c, 0);
  return { seasons, total, first, last: cur };
}

async function lookupAnilist(show) {
  const q = cleanTitle(show).replace(/\bS\d+$/i, '').trim();
  const d = await anilist(ANILIST_SEARCH, { search: q });
  const list = (d && d.Page && d.Page.media) || [];
  if (!list.length) return { source: 'anilist', found: false };
  const scored = list.map(m => ({ m, s: Math.max(similarity(q, m.title.english), similarity(q, m.title.romaji)) + (['TV', 'TV_SHORT'].includes(m.format) ? 0.05 : 0) })).sort((a, b) => b.s - a.s);
  if (scored[0].s < 0.5) return { source: 'anilist', found: false, candidates: list.slice(0, 5).map(m => ({ id: m.id, title: aniTitle(m), year: m.seasonYear, url: m.siteUrl })) };
  return fetchAnilistById(scored[0].m.id, scored[0].m);
}
async function fetchAnilistById(id, mediaObj) {
  let m = mediaObj;
  if (!m) { const d = await anilist(ANILIST_BY_ID, { id: Number(id) }); m = d && d.Media; }
  if (!m) return { source: 'anilist', found: false };
  const { seasons, total, first, last } = await buildAnilistSeasons(m);
  // AniList tags are crowd-ranked 0–100; keep the confident, non-spoiler ones (Isekai, Slice of Life, Time Skip …).
  const tags = (m.tags || first.tags || []).filter(t => t && !t.isMediaSpoiler && (t.rank == null || t.rank >= 60)).sort((a, b) => (b.rank || 0) - (a.rank || 0)).slice(0, 8).map(t => t.name);
  return { source: 'anilist', found: true, source_id: String(first.id), matched_title: aniTitle(first), status: last.status, seasons, total_episodes: total, url: first.siteUrl, rating: first.averageScore != null ? Math.round(first.averageScore) / 10 : null, rating_votes: first.popularity || null, genres: Array.isArray(m.genres) ? m.genres : (first.genres || []), online_tags: tags, next_airing: last.nextAiringEpisode && last.nextAiringEpisode.airingAt ? new Date(last.nextAiringEpisode.airingAt * 1000).toISOString().slice(0, 10) : null, next_episode: last.nextAiringEpisode ? `E${last.nextAiringEpisode.episode}` : null };
}

// ---- public -------------------------------------------------------------------
async function lookupSeries(type, show) {
  return type === 'anime' ? lookupAnilist(show) : lookupTvmaze(show);
}
async function fetchById(source, id) {
  return source === 'anilist' ? fetchAnilistById(id) : fetchTvmazeById(id);
}
async function searchCandidates(typeOrSource, q) {
  if (typeOrSource === 'anime' || typeOrSource === 'anilist') {
    const d = await anilist(ANILIST_SEARCH, { search: q });
    return ((d && d.Page && d.Page.media) || []).map(m => ({ source: 'anilist', id: m.id, title: aniTitle(m), year: m.seasonYear, format: m.format, episodes: aniCount(m) || null, url: m.siteUrl }));
  }
  const r = await getJson(`${TVMAZE}/search/shows?q=${encodeURIComponent(q)}`) || [];
  return r.map(x => ({ source: 'tvmaze', id: x.show.id, title: x.show.name, year: (x.show.premiered || '').slice(0, 4), format: x.show.type, episodes: null, url: x.show.url }));
}

// Compare what is on disk with the expected counts. rows: files of one series.
function missingEpisodes(rows, seasonsJson) {
  let expected; try { expected = typeof seasonsJson === 'string' ? JSON.parse(seasonsJson) : seasonsJson; } catch { expected = null; }
  const have = new Map();
  for (const r of rows) {
    if (r.season == null || r.episode == null) continue;
    if (!have.has(r.season)) have.set(r.season, new Set());
    const end = r.episode_end || r.episode;
    for (let e = r.episode; e <= end; e++) have.get(r.season).add(e);
  }
  const out = { missing: [], missingCount: 0, expectedTotal: 0, haveTotal: 0, absolute: false };
  if (!expected) return out;
  // Absolute numbering guard: if any season on disk has an episode number far above its expected count, skip that season.
  for (const [s, n] of Object.entries(expected)) {
    const season = Number(s); if (season === 0 || !n) continue;
    out.expectedTotal += n;
    const set = have.get(season) || new Set();
    const maxOnDisk = Math.max(0, ...set);
    if (maxOnDisk > n * 1.5 && maxOnDisk > n + 5) { out.absolute = true; out.haveTotal += Math.min(set.size, n); continue; }
    const miss = []; for (let e = 1; e <= n; e++) if (!set.has(e)) miss.push(e);
    out.haveTotal += n - miss.length;
    if (miss.length) { out.missing.push({ season, missing: miss, expected: n }); out.missingCount += miss.length; }
  }
  return out;
}

/**
 * Apply a collecting policy to a missingEpisodes() result. pref: { mute, from_season, from_episode } or null.
 * Muted: nothing counts as missing. From S/E onward: earlier seasons and earlier episodes of that season are dropped.
 * Returns a new result with rawMissingCount (before the policy) and policy ('mute' | 'from' | null).
 */
function applyCollectPolicy(res, pref) {
  const out = { ...res, rawMissingCount: res.missingCount, policy: null };
  if (!pref) return out;
  if (pref.mute) return { ...out, missing: [], missingCount: 0, policy: 'mute' };
  const fs = pref.from_season != null ? Number(pref.from_season) : (pref.from_episode != null ? 1 : null);
  if (fs == null) return out;
  const fe = Number(pref.from_episode) || 1;
  const missing = [];
  for (const m of res.missing) {
    if (m.season < fs) continue;
    const eps = m.season === fs ? m.missing.filter(e => e >= fe) : m.missing;
    if (eps.length) missing.push({ ...m, missing: eps });
  }
  return { ...out, missing, missingCount: missing.reduce((a, m) => a + m.missing.length, 0), policy: 'from' };
}

module.exports = { applyCollectPolicy, lookupSeries, fetchById, searchCandidates, missingEpisodes, cleanTitle, similarity };
