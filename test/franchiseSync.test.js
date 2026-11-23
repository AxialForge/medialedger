'use strict';
// Franchises as collections: the sync makes one collection per franchise, marks what it put there, keeps what was
// added by hand, follows the library as it changes, and obeys the decisions stored in the two franchise tables.
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { Db } = require('../src/main/db');
const { createCollections } = require('../src/main/collections');
const { createFranchises } = require('../src/main/franchiseSync');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-fr-'));
const db = new Db(path.join(dir, 't.db'));
const file = (o) => db.run(`INSERT INTO files (root_id, rel_path, abs_path, file_name, library_type, show_name, season, episode, movie_title, movie_year, group_key, size, duration_s, resolution, plex_rating_key, plex_show_key, plex_view_count, plex_released, missing, ignored, adult, parse_ok, probe_ok) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,1,1)`,
  o.root || 'r', o.rel, 'X:\\' + o.rel, path.basename(o.rel), o.type, o.show || null, o.season || null, o.episode || null, o.title || null, o.year || null, o.group || null, o.size || 1e9, o.dur || 3600, o.res || '1080p', o.rk || null, o.sk || null, o.plays || 0, o.released || null);
const C = createCollections(db), FR = createFranchises(db, C);
const col = (name) => { const c = db.get("SELECT id FROM collections WHERE name=?", name); return c ? C.get(c.id) : null; };
const titles = (name) => col(name).items.map(i => `${i.title}${i.present ? '' : ' (missing)'}`);

file({ rel: 'Movies/Dune (2021)/Dune.mkv', type: 'movie', title: 'Dune', year: 2021, group: 'dune|2021', released: '2021-10-22' });
file({ rel: 'Movies/Dune Part Two (2024)/Dune Part Two.mkv', type: 'movie', title: 'Dune Part Two', year: 2024, group: 'dune part two|2024', released: '2024-03-01' });
file({ rel: 'Movies/Venom (2018)/Venom.mkv', type: 'movie', title: 'Venom', year: 2018, group: 'venom|2018' });
file({ rel: 'Movies/After Earth (2013)/After Earth.mkv', type: 'movie', title: 'After Earth', year: 2013, group: 'after earth|2013' });
file({ rel: 'Movies/Heat (1995)/Heat.mkv', type: 'movie', title: 'Heat', year: 1995, group: 'heat|1995' });
file({ rel: 'TV/Andor/S01E01.mkv', type: 'tv', show: 'Andor', season: 1, episode: 1 });
file({ rel: 'TV/Planet Earth/S01E01.mkv', type: 'tv', show: 'Planet Earth', season: 1, episode: 1 });
const mine = C.save({ name: 'Dune' });          // a hand-made set of the same name is left alone

// ---- first sync
let r = FR.sync({ year: 2026 });
assert.strictEqual(r.owned, 4); assert.strictEqual(r.unassigned, 3); assert.strictEqual(r.made, r.franchises);
assert.strictEqual(C.get(mine).items.length, 0, 'your own collection of the same name is not touched');
assert.strictEqual(col('Dune').source, 'manual'); assert.strictEqual(col('Dune (franchise)').source, 'franchise');
assert.deepStrictEqual(titles('Dune (franchise)'), ['Dune (1984) (missing)', 'Dune', 'Dune Part Two', 'Dune: Prophecy (missing)', 'Dune: Part Three (missing)'], 'owned and missing, in release order');
assert.ok(col('Dune (franchise)').items.every(i => i.from_franchise));
assert.ok(titles('Star Wars').includes('Andor') && titles('Star Wars').some(t => / \(missing\)$/.test(t)));
assert.deepStrictEqual(FR.unassigned().map(u => u.title), ['After Earth', 'Heat', 'Planet Earth']);
assert.strictEqual(FR.nameOf(col('Dune (franchise)').id), 'Dune');

// ---- the franchise page: sub-universes and the timeline, worked out on the spot
{
  const sw = FR.view(col('Star Wars').id);
  assert.strictEqual(sw.franchise, 'Star Wars'); assert.strictEqual(sw.eras.length, 7); assert.deepStrictEqual(sw.subs, {}, 'Star Wars has no sub-universes');
  const andor = sw.timeline.find(e => e.title === 'Andor');
  assert.deepStrictEqual([andor.owned, andor.library_type, andor.title_key], [true, 'tv', 'Andor'], 'an owned entry links to the library title');
  assert.ok(sw.timeline.some(e => !e.owned && e.title_key === null) && sw.timeline.every(e => /^\d{4}-\d\d-\d\d$/.test(e.rel) && typeof e.chron === 'number'));
  const mv = FR.view(col('Marvel (MCU & Marvel)').id);
  assert.deepStrictEqual(mv.subs, { 'movie|venom|2018': 'Sony Spider-Man Universe' }); assert.strictEqual(mv.subOrder[0], 'MCU');
  assert.ok(mv.subOrder.includes('Sony Spider-Man Universe') && mv.timeline.length > 50);
  const dn = FR.view(col('Dune (franchise)').id); assert.deepStrictEqual([dn.timeline, dn.eras, dn.subOrder], [[], [], []], 'a franchise with neither still answers');
  assert.strictEqual(FR.view(mine), null, 'a collection of yours is not a franchise');
}

// ---- a second sync changes nothing; hand-made additions and notes survive
const duneId = col('Dune (franchise)').id;
const handId = C.addItem(duneId, { library_type: 'movie', title_key: 'heat|1995' });
const partTwo = col('Dune (franchise)').items.find(i => i.title === 'Dune Part Two'); C.setNote(duneId, partTwo.id, 'IMAX');
r = FR.sync({ year: 2026 });
assert.deepStrictEqual([r.made, r.added, r.removed], [0, 0, 0], 'nothing to do the second time');
assert.ok(col('Dune (franchise)').items.find(i => i.id === handId && !i.from_franchise), 'a title added by hand stays');
assert.strictEqual(col('Dune (franchise)').items.find(i => i.id === partTwo.id).note, 'IMAX', 'rows are kept, not refilled, so notes survive');
C.save({ id: duneId, name: 'Arrakis' }); FR.sync({ year: 2026 });
assert.ok(col('Arrakis') && !col('Dune (franchise)'), 'a renamed franchise collection is found again, not made twice');

// ---- the library changes: a missing title arrives, an owned one goes
file({ rel: 'TV/Dune Prophecy/S01E01.mkv', type: 'tv', show: 'Dune Prophecy', season: 1, episode: 1 });
db.run("UPDATE files SET missing=1 WHERE group_key='dune part two|2024'");
FR.sync({ year: 2026 });
assert.ok(titles('Arrakis').includes('Dune Prophecy') && !titles('Arrakis').includes('Dune: Prophecy (missing)'), 'the placeholder gives way to the real title');
assert.ok(titles('Arrakis').includes('Dune: Part Two (missing)') && !titles('Arrakis').includes('Dune Part Two'), 'a title that left the library is listed as missing again');

// ---- decisions: assign, keep out, hide a missing title, undo
FR.assign('Planet Earth', 'BBC Earth'); FR.sync({ year: 2026 });
assert.deepStrictEqual(titles('BBC Earth'), ['Planet Earth'], 'a new franchise can be named by hand');
assert.ok(FR.names().includes('BBC Earth'));
assert.throws(() => FR.assign('Heat', '  '), /franchise/);
FR.block({ kind: 'title', title: 'Venom', media: 'Movie' }); r = FR.sync({ year: 2026 });
assert.ok(FR.unassigned().find(u => u.title === 'Venom' && u.blocked), 'a title kept out shows as unassigned, marked as your doing');
assert.ok(!db.get("SELECT 1 FROM collections WHERE plex_key='fr:Marvel (MCU & Marvel)'"), 'a franchise with nothing left is removed');
FR.block({ kind: 'missing', title: 'Dune: Part Three', media: 'Movie', franchise: 'Dune' }); FR.sync({ year: 2026 });
assert.ok(!titles('Arrakis').includes('Dune: Part Three (missing)') && titles('Arrakis').includes('Dune (1984) (missing)'), 'one missing title can be hidden');
const d = FR.decisions(); assert.strictEqual(d.rules.length, 1); assert.strictEqual(d.blocks.length, 2);
for (const b of d.blocks) FR.undo('block', b.id); FR.undo('rule', d.rules[0].id); FR.sync({ year: 2026 });
assert.ok(titles('Arrakis').includes('Dune: Part Three (missing)') && col('Marvel (MCU & Marvel)') && !col('BBC Earth'), 'undoing puts everything back');
// a franchise collection emptied of franchise rows but holding something of yours is kept
db.run("UPDATE files SET missing=1 WHERE movie_title='Dune' OR show_name='Dune Prophecy'"); FR.sync({ year: 2026 });
assert.deepStrictEqual(titles('Arrakis'), ['Heat'], 'what you added outlives the franchise');

db.close(); fs.rmSync(dir, { recursive: true, force: true });
console.log('franchise sync tests passed');
