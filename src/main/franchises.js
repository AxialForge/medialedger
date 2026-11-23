'use strict';
// Franchises: the library grouped into sagas across movies, TV and anime, with what is owned, what is missing,
// and (for a few) a release and an in-universe timeline.
//
// This is the grouping engine only: pure functions over a list of titles, no database, no Electron. It is a
// faithful port of the Python prototype (franchise_report.py, 2026-11-22), kept faithful on purpose so the two can
// be compared title for title. All the knowledge is data, in src/main/franchise-data/:
//   rules.json      ordered [franchise, regex] pairs, first match wins, plus a block list of false positives
//   subgroups.json  sub-universes inside Marvel and DC
//   canon.json      per-franchise canonical titles, used to say what is MISSING (only where something is owned)
//   timelines.json  eras and entries (release date, in-universe year) for Star Wars and Marvel
//
// Honest caveat, to be repeated wherever this is shown: the canonical lists, release dates and in-universe years
// were written from memory, not checked against a source. They are seed data. The rules are regex heuristics and
// some names are ambiguous (Avatar, Dune 1984 vs 2021, Spider-Man across three studios).
//
// Two matching conventions come from the prototype and must not be "tidied":
//   - franchise rules and sub-universe rules run on the RAW title, case-insensitively
//   - canon and timeline regexes run on the NORMALISED title (nz), case-sensitively, with "-" in the regex read as a space
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'franchise-data');
const MEDIA = { movie: 'Movie', tv: 'TV', anime: 'Anime' };

/** Lowercase, "-" and ":" to spaces, punctuation gone (keeps & and +), spaces collapsed. */
const nz = (t) => String(t == null ? '' : t).toLowerCase().replace(/[-:]/g, ' ').replace(/[^a-z0-9&+ ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Read the four data files. `user` layers the owner's own decisions on top without touching the shipped files:
 *   user.rules  [[franchise, regex], ...]  tried BEFORE the shipped rules, so an assignment made by hand wins
 *   user.block  [{ title, media }]         added to the shipped block list
 */
function loadData(dir = DATA_DIR, user = {}) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const r = read('rules.json');
  const compile = (pairs) => pairs.map(([name, re]) => [name, new RegExp(re, 'i')]);
  return {
    rules: [...compile(user.rules || []), ...compile(r.rules)],
    block: [...(user.block || []), ...r.block],
    subgroups: read('subgroups.json'), canon: read('canon.json'), timelines: read('timelines.json'),
  };
}

const blocked = (title, media, block) => block.some(b => b.title === title && (b.media == null || b.media === media));
/** The franchise a title belongs to, or null. First rule that matches wins. */
function franchiseOf(title, media, data) {
  if (blocked(title, media, data.block)) return null;
  for (const [name, re] of data.rules) if (re.test(title)) return name;
  return null;
}
/** The sub-universe inside a franchise ("MCU", "Fox X-Men Universe", "DC Animated"), or ''. */
function subgroupOf(franchise, title, media, genres, SG) {
  const g = SG[franchise];
  if (g && g.rules) {
    for (const [name, re] of g.rules) if (new RegExp(re, 'i').test(title)) return name;
    return g.default;
  }
  if (franchise === 'DC' && SG.DC) {
    const d = SG.DC;
    if (media === 'Movie') return String(genres || '').toLowerCase().includes('animation') ? d.movie_animated : d.movie_live;
    for (const [name, re] of d.tv_rules) if (new RegExp(re, 'i').test(title)) return name;
    return d.tv_default;
  }
  return '';
}

/**
 * Sort the library into franchises.
 * `titles`: [{ media: 'Movie'|'TV'|'Anime', title, year, seasons, episodes, size_gb, runtime_min, rating, res, genres, ...anything }]
 * Extra fields (a library key, say) ride along untouched on the owned items.
 */
function assign(titles, data) {
  const owned = [], unassigned = [];
  for (const t of titles) {
    const title = String(t.title || '').trim();
    const fr = franchiseOf(title, t.media, data);
    if (!fr) { unassigned.push({ ...t, title }); continue; }
    const movie = t.media === 'Movie';
    owned.push({
      ...t, franchise: fr, sub: subgroupOf(fr, title, t.media, t.genres || '', data.subgroups), title,
      year: movie ? String(t.year == null ? '' : t.year) : '', episodes: movie ? '' : (t.episodes == null ? '' : t.episodes), seasons: t.seasons == null ? '' : t.seasons,
      size_gb: Number(t.size_gb) || 0, runtime_min: Number(t.runtime_min) || 0, rating: t.rating == null ? '' : t.rating, res: t.res || '', genres: t.genres || '', status: 'Owned', dupes: 0,
    });
  }
  return { owned, unassigned };
}

/**
 * Merge copies of the same title (the larger file stays, `dupes` counts the rest) while keeping apart what only
 * shares a name: a film with a different year (Dune 1984 and 2021), a series against its remake.
 */
function dedupe(items) {
  const norm = (o) => {
    let t = o.title.toLowerCase().replace(/\(\s*\)/g, '');
    if (o.media === 'Movie') t = t.replace(/\(.*?\)/g, '');
    t = t.replace(/james bond\s*-?/g, '').replace(/harry potter\s*\d/g, 'harry potter').replace(/\bs01e01\b|\bpart\b/g, '');
    return `${o.franchise}\u0001${o.media}\u0001${t.replace(/[^a-z0-9]/g, '')}`;
  };
  const years = new Map();
  for (const o of items) if (o.media === 'Movie' && o.year) { const k = norm(o); if (!years.has(k)) years.set(k, new Set()); years.get(k).add(o.year); }
  const out = new Map();
  for (const o of items) {
    let k = norm(o);
    if (o.media === 'Movie') { const ys = years.get(k); k += '\u0001' + (ys && ys.has(o.year) ? o.year : ys ? [...ys].sort()[0] : ''); }
    const cur = out.get(k);
    if (!cur) { out.set(k, o); continue; }
    const n = cur.dupes + 1;
    if (o.size_gb > cur.size_gb) { o.dupes = n; out.set(k, o); } else cur.dupes = n;
  }
  return [...out.values()];
}

/**
 * The canonical titles you do not have, for every franchise you have at least one title of.
 * A title due after `year` (this year) is "Missing (upcoming)" rather than a gap in the shelf.
 */
function missing(owned, data, { year = new Date().getFullYear() } = {}) {
  const extra = [];
  for (const [fr, list] of Object.entries(data.canon)) {
    const its = owned.filter(o => o.franchise === fr);
    if (!its.length) continue;
    const names = its.map(o => nz(o.title));
    for (const [name, media, y, re] of list) {
      const rx = new RegExp(re.replace(/-/g, ' '));
      if (names.some(n => rx.test(n))) continue;
      const upcoming = /^\d+$/.test(String(y)) && Number(y) > year;
      extra.push({ franchise: fr, sub: '', media, title: name, year: String(y), episodes: '', seasons: '', size_gb: 0, runtime_min: 0, rating: '', res: '', genres: '', dupes: 0, status: upcoming ? 'Missing (upcoming)' : 'Missing' });
    }
  }
  return extra;
}

/** Per franchise with a timeline: every entry with its release date, in-universe point, era, and whether you own it. */
function timelines(owned, data) {
  const entries = {}, eras = {};
  for (const [fr, spec] of Object.entries(data.timelines)) {
    const its = owned.filter(o => o.franchise === fr).map(o => [o, nz(o.title)]);
    eras[fr] = spec.eras;
    entries[fr] = spec.entries.map(e => {
      const rx = new RegExp(e.regex.replace(/-/g, ' '));
      const hit = its.filter(([, n]) => rx.test(n)).map(([o]) => o);
      return { title: e.title, media: e.media, rel: e.rel, chron: e.chron, label: e.label, era: e.era, owned: hit.length > 0, file: hit.length ? hit[0].title : '', size: hit.length ? hit[0].size_gb : 0, eps: hit.length ? hit[0].episodes : '', item: hit.length ? hit[0] : null };
    });
  }
  return { entries, eras };
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const order = (a, b) => cmp(a.franchise, b.franchise) || cmp(a.status !== 'Owned', b.status !== 'Owned') || cmp(a.sub, b.sub) || cmp(a.media, b.media) || cmp(a.year || '9', b.year || '9') || cmp(a.title, b.title);

/** Everything at once: { items (owned + missing, in display order), unassigned, timelines, eras, stats }. */
function build(titles, data, opts = {}) {
  const a = assign(titles, data);
  const owned = dedupe(a.owned);
  const gaps = missing(owned, data, opts);
  const tl = timelines(owned, data);
  const items = [...owned, ...gaps].sort(order);
  return {
    items, unassigned: a.unassigned, timelines: tl.entries, eras: tl.eras,
    stats: { franchises: new Set(items.map(o => o.franchise)).size, owned: owned.length, missing: gaps.length, upcoming: gaps.filter(g => g.status !== 'Missing').length, unassigned: a.unassigned.length },
  };
}

module.exports = { MEDIA, DATA_DIR, nz, loadData, franchiseOf, subgroupOf, assign, dedupe, missing, timelines, build };
