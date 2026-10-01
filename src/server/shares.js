'use strict';
// Network shares, from the web server's side. The server cannot mount anything itself (see server/share-helper.js):
//
//   status()  reads /etc/fstab and /proc/mounts, both world-readable, to list the CIFS shares and whether each is up;
//   probe()   asks a file server which shares it offers, with smbclient, as the service user (no root needed);
//   add() / remove()  drop a request file for the root helper and wait for its answer.
//
// A password is held only for the length of the call: smbclient gets it in its environment (not on the command
// line, where other users could read it), and a request file is deleted by the helper before it acts on it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const helper = require('../../server/share-helper');

const UNIT = '/etc/systemd/system/medialedger-share.path';

function createShares({ dataDir, log = () => {}, audit = () => {} }) {
  const dir = path.join(dataDir, 'shares');
  const linux = process.platform === 'linux';
  const helperInstalled = () => linux && fs.existsSync(UNIT);
  const has = (cmd) => ['/usr/bin/', '/bin/', '/usr/local/bin/'].some(p => fs.existsSync(p + cmd));

  function list() {
    if (!linux) return [];
    let fstab = '', mounts = '';
    try { fstab = fs.readFileSync('/etc/fstab', 'utf8'); } catch { /* none */ }
    try { mounts = fs.readFileSync('/proc/mounts', 'utf8'); } catch { /* none */ }
    const up = new Set(mounts.split('\n').map(l => l.split(' ')).filter(f => f[2] === 'cifs').map(f => f[1].replace(/\\040/g, ' ')));
    return helper.parseFstab(fstab).map(s => {
      let entries = null;
      if (up.has(s.mount)) { try { entries = fs.readdirSync(s.mount).length; } catch { /* not readable */ } }
      return { ...s, mounted: up.has(s.mount), entries };
    });
  }
  const status = () => ({ available: helperInstalled(), platform: process.platform, canProbe: linux && has('smbclient'), base: helper.MOUNT_BASE, shares: list(),
    why: !linux ? 'On Windows the library folders are picked directly: browse to them, or type a path like \\\\server\\share\\Movies. Windows remembers the sign-in.' : helperInstalled() ? null : 'This server was installed before 2.4. Run "sudo medialedger-update" and then "sudo bash /opt/medialedger/server/install.sh" once to add the share helper.' });

  /** The disk shares a server offers to this user. */
  function probe({ host, user, pass, domain }) {
    const h = String(host || '').trim();
    if (!helper.HOST_RE.test(h)) return Promise.reject(new Error('The server address must be an IP address or a name, like 192.168.1.204 or nas.home'));
    const u = String(user || '').trim();
    if (/[%\n\r]/.test(u)) return Promise.reject(new Error('The username cannot contain a % sign'));
    if (!has('smbclient')) return Promise.reject(new Error('smbclient is not installed on the server. Run: sudo apt-get install -y smbclient'));
    const args = ['-g', '-L', '//' + h, '-m', 'SMB3', ...(domain ? ['-W', String(domain)] : []), ...(u ? ['-U', u] : ['-N'])];
    return new Promise((resolve, reject) => {
      execFile('smbclient', args, { env: { ...process.env, USER: u || 'guest', PASSWD: String(pass == null ? '' : pass), LC_ALL: 'C' }, timeout: 20000, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
        const text = `${stdout || ''}\n${stderr || ''}`;
        const shares = String(stdout || '').split('\n').map(l => l.split('|')).filter(f => f[0] === 'Disk' && f[1] && !f[1].endsWith('$')).map(f => ({ name: f[1], comment: (f[2] || '').trim(), folder: helper.mountName(f[1]) }));
        if (shares.length) return resolve({ host: h, shares });
        if (/LOGON_FAILURE|ACCESS_DENIED|ACCOUNT_/.test(text)) return reject(new Error('The server refused the username or password'));
        if (/HOST_UNREACHABLE|CONNECTION_REFUSED|IO_TIMEOUT|NT_STATUS_NOT_FOUND|timed out|Connection to .* failed|BAD_NETWORK_NAME/i.test(text) || (err && err.killed)) return reject(new Error(`${h} did not answer as a file server. Check the address and that file sharing (SMB) is on`));
        if (err) return reject(new Error((text.split('\n').map(x => x.trim()).filter(Boolean).pop() || err.message).slice(0, 200)));
        reject(new Error('The server answered but offers no shares to this user'));
      });
    });
  }

  /** Hand a request to the root helper and wait for its answer. */
  function ask(req) {
    if (!helperInstalled()) return Promise.reject(new Error(status().why));
    const clean = helper.validate(req); // fail here, with the same rules the helper applies, before anything is written
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const id = crypto.randomBytes(8).toString('hex');
    const reqFile = path.join(dir, `request-${id}.json`), resFile = path.join(dir, `result-${id}.json`);
    fs.writeFileSync(reqFile, JSON.stringify(clean), { mode: 0o600 });
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        let raw = null; try { raw = fs.readFileSync(resFile, 'utf8'); } catch { /* not yet */ }
        if (raw != null) { try { fs.unlinkSync(resFile); } catch { /* gone */ } let r; try { r = JSON.parse(raw); } catch { r = { ok: false, error: 'The share helper gave an unreadable answer' }; } return r.ok ? resolve(r) : reject(new Error(r.error || 'The share could not be connected')); }
        if (Date.now() - started > 60000) { try { fs.unlinkSync(reqFile); } catch { /* taken */ } return reject(new Error('The share helper did not answer. On the server run: sudo systemctl status medialedger-share.path')); }
        setTimeout(tick, 300);
      };
      setTimeout(tick, 300);
    });
  }
  async function add(o, by, ip) {
    const name = o.name ? String(o.name) : helper.mountName(o.share);
    const r = await ask({ op: 'add', name, host: o.host, share: o.share, user: o.user, pass: o.pass, domain: o.domain });
    audit('share_added', ip, `//${String(o.host).trim()}/${o.share} at ${r.mount}`, by); log(`share connected: //${String(o.host).trim()}/${o.share} at ${r.mount}`);
    return { ...r, shares: list() };
  }
  async function remove(name, by, ip) {
    const s = list().find(x => x.name === name && x.managed);
    if (!s) throw new Error('That share was not connected from here. Shares made by the installer are removed in /etc/fstab');
    const r = await ask({ op: 'remove', name });
    audit('share_removed', ip, s.source, by); log(`share removed: ${s.source}`);
    return { ...r, shares: list() };
  }
  return { status, probe, add, remove, list };
}

module.exports = { createShares };
