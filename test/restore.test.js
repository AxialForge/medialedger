'use strict';
// Backup sets and restore: companions copied, sets pruned together, a bad backup refused, the swap on startup.
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { Db, MIGRATIONS } = require('../src/main/db');
const R = require('../src/main/restore');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-restore-'));
const data = path.join(tmp, 'data'), nas = path.join(tmp, 'nas'); fs.mkdirSync(data); fs.mkdirSync(nas);
const MAXV = MIGRATIONS[MIGRATIONS.length - 1].version;

// a live profile with one file row, settings and accounts
let db = new Db(path.join(data, 'medialedger.db'));
db.run("INSERT INTO files (root_id, rel_path, abs_path, file_name, library_type) VALUES ('r', 'a.mkv', 'a.mkv', 'a.mkv', 'tv')");
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ marker: 'old' }));
fs.writeFileSync(path.join(data, 'web.json'), JSON.stringify({ users: { admin: {} } }));

// three backup sets; keep 2
for (const stamp of ['2026-09-01T03-30-00', '2026-09-02T03-30-00', '2026-09-03T03-30-00']) {
  fs.copyFileSync(db.backup('t'), path.join(nas, `medialedger-${stamp}.db`));
  assert.strictEqual(R.copyCompanions(data, nas, stamp).length, 2);
}
fs.writeFileSync(path.join(nas, 'unrelated.txt'), 'x');
assert.strictEqual(R.listSets(nas).length, 3);
assert.strictEqual(R.pruneSets(nas, 2), 1);
const sets = R.listSets(nas);
assert.deepStrictEqual(sets.map(s => s.stamp), ['2026-09-03T03-30-00', '2026-09-02T03-30-00'], 'newest first, oldest pruned as a whole set');
assert.ok(sets[0].files.db && sets[0].files.settings && sets[0].files.web);
assert.ok(!fs.existsSync(path.join(nas, 'medialedger-2026-09-01T03-30-00.web.json')), 'companions go with their database');
assert.ok(fs.existsSync(path.join(nas, 'unrelated.txt')), 'other files are left alone');
assert.strictEqual(sets[0].when, '2026-09-03T03:30:00Z');

// the library changes after the backup
db.run("INSERT INTO files (root_id, rel_path, abs_path, file_name, library_type) VALUES ('r', 'b.mkv', 'b.mkv', 'b.mkv', 'tv')");
db.close();
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ marker: 'new' }));

// a corrupt backup is refused and nothing is staged
fs.writeFileSync(path.join(nas, 'medialedger-2026-09-04T03-30-00.db'), 'not a database');
assert.throws(() => R.stageRestore(data, nas, '2026-09-04T03-30-00', {}, MAXV));
assert.ok(!fs.existsSync(path.join(data, 'restore-pending', 'READY')));
assert.throws(() => R.stageRestore(data, nas, '2026-09-03T03-30-00', {}, MAXV - 1), /Update MediaLedger/, 'a newer schema is refused');
assert.throws(() => R.stageRestore(data, nas, '1999-01-01T00-00-00', {}, MAXV), /no longer/);

// stage database + settings, not accounts; nothing live changes until startup
const st = R.stageRestore(data, nas, '2026-09-03T03-30-00', { settings: true, web: false }, MAXV);
assert.strictEqual(st.files, 1); assert.strictEqual(st.version, MAXV);
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(data, 'settings.json'), 'utf8')).marker, 'new');
assert.strictEqual(R.applyPendingRestore(path.join(tmp, 'nowhere')), null, 'no pending restore is a no-op');

const done = R.applyPendingRestore(data);
assert.deepStrictEqual(done.files.sort(), ['medialedger.db', 'settings.json']);
db = new Db(path.join(data, 'medialedger.db'));
assert.strictEqual(db.get('SELECT COUNT(*) n FROM files').n, 1, 'the library is back to the backup');
db.close();
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(data, 'settings.json'), 'utf8')).marker, 'old');
assert.ok(fs.existsSync(path.join(done.aside, 'medialedger.db')), 'the replaced database is kept aside');
assert.ok(!fs.existsSync(path.join(data, 'restore-pending')));
assert.strictEqual(R.applyPendingRestore(data), null, 'runs once');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('restore tests passed');
