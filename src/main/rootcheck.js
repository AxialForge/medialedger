'use strict';
// Reachability checks for library roots, plus server-side folder browsing.
// Plain Node, shared by both shells. Nothing here needs privileges.
//
// checkRoot(path) answers: does the folder exist, can we list it, can we write
// to it, how many entries, and on Linux: is it under a mount in /etc/fstab, is
// that mount actually mounted, and does the NAS answer on the SMB port. That
// last part is what tells "share not mounted" apart from "NAS unplugged".
const fs = require('fs');
const path = require('path');
const net = require('net');

const isLinux = process.platform === 'linux';

function fstabEntries() {
  try {
    return fs.readFileSync('/etc/fstab', 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.split(/\s+/)).filter(f => f.length >= 3).map(([source, mountPoint, type]) => ({ source, mountPoint, type }));
  } catch { return []; }
}
function mounted() {
  try { return fs.readFileSync('/proc/mounts', 'utf8').split('\n').map(l => l.split(' ')).filter(f => f.length >= 3).map(([source, mountPoint, type]) => ({ source, mountPoint: mountPoint.replace(/\\040/g, ' '), type })); } catch { return []; }
}
const under = (p, mp) => p === mp || p.startsWith(mp.endsWith('/') ? mp : mp + '/');

/** TCP connect test with a short timeout; resolves true/false, never throws. */
function tcpReachable(host, port, ms = 2000) {
  return new Promise(res => { const s = net.connect({ host, port }); const done = v => { try { s.destroy(); } catch { /* ignore */ } res(v); }; s.setTimeout(ms, () => done(false)); s.once('connect', () => done(true)); s.once('error', () => done(false)); });
}

/** Host of a UNC path or a cifs source: \\\\192.168.1.204\\share or //192.168.1.204/share → 192.168.1.204 */
function hostOf(p) { const m = /^(?:\\\\|\/\/)([^\\/]+)[\\/]/.exec(String(p || '')); return m ? m[1] : null; }

async function checkRoot(root) {
  const p = root.path;
  const out = { id: root.id, label: root.label, path: p, exists: false, isDir: false, readable: false, writable: false, entries: null, sample: [], mount: null, nas: null, status: 'unreachable', detail: '' };
  if (!p) { out.detail = 'no path'; return out; }
  try { const st = fs.statSync(p); out.exists = true; out.isDir = st.isDirectory(); } catch (e) { out.detail = e.code || e.message; }
  if (out.isDir) {
    try { const names = fs.readdirSync(p); out.entries = names.length; out.sample = names.slice(0, 5); out.readable = true; } catch (e) { out.detail = 'cannot list: ' + (e.code || e.message); }
    try { fs.accessSync(p, fs.constants.W_OK); out.writable = true; } catch { /* read-only is fine for scanning */ }
  }
  // Linux: which mount should provide this path, and is it there?
  if (isLinux) {
    const fe = fstabEntries().filter(e => under(p, e.mountPoint)).sort((a, b) => b.mountPoint.length - a.mountPoint.length)[0];
    const me = mounted().filter(e => under(p, e.mountPoint) && e.mountPoint !== '/').sort((a, b) => b.mountPoint.length - a.mountPoint.length)[0];
    if (fe || me) out.mount = { point: (fe || me).mountPoint, source: (fe || me).source, type: (fe || me).type, inFstab: !!fe, mounted: !!me && me.type !== 'autofs', automount: !!me && me.type === 'autofs' };
  }
  // Network share: does the file server answer on SMB at all?
  const host = hostOf(p) || (out.mount && hostOf(out.mount.source));
  if (host) out.nas = { host, port: 445, reachable: await tcpReachable(host, 445) };

  if (out.readable && (out.entries > 0 || !out.mount)) { out.status = 'ok'; out.detail = `${out.entries} entries${out.writable ? ', writable' : ', read-only'}`; }
  else if (out.readable && out.entries === 0 && out.mount && !out.mount.mounted) { out.status = 'unmounted'; out.detail = 'folder exists but the share is not mounted'; }
  else if (out.mount && !out.mount.mounted) { out.status = 'unmounted'; out.detail = `share ${out.mount.source} is not mounted at ${out.mount.point}`; }
  else if (out.nas && !out.nas.reachable) { out.status = 'nas_down'; out.detail = `${out.nas.host} does not answer on port 445`; }
  else if (out.readable) { out.status = 'ok'; out.detail = `${out.entries} entries${out.writable ? ', writable' : ', read-only'}`; }
  if (out.nas && !out.nas.reachable && out.status !== 'ok') out.status = 'nas_down';
  return out;
}

async function checkRoots(roots) { return Promise.all((roots || []).map(checkRoot)); }

/** Sub-directories of a path for the web build's folder picker. `''` lists the top level (drives / root). */
function listDirs(p) {
  if (!p) {
    if (process.platform === 'win32') { const drives = []; for (const l of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { try { fs.accessSync(l + ':\\'); drives.push({ name: l + ':\\', path: l + ':\\' }); } catch { /* none */ } } return { path: '', parent: null, dirs: drives }; }
    p = '/';
  }
  const abs = path.resolve(p);
  let names = [];
  try { names = fs.readdirSync(abs, { withFileTypes: true }).filter(d => { try { return d.isDirectory() || (d.isSymbolicLink() && fs.statSync(path.join(abs, d.name)).isDirectory()); } catch { return false; } }).map(d => d.name).filter(n => !n.startsWith('.')).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })); }
  catch (e) { return { path: abs, parent: path.dirname(abs) !== abs ? path.dirname(abs) : (process.platform === 'win32' ? '' : null), dirs: [], error: e.code || e.message }; }
  const parent = path.dirname(abs) === abs ? (process.platform === 'win32' ? '' : null) : path.dirname(abs);
  return { path: abs, parent, dirs: names.slice(0, 500).map(n => ({ name: n, path: path.join(abs, n) })) };
}

module.exports = { checkRoot, checkRoots, listDirs, hostOf, tcpReachable };
