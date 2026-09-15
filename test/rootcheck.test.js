'use strict';
// Root reachability + folder browsing, without touching the network beyond localhost.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rc = require('../src/main/rootcheck');

assert.strictEqual(rc.hostOf('\\\\192.168.1.204\\Apocrypha_Media_Pool\\Movies'), '192.168.1.204');
assert.strictEqual(rc.hostOf('//192.168.1.204/Apocrypha_Media_Pool'), '192.168.1.204');
assert.strictEqual(rc.hostOf('/mnt/media/Movies'), null);
assert.strictEqual(rc.hostOf('C:\\Media'), null);

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-root-'));
  fs.writeFileSync(path.join(tmp, 'a.mkv'), '');
  const [good, missing, empty] = await rc.checkRoots([{ id: 'g', label: 'Good', path: tmp }, { id: 'm', label: 'Missing', path: path.join(tmp, 'nope') }, { id: 'e', label: 'Empty', path: '' }]);
  assert.strictEqual(good.status, 'ok'); assert.strictEqual(good.entries, 1); assert.ok(good.writable);
  assert.strictEqual(missing.status, 'unreachable'); assert.strictEqual(missing.detail, 'ENOENT');
  assert.strictEqual(empty.detail, 'no path');
  assert.strictEqual(await rc.tcpReachable('127.0.0.1', 1, 300), false, 'closed port is unreachable');

  const top = rc.listDirs('');
  assert.ok(top.dirs.length >= 1, 'top level lists drives or /');
  assert.strictEqual(rc.listDirs(tmp).dirs.length, 0, 'files are not listed');
  fs.mkdirSync(path.join(tmp, 'Season 01')); fs.mkdirSync(path.join(tmp, '.hidden'));
  const here = rc.listDirs(tmp);
  assert.deepStrictEqual(here.dirs.map(d => d.name), ['Season 01'], 'sub-folders listed, hidden ones skipped');
  assert.strictEqual(here.parent, path.dirname(tmp));
  console.log('rootcheck tests passed');
})().catch(e => { console.error(e); process.exit(1); });
