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
const F = require('./franchises');

const TYPE = { Movie: 'movie', TV: 'tv', Anime: 'anime' };
const KEY = (name) => 'fr:' + name;

const rxEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function createFranchises(db, collections) {
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
        for (const g of w.place.values()) put({ library_type: TYPE[g.media] || 'other', title: g.title, year: g.year });
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
    const out = { franchises: want.size, owned: a.owned.length, missing: gaps.length, unassigned: a.unassigned.length, made, added, removed, dropped };
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

  return { sync, unassigned, names, assign, block, undo, decisions, nameOf, library };
}

module.exports = { createFranchises, MEDIA_OF: { movie: 'Movie', tv: 'TV', anime: 'Anime' } };
