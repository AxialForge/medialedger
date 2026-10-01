'use strict';
// The root share helper: what it accepts, what it writes, and what it leaves behind when a mount fails.
const assert = require('assert');
const h = require('../server/share-helper');

// ---- requests: every field is hostile until it matches
const good = { op: 'add', name: 'Media', host: '192.168.1.204', share: 'Apocrypha Media Pool', user: 'joe', pass: 'p@ss word!' };
assert.deepStrictEqual(h.validate(good), { ...good, domain: '' });
assert.deepStrictEqual(h.validate({ op: 'remove', name: 'Media', host: '; rm -rf /' }), { op: 'remove', name: 'Media' }, 'remove takes a name and nothing else');
for (const [patch, why] of [
  [{ op: 'format' }, 'unknown operation'], [{ name: '../etc' }, 'a path as the name'], [{ name: '' }, 'no name'], [{ name: 'a b' }, 'a space in the name'], [{ name: 'x'.repeat(33) }, 'a long name'],
  [{ host: '192.168.1.204; reboot' }, 'a command in the host'], [{ host: '//nas' }, 'slashes in the host'], [{ host: '' }, 'no host'], [{ host: '-o' }, 'an option as the host'],
  [{ share: 'a/b' }, 'a path as the share'], [{ share: 'x,uid=0' }, 'mount options in the share'], [{ share: 'C$' }, 'an admin share'], [{ share: '$(id)' }, 'a substitution'],
  [{ user: 'joe\npassword=x' }, 'a second line in the username'], [{ user: 'joe%pw' }, 'a % in the username'], [{ pass: 'a\nb' }, 'a line break in the password'], [{ domain: 'a b' }, 'a space in the domain'],
]) assert.throws(() => h.validate({ ...good, ...patch }), Error, `must refuse ${why}`);
assert.strictEqual(h.mountName('Apocrypha Media Pool'), 'Apocrypha_Media_Pool');
assert.strictEqual(h.mountName('../../etc'), 'etc');
assert.ok(h.NAME_RE.test(h.mountName('§§§')), 'a name with nothing usable still gives a valid folder');

// ---- fstab: one line in, one line out, the rest untouched
const base = 'proc /proc proc defaults 0 0\n//192.168.1.204/Apocrypha_Media_Pool /mnt/media cifs credentials=/etc/medialedger-cifs.cred,uid=999 0 0\n# a comment /mnt/medialedger/Media cifs\n';
const line = h.fstabLine(good, 999, 998);
assert.ok(line.startsWith('//192.168.1.204/Apocrypha\\040Media\\040Pool /mnt/medialedger/Media cifs credentials=/etc/medialedger-shares/Media.cred,uid=999,gid=998,'), 'spaces are escaped the fstab way');
assert.ok(/x-systemd\.automount/.test(line) && /nofail/.test(line), 'a share that is down must not hang the boot');
const added = h.editFstab(base, '/mnt/medialedger/Media', line);
assert.strictEqual(added, base + line + '\n');
assert.strictEqual(h.editFstab(added, '/mnt/medialedger/Media', line), added, 'adding twice keeps one line');
assert.strictEqual(h.editFstab(added, '/mnt/medialedger/Media', null), base, 'removing restores the file, comment included');
const parsed = h.parseFstab(added);
assert.deepStrictEqual(parsed.map(s => [s.name, s.mount, s.managed, s.source]), [['media', '/mnt/media', false, '//192.168.1.204/Apocrypha_Media_Pool'], ['Media', '/mnt/medialedger/Media', true, '//192.168.1.204/Apocrypha Media Pool']]);

// ---- perform: against a pretend system
const fake = (failMount) => {
  const files = { '/etc/fstab': base }, calls = [], dirs = new Set();
  return { files, calls, dirs, sys: {
    exec: (cmd, args) => { calls.push([cmd, ...args].join(' ')); if (cmd === 'mount' && failMount) { const e = new Error('mount failed'); e.stderr = failMount; throw e; } if (cmd === 'umount') throw new Error('not mounted'); return ''; },
    readFile: (p) => files[p], writeFile: (p, t, mode) => { files[p] = t; files[p + ':mode'] = mode; }, unlink: (p) => { if (!(p in files)) throw new Error('ENOENT'); delete files[p]; delete files[p + ':mode']; },
    rmdir: (p) => dirs.delete(p), mkdirp: (p) => dirs.add(p), unitName: () => 'mnt-medialedger-Media',
  } };
};
{
  const f = fake(null); const r = h.perform(h.validate(good), { uid: 999, gid: 998 }, f.sys);
  assert.deepStrictEqual(r, { ok: true, mount: '/mnt/medialedger/Media' });
  assert.strictEqual(f.files['/etc/medialedger-shares/Media.cred'], 'username=joe\npassword=p@ss word!\n'); assert.strictEqual(f.files['/etc/medialedger-shares/Media.cred:mode'], 0o600, 'the password file is for root only');
  assert.ok(f.files['/etc/fstab'].endsWith(line + '\n')); assert.ok(f.calls.includes('mount /mnt/medialedger/Media'));
  assert.ok(f.calls.every(c => !c.includes('p@ss')), 'the password never reaches a command line');
  const gone = h.perform(h.validate({ op: 'remove', name: 'Media' }), { uid: 999, gid: 998 }, f.sys);
  assert.strictEqual(gone.ok, true); assert.strictEqual(f.files['/etc/fstab'], base); assert.ok(!('/etc/medialedger-shares/Media.cred' in f.files), 'removing takes the password with it');
}
{
  const f = fake('mount error(13): Permission denied\nRefer to the mount.cifs(8) manual page'); const r = h.perform(h.validate(good), { uid: 999, gid: 998 }, f.sys);
  assert.deepStrictEqual(r, { ok: false, error: 'The server refused the username or password' });
  assert.strictEqual(f.files['/etc/fstab'], base, 'a share that did not mount leaves no fstab line'); assert.ok(!('/etc/medialedger-shares/Media.cred' in f.files), 'and no stored password');
}
assert.strictEqual(h.explain({ stderr: 'mount error(2): No such file or directory' }), 'The server has no share with that name');
assert.strictEqual(h.explain({ stderr: 'mount error(113): could not connect to 10.0.0.9Unable to find suitable address.' }), 'The server did not answer. Check the address and that it is switched on');

// ---- the folder picker sees folders whose type the mount does not report
{
  const fs = require('fs'), os = require('os'), path = require('path');
  const { listDirs } = require('../src/main/rootcheck');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-dirs-')); fs.mkdirSync(path.join(d, 'Season 10')); fs.mkdirSync(path.join(d, 'Season 2')); fs.mkdirSync(path.join(d, '.hidden')); fs.writeFileSync(path.join(d, 'a.mkv'), ''); fs.writeFileSync(path.join(d, 'b.mkv'), '');
  const real = fs.readdirSync; // pretend the mount answers "unknown" for every entry, as some CIFS mounts do
  fs.readdirSync = (p, o) => { const r = real(p, o); return o && o.withFileTypes ? r.map(e => ({ name: e.name, isDirectory: () => false, isFile: () => false, isSymbolicLink: () => false })) : r; };
  const r = listDirs(d); fs.readdirSync = real;
  assert.deepStrictEqual(r.dirs.map(x => x.name), ['Season 2', 'Season 10'], 'folders are found by asking, and sorted the way a person counts');
  assert.strictEqual(r.files, 2); fs.rmSync(d, { recursive: true, force: true });
}
console.log('shares tests passed');
