'use strict';
// Collection suggestions from names alone (the web sources are not called here), and the subtitle audit's rules.
const assert = require('assert');
const { localGroups, stem } = require('../src/main/suggest');

assert.strictEqual(stem('Pirates of the Caribbean: Dead Man\'s Chest'), 'pirates of caribbean');
assert.strictEqual(stem('Rocky IV'), 'rocky'); assert.strictEqual(stem('Rocky'), 'rocky'); assert.strictEqual(stem('Toy Story 3'), 'toy story');
assert.strictEqual(stem('John Wick: Chapter 4'), 'john wick'); assert.strictEqual(stem('Batman Begins'), 'batman'); assert.strictEqual(stem('Harry Potter and the Goblet of Fire'), 'harry potter and goblet of fire', 'a title with no series marker is left whole');
const items = [
  { library_type: 'movie', title_key: 'rocky|1976', title: 'Rocky', year: 1976 }, { library_type: 'movie', title_key: 'rocky ii|1979', title: 'Rocky II', year: 1979 }, { library_type: 'movie', title_key: 'rocky iv|1985', title: 'Rocky IV', year: 1985 },
  { library_type: 'movie', title_key: 'potc1|2003', title: 'Pirates of the Caribbean: The Curse of the Black Pearl', year: 2003 }, { library_type: 'movie', title_key: 'potc2|2006', title: 'Pirates of the Caribbean: Dead Man\'s Chest', year: 2006 },
  { library_type: 'movie', title_key: 'alien|1979', title: 'Alien', year: 1979 }, { library_type: 'tv', title_key: 'Loki', title: 'Loki' }, { library_type: 'tv', title_key: 'Loki', title: 'Loki' },
];
const g = localGroups(items);
assert.deepStrictEqual(g.map(x => [x.name, x.items.length]).sort(), [['Pirates of the Caribbean', 2], ['Rocky', 3]], 'one lone title or one repeated title is not a set');
assert.deepStrictEqual(g.find(x => x.name === 'Rocky').items.map(i => i.year), [1976, 1979, 1985], 'oldest first');

// the subtitle audit (through the service, with a small database)
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createService } = require('../src/main/service');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-subs-'));
const svc = createService({ userData: dir, log: () => {}, send: () => {}, host: { isPackaged: true, getAppPath: () => path.resolve(__dirname, '..'), restart: () => {} } });
svc.init();
const db = svc.db;
const add = (name, subs, side) => db.run(`INSERT INTO files (root_id, rel_path, abs_path, file_name, library_type, show_name, season, episode, sub_langs, sidecar_subs, probe_ok, parse_ok, missing, ignored, adult, size) VALUES ('r', ?, ?, ?, 'tv', 'Show', 1, 1, ?, ?, 1, 1, 0, 0, 0, 10)`, name, 'X:/' + name, name, subs, side);
add('a.mkv', 'eng;jpn', null); add('b.mkv', 'jpn', null); add('c.mkv', null, 'c.en.srt'); add('d.mkv', null, 'd.srt'); add('e.mkv', 'fre', 'e.forced.en.srt');
let r = svc.handlers.get('data:subtitles')();
assert.deepStrictEqual([r.total, r.have, r.lacking, r.unknown], [5, 3, 1, 1], 'a track or a tagged sidecar counts, in either Plex order (en.forced / forced.en); an untagged sidecar is unknown');
assert.strictEqual(r.titles[0].files, 1); assert.deepStrictEqual(r.titles[0].episodes, ['S01E01']);
svc.settings.set({ subtitles: { wanted: 'jpn' } });
r = svc.handlers.get('data:subtitles')(); assert.deepStrictEqual([r.have, r.lacking], [2, 2]);
svc.shutdown(); fs.rmSync(dir, { recursive: true, force: true });
console.log('suggest and subtitle tests passed');
