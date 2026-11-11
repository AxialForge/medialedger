'use strict';
// What is this barcode? Asked in order, stopping at the first answer:
//   1. a release you already described (disc_releases)        -> no network at all
//   2. the cache of earlier answers (disc_lookups)            -> no network, no quota
//   3. UPCitemdb's free trial endpoint (no key)               -> 100 a day and 6 a minute, per address
//   4. nothing: the form is filled in by hand
// A lookup only ever SUGGESTS. It never creates or changes a release: the page shows the match in the form and
// the user saves it. Scanning never waits on it and never fails because of it, so nothing here throws.
//
// UPCitemdb returns a shop listing, not film data: "The Spiderwick Chronicles (Blu-ray) (Widescreen)". parseProduct()
// pulls a title, format, edition and year out of that conservatively, and says when the thing is not a disc at all
// (a barcode scanner reads cereal boxes too). With a TMDB key in Settings the title and year are tidied against TMDB.
const { normalizeUpc } = require('./discs');
const tmdb = require('./tmdb');

const ENDPOINT = 'https://api.upcitemdb.com/prod/trial/lookup?upc=';
const UA = 'MediaLedger (https://github.com/AxialForge/medialedger)';
const NONE_TTL_MS = 30 * 86400000;   // "not in their database" is asked again after a month

const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const EDITIONS = [
  [/steel\s?book/i, 'Steelbook'], [/director'?s cut/i, "Director's Cut"], [/extended (edition|cut|version)/i, 'Extended'], [/\bunrated\b/i, 'Unrated'],
  [/theatrical (edition|cut|version)/i, 'Theatrical'], [/collector'?s edition/i, "Collector's Edition"], [/special edition/i, 'Special Edition'],
  [/limited edition/i, 'Limited Edition'], [/ultimate edition/i, 'Ultimate Edition'], [/(\d+)(?:st|nd|rd|th) anniversary/i, m => m[0].replace(/anniversary/i, 'Anniversary')],
  [/criterion/i, 'Criterion'], [/remastered/i, 'Remastered'], [/final cut/i, 'Final Cut'],
];
// Words a shop adds that are not part of the film's name. Everything from the first one on is cut off the title.
const NOISE = /\s[-–:,+/|]?\s*(4k\b|ultra[\s-]?hd|uhd\b|blu[\s-]?ray|hd[\s-]?dvd|dvd\b|digital\b|widescreen|full\s?screen|steel\s?book|\d+[\s-]dis[ck]|includes\b|with digital).*$/i;
// A listing with no format word ("Project Hail Mary", brand MGM, no category) is still probably a disc. It is only
// plainly NOT one when the shop filed it under something that is not media. So: 'disc', 'maybe' or 'no'.
const MEDIA_CAT = /dvd|blu-?ray|movies|media|video|film|tv/i;
function confidence(p, category) {
  if (p.isDisc) return 'disc';
  const cat = String(category || '').trim();
  if (cat && !MEDIA_CAT.test(cat)) return 'no';
  return 'maybe';
}
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, '');

/**
 * A shop's product title -> { title, year, format, edition, discs_count, kind, season, isDisc }.
 * Conservative on purpose: a year only counts inside brackets ("(2010)", "(Blu-ray, 2010)"), so "Blade Runner 2049"
 * keeps its name, and when nothing sensible is left the raw string is returned as the title for the user to fix.
 */
function parseProduct(raw, category = '') {
  const src = String(raw || '').replace(/\s+/g, ' ').trim();
  const low = src.toLowerCase(), cat = String(category || '').toLowerCase();
  const has = (re) => re.test(low);
  const discWord = has(/blu[\s-]?ray|\bdvd\b|\bdis[ck]s?\b/), mediaCat = /dvd|blu-?ray|movies|media|video/.test(cat);
  let format = null;
  if (has(/\b4k\b|ultra[\s-]?hd|\buhd\b/) && (discWord || mediaCat)) format = '4K UHD';   // "4K" alone is also a television
  else if (has(/hd[\s-]?dvd/)) format = 'HD DVD';
  else if (has(/blu[\s-]?ray/) && has(/\b3d\b/)) format = '3D';
  else if (has(/blu[\s-]?ray/)) format = 'Blu-ray';
  else if (has(/\bdvd\b/)) format = 'DVD';

  const ym = src.match(/[([,]\s*((?:19|20)\d\d)\s*[)\],]/);
  const dm = low.match(/(\d+)[\s-]*dis[ck]s?\b/) || (low.match(/\b(two|three|four|five|six)[\s-]dis[ck]/) || []).slice(0, 2).map((v, i) => i ? String({ two: 2, three: 3, four: 4, five: 5, six: 6 }[v]) : v);
  const sm = low.match(/\bseason\s+(\d+)\b/) || low.match(/\bseries\s+(\d+)\b/);
  const om = low.match(/\b(?:the )?complete (first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) season\b/);
  const season = sm ? Number(sm[1]) : om ? ORDINALS[om[1]] : null;
  const tv = season != null || has(/complete series|the series\b|\bseasons? \d|complete collection.*season/);
  const set = has(/\btrilogy\b|\bquadrilogy\b|\b\d+[\s-](film|movie)s?\b|double feature|triple feature|box\s?set|\bcollection\b/) && !(has(/criterion collection/) && !has(/\btrilogy\b|box\s?set|\d+[\s-](film|movie)/));
  const editions = [];
  for (const [re, name] of EDITIONS) { const m = src.match(re); if (m) editions.push(typeof name === 'function' ? name(m) : name); }

  let title = src.replace(/\s*[([][^)\]]*[)\]]/g, ' ').replace(/\s+/g, ' ').trim();   // bracketed notes go
  title = (' ' + title).replace(NOISE, '').trim() || title;
  title = title.replace(/\s*[:\-–,]?\s*(the )?complete (series|collection|(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) season)\b.*$/i, '').replace(/\s*[:\-–,]?\s*\bseasons? \d+.*$/i, '');
  for (const [re] of EDITIONS) title = title.replace(new RegExp(`\\s*[:\\-–,]\\s*(the )?${re.source}\\s*$`, 'i'), '');
  title = title.replace(/[\s\-–:,+/|]+$/, '').trim() || src;

  return { title, year: ym ? Number(ym[1]) : null, format, edition: editions.slice(0, 2).join(', ') || null, discs_count: dm && dm[1] ? Number(dm[1]) : null, kind: tv ? 'tv' : set ? 'collection' : 'movie', season, isDisc: !!format };
}

function createDiscLookup({ db, settings, log = () => {}, fetchFn = (...a) => fetch(...a), clock = () => Date.now() }) {
  const limit = { remaining: null, limit: null, pausedUntil: 0 };
  const enabled = () => { const d = settings.get().discs; return !d || d.lookup !== false; };
  const tmdbKey = () => String((settings.get().tmdb || {}).key || '').trim();

  /** The one library title this could be, or null when there is none or more than one. */
  function matchLibrary(p, adultFilter = '') {
    const want = norm(p.title); if (!want) return null;
    if (p.kind === 'tv') {
      const hits = db.all(`SELECT DISTINCT library_type, show_name FROM files WHERE library_type IN ('tv','anime') AND missing=0 AND ignored=0 AND show_name IS NOT NULL${adultFilter}`).filter(r => norm(r.show_name) === want);
      return hits.length === 1 ? { library_type: hits[0].library_type, title_key: hits[0].show_name, title: hits[0].show_name, year: null, season: p.season } : null;
    }
    let hits = db.all(`SELECT group_key, MIN(movie_title) title, MIN(movie_year) year FROM files WHERE library_type='movie' AND missing=0 AND ignored=0 AND group_key IS NOT NULL${adultFilter} GROUP BY group_key`).filter(r => norm(r.title) === want);
    if (hits.length > 1 && p.year) hits = hits.filter(r => r.year === p.year);
    return hits.length === 1 ? { library_type: 'movie', title_key: hits[0].group_key, title: hits[0].title, year: hits[0].year } : null;
  }

  async function refine(p, likely) {
    const key = tmdbKey(); if (!key || !likely || p.kind === 'collection') return null;
    try {
      const r = p.kind === 'tv' ? await tmdb.searchTv(key, p.title, fetchFn) : await tmdb.searchMovie(key, p.title, p.year, fetchFn);
      // Only when TMDB plainly means the same thing: its name equals ours, or one begins with the other.
      if (!r || !r.title) return null;
      const a = norm(r.title), b = norm(p.title);
      if (a !== b && !(a.length > 3 && b.startsWith(a)) && !(b.length > 3 && a.startsWith(b))) return null;
      return r;
    } catch (e) { log('disc lookup: tmdb: ' + e.message); return null; }
  }

  async function suggestion(row, cached, adultFilter) {
    const p = parseProduct(row.title, row.category);
    const conf = confidence(p, row.category), likely = conf !== 'no';
    const t = await refine(p, likely);
    if (t) { p.title = t.title; if (t.year && p.kind !== 'tv') p.year = t.year; }
    return {
      status: 'found', source: row.source, cached, upc: row.upc, raw_title: row.title, brand: row.brand, category: row.category, isDisc: conf === 'disc', maybe: conf === 'maybe',
      release: { title: p.title, year: p.year, kind: p.kind, format: p.format, edition: p.edition, discs_count: p.discs_count, studio: likely ? row.brand || null : null },
      link: likely ? matchLibrary(p, adultFilter) : null, tmdb: t ? { id: t.id, kind: t.kind } : null, quota: { remaining: limit.remaining, limit: limit.limit },
    };
  }

  /** @returns {{status: 'invalid'|'local'|'off'|'found'|'none'|'limited'|'error', ...}} never throws */
  async function lookup(raw, { refresh = false, adultFilter = '' } = {}) {
    try {
      const upc = normalizeUpc(raw);
      if (!upc) return { status: 'invalid' };
      const release = db.get('SELECT * FROM disc_releases WHERE upc=?', upc);
      if (release) return { status: 'local', upc, release };
      const hit = db.get('SELECT * FROM disc_lookups WHERE upc=?', upc);
      if (hit && !refresh) {
        if (hit.status === 'found') return suggestion(hit, true, adultFilter);
        if (clock() - new Date(hit.ts).getTime() < NONE_TTL_MS) return { status: 'none', upc, cached: true };
      }
      if (!enabled()) return { status: 'off', upc };
      if (limit.pausedUntil > clock()) return { status: 'limited', upc, retryAt: new Date(limit.pausedUntil).toISOString() };

      let res, body;
      try {
        res = await fetchFn(ENDPOINT + upc, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
        body = await res.json().catch(() => ({}));
      } catch (e) { return { status: 'error', upc, message: /abort|timeout/i.test(e.name + e.message) ? 'The lookup service did not answer in time' : 'Could not reach the lookup service' }; }
      const head = (k) => { const v = res.headers && res.headers.get ? res.headers.get(k) : null; return v == null || v === '' ? null : Number(v); };
      const remaining = head('x-ratelimit-remaining'), cap = head('x-ratelimit-limit'), reset = head('x-ratelimit-reset');
      if (remaining != null) limit.remaining = remaining; if (cap != null) limit.limit = cap;
      if (res.status === 429 || body.code === 'TOO_FAST' || body.code === 'EXCEED_LIMIT') {
        // Their reset header is a Unix time. Without it, rest a minute (the burst window) rather than guess the daily one.
        limit.pausedUntil = reset && reset * 1000 > clock() ? reset * 1000 : clock() + 60000;
        log(`disc lookup: UPCitemdb says ${body.code || res.status}, resting until ${new Date(limit.pausedUntil).toISOString()}`);
        return { status: 'limited', upc, retryAt: new Date(limit.pausedUntil).toISOString() };
      }
      if (!res.ok || body.code !== 'OK') return { status: 'error', upc, message: `The lookup service answered ${body.code || 'HTTP ' + res.status}` };
      const item = (body.items || [])[0];
      const row = { upc, source: 'upcitemdb', status: item && item.title ? 'found' : 'none', title: item ? String(item.title || '').slice(0, 400) : null, brand: item ? String(item.brand || '').slice(0, 120) || null : null, category: item ? String(item.category || '').slice(0, 200) || null : null, image: item && Array.isArray(item.images) && /^https:\/\//.test(item.images[0] || '') ? String(item.images[0]).slice(0, 500) : null, ts: new Date(clock()).toISOString() };
      db.run('INSERT INTO disc_lookups (upc, source, status, title, brand, category, image, ts) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(upc) DO UPDATE SET source=excluded.source, status=excluded.status, title=excluded.title, brand=excluded.brand, category=excluded.category, image=excluded.image, ts=excluded.ts', row.upc, row.source, row.status, row.title, row.brand, row.category, row.image, row.ts);
      if (row.status === 'none') return { status: 'none', upc, cached: false, quota: { remaining: limit.remaining, limit: limit.limit } };
      return suggestion(row, false, adultFilter);
    } catch (e) { log('disc lookup: ' + e.message); return { status: 'error', message: e.message }; }
  }
  const state = () => ({ enabled: enabled(), tmdb: !!tmdbKey(), remaining: limit.remaining, limit: limit.limit, pausedUntil: limit.pausedUntil > clock() ? new Date(limit.pausedUntil).toISOString() : null, cached: db.get('SELECT COUNT(*) n FROM disc_lookups').n });
  return { lookup, state, matchLibrary };
}

module.exports = { createDiscLookup, parseProduct, confidence, norm };
