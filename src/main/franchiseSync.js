'use strict';
// Franchises as collections. The grouping engine (franchises.js) is pure; this is the part that reads the library,
// asks the engine what belongs together, and keeps one collection per franchise (source 'franchise') in step.
//
// Same idea as the Plex mirror in collections.js: the rows this file put there are marked (from_franchise=1) and
// only those are ever added or removed, so anything added to a franchise by hand stays. Unlike the Plex mirror it
// works by difference, not delete-and-refill, so notes and item ids survive a scan.
//
// A franchise collection is found again by collections.plex_key = 'fr:<franchise name>' (the column is the "key in
// the place it came from"; Plex's own keys are numbers, so the two never meet). That lets the collection be renamed.
//
// The owner's decisions live in two tables and are layered over the shipped data, never written into it:
//   franchise_rules   "this title belongs to that franchise"    (tried before the shipped rules)
//   franchise_blocks  kind 'title':   "this title is not part of any franchise"
//                     kind 'missing': "stop listing this canonical title as missing"
//
// TMDB (optional, needs the owner's free key): a franchise can be linked to TMDB film series. Their films are kept in
// franchise_tmdb and merged at sync time: a film TMDB lists that is neither owned nor already in the shipped list
// becomes a missing title, and TMDB's year replaces the one written from memory. The link is always made by hand
// from a search; nothing is linked on a guess. The network is only touched by the tmdb* functions, never by sync().
const F = require('./franchises');
const tmdb = require('./tmdb');

const TYPE = { Movie: 'movie', TV: 'tv', Anime: 'anime' };
const KEY = (name) => 'fr:' + name;

const rxEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const noThe = (s) => s.replace(/^the /, '');
const bare = (t) => noThe(F.nz(String(t).replace(/\(\d{4}\)/g, '')));   // a title as two sources would both spell it
const yearOfDate = (d) => (d ? Number(String(d).slice(0, 4)) : null);
const near = (a, b) => !a || !b || Math.abs(Number(a) - Number(b)) <= 1;

function createFranchises(db, collections, opts = {}) {
  const key = () => String((opts.key ? opts.key() : '') || '').trim();
  const links = (fr) => (fr ? db.all('SELECT * FROM franchise_tmdb WHERE franchise=? ORDER BY id', fr) : db.all('SELECT * FROM franchise_tmdb ORDER BY id')).map(r => { let parts = []; try { parts = JSON.parse(r.parts || '[]'); } catch { /* an unreadable row counts as empty */ } return { ...r, parts }; });
  const decisions = () => ({
    rules: db.all('SELECT id, franchise, pattern, title, created FROM franchise_rules ORDER BY id DESC'),
    blocks: db.all('SELECT id, kind, title, media, franchise, created FROM franchise_blocks ORDER BY id DESC'),
  });
  function data() {
    const d = decisions();
    return F.loadData(undefined, { rules: d.rules.map(r => [r.franchise, r.pattern]), block: d.blocks.filter(b => b.kind === 'title').map(b => ({ title: b.title, media: b.media || null })) });
  }
  /** Every title in the library, in the shape the engine reads. `adultFilter` only for what is shown, never for the sync. */
  function library(adultFilter = '') {
    const movies = db.all(`SELECT group_key k, MIN(movie_title) title, MIN(movie_year) year, SUM(size) bytes, MAX(plex_genres) genres FROM files WHERE library_type='movie' AND missing=0 AND ignored=0${adultFilter} GROUP BY group_key`);
    const series = db.all(`SELECT library_type t, show_name title, COUNT(*) episodes, COUNT(DISTINCT season) seasons, SUM(size) bytes FROM files WHERE library_type IN ('tv','anime') AND missing=0 AND ignored=0${adultFilter} GROUP BY library_type, show_name`);
    return [
      ...movies.filter(m => m.title).map(m => ({ media: 'Movie', title: m.title, year: m.year || '', size_gb: (m.bytes || 0) / 1073741824, genres: m.genres || '', library_type: 'movie', title_key: m.k })),
      ...series.filter(s => s.title).map(s => ({ media: F.MEDIA[s.t], title: s.title, seasons: s.seasons, episodes: s.episodes, size_gb: (s.bytes || 0) / 1073741824, library_type: s.t, title_key: s.title })),
    ];
  }

  /** Bring the franchise collections in step with the library. Safe to run as often as you like. */
  function sync({ year, log = () => {} } = {}) {
    const d = data();
    const a = F.assign(library(), d);
    const hidden = new Set(db.all("SELECT franchise, title, media FROM franchise_blocks WHERE kind='missing'").map(b => `${b.franchise}|${b.media}|${b.title}`));
    const gaps = F.missing(a.owned, d, { year }).filter(g => !hidden.has(`${g.franchise}|${g.media}|${g.title}`));
    const want = new Map();
    const slot = (fr) => { if (!want.has(fr)) want.set(fr, { owned: new Map(), place: new Map() }); return want.get(fr); };
    for (const o of a.owned) slot(o.franchise).owned.set(o.library_type + '|' + o.title_key, o);
    for (const g of gaps) slot(g.franchise).place.set(g.title.toLowerCase(), g);
    // TMDB's films for the franchises linked to it. The shipped list is the bridge between the two spellings of a title:
    // a film TMDB names that the shipped list already knows is left to the shipped list, with TMDB's year.
    for (const l of links()) {
      const w = want.get(l.franchise); if (!w) continue;
      const mine = a.owned.filter(o => o.franchise === l.franchise && o.media === 'Movie').map(o => ({ n: bare(o.title), y: Number(o.year) || null }));
      const canon = (d.canon[l.franchise] || []).filter(c => c[1] === 'Movie').map(c => ({ title: c[0], n: bare(c[0]), y: Number(c[2]) || null, rx: new RegExp(c[3].replace(/-/g, ' ')) }));
      for (const p of l.parts) {
        const y = yearOfDate(p.date), raw = F.nz(p.title), n = noThe(raw);
        const c = canon.find(k => (y && k.rx.test(`${raw} ${y}`)) || (k.rx.test(raw) && near(k.y, y)) || (k.n === n && near(k.y, y)));
        if (c) { const g = w.place.get(c.title.toLowerCase()); if (g && y) g.year = String(y); continue; }
        if (mine.some(o => o.n === n && near(o.y, y))) continue;
        if (hidden.has(`${l.franchise}|Movie|${p.title}`) || w.place.has(p.title.toLowerCase())) continue;
        w.place.set(p.title.toLowerCase(), { franchise: l.franchise, media: 'Movie', title: p.title, year: y ? String(y) : '' });
      }
    }
    const missingCount = [...want.values()].reduce((n, w) => n + w.place.size, 0);

    const now = new Date().toISOString(); const touched = []; let made = 0, added = 0, removed = 0, dropped = 0;
    db.transaction(() => {
      const have = new Map(db.all("SELECT id, plex_key FROM collections WHERE source='franchise'").map(c => [c.plex_key, c.id]));
      for (const [fr, w] of want) {
        let cid = have.get(KEY(fr)); let changed = false;
        if (!cid) {
          const name = db.get('SELECT id FROM collections WHERE name=? COLLATE NOCASE', fr) ? `${fr} (franchise)` : fr;
          db.run('INSERT INTO collections (name, note, source, plex_key, created, updated) VALUES (?,?,?,?,?,?)', name, null, 'franchise', KEY(fr), now, now);
          cid = db.get('SELECT last_insert_rowid() id').id; made++; changed = true;
        }
        have.delete(KEY(fr));
        for (const it of db.all('SELECT id, library_type, title_key, title FROM collection_items WHERE collection_id=? AND from_franchise=1', cid)) {
          const keep = it.title_key ? w.owned.has(it.library_type + '|' + it.title_key) : w.place.has(String(it.title || '').toLowerCase());
          if (!keep) { db.run('DELETE FROM collection_items WHERE id=?', it.id); removed++; changed = true; }
        }
        const put = (ref) => { const id = collections.addItem(cid, ref); if (id) { db.run('UPDATE collection_items SET from_franchise=1 WHERE id=?', id); added++; changed = true; } };
        for (const o of w.owned.values()) put({ library_type: o.library_type, title_key: o.title_key });
        for (const g of w.place.values()) {
          put({ library_type: TYPE[g.media] || 'other', title: g.title, year: g.year });
          // a placeholder already there keeps its row; only its year follows a better source
          const yr = Number(g.year) || null;
          if (yr && db.run('UPDATE collection_items SET year=? WHERE collection_id=? AND from_franchise=1 AND title_key IS NULL AND title=? COLLATE NOCASE AND COALESCE(year,0)<>?', yr, cid, g.title, yr).changes) changed = true;
        }
        if (changed) touched.push(cid);
      }
      // a franchise nothing in the library belongs to any more: take back what was put there, and the collection too if that empties it
      for (const cid of have.values()) {
        removed += db.run('DELETE FROM collection_items WHERE collection_id=? AND from_franchise=1', cid).changes;
        if (!db.get('SELECT 1 FROM collection_items WHERE collection_id=?', cid)) { db.run('DELETE FROM collections WHERE id=?', cid); dropped++; }
      }
    });
    // reorder() opens its own transaction, so the ordering happens after the one above has closed
    for (const cid of touched) { try { collections.sortByRelease(cid); } catch (e) { log('franchises: order ' + cid + ': ' + e.message); } }
    const out = { franchises: want.size, owned: a.owned.length, missing: missingCount, unassigned: a.unassigned.length, made, added, removed, dropped };
    log(`franchises: ${out.franchises} sets, ${out.owned} titles, ${out.missing} missing, ${out.unassigned} in none (${made} new, +${added} -${removed})`);
    return out;
  }

  /** Library titles no rule claims, and why where there is a reason. */
  function unassigned(adultFilter = '') {
    const d = data(); const mine = new Set(db.all("SELECT title, media FROM franchise_blocks WHERE kind='title'").map(b => `${b.media}|${b.title}`));
    return F.assign(library(adultFilter), d).unassigned.map(u => ({ library_type: u.library_type, title_key: u.title_key, title: u.title, year: u.year || null, media: u.media, blocked: mine.has(`${u.media}|${u.title}`) }))
      .sort((x, y) => x.title.localeCompare(y.title, undefined, { sensitivity: 'base' }));
  }
  /** Every franchise name there is a rule for, for the "which franchise?" box. */
  function names() { return [...new Set(data().rules.map(r => r[0]))].sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' })); }

  /** "This title belongs to that franchise." Stored as a rule for exactly this title. */
  function assign(title, franchise) {
    const t = String(title || '').trim(), fr = String(franchise || '').trim().slice(0, 80);
    if (!t) throw new Error('No title given'); if (!fr) throw new Error('Type or pick a franchise');
    db.transaction(() => {
      db.run("DELETE FROM franchise_blocks WHERE kind='title' AND title=?", t);
      db.run('DELETE FROM franchise_rules WHERE title=?', t);
      db.run('INSERT INTO franchise_rules (franchise, pattern, title, created) VALUES (?,?,?,?)', fr, `^${rxEscape(t)}$`, t, new Date().toISOString());
    });
    return true;
  }
  /** "This title is not part of any franchise" (kind 'title'), or "stop listing this as missing" (kind 'missing'). */
  function block({ kind, title, media, franchise } = {}) {
    const t = String(title || '').trim(), k = kind === 'missing' ? 'missing' : 'title', m = TYPE[media] ? media : null;
    if (!t) throw new Error('No title given'); if (k === 'missing' && !franchise) throw new Error('No franchise given');
    db.transaction(() => {
      if (k === 'title') db.run('DELETE FROM franchise_rules WHERE title=?', t);
      db.run('DELETE FROM franchise_blocks WHERE kind=? AND title=? AND COALESCE(media,\'\')=? AND COALESCE(franchise,\'\')=?', k, t, m || '', franchise || '');
      db.run('INSERT INTO franchise_blocks (kind, title, media, franchise, created) VALUES (?,?,?,?,?)', k, t, m, k === 'missing' ? String(franchise) : null, new Date().toISOString());
    });
    return true;
  }
  /** Take one decision back. */
  function undo(what, id) { return db.run(`DELETE FROM ${what === 'rule' ? 'franchise_rules' : 'franchise_blocks'} WHERE id=?`, Number(id)).changes > 0; }
  /** The franchise a collection stands for, or null. */
  function nameOf(collectionId) { const c = db.get("SELECT plex_key FROM collections WHERE id=? AND source='franchise'", Number(collectionId)); return c && c.plex_key ? String(c.plex_key).slice(3) : null; }

  /** The order sub-universes are shown in: the order the data lists them, the catch-all last. */
  function subOrder(fr, SG) {
    const g = SG[fr]; if (!g) return [];
    if (g.rules) return [g.default, ...g.rules.map(r => r[0])];
    return [g.movie_live, g.movie_animated, ...(g.tv_rules || []).map(r => r[0]), g.tv_default].filter(Boolean);
  }
  /**
   * What a franchise page shows beyond the plain list: which sub-universe each owned title is in, and the timeline
   * (every entry with its release date, its point in the story, its era, and whether it is in the library).
   * Worked out on the spot from the engine, never stored: it is a pure function of the titles and the data.
   */
  function view(collectionId, adultFilter = '') {
    const fr = nameOf(collectionId); if (!fr) return null;
    const d = data(); const owned = F.assign(library(adultFilter), d).owned.filter(o => o.franchise === fr);
    const subs = {}; for (const o of owned) if (o.sub) subs[o.library_type + '|' + o.title_key] = o.sub;
    const tl = d.timelines[fr] ? F.timelines(owned, d) : null;
    const mine = links(fr); const parts = mine.flatMap(l => l.parts).filter(p => p.date).map(p => ({ n: F.nz(p.title), date: p.date }));
    // a film's release date from TMDB, when a linked series has that film within a year of the date written from memory
    const checkedDate = (spec) => { if (spec.media !== 'Movie' || !parts.length) return null; const rx = new RegExp(spec.regex.replace(/-/g, ' ')); const hit = parts.find(p => rx.test(p.n) && near(yearOfDate(p.date), yearOfDate(spec.rel))); return hit ? hit.date : null; };
    return {
      franchise: fr, subs, subOrder: subOrder(fr, d.subgroups),
      eras: tl ? tl.eras[fr] : [],
      tmdb: mine.map(l => ({ id: l.id, tmdb_id: l.tmdb_id, name: l.name, films: l.parts.length, fetched: l.fetched })),
      timeline: tl ? tl.entries[fr].map((e, n) => { const cd = checkedDate(d.timelines[fr].entries[n]); return { checked: !!cd, was: cd && cd !== e.rel ? e.rel : null, ...e, rel: cd || e.rel }; }).map(e => ({ title: e.title, media: e.media, rel: e.rel, checked: e.checked, was: e.was, chron: e.chron, label: e.label, era: e.era, owned: e.owned, library_type: e.item ? e.item.library_type : null, title_key: e.item ? e.item.title_key : null, file: e.file })) : [],
    };
  }

  // ---- TMDB: the only functions here that use the network
  const store = (fr, c) => db.run('INSERT INTO franchise_tmdb (franchise, tmdb_id, name, parts, fetched) VALUES (?,?,?,?,?) ON CONFLICT(franchise, tmdb_id) DO UPDATE SET name=excluded.name, parts=excluded.parts, fetched=excluded.fetched', fr, Number(c.id), c.name, JSON.stringify(c.parts), new Date().toISOString());
  const tmdbSearch = (q) => tmdb.searchCollection(key(), q, opts.fetchFn);
  /** Link a franchise (by its collection) to one TMDB film series, and fetch its films. */
  async function tmdbLink(collectionId, tmdbId) {
    const fr = nameOf(collectionId); if (!fr) throw new Error('That collection is not a franchise');
    const c = await tmdb.collection(key(), tmdbId, opts.fetchFn); store(fr, c);
    return { franchise: fr, name: c.name, films: c.parts.length };
  }
  function tmdbUnlink(linkId) { return db.run('DELETE FROM franchise_tmdb WHERE id=?', Number(linkId)).changes > 0; }
  /** Fetch again whatever is older than `maxAgeDays` (0 = everything). Stops at the first failure: the rest wait for next time. */
  async function tmdbRefresh({ maxAgeDays = 30, franchise = null, log = () => {} } = {}) {
    if (!key()) return { skipped: 'no key' };
    const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
    const due = links(franchise).filter(l => !l.fetched || maxAgeDays === 0 || l.fetched < cutoff); let done = 0;
    for (const l of due) {
      try { store(l.franchise, await tmdb.collection(key(), l.tmdb_id, opts.fetchFn)); done++; }
      catch (e) { log(`franchises: TMDB ${l.name}: ${e.message}`); return { due: due.length, done, error: e.message }; }
    }
    return { due: due.length, done };
  }

  return { sync, unassigned, names, assign, block, undo, decisions, nameOf, library, view, tmdbSearch, tmdbLink, tmdbUnlink, tmdbRefresh };
}

module.exports = { createFranchises, MEDIA_OF: { movie: 'Movie', tv: 'TV', anime: 'Anime' } };
