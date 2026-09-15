'use strict';
// The phone-sized request page (/request). Talks to the same API as the app: POST /api/<channel> with a JSON array of arguments.
(function () {
  const $ = (s) => document.querySelector(s);
  const api = async (ch, ...args) => { const r = await fetch('api/' + ch, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args), credentials: 'same-origin' }); const j = await r.json().catch(() => ({})); if (!r.ok || !j.ok) { const e = new Error(j.error || `HTTP ${r.status}`); e.reason = j.reason; e.status = r.status; throw e; } return j.result; };
  let me = null;
  api('security:me').then(m => { me = m; if (m && m.guest) $('#whoRow').hidden = false; try { const n = localStorage.getItem('medialedger.requester'); if (n) $('#who').value = n; } catch { /* ignore */ } })
    .catch(e => { if (e.status === 401) { $('#err').textContent = 'This page needs guest access switched on, or a sign-in on the full site first.'; $('#err').hidden = false; $('#go').disabled = true; } });
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault(); $('#err').hidden = true; $('#go').disabled = true; $('#go').textContent = 'Sending…';
    try {
      const who = $('#who').value.trim();
      try { if (who) localStorage.setItem('medialedger.requester', who); } catch { /* ignore */ }
      const r = await api('requests:add', { title: $('#title').value, kind: $('#kind').value, year: $('#year').value, note: $('#note').value, requested_by: who || undefined });
      $('#doneText').textContent = `"${r && r.title ? r.title : $('#title').value}" is on the list.`;
      $('#f').hidden = true; $('#done').hidden = false;
    } catch (e) { $('#err').textContent = e.status === 401 ? 'Guest access is off. Sign in on the full site, then come back.' : e.message; $('#err').hidden = false; }
    finally { $('#go').disabled = false; $('#go').textContent = 'Send request'; }
  };
  $('#again').onclick = () => { $('#f').reset(); $('#f').hidden = false; $('#done').hidden = true; $('#title').focus(); };
})();
