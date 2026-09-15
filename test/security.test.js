'use strict';
// Web-shell security: TOTP against the RFC 6238 vectors, LAN detection, and the
// session / lockout / re-auth state machine on a throwaway data folder.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const totp = require('../src/server/totp');
const { createSecurity, isPrivateIp } = require('../src/server/security');

// RFC 6238 appendix B (SHA1, secret "12345678901234567890")
const rfcSecret = totp.base32Encode(Buffer.from('12345678901234567890'));
assert.strictEqual(totp.totp(rfcSecret, 59 * 1000), '287082'); // T = 59 s → counter 1
assert.strictEqual(totp.hotp(Buffer.from('12345678901234567890'), 1), '287082');
assert.strictEqual(totp.hotp(Buffer.from('12345678901234567890'), 37037036), '081804'); // T = 1111111109
assert.strictEqual(totp.hotp(Buffer.from('12345678901234567890'), 66666666), '279037'); // T = 2000000000 (RFC: 69279037)
assert.strictEqual(totp.base32Decode(totp.base32Encode(Buffer.from('hello world'))).toString(), 'hello world');
assert.ok(totp.verify(rfcSecret, totp.totp(rfcSecret, 1111111109000), 1111111109000));
assert.ok(totp.verify(rfcSecret, totp.totp(rfcSecret, 1111111109000 - 30000), 1111111109000), 'previous step accepted');
assert.ok(!totp.verify(rfcSecret, '000000', 1111111109000));
assert.ok(/^otpauth:\/\/totp\/MediaLedger:pi\?secret=[A-Z2-7]+&issuer=MediaLedger/.test(totp.otpauthUrl(totp.newSecret(), 'pi')));

// LAN detection
for (const ip of ['127.0.0.1', '::1', '10.1.2.3', '192.168.1.203', '172.16.0.9', '172.31.255.1', '169.254.1.1', '100.64.0.1', '::ffff:192.168.0.5', 'fd12::1', 'fe80::1']) assert.ok(isPrivateIp(ip), ip + ' should be private');
for (const ip of ['8.8.8.8', '172.32.0.1', '11.0.0.1', '2001:db8::1', '']) assert.ok(!isPrivateIp(ip), ip + ' should be public');

// Accounts, sessions, lockout, re-auth
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-sec-'));
// 1.0 file with a single password migrates into the admin account
fs.writeFileSync(path.join(dir, 'web.json'), JSON.stringify({ passwordHash: require('../src/server/security').hashPassword('legacy pass'), sessions: {} }));
let sec = createSecurity({ dataDir: dir });
assert.ok(sec.userOf('admin') && sec.userOf('admin').role === 'admin', 'legacy password became the admin account');
assert.ok(!sec.state.passwordHash);
assert.ok(sec.login('10.0.0.2', 'ua', { username: 'admin', password: 'legacy pass' }).ok);
sec.setPassword('correct horse');
assert.strictEqual(sec.login('10.0.0.2', 'ua', { username: 'admin', password: 'wrong' }).reason, 'password');
assert.strictEqual(sec.login('10.0.0.2', 'ua', { username: 'nobody', password: 'correct horse' }).reason, 'password');
const ok = sec.login('10.0.0.2', 'Mozilla', { username: 'Admin', password: 'correct horse' });
assert.ok(ok.ok && /^[a-f0-9]{64}$/.test(ok.id) && ok.role === 'admin' && ok.username === 'admin', 'username is case-insensitive');
const s = sec.sessionOf(`ml_session=${ok.id}`);
assert.ok(s && s.ip === '10.0.0.2' && s.user === 'admin' && s.role === 'admin');
assert.ok(!sec.needsReauth(s), 'fresh login counts as re-authenticated');
sec.state.sessions[ok.id].reauthAt = Date.now() - 10 * 60000;
assert.ok(sec.needsReauth(sec.sessionOf(`ml_session=${ok.id}`)), 'stale after 5 minutes');
assert.ok(!sec.reauth(sec.sessionOf(`ml_session=${ok.id}`), 'nope', '10.0.0.2'));
assert.ok(sec.reauth(sec.sessionOf(`ml_session=${ok.id}`), 'correct horse', '10.0.0.2'));
// users
assert.throws(() => sec.addUser('Bad Name!', 'password123', 'standard', '10.0.0.2', 'admin'), /Username/);
assert.throws(() => sec.addUser('joe', 'short', 'standard', '10.0.0.2', 'admin'), /at least 8/);
sec.addUser('Joe', 'joes password', 'standard', '10.0.0.2', 'admin');
assert.throws(() => sec.addUser('joe', 'joes password', 'standard', '10.0.0.2', 'admin'), /already exists/);
const joe = sec.login('10.0.0.5', 'phone', { username: 'joe', password: 'joes password' });
assert.ok(joe.ok && joe.role === 'standard');
assert.throws(() => sec.setRole('admin', 'standard', '10.0.0.2', 'admin'), /last admin/);
assert.throws(() => sec.deleteUser('admin', '10.0.0.2', 'admin'), /last admin/);
sec.setRole('joe', 'admin', '10.0.0.2', 'admin');
assert.strictEqual(sec.sessionOf(`ml_session=${joe.id}`).role, 'admin', 'role change reaches live sessions');
sec.setRole('joe', 'standard', '10.0.0.2', 'admin');
sec.resetPassword('joe', 'new joes password', '10.0.0.2', 'admin');
assert.ok(!sec.sessionOf(`ml_session=${joe.id}`), 'password reset signs that user out');
assert.ok(sec.login('10.0.0.5', 'phone', { username: 'joe', password: 'new joes password' }).ok);
// per-session flag
sec.setSessionFlag(ok.id, 'showAdult', true);
assert.strictEqual(sec.sessionOf(`ml_session=${ok.id}`).showAdult, true);
// lockout after repeated failures from one address; other addresses unaffected
for (let i = 0; i < 8; i++) sec.login('10.0.0.9', 'ua', { username: 'admin', password: 'bad' });
assert.strictEqual(sec.login('10.0.0.9', 'ua', { username: 'admin', password: 'correct horse' }).reason, 'locked');
assert.ok(sec.login('10.0.0.10', 'ua', { username: 'admin', password: 'correct horse' }).ok);
// 2FA applies to admins only
const setup = sec.totpSetup('pi');
assert.throws(() => sec.totpEnable('000000', '10.0.0.2', 'admin'), /did not match/);
sec.totpEnable(totp.totp(setup.secret), '10.0.0.2', 'admin');
assert.strictEqual(sec.login('10.0.0.3', 'ua', { username: 'admin', password: 'correct horse' }).reason, 'totp');
assert.strictEqual(sec.login('10.0.0.3', 'ua', { username: 'admin', password: 'correct horse', code: '123456' }).reason, 'totp_bad');
assert.ok(sec.login('10.0.0.3', 'ua', { username: 'admin', password: 'correct horse', code: totp.totp(setup.secret) }).ok);
assert.ok(sec.login('10.0.0.3', 'ua', { username: 'joe', password: 'new joes password' }).ok, 'standard users sign in without a code');
// own password change keeps the current session, drops the user's others
const mine = sec.sessionOf(`ml_session=${ok.id}`);
const adminSessionsBefore = Object.values(sec.state.sessions).filter(x => x.user === 'admin').length;
sec.changePassword(mine, 'correct horse', 'battery staple', '10.0.0.2');
assert.ok(adminSessionsBefore > 1 && Object.values(sec.state.sessions).filter(x => x.user === 'admin').length === 1 && sec.sessionOf(`ml_session=${ok.id}`));
assert.ok(Object.values(sec.state.sessions).some(x => x.user === 'joe'), 'other users stay signed in');
// options + status
sec.setOptions({ lanOnly: false, idleMinutes: 30, guestEnabled: true }, '10.0.0.2', 'admin');
assert.ok(sec.isAllowedIp('8.8.8.8') && sec.guestEnabled());
sec.setOptions({ lanOnly: true, guestEnabled: false }, '10.0.0.2', 'admin');
assert.ok(!sec.isAllowedIp('8.8.8.8') && sec.isAllowedIp('192.168.1.5'));
const st = sec.status(sec.sessionOf(`ml_session=${ok.id}`));
assert.ok(st.totpEnabled && st.users.length === 2 && st.me.username === 'admin' && st.sessions.some(x => x.current) && st.events.some(e => e.event === 'ip_locked') && st.banned.length === 1);
// persisted with tight permissions
const again = createSecurity({ dataDir: dir });
assert.ok(again.sessionOf(`ml_session=${ok.id}`), 'sessions survive a restart');
if (process.platform !== 'win32') assert.strictEqual(fs.statSync(path.join(dir, 'web.json')).mode & 0o777, 0o600);
console.log('security tests passed');
