'use strict';
// Collections: named sets of titles across TV, anime and movies ("the Marvel universe", "Pirates of the Caribbean").
//
// A collection is yours (source 'manual') or mirrored from Plex (source 'plex'). Plex collections are read, never
// written: each Plex sync replaces the items it put there (from_plex=1) and leaves the ones you added by hand.
// An item points at a library title (library_type + title_key: the series name, or a movie's group_key) or is a
// placeholder with just a title and year for something you do not have yet, so a set can show its gaps.
const PLACE = { movie: 'movie', tv: 'tv', anime: 'anime', other: 'other' };

function createCollections(db) {
  const titleOf = (it) => it.title;

  /** Everything known about the library titles a list of items points at, in one pass. */
  function enrich(items, adultFilter) {
    const keys = { movie: new Set(), tv: new Set(), anime: new Set() };
    for (const it of items) if (it.title_key && keys[it.library_type]) keys[it.library_type].add(it.title_key);
    const found = new Map();
    const q = (type, col, list) => {
      if (!list.length) return;
      const ph = list.map(() => '?').join(',');
      const rows = type === 'movie'
        ? db.all(`SELECT group_key k, MIN(movie_title) title, MIN(movie_year) year, COUNT(*) files, SUM(size) bytes, MAX(duration_s) seconds, GROUP_CONCAT(DISTINCT resolution) resolutions, MAX(hdr) hdr, MAX(plex_view_count) plays, MAX(plex_released) released, MAX(plex_content_rating) rated FROM files WHERE library_type='movie' AND missing=0 AND ignored=0 AND group_key IN (${ph})${adultFilter} GROUP BY group_key`, ...list)
        : db.all(`SELECT show_name k, show_name title, COUNT(*) episodes, COUNT(DISTINCT season) seasons, SUM(size) bytes, SUM(duration_s) seconds, GROUP_CONCAT(DISTINCT resolution) resolutions, SUM(CASE WHEN plex_view_count>0 THEN 1 ELSE 0 END) watched, SUM(CASE WHEN plex_rating_key IS NOT NULL THEN 1 ELSE 0 END) linked, MAX(plex_show_key) show_key FROM files WHERE library_type=? AND missing=0 AND ignored=0 AND show_name IN (${ph})${adultFilter} GROUP BY show_name`, type, ...list);
      for (const r of rows) found.set(type + '|' + r.k, r);
    };
    q('movie', 'group_key', [...keys.movie]); q('tv', 'show_name', [...keys.tv]); q('anime', 'show_name', [...keys.anime]);
    const showYears = new Map(db.all('SELECT rating_key, year, released, content_rating FROM plex_shows').map(s => [s.rating_key, s]));
    return items.map(it => {
      const r = it.title_key ? found.get(it.library_type + '|' + it.title_key) : null;
      const ps = r && r.show_key ? showYears.get(r.show_key) : null;
      return {
        id: it.id, position: it.position, library_type: it.library_type, title_key: it.title_key, note: it.note, from_plex: !!it.from_plex,
        title: r ? r.title : it.title, year: r ? (it.library_type === 'movie' ? r.year : ps && ps.year) || it.year : it.year,
        present: !!r, files: r ? (r.files || r.episodes) : 0, episodes: r && r.episodes != null ? r.episodes : null, seasons: r ? r.seasons || null : null,
        bytes: r ? r.bytes : 0, seconds: r ? r.seconds : 0, resolutions: r ? r.resolutions : null, hdr: r ? r.hdr : null,
        watched: r ? (it.library_type === 'movie' ? (r.plays > 0 ? 1 : 0) : (r.linked ? r.watched : null)) : null,
        released: r ? (it.library_type === 'movie' ? r.released : ps && ps.released) || null : null, rated: r ? (it.library_type === 'movie' ? r.rated : ps && ps.content_rating) || null : null,
      };
    });
  }

  function list(adultFilter = '') {
    const cols = db.all('SELECT * FROM collections ORDER BY name COLLATE NOCASE');
    const items = db.all('SELECT * FROM collection_items ORDER BY collection_id, position');
    const by = new Map(); for (const it of items) { if (!by.has(it.collection_id)) by.set(it.collection_id, []); by.get(it.collection_id).push(it); }
    return cols.map(c => {
      const its = enrich(by.get(c.id) || [], adultFilter);
      const present = its.filter(i => i.present);
      return { id: c.id, name: c.name, note: c.note, source: c.source, plex_key: c.plex_key, created: c.created, updated: c.updated,
        items: its.length, present: present.length, missing: its.length - present.length, bytes: present.reduce((a, i) => a + (i.bytes || 0), 0), seconds: present.reduce((a, i) => a + (i.seconds || 0), 0),
        watched: present.filter(i => i.watched === 1 || (i.episodes && i.watched === i.episodes)).length, types: [...new Set(its.map(i => i.library_type))],
        cover: c.cover_type && c.cover_key && its.some(i => i.present && i.library_type === c.cover_type && i.title_key === c.cover_key) ? { library_type: c.cover_type, title_key: c.cover_key } : null,
        preview: its.filter(i => i.present).slice(0, 6).map(i => ({ library_type: i.library_type, title_key: i.title_key, title: i.title })) };
    });
  }
  function get(id, adultFilter = '') {
    const c = db.get('SELECT * FROM collections WHERE id=?', Number(id)); if (!c) return null;
    const items = enrich(db.all('SELECT * FROM collection_items WHERE collection_id=? ORDER BY position', c.id), adultFilter);
    return { ...c, items };
  }
  const clean = (s, n) => String(s || '').trim().slice(0, n);
  function save({ id, name, note }) {
    const n = clean(name, 80); if (!n) throw new Error('Give the collection a name');
    const now = new Date().toISOString();
    if (id) { if (!db.get('SELECT id FROM collections WHERE id=?', Number(id))) throw new Error('No such collection'); db.run('UPDATE collections SET name=?, note=?, updated=? WHERE id=?', n, clean(note, 1000) || null, now, Number(id)); return Number(id); }
    if (db.get('SELECT id FROM collections WHERE name=? COLLATE NOCASE', n)) throw new Error(`There is already a collection called ${n}`);
    db.run('INSERT INTO collections (name, note, source, created, updated) VALUES (?,?,?,?,?)', n, clean(note, 1000) || null, 'manual', now, now);
    return db.get('SELECT last_insert_rowid() id').id;
  }
  function setCover(id, libraryType, titleKey) { db.run('UPDATE collections SET cover_type=?, cover_key=?, updated=? WHERE id=?', libraryType || null, titleKey || null, new Date().toISOString(), Number(id)); return true; }
  /** The collections a library title is in, and all of them, for the "add to collection" dialog. */
  function forTitle(libraryType, titleKey) { const inIds = new Set(db.all('SELECT collection_id FROM collection_items WHERE library_type=? AND title_key=?', libraryType, titleKey).map(r => r.collection_id)); return db.all('SELECT id, name, source FROM collections ORDER BY name COLLATE NOCASE').map(c => ({ ...c, has: inIds.has(c.id) })); }
  /** CSV of one collection: what is on hand and what is not, in order. */
  function exportCsv(id, adultFilter = '') {
    const c = get(id, adultFilter); if (!c) throw new Error('No such collection');
    const q = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [['position', 'title', 'year', 'kind', 'in_library', 'released', 'content_rating', 'episodes', 'seasons', 'minutes', 'gb', 'best_resolution', 'watched', 'note']];
    for (const i of c.items) rows.push([i.position, i.title, i.year || '', i.library_type, i.present ? 'yes' : 'no', i.released || '', i.rated || '', i.episodes == null ? '' : i.episodes, i.seasons || '', i.seconds ? Math.round(i.seconds / 60) : '', i.bytes ? (i.bytes / 1073741824).toFixed(2) : '', i.resolutions ? String(i.resolutions).split(',').sort().pop() : '', i.watched == null ? '' : (i.episodes != null ? `${i.watched}/${i.episodes}` : (i.watched ? 'yes' : 'no')), i.note || '']);
    return { name: c.name, filename: `${c.name.replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'collection'}.csv`, csv: rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n' };
  }
  function remove(id) { db.run('DELETE FROM collection_items WHERE collection_id=?', Number(id)); return db.run('DELETE FROM collections WHERE id=?', Number(id)).changes > 0; }
  const nextPos = (cid) => (db.get('SELECT COALESCE(MAX(position), 0) p FROM collection_items WHERE collection_id=?', cid).p || 0) + 1;
  /** Add a library title ({ library_type, title_key }) or a placeholder ({ library_type, title, year }). */
  function addItem(id, it, fromPlex = false) {
    const cid = Number(id); if (!db.get('SELECT id FROM collections WHERE id=?', cid)) throw new Error('No such collection');
    const type = PLACE[it.library_type] ? it.library_type : 'other';
    const key = it.title_key ? String(it.title_key).slice(0, 300) : null, title = clean(it.title, 200), year = Number(it.year) >= 1800 && Number(it.year) <= 2200 ? Number(it.year) : null;
    if (!key && !title) throw new Error('Pick a title from the library or type one');
    if (key && db.get('SELECT id FROM collection_items WHERE collection_id=? AND library_type=? AND title_key=?', cid, type, key)) return null; // already in it
    if (!key && db.get('SELECT id FROM collection_items WHERE collection_id=? AND title_key IS NULL AND title=? COLLATE NOCASE', cid, title)) return null;
    db.run('INSERT INTO collection_items (collection_id, position, library_type, title_key, title, year, note, from_plex, added) VALUES (?,?,?,?,?,?,?,?,?)', cid, nextPos(cid), type, key, key ? null : title, year, clean(it.note, 300) || null, fromPlex ? 1 : 0, new Date().toISOString());
    db.run('UPDATE collections SET updated=? WHERE id=?', new Date().toISOString(), cid);
    return db.get('SELECT last_insert_rowid() id').id;
  }
  function removeItem(id, itemId) { const r = db.run('DELETE FROM collection_items WHERE collection_id=? AND id=?', Number(id), Number(itemId)); if (r.changes) db.run('UPDATE collections SET updated=? WHERE id=?', new Date().toISOString(), Number(id)); return r.changes > 0; }
  function setNote(id, itemId, note) { db.run('UPDATE collection_items SET note=? WHERE collection_id=? AND id=?', clean(note, 300) || null, Number(id), Number(itemId)); return true; }
  /** The whole order at once: item ids in the wanted order. Ids not listed keep their relative order after the listed ones. */
  function reorder(id, itemIds) {
    const cid = Number(id); const have = db.all('SELECT id FROM collection_items WHERE collection_id=? ORDER BY position', cid).map(r => r.id);
    const wanted = (itemIds || []).map(Number).filter(x => have.includes(x)); const order = [...wanted, ...have.filter(x => !wanted.includes(x))];
    db.transaction(() => { order.forEach((iid, i) => db.run('UPDATE collection_items SET position=? WHERE id=?', i + 1, iid)); db.run('UPDATE collections SET updated=? WHERE id=?', new Date().toISOString(), cid); });
    return order;
  }
  /** Order by release date (then year, then title): the way a franchise is usually watched. */
  function sortByRelease(id, adultFilter = '') {
    const c = get(id, adultFilter); if (!c) throw new Error('No such collection');
    const key = (i) => `${i.released || (i.year ? i.year + '-99-99' : '9999')}|${(i.title || '').toLowerCase()}`;
    return reorder(id, c.items.slice().sort((a, b) => key(a).localeCompare(key(b))).map(i => i.id));
  }
  /** Titles across the whole library that match some words; what the add box offers. */
  function search(q, adultFilter = '') {
    const like = `%${String(q || '').trim()}%`; if (like === '%%') return [];
    const movies = db.all(`SELECT 'movie' library_type, group_key title_key, MIN(movie_title) title, MIN(movie_year) year, COUNT(*) n FROM files WHERE library_type='movie' AND missing=0 AND ignored=0 AND movie_title LIKE ?${adultFilter} GROUP BY group_key ORDER BY title LIMIT 25`, like);
    const series = db.all(`SELECT library_type, show_name title_key, show_name title, NULL year, COUNT(*) n FROM files WHERE library_type IN ('tv','anime') AND missing=0 AND ignored=0 AND show_name LIKE ?${adultFilter} GROUP BY library_type, show_name ORDER BY show_name LIMIT 25`, like);
    return [...series, ...movies].slice(0, 40);
  }

  /** Mirror Plex's collections. `plexCols`: [{ key, title, section, items: [{ ratingKey, type }] }] from plex.js. */
  function importFromPlex(plexCols, log = () => {}) {
    const movieByKey = new Map(db.all('SELECT plex_rating_key k, group_key g FROM files WHERE library_type=? AND plex_rating_key IS NOT NULL AND missing=0', 'movie').map(r => [r.k, r.g]));
    const showByKey = new Map(db.all('SELECT DISTINCT plex_show_key k, library_type t, show_name s FROM files WHERE plex_show_key IS NOT NULL AND missing=0').map(r => [r.k, r]));
    const now = new Date().toISOString(); let made = 0, items = 0;
    db.transaction(() => {
      for (const pc of plexCols) {
        if (!pc.title) continue;
        let c = db.get('SELECT id FROM collections WHERE plex_key=?', String(pc.key));
        if (!c) { c = db.get('SELECT id FROM collections WHERE name=? COLLATE NOCASE AND source=?', pc.title, 'plex'); }
        if (!c) { db.run('INSERT INTO collections (name, note, source, plex_key, created, updated) VALUES (?,?,?,?,?,?)', db.get('SELECT id FROM collections WHERE name=? COLLATE NOCASE', pc.title) ? `${pc.title} (Plex)` : pc.title, pc.section ? `From Plex, section ${pc.section}` : 'From Plex', 'plex', String(pc.key), now, now); c = db.get('SELECT last_insert_rowid() id'); made++; }
        else db.run('UPDATE collections SET name=?, plex_key=?, updated=? WHERE id=?', pc.title, String(pc.key), now, c.id);
        db.run('DELETE FROM collection_items WHERE collection_id=? AND from_plex=1', c.id);
        for (const it of pc.items || []) {
          const m = movieByKey.get(String(it.ratingKey)); const s = showByKey.get(String(it.ratingKey));
          const ref = m ? { library_type: 'movie', title_key: m } : s ? { library_type: s.t, title_key: s.s } : { library_type: it.type === 'show' ? 'tv' : 'movie', title: it.title, year: it.year };
          if (addItem(c.id, ref, true)) items++;
        }
      }
    });
    log(`collections: ${plexCols.length} from Plex, ${made} new, ${items} items`);
    return { collections: plexCols.length, made, items };
  }

  return { list, get, save, remove, addItem, removeItem, setNote, reorder, sortByRelease, search, importFromPlex, titleOf, setCover, forTitle, exportCsv };
}

module.exports = { createCollections };
