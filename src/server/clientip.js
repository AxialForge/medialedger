'use strict';
// Who is really calling. Behind a reverse proxy on the same machine (Caddy, Tailscale Funnel) the socket's
// address is 127.0.0.1 and the visitor is in X-Forwarded-For. That header is only believed when the
// connection itself comes from loopback, so a LAN client talking to the port directly cannot forge it.
//
//   clientIp(req) → '203.0.113.7'
//   viaProxy(req) → true when the address came from the header

const clean = (a) => String(a || '').trim().replace(/^::ffff:/, '').replace(/^\[|\]$/g, '');
const isLoopback = (a) => a === '127.0.0.1' || a === '::1' || a.startsWith('127.');
const looksLikeIp = (a) => /^(\d{1,3}\.){3}\d{1,3}$/.test(a) || (a.includes(':') && /^[0-9a-f:.]+$/i.test(a));

function forwardedFor(req) {
  const h = req.headers && req.headers['x-forwarded-for'];
  if (!h) return null;
  // Each proxy appends the address it saw; with one trusted proxy in front, the last entry is the one it wrote.
  let ip = clean(String(Array.isArray(h) ? h[h.length - 1] : h).split(',').pop());
  const v4port = /^((\d{1,3}\.){3}\d{1,3}):\d+$/.exec(ip); if (v4port) ip = v4port[1];
  return looksLikeIp(ip) ? ip : null;
}

function clientIp(req) {
  const sock = clean(req.socket && req.socket.remoteAddress);
  if (isLoopback(sock)) { const f = forwardedFor(req); if (f) return f; }
  return sock;
}
const viaProxy = (req) => isLoopback(clean(req.socket && req.socket.remoteAddress)) && !!forwardedFor(req);
/** The scheme the visitor used: the proxy says so when it terminated TLS. */
const forwardedProto = (req) => (isLoopback(clean(req.socket && req.socket.remoteAddress)) && /^https$/i.test(String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim())) ? 'https' : null;

module.exports = { clientIp, viaProxy, forwardedProto, isLoopback };
