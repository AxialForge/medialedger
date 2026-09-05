'use strict';
// Exercises applyRenames against a temp folder + temp DB (never the real share).
const fs = require('fs'); const os = require('os'); const path = require('path');
const assert = require('assert');
const { Db } = require('../src/main/db');
const { applyRenames, proposals } = require('../src/main/renamer');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-ren-'));
const showDir = path.join(tmp, 'The Boys', 'The Boys S3'); fs.mkdirSync(showDir, { recursive: true });
const f1 = path.join(showDir, '4The Boys S3.mp4'); fs.writeFileSync(f1, 'x');
const f2 = path.join(showDir, '5The Boys S3.mp4'); fs.writeFileSync(f2, 'y');
fs.writeFileSync(path.join(showDir, 'The Boys - S03E05.mp4'), 'already-there'); // collision for f2

const db = new Db(path.join(tmp, 't.db'));
const base = { root_id: 'tv', library_type: 'tv', ext: 'mp4', size: 1, mtime_ms: 1, first_seen: 'a', last_seen: 'a', missing: 0, parse_ok: 1, show_name: 'The Boys', season: 3 };
db.upsertFile({ ...base, rel_path: 'The Boys\\The Boys S3\\4The Boys S3.mp4', abs_path: f1, file_name: '4The Boys S3.mp4', episode: 4 });
db.upsertFile({ ...base, rel_path: 'The Boys\\The Boys S3\\5The Boys S3.mp4', abs_path: f2, file_name: '5The Boys S3.mp4', episode: 5 });
db.saveOverride({ root_id: 'tv', rel_path: 'The Boys\\The Boys S3\\4The Boys S3.mp4', library_type: 'tv', keep: 1 });

const props = proposals(db, {});
assert.strictEqual(props.length, 2);
assert.strictEqual(props[0].to, 'The Boys - S03E04.mp4');

const res = applyRenames(db, props.map(p => p.id), () => {});
assert.strictEqual(res[0].ok, true);
assert.strictEqual(res[1].ok, false); assert.match(res[1].error, /already exists/);
assert.ok(fs.existsSync(path.join(showDir, 'The Boys - S03E04.mp4')));
assert.ok(!fs.existsSync(f1));
assert.ok(fs.existsSync(f2), 'collision source must be untouched');
const row = db.get('SELECT rel_path, file_name FROM files WHERE id=?', props[0].id);
assert.strictEqual(row.file_name, 'The Boys - S03E04.mp4');
assert.strictEqual(db.get('SELECT keep FROM overrides WHERE rel_path=?', 'The Boys\\The Boys S3\\The Boys - S03E04.mp4').keep, 1, 'override follows the rename');
assert.strictEqual(db.listRenames().length, 2);
db.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('rename harness passed');
