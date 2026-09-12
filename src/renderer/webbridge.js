// Browser bridge: builds window.ledger from bridge-shape.js over HTTP.
//
// Requests: POST /api/<channel> with a JSON array of arguments; the reply is
// { ok: true, result } or { ok: false, error }. Events: one EventSource on
// /api/events carrying { channel, payload } messages. A 401 means the session
// is missing or expired, so a login form is shown and the call retried after.
//
// Does nothing when preload.js already installed window.ledger (desktop app).
(function () {
  if (window.ledger || !window.LEDGER_SHAPE) return;

  let loginPromise = null;
  function askLogin() {
    if (loginPromise) return loginPromise;
    loginPromise = new Promise((resolve) => {
      const box = document.createElement('div');
      box.id = 'webLogin';
      box.innerHTML = '<form class="card" id="webLoginForm"><h2>MediaLedger</h2><p class="muted">Enter the password set on the server.</p>' +
        '<input type="password" id="webLoginPw" autocomplete="current-password" autofocus placeholder="Password">' +
        '<div class="inline" style="margin-top:10px"><button class="primary" type="submit">Sign in</button><span class="bad small" id="webLoginErr"></span></div></form>';
      Object.assign(box.style, { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'grid', placeItems: 'center', zIndex: 9999 });
      document.body.append(box);
      const form = box.querySelector('#webLoginForm');
      form.style.minWidth = '320px';
      form.onsubmit = async (e) => {
        e.preventDefault();
        const r = await fetch('api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: box.querySelector('#webLoginPw').value }) });
        if (r.ok) { box.remove(); loginPromise = null; resolve(); }
        else { box.querySelector('#webLoginErr').textContent = r.status === 429 ? 'Too many attempts; wait a minute.' : 'Wrong password.'; }
      };
    });
    return loginPromise;
  }

  async function call(ch, args) {
    for (;;) {
      const r = await fetch('api/' + encodeURIComponent(ch), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
      if (r.status === 401) { await askLogin(); continue; }
      let body;
      try { body = await r.json(); } catch { throw new Error(`Server error ${r.status}`); }
      if (!body.ok) throw new Error(body.error || `Server error ${r.status}`);
      if (listeners.size) ensureEvents(); // open the event stream only once a call has proven the session
      return body.result;
    }
  }

  const listeners = new Map();
  let es = null;
  function ensureEvents() {
    if (es) return;
    es = new EventSource('api/events');
    es.onmessage = (m) => { try { const { channel, payload } = JSON.parse(m.data); for (const fn of listeners.get(channel) || []) fn(payload); } catch { /* ignore */ } };
    es.onerror = () => { /* EventSource reconnects on its own; a 401 shows up on the next request */ };
  }
  const listen = (ch) => (fn) => { if (!listeners.has(ch)) listeners.set(ch, new Set()); listeners.get(ch).add(fn); return () => listeners.get(ch).delete(fn); };
  const invoke = (ch) => (...args) => call(ch, args);

  function build(node) {
    if (typeof node === 'string') return node.startsWith('!') ? listen(node.slice(1)) : invoke(node);
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = build(v);
    return out;
  }
  window.ledger = build(window.LEDGER_SHAPE);
  window.ledger.isWeb = true;
})();
