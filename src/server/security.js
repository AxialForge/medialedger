'use strict';
// Security for the web shell: password, sessions, lockout, LAN-only guard,
// two-factor codes, re-authentication for dangerous actions, and an audit log.
//
// State lives in <data>/web.json (mode 0600), deliberately apart from
// settings.json which the UI can replace wholesale. Events append to
// <data>/security.log as JSON lines and the last 300 are kept in memory for
// the Security tab.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const totp = require('./totp');

const SESSION_DAYS = 30;
const REAUTH_MINUTES = 5;
const LOCK_FAILS = 8;         // failures per IP …
const LOCK_WINDOW_MS = 15 * 60000; // … within this window …
const LOCK_MS = 15 * 60000;   // … ban the IP for this long
const MIN_PASSWORD = 8;

/** Private / local address? Loopback, RFC 1918, link-local, CGNAT, IPv6 ULA + link-local. */
function isPrivateIp(ip) {
  if (!ip) return false;
  let a = String(ip);
  if (a.startsWith('::ffff:')) a = a.slice(7);
  if (a === '::1' || a === '127.0.0.1') return true;
  if (net.isIPv4(a)) {
    const [x, y] = a.split('.').map(Number);
    return x === 10 || x === 127 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31) || (x === 169 && y === 254) || (x === 100 && y >= 64 && y <= 127);
  }
  if (net.isIPv6(a)) { const l = a.toLowerCase(); return l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80'); }
  return false;
}

const hashPassword = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const checkHash = (pw, stored) => { if (!stored) return false; const [salt, hex] = stored.split(':'); const a = Buffer.from(hex, 'hex'), b = crypto.scryptSync(pw, salt, 32); return a.length === b.length && crypto.timingSafeEqual(a, b); };

function createSecurity({ dataDir, log = () => {} }) {
  const webFile = path.join(dataDir, 'web.json');
  const auditFile = path.join(dataDir, 'security.log');
  const DEFAULTS = { passwordHash: null, lanOnly: true, idleMinutes: 0, totp: { enabled: false, secret: null, pending: null }, sessions: {} };
  let state = { ...DEFAULTS };
  try { state = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(webFile, 'utf8')) }; state.totp = { ...DEFAULTS.totp, ...(state.totp || {}) }; state.sessions = state.sessions || {}; for (const [k, v] of Object.entries(state.sessions)) if (!v || !v.lastSeen) delete state.sessions[k]; /* pre-0.8 sessions lack lastSeen */ } catch { /* first run */ }
  const save = () => { fs.writeFileSync(webFile, JSON.stringify(state, null, 2), { mode: 0o600 }); try { fs.chmodSync(webFile, 0o600); } catch { /* windows */ } };

  // ---- audit ----
  const recent = [];
  try { for (const l of fs.readFileSync(auditFile, 'utf8').trim().split('\n').slice(-300)) { try { recent.push(JSON.parse(l)); } catch { /* skip */ } } } catch { /* none yet */ }
  function audit(event, ip, detail = '') {
    const e = { ts: new Date().toISOString(), event, ip: ip || null, detail };
    recent.push(e); if (recent.length > 300) recent.shift();
    try { fs.appendFileSync(auditFile, JSON.stringify(e) + '\n', { mode: 0o600 }); } catch { /* ignore */ }
    log(`security: ${event} ${ip || ''} ${detail}`.trim());
  }

  // ---- lockout ----
  const fails = new Map(); // ip -> [ts]
  const bans = new Map();  // ip -> until
  const failed = (ip) => { const now = Date.now(); const l = (fails.get(ip) || []).filter(t => now - t < LOCK_WINDOW_MS); l.push(now); fails.set(ip, l); if (l.length >= LOCK_FAILS) { bans.set(ip, now + LOCK_MS); fails.delete(ip); audit('ip_locked', ip, `${LOCK_FAILS} failures in ${LOCK_WINDOW_MS / 60000} min`); } };
  const isBanned = (ip) => { const u = bans.get(ip); if (u && u > Date.now()) return true; if (u) bans.delete(ip); return false; };

  // ---- sessions ----
  const prune = () => { const now = Date.now(); for (const [k, s] of Object.entries(state.sessions)) if (s.expires < now || (state.idleMinutes && s.lastSeen && now - s.lastSeen > state.idleMinutes * 60000)) delete state.sessions[k]; };
  function newSession(ip, ua) {
    prune();
    const id = crypto.randomBytes(32).toString('hex');
    state.sessions[id] = { created: Date.now(), expires: Date.now() + SESSION_DAYS * 86400000, lastSeen: Date.now(), ip, ua: String(ua || '').slice(0, 160), reauthAt: Date.now() };
    save();
    return id;
  }
  const cookieFor = (id, secure) => `ml_session=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
  const clearCookie = 'ml_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
  function sessionOf(cookieHeader) {
    const m = /(?:^|;\s*)ml_session=([a-f0-9]{64})/.exec(cookieHeader || '');
    if (!m) return null;
    const s = state.sessions[m[1]];
    if (!s) return null;
    const now = Date.now();
    if (s.expires < now || (state.idleMinutes && now - s.lastSeen > state.idleMinutes * 60000)) { delete state.sessions[m[1]]; save(); return null; }
    if (now - s.lastSeen > 60000) { s.lastSeen = now; save(); } // throttle disk writes
    return { id: m[1], ...s };
  }
  const shortId = (id) => id.slice(0, 8);

  // ---- login ----
  function login(ip, ua, { password, code }) {
    if (isBanned(ip)) { audit('login_blocked', ip, 'locked out'); return { ok: false, reason: 'locked' }; }
    if (!state.passwordHash) return { ok: false, reason: 'nopassword' };
    if (!checkHash(String(password || ''), state.passwordHash)) { failed(ip); audit('login_failed', ip, 'wrong password'); return { ok: false, reason: 'password' }; }
    if (state.totp.enabled) {
      if (!code) return { ok: false, reason: 'totp' }; // password right, now ask for the code
      if (!totp.verify(state.totp.secret, code)) { failed(ip); audit('login_failed', ip, 'wrong 2FA code'); return { ok: false, reason: 'totp_bad' }; }
    }
    fails.delete(ip);
    const id = newSession(ip, ua);
    audit('login', ip, state.totp.enabled ? 'password + 2FA' : 'password');
    return { ok: true, id };
  }
  function logout(id, ip) { delete state.sessions[id]; save(); audit('logout', ip); }

  // ---- password ----
  function setPassword(pw) { if (!pw || pw.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters`); state.passwordHash = hashPassword(pw); state.sessions = {}; save(); }
  function changePassword(current, next, keepId, ip) {
    if (!checkHash(String(current || ''), state.passwordHash)) { failed(ip); audit('password_change_failed', ip); throw new Error('Current password is wrong'); }
    if (!next || next.length < MIN_PASSWORD) throw new Error(`New password must be at least ${MIN_PASSWORD} characters`);
    state.passwordHash = hashPassword(next);
    for (const k of Object.keys(state.sessions)) if (k !== keepId) delete state.sessions[k];
    save(); audit('password_changed', ip, 'other sessions signed out');
  }

  // ---- re-authentication for dangerous actions ----
  const needsReauth = (s) => !s.reauthAt || Date.now() - s.reauthAt > REAUTH_MINUTES * 60000;
  function reauth(s, password, ip) {
    if (isBanned(ip)) return false;
    if (!checkHash(String(password || ''), state.passwordHash)) { failed(ip); audit('reauth_failed', ip); return false; }
    state.sessions[s.id].reauthAt = Date.now(); save(); audit('reauth', ip); return true;
  }

  // ---- two-factor ----
  function totpSetup(account) { const secret = totp.newSecret(); state.totp.pending = secret; save(); return { secret, url: totp.otpauthUrl(secret, account) }; }
  function totpEnable(code, ip) {
    if (!state.totp.pending) throw new Error('Start 2FA setup first');
    if (!totp.verify(state.totp.pending, code)) throw new Error('That code did not match; check the phone clock and try again');
    state.totp = { enabled: true, secret: state.totp.pending, pending: null }; save(); audit('2fa_enabled', ip); return true;
  }
  function totpDisable(password, ip) {
    if (!checkHash(String(password || ''), state.passwordHash)) { failed(ip); throw new Error('Password is wrong'); }
    state.totp = { enabled: false, secret: null, pending: null }; save(); audit('2fa_disabled', ip); return true;
  }

  // ---- settings ----
  function setOptions({ lanOnly, idleMinutes }, ip) {
    if (typeof lanOnly === 'boolean') state.lanOnly = lanOnly;
    if (idleMinutes != null) state.idleMinutes = Math.max(0, Math.min(10080, Number(idleMinutes) || 0));
    save(); audit('options_changed', ip, `lanOnly=${state.lanOnly} idleMinutes=${state.idleMinutes}`);
  }
  const isAllowedIp = (ip) => !state.lanOnly || isPrivateIp(ip);

  // ---- status for the Security tab ----
  function status(currentId, extra = {}) {
    prune();
    return {
      passwordSet: !!state.passwordHash, totpEnabled: state.totp.enabled, totpPending: !!state.totp.pending, lanOnly: state.lanOnly, idleMinutes: state.idleMinutes,
      sessions: Object.entries(state.sessions).map(([id, s]) => ({ id: shortId(id), current: id === currentId, created: s.created, lastSeen: s.lastSeen, expires: s.expires, ip: s.ip, ua: s.ua })).sort((a, b) => b.lastSeen - a.lastSeen),
      events: recent.slice(-100).reverse(),
      banned: [...bans.entries()].filter(([, u]) => u > Date.now()).map(([ip, until]) => ({ ip, until })),
      failedLogins24h: recent.filter(e => e.event === 'login_failed' && Date.now() - Date.parse(e.ts) < 86400000).length,
      limits: { lockFails: LOCK_FAILS, lockMinutes: LOCK_MS / 60000, reauthMinutes: REAUTH_MINUTES, sessionDays: SESSION_DAYS, minPassword: MIN_PASSWORD },
      ...extra,
    };
  }
  function revoke(short, currentId, ip) { for (const k of Object.keys(state.sessions)) if (shortId(k) === short && k !== currentId) { delete state.sessions[k]; save(); audit('session_revoked', ip, short); return true; } return false; }
  function revokeOthers(currentId, ip) { let n = 0; for (const k of Object.keys(state.sessions)) if (k !== currentId) { delete state.sessions[k]; n++; } save(); audit('sessions_revoked', ip, `${n} other session(s)`); return n; }

  return { get state() { return state; }, audit, isBanned, isAllowedIp, login, logout, sessionOf, cookieFor, clearCookie, setPassword, changePassword, needsReauth, reauth, totpSetup, totpEnable, totpDisable, setOptions, status, revoke, revokeOthers, hasPassword: () => !!state.passwordHash };
}

module.exports = { createSecurity, isPrivateIp, hashPassword, checkHash, MIN_PASSWORD };
