'use strict';
// Collections: sets across libraries, placeholders for gaps, ordering, and what a Plex import may and may not change.
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { Db } = require('../src/main/db');
const { createCollections } = require('../src/main/collections');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-col-'));
const db = new Db(path.join(dir, 't.db'));
const file = (o) => db.run(`INSERT INTO files (root_id, rel_path, abs_path, file_name, library_type, show_name, season, episode, movie_title, movie_year, group_key, size, duration_s, resolution, plex_rating_key, plex_show_key, plex_view_count, plex_released, missing, ignored, adult, parse_ok, probe_ok) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,1,1)`,
  o.root || 'r', o.rel, 'X:\\' + o.rel, path.basename(o.rel), o.type, o.show || null, o.season || null, o.episode || null, o.title || null, o.year || null, o.group || null, o.size || 1e9, o.dur || 3600, o.res || '1080p', o.rk || null, o.sk || null, o.plays || 0, o.released || null);
file({ rel: 'Movies/Iron Man (2008)/Iron Man.mkv', type: 'movie', title: 'Iron Man', year: 2008, group: 'iron man|2008', rk: '101', released: '2008-05-02', plays: 1, res: '4K' });
file({ rel: 'Movies/Thor (2011)/Thor.mkv', type: 'movie', title: 'Thor', year: 2011, group: 'thor|2011', rk: '102', released: '2011-05-06' });
file({ rel: 'TV/Loki/S01E01.mkv', type: 'tv', show: 'Loki', season: 1, episode: 1, rk: '301', sk: '201', plays: 1 });
file({ rel: 'TV/Loki/S01E02.mkv', type: 'tv', show: 'Loki', season: 1, episode: 2, rk: '302', sk: '201' });
db.run("INSERT INTO plex_shows (rating_key, title, year, released) VALUES ('201', 'Loki', 2021, '2021-06-09')");
const C = createCollections(db);

// ---- yours: make, add across kinds, placeholders, order
const id = C.save({ name: 'Marvel' });
assert.throws(() => C.save({ name: 'marvel' }), /already/, 'names are unique, case aside');
assert.throws(() => C.save({ name: '  ' }), /name/);
C.addItem(id, { library_type: 'tv', title_key: 'Loki' });
C.addItem(id, { library_type: 'movie', title_key: 'thor|2011' });
C.addItem(id, { library_type: 'movie', title_key: 'iron man|2008' });
C.addItem(id, { library_type: 'movie', title: 'Captain America', year: 2011 });
assert.strictEqual(C.addItem(id, { library_type: 'movie', title_key: 'thor|2011' }), null, 'adding twice does nothing');
let c = C.get(id);
assert.deepStrictEqual(c.items.map(i => [i.position, i.title, i.present, i.year]), [[1, 'Loki', true, 2021], [2, 'Thor', true, 2011], [3, 'Iron Man', true, 2008], [4, 'Captain America', false, 2011]]);
assert.strictEqual(c.items[0].episodes, 2); assert.strictEqual(c.items[0].watched, 1); assert.strictEqual(c.items[2].watched, 1); assert.strictEqual(c.items[1].watched, 0);
C.sortByRelease(id);
assert.deepStrictEqual(C.get(id).items.map(i => i.title), ['Iron Man', 'Thor', 'Captain America', 'Loki'], 'release order: date, then year for placeholders');
C.reorder(id, [C.get(id).items[3].id]);
assert.strictEqual(C.get(id).items[0].title, 'Loki', 'an id listed first moves first; the rest keep their order');
const L = C.list();
assert.deepStrictEqual([L[0].items, L[0].present, L[0].missing, L[0].watched, L[0].types.sort()], [4, 3, 1, 2, ['movie', 'tv']]);
assert.deepStrictEqual(C.search('ir').map(x => x.title), ['Iron Man']); assert.deepStrictEqual(C.search('lok').map(x => x.library_type), ['tv']); assert.deepStrictEqual(C.search(''), []);
C.setNote(id, C.get(id).items[0].id, 'watch after Endgame'); assert.strictEqual(C.get(id).items[0].note, 'watch after Endgame');

// ---- from Plex: mirrored, never the other way; your additions survive a re-sync
const plex = [{ key: 'p1', title: 'Marvel Cinematic Universe', section: 'Movies', items: [{ ratingKey: '101', type: 'movie' }, { ratingKey: '102', type: 'movie' }, { ratingKey: '999', type: 'movie', title: 'Hulk', year: 2008 }] }, { key: 'p2', title: 'Marvel', section: 'TV', items: [{ ratingKey: '201', type: 'show' }] }];
let r = C.importFromPlex(plex);
assert.deepStrictEqual([r.collections, r.made, r.items], [2, 2, 4]);
const all = C.list();
assert.deepStrictEqual(all.map(x => `${x.name}|${x.source}`).sort(), ['Marvel (Plex)|plex', 'Marvel Cinematic Universe|plex', 'Marvel|manual'], 'a Plex collection with your name gets a suffix, yours is untouched');
const mcu = C.get(all.find(x => x.name === 'Marvel Cinematic Universe').id);
assert.deepStrictEqual(mcu.items.map(i => [i.title, i.present, i.from_plex]), [['Iron Man', true, true], ['Thor', true, true], ['Hulk', false, true]], 'an item Plex has that the library does not becomes a placeholder');
C.addItem(mcu.id, { library_type: 'tv', title_key: 'Loki' });
r = C.importFromPlex([{ key: 'p1', title: 'Marvel Cinematic Universe', section: 'Movies', items: [{ ratingKey: '101', type: 'movie' }] }]);
assert.strictEqual(r.made, 0);
assert.deepStrictEqual(C.get(mcu.id).items.map(i => [i.title, i.from_plex]), [['Loki', false], ['Iron Man', true]], 'a re-sync replaces what Plex put there and keeps what you added');
assert.strictEqual(C.get(id).items.length, 4, 'your own collection is never touched by a sync');
assert.ok(C.remove(mcu.id)); assert.strictEqual(C.get(mcu.id), null);
db.close(); fs.rmSync(dir, { recursive: true, force: true });
console.log('collections tests passed');
