'use strict';
// Exercises the movie rename executor against a temp folder + temp DB (never the real share).
const fs = require('fs'); const os = require('os'); const path = require('path');
const assert = require('assert');
const { Db } = require('../src/main/db');
const { planMovieNames } = require('../src/main/movieNamer');
const { runBatch, undoBatch, preflight } = require('../src/main/movieRename');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-mr-'));
const root = path.join(tmp, 'Movies'); fs.mkdirSync(root);
const mk = (name, content) => { fs.writeFileSync(path.join(root, name), content); return path.join(root, name); };
const a = mk('A Breed Apart 2025 - 1080p WEB-DL (LiLTV).mp4', 'aaaa');
const b = mk('Pacific Rim (2013) [4k].mkv', 'bbbbbb');
const c = mk('Atlantis Milo\'s Return (2003).mp4', 'cc');
mk('Atlantis Milo\'s Return (2003) [1080p].mp4', 'dd'); // collision partner for c

const db = new Db(path.join(tmp, 't.db'));
const base = { root_id: 'movies', library_type: 'movie', ext: 'mp4', mtime_ms: 1, first_seen: 'a', last_seen: 'a', missing: 0, parse_ok: 1, probe_ok: 1, probed_at: 't', hdr: 'SDR', video_codec: 'h264', audio_langs: 'eng', resolution: '1080p' };
db.upsertFile({ ...base, rel_path: path.basename(a), abs_path: a, file_name: path.basename(a), size: 4, movie_title: 'A Breed Apart', movie_year: 2025, group_key: 'abreedapart|2025' });
db.upsertFile({ ...base, rel_path: path.basename(b), abs_path: b, file_name: path.basename(b), size: 6, ext: 'mkv', movie_title: 'Pacific Rim', movie_year: 2013, resolution: '4K', hdr: 'HDR10', video_codec: 'hevc', edition_tag: '4k', group_key: 'pacificrim|2013' });
db.upsertFile({ ...base, rel_path: path.basename(c), abs_path: c, file_name: path.basename(c), size: 2, movie_title: 'Atlantis Milo\'s Return', movie_year: 2003, group_key: 'x' });
db.upsertFile({ ...base, rel_path: 'Atlantis Milo\'s Return (2003) [1080p].mp4', abs_path: path.join(root, 'Atlantis Milo\'s Return (2003) [1080p].mp4'), file_name: 'Atlantis Milo\'s Return (2003) [1080p].mp4', size: 2, movie_title: 'Atlantis Milo\'s Return', movie_year: 2003, edition_tag: '1080p', group_key: 'x' });
db.saveOverride({ root_id: 'movies', rel_path: path.basename(b), library_type: 'movie', source: 'rip' });

const rows = db.all(`SELECT f.*, o.source AS source_override FROM files f LEFT JOIN overrides o ON o.root_id=f.root_id AND o.rel_path=f.rel_path WHERE f.library_type='movie'`);
const plan = planMovieNames(rows);
const ready = plan.filter(p => p.ok && !p.unchanged);
assert.strictEqual(ready.length, 2, 'two ready, two blocked by collision');
assert.strictEqual(plan.find(p => p.from === path.basename(b)).name, 'Pacific Rim (2013) - Rip 4K HDR HEVC.mkv', 'manual source override wins');

// 1. dry run touches nothing
let r = runBatch(db, ready, { live: false, layout: 'inplace', rootPath: root });
assert.strictEqual(r.status, 'done'); assert.strictEqual(r.done, 2); assert.ok(fs.existsSync(a));
assert.strictEqual(db.getBatch(r.batchId).mode, 'dry');

// 2. pre-flight abort: tamper with a size
fs.appendFileSync(a, 'zz');
r = runBatch(db, ready, { live: true, layout: 'inplace', rootPath: root });
assert.strictEqual(r.status, 'aborted'); assert.match(r.problems[0].reason, /size changed/); assert.ok(fs.existsSync(a), 'nothing renamed on abort'); assert.ok(fs.existsSync(b));
fs.writeFileSync(a, 'aaaa');

// 3. batch limit
assert.throws(() => runBatch(db, ready, { live: true, layout: 'inplace', rootPath: root, limit: 1 }), /limit is 1/);

// 4. live in place
r = runBatch(db, ready, { live: true, layout: 'inplace', rootPath: root });
assert.strictEqual(r.status, 'done'); assert.strictEqual(r.done, 2);
assert.ok(fs.existsSync(path.join(root, 'A Breed Apart (2025) - Web 1080p SDR H264.mp4')));
assert.ok(!fs.existsSync(a));
assert.strictEqual(db.get('SELECT file_name FROM files WHERE movie_title=?', 'A Breed Apart').file_name, 'A Breed Apart (2025) - Web 1080p SDR H264.mp4');
assert.strictEqual(db.get('SELECT source FROM overrides WHERE rel_path=?', 'Pacific Rim (2013) - Rip 4K HDR HEVC.mkv').source, 'rip', 'override follows the rename');
const liveId = r.batchId;

// 5. undo
const u = undoBatch(db, liveId);
assert.strictEqual(u.undone, 2); assert.strictEqual(u.failed, 0);
assert.ok(fs.existsSync(a) && fs.existsSync(b));
assert.strictEqual(db.getBatch(liveId).status, 'undone');
assert.strictEqual(db.get('SELECT file_name FROM files WHERE movie_title=?', 'Pacific Rim').file_name, path.basename(b));

// 6. folders layout: copy-verify-delete into Title (Year)\
const rows2 = db.all(`SELECT f.*, o.source AS source_override FROM files f LEFT JOIN overrides o ON o.root_id=f.root_id AND o.rel_path=f.rel_path WHERE f.library_type='movie'`);
const ready2 = planMovieNames(rows2).filter(p => p.ok && !p.unchanged);
r = runBatch(db, ready2, { live: true, layout: 'folders', rootPath: root });
assert.strictEqual(r.status, 'done');
const moved = path.join(root, 'Pacific Rim (2013)', 'Pacific Rim (2013) - Rip 4K HDR HEVC.mkv');
assert.ok(fs.existsSync(moved)); assert.strictEqual(fs.readFileSync(moved, 'utf8'), 'bbbbbb'); assert.ok(!fs.existsSync(b));
assert.strictEqual(db.get('SELECT rel_path FROM files WHERE movie_title=?', 'Pacific Rim').rel_path, 'Pacific Rim (2013)\\Pacific Rim (2013) - Rip 4K HDR HEVC.mkv');
const u2 = undoBatch(db, r.batchId);
assert.strictEqual(u2.undone, 2); assert.ok(fs.existsSync(b)); assert.ok(!fs.existsSync(path.join(root, 'Pacific Rim (2013)')), 'empty folder removed on undo');

// 7. undo refuses when the file changed after the rename
r = runBatch(db, ready, { live: true, layout: 'inplace', rootPath: root });
fs.appendFileSync(path.join(root, 'A Breed Apart (2025) - Web 1080p SDR H264.mp4'), '!');
const u3 = undoBatch(db, r.batchId);
assert.strictEqual(u3.failed, 1); assert.strictEqual(u3.undone, 1);
assert.strictEqual(db.getBatch(r.batchId).status, 'partially undone');

// 8. preflight: target exists
const pf = preflight([{ id: 1, from: 'x', abs_path: c, rel_path: path.basename(c), dir: '', size: 2, name: 'Atlantis Milo\'s Return (2003) [1080p].mp4', tokens: {} }], root, 'inplace');
assert.strictEqual(pf.ok, false); assert.match(pf.problems[0].reason, /already exists/);

db.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('movie rename harness passed');
