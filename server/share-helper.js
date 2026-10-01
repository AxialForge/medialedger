#!/usr/bin/env node
'use strict';
// Root helper: connects and removes network shares for MediaLedger.
//
// The web service runs as an unprivileged user with NoNewPrivileges, so it cannot mount anything and cannot
// use sudo. Instead it drops a request file into <data>/shares/ and systemd (medialedger-share.path) starts
// this script as root. Everything in a request is treated as hostile:
//
//   * the request must be a small regular file owned by the service user (never a link);
//   * a share is only ever mounted at /mnt/medialedger/<name>, as CIFS, owned by the service user;
//   * every field is checked against a strict pattern before it reaches fstab, a credentials file or mount;
//   * nothing is passed through a shell;
//   * the answer is written with O_EXCL | O_NOFOLLOW, so a planted link cannot redirect a root write.
//
//   node share-helper.js --dir=/var/lib/medialedger/shares --owner=medialedger
//
// Request:  request-<16 hex>.json  { op: 'add' | 'remove', name, host, share, user, pass, domain? }
// Answer:   result-<same id>.json  { ok, mount?, error? }
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MOUNT_BASE = '/mnt/medialedger';
const CRED_DIR = '/etc/medialedger-shares';
const FSTAB = '/etc/fstab';
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const HOST_RE = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const SHARE_RE = /^[^\\/\x00-\x1f"'`$,;|&<>*?]{1,80}$/;
const FIELD_RE = /^[^\x00-\x1f]{1,128}$/; // user, password, domain: one line, no control characters

/** A safe folder name for a share: "My Media Pool" -> "My_Media_Pool". */
const mountName = (share) => String(share || '').trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'share';

/** Throws with a message written for a person when a request is not acceptable. Returns the cleaned request. */
function validate(r) {
  if (!r || typeof r !== 'object') throw new Error('Empty request');
  const op = r.op;
  if (op !== 'add' && op !== 'remove') throw new Error('Unknown operation');
  const name = String(r.name || '');
  if (!NAME_RE.test(name)) throw new Error('The folder name may only use letters, digits, dash and underscore (up to 32)');
  if (op === 'remove') return { op, name };
  const host = String(r.host || '').trim(), share = String(r.share || '').trim(), user = String(r.user || ''), pass = String(r.pass == null ? '' : r.pass), domain = String(r.domain || '');
  if (!HOST_RE.test(host)) throw new Error('The server address must be an IP address or a name, like 192.168.1.204 or nas.home');
  if (!SHARE_RE.test(share) || share.endsWith('$')) throw new Error('That share name cannot be used');
  if (!FIELD_RE.test(user) || /[%=]/.test(user)) throw new Error('The username cannot be used (no % or = signs, one line)');
  if (pass && !FIELD_RE.test(pass)) throw new Error('The password cannot contain line breaks or control characters');
  if (domain && (!FIELD_RE.test(domain) || /[=\s]/.test(domain))) throw new Error('The domain cannot be used');
  return { op, name, host, share, user, pass, domain };
}

const mountOf = (name) => `${MOUNT_BASE}/${name}`;
const credOf = (name) => `${CRED_DIR}/${name}.cred`;
const fstabEscape = (s) => s.replace(/\\/g, '\\134').replace(/ /g, '\\040').replace(/\t/g, '\\011');
/** The fstab line for one share. Same options the installer has always used for /mnt/media. */
function fstabLine({ name, host, share }, uid, gid) {
  return `//${host}/${fstabEscape(share)} ${mountOf(name)} cifs credentials=${credOf(name)},uid=${uid},gid=${gid},file_mode=0664,dir_mode=0775,vers=3.0,iocharset=utf8,_netdev,nofail,x-systemd.automount 0 0`;
}
/** fstab text with the line for `mount` replaced by `line`, or removed when line is null. Other lines are untouched. */
function editFstab(text, mount, line) {
  const out = String(text).split('\n').filter(l => { const f = l.trim().split(/\s+/); return !(f.length >= 3 && !l.trim().startsWith('#') && f[1] === mount && f[2] === 'cifs'); });
  while (out.length && out[out.length - 1] === '') out.pop();
  if (line) out.push(line);
  return out.join('\n') + '\n';
}
/** The CIFS shares in an fstab text: [{ source, mount, name, managed }]. Used by the web server to list them. */
function parseFstab(text) {
  const un = (s) => s.replace(/\\040/g, ' ').replace(/\\011/g, '\t').replace(/\\134/g, '\\');
  return String(text).split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.split(/\s+/)).filter(f => f.length >= 3 && f[2] === 'cifs')
    .map(f => { const mount = un(f[1]); const managed = mount.startsWith(MOUNT_BASE + '/') && NAME_RE.test(mount.slice(MOUNT_BASE.length + 1)); return { source: un(f[0]), mount, name: managed ? mount.slice(MOUNT_BASE.length + 1) : path.basename(mount), managed }; });
}

/** What mount(8) and the kernel say, turned into something a person can act on. */
function explain(err) {
  const m = String((err && (err.stderr || err.message)) || err || '');
  if (/error\(13\)|Permission denied/i.test(m)) return 'The server refused the username or password';
  if (/error\(2\)|No such file or directory/i.test(m)) return 'The server has no share with that name';
  if (/error\(11[23]\)|Host is down|No route to host/i.test(m)) return 'The server did not answer. Check the address and that it is switched on';
  if (/error\(115\)|Operation now in progress|timed out/i.test(m)) return 'The server did not answer in time';
  if (/could not resolve address|Name or service not known/i.test(m)) return 'That server name does not resolve. Try its IP address';
  if (/error\(95\)|Operation not supported/i.test(m)) return 'The server does not accept SMB 3.0 sign-ins';
  return (m.split('\n').map(x => x.trim()).filter(Boolean).pop() || 'mount failed').slice(0, 300);
}

/** Carry out one validated request. `sys` is injectable so the logic can be tested without root. */
function perform(r, ids, sys) {
  const mnt = mountOf(r.name);
  if (r.op === 'remove') {
    try { sys.exec('umount', [mnt]); } catch { /* not mounted, or busy: the fstab line still goes */ }
    try { sys.exec('systemctl', ['stop', sys.unitName(mnt) + '.automount']); } catch { /* none */ }
    sys.writeFile(FSTAB, editFstab(sys.readFile(FSTAB), mnt, null));
    try { sys.unlink(credOf(r.name)); } catch { /* gone */ }
    try { sys.exec('systemctl', ['daemon-reload']); } catch { /* best effort */ }
    try { sys.rmdir(mnt); } catch { /* still busy or not empty: leave it */ }
    return { ok: true, mount: mnt, removed: true };
  }
  const before = sys.readFile(FSTAB);
  sys.mkdirp(CRED_DIR, 0o700); sys.mkdirp(mnt, 0o755);
  sys.writeFile(credOf(r.name), `username=${r.user}\npassword=${r.pass}\n${r.domain ? `domain=${r.domain}\n` : ''}`, 0o600);
  sys.writeFile(FSTAB, editFstab(before, mnt, fstabLine(r, ids.uid, ids.gid)));
  try {
    try { sys.exec('umount', [mnt]); } catch { /* was not mounted */ }
    sys.exec('systemctl', ['daemon-reload']);
    sys.exec('mount', [mnt]);
  } catch (e) {
    // Leave nothing behind from a share that did not mount: no fstab line to hang the next boot, no stray password.
    sys.writeFile(FSTAB, before); try { sys.unlink(credOf(r.name)); } catch { /* gone */ }
    try { sys.exec('systemctl', ['daemon-reload']); } catch { /* best effort */ }
    try { sys.rmdir(mnt); } catch { /* leave it */ }
    return { ok: false, error: explain(e) };
  }
  return { ok: true, mount: mnt };
}

const realSys = {
  exec: (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 45000, encoding: 'utf8' }),
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  writeFile: (p, text, mode) => { const tmp = p + '.ml-new'; fs.writeFileSync(tmp, text, { mode: mode || 0o644 }); if (mode) fs.chmodSync(tmp, mode); fs.renameSync(tmp, p); },
  unlink: (p) => fs.unlinkSync(p),
  rmdir: (p) => fs.rmdirSync(p),
  mkdirp: (p, mode) => fs.mkdirSync(p, { recursive: true, mode }),
  unitName: (mnt) => { try { return execFileSync('systemd-escape', ['-p', mnt], { encoding: 'utf8' }).trim(); } catch { return mnt.replace(/^\//, '').replace(/\//g, '-'); } },
};

/** Process every request waiting in `dir`. Returns how many were handled. */
function processDir(dir, owner, sys = realSys) {
  const ids = { uid: Number(execFileSync('id', ['-u', owner], { encoding: 'utf8' })), gid: Number(execFileSync('id', ['-g', owner], { encoding: 'utf8' })) };
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    const m = /^request-([a-f0-9]{16})\.json$/.exec(f); if (!m) continue;
    const file = path.join(dir, f), out = path.join(dir, `result-${m[1]}.json`);
    let result;
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile() || st.uid !== ids.uid || st.size > 4096) throw new Error('Request refused');
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      let raw; try { raw = fs.readFileSync(fd, 'utf8'); } finally { fs.closeSync(fd); }
      fs.unlinkSync(file); // the password does not stay on disk a moment longer than needed
      result = perform(validate(JSON.parse(raw)), ids, sys);
    } catch (e) { try { fs.unlinkSync(file); } catch { /* gone */ } result = { ok: false, error: e instanceof SyntaxError ? 'Request was not readable' : e.message }; }
    try { fs.unlinkSync(out); } catch { /* none */ }
    const fd = fs.openSync(out, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeSync(fd, JSON.stringify(result)); fs.fchownSync(fd, ids.uid, ids.gid); } finally { fs.closeSync(fd); }
    n++;
  }
  return n;
}

if (require.main === module) {
  const arg = (k) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
  const dir = arg('dir'), owner = arg('owner') || 'medialedger';
  if (!dir) { console.error('usage: share-helper.js --dir=<data>/shares [--owner=medialedger]'); process.exit(2); }
  if (process.getuid && process.getuid() !== 0) { console.error('share-helper must run as root'); process.exit(1); }
  try { const n = processDir(dir, owner); if (n) console.log(`share-helper: ${n} request(s) handled`); } catch (e) { console.error('share-helper: ' + e.message); process.exit(1); }
}

module.exports = { validate, fstabLine, editFstab, parseFstab, perform, explain, mountName, processDir, MOUNT_BASE, CRED_DIR, NAME_RE, HOST_RE };
