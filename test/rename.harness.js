'use strict';
// Exercises applyRenames against a temp folder + temp DB (never the real share).
const fs = require('fs'); const os = require('os'); const path = require('path');
const assert = require('assert');
const { Db } = require('../src/main/db');
const { applyRenames, proposals, proposeSegments } = require('../src/main/renamer');
const { runBatch, undoBatch } = require('../src/main/movieRename');

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
// ---- name parts ----
const ep = { library_type: 'anime', parse_ok: 1, file_name: 'x.mkv', show_name: 'Frieren', season: 1, episode: 2, episode_title: 'Pilot', resolution: '1080p', video_codec: 'hevc', audio_langs: 'jpn', sub_langs: 'eng' };
assert.strictEqual(proposeSegments(ep).name, 'Frieren - S01E02 - Pilot.mkv', 'title on by default');
assert.strictEqual(proposeSegments(ep, []).name, 'Frieren - S01E02.mkv');
assert.strictEqual(proposeSegments(ep, ['title', 'resolution', 'codec', 'dubsub']).name, 'Frieren - S01E02 - Pilot [1080p HEVC Sub].mkv');
assert.strictEqual(proposeSegments(ep, ['dubsub', 'bogus']).name, 'Frieren - S01E02 [Sub].mkv');
assert.deepStrictEqual(proposeSegments(ep).segments.map(x => x.part), ['show', 'code', 'title', 'ext']);

// ---- episodes through the batch engine: pre-flight abort on a collision, then a clean batch and its undo ----
{
  const dir2 = path.join(tmp, 'Show B', 'S1'); fs.mkdirSync(dir2, { recursive: true });
  const a = path.join(dir2, 'showb 1.mp4'); fs.writeFileSync(a, 'aa');
  const b = path.join(dir2, 'showb 2.mp4'); fs.writeFileSync(b, 'bbb');
  db.upsertFile({ ...base, size: 2, rel_path: 'Show B\\S1\\showb 1.mp4', abs_path: a, file_name: 'showb 1.mp4', show_name: 'Show B', season: 1, episode: 1 });
  db.upsertFile({ ...base, size: 3, rel_path: 'Show B\\S1\\showb 2.mp4', abs_path: b, file_name: 'showb 2.mp4', show_name: 'Show B', season: 1, episode: 2 });
  const items = proposals(db, { show: 'Show B' });
  assert.strictEqual(items.length, 2); assert.strictEqual(items[0].name, 'Show B - S01E01.mp4'); assert.strictEqual(items[0].dir, 'Show B\\S1');
  fs.writeFileSync(path.join(dir2, 'Show B - S01E02.mp4'), 'taken');
  const aborted = runBatch(db, items, { live: true, layout: 'episodes', rootPath: tmp });
  assert.strictEqual(aborted.status, 'aborted'); assert.ok(fs.existsSync(a) && fs.existsSync(b), 'pre-flight abort touches nothing');
  fs.unlinkSync(path.join(dir2, 'Show B - S01E02.mp4'));
  const dry = runBatch(db, items, { live: false, layout: 'episodes', rootPath: tmp });
  assert.strictEqual(dry.status, 'done'); assert.ok(fs.existsSync(a), 'dry run renames nothing');
  const live = runBatch(db, items, { live: true, layout: 'episodes', rootPath: tmp });
  assert.strictEqual(live.done, 2); assert.ok(fs.existsSync(path.join(dir2, 'Show B - S01E01.mp4')) && !fs.existsSync(a));
  assert.strictEqual(db.get('SELECT file_name FROM files WHERE id=?', items[1].id).file_name, 'Show B - S01E02.mp4');
  const undo = undoBatch(db, live.batchId);
  assert.strictEqual(undo.undone, 2); assert.ok(fs.existsSync(a) && fs.existsSync(b), 'undo restores both');
  assert.strictEqual(db.get('SELECT file_name FROM files WHERE id=?', items[0].id).file_name, 'showb 1.mp4');
}
db.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('rename harness passed (episodes through the batch engine)');
