'use strict';
// The duplicate sweep: keep-best decides by resolution then bitrate; moving the discards is a real, verified, undoable move.
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createService } = require('../src/main/service');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-dup-'));
const root = path.join(dir, 'tv'); fs.mkdirSync(path.join(root, 'Show', 'Season 1'), { recursive: true });
const mk = (name, bytes) => { const p = path.join(root, 'Show', 'Season 1', name); fs.writeFileSync(p, Buffer.alloc(bytes, 1)); return p; };
const a = mk('Show - S01E01 - 1080p.mkv', 3000), b = mk('Show - S01E01 - 720p.mkv', 2000), c = mk('Show - S01E02.mkv', 1000);
const svc = createService({ userData: path.join(dir, 'data'), log: () => {}, send: () => {}, host: { isPackaged: true, getAppPath: () => path.resolve(__dirname, '..'), restart: () => {} } });
svc.init();
svc.settings.set({ roots: [{ id: 'tv', label: 'TV', path: root, type: 'tv', enabled: true }], renaming: { ...svc.settings.get().renaming, enabled: false } });
const db = svc.db;
const add = (abs, res, kbps, ep) => db.run(`INSERT INTO files (root_id, rel_path, abs_path, file_name, library_type, show_name, season, episode, resolution, bitrate_kbps, size, probe_ok, parse_ok, missing, ignored, adult) VALUES ('tv', ?, ?, ?, 'tv', 'Show', 1, ?, ?, ?, ?, 1, 1, 0, 0, 0)`, path.relative(root, abs), abs, path.basename(abs), ep, res, kbps, fs.statSync(abs).size);
add(a, '1080p', 8000, 1); add(b, '720p', 9000, 1); add(c, '1080p', 8000, 2);
const H = (n, ...x) => svc.handlers.get(n)(...x);

assert.strictEqual(H('data:duplicates').length, 1);
assert.deepStrictEqual(H('dup:keepBest'), { decided: 1 });
const g = H('data:duplicates')[0];
assert.deepStrictEqual(g.files.map(f => [path.basename(f.rel_path), f.keep]).sort(), [['Show - S01E01 - 1080p.mkv', 1], ['Show - S01E01 - 720p.mkv', 0]], 'resolution wins over bitrate');
let plan = H('dup:plan');
assert.strictEqual(plan.items.length, 1); assert.strictEqual(plan.live, false); assert.ok(plan.items[0].to.startsWith('_duplicates'));
await_(async () => {
  await assert.rejects(H('dup:moveDiscards', 'tv'), /switched off/, 'the renaming switch guards the move');
  svc.settings.set({ renaming: { ...svc.settings.get().renaming, enabled: true } });
  const r = await H('dup:moveDiscards', 'tv');
  assert.deepStrictEqual([r.done, r.failed], [1, 0]);
  const moved = path.join(root, '_duplicates', 'Show', 'Season 1', 'Show - S01E01 - 720p.mkv');
  assert.ok(fs.existsSync(moved) && !fs.existsSync(b), 'the discard moved into _duplicates with its folder path');
  assert.ok(fs.existsSync(a), 'the keeper stayed');
  assert.strictEqual(db.get('SELECT ignored, rel_path FROM files WHERE file_name=?', path.basename(b)).ignored, 1, 'the moved file is marked ignored');
  assert.strictEqual(H('data:duplicates').length, 0, 'no duplicate is left');
  const batch = db.getBatch(r.batchId); assert.strictEqual(batch.layout, 'duplicates'); assert.strictEqual(batch.mode, 'live');
  const u = H('movie:undo', r.batchId);
  assert.strictEqual(u.undone, 1); assert.ok(fs.existsSync(b) && !fs.existsSync(moved), 'undo puts the file back');
  svc.shutdown(); fs.rmSync(dir, { recursive: true, force: true });
  console.log('duplicate sweep tests passed');
});
function await_(fn) { fn().catch(e => { console.error(e); process.exit(1); }); }
