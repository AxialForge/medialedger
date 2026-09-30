'use strict';
/* The owner's page on the family portal: sign in with the web admin account, then requests, invites, status
   and jobs over the /a/ allow-list. Nothing here can reach settings, scans of new folders, renames or files. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const view = $('#view');
  let me = null;

  async function api(path, body) {
    const r = await fetch('/a/' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { headers: { accept: 'application/json' } });
    let j = null; try { j = await r.json(); } catch { /* not json */ }
    if (r.status === 404 && !j) throw new Error('off');
    if (!j) throw new Error(`The server answered ${r.status}`);
    if (!j.ok) { const e = new Error(j.error || 'Something went wrong'); e.reason = j.reason; throw e; }
    return j.result;
  }
  let toastTimer = null;
  function toast(msg, bad) { let t = $('.toast'); if (!t) { t = document.createElement('div'); document.body.append(t); } t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 4000); }
  const when = (s) => s ? new Date(s).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const gb = (b) => b == null ? '?' : b >= 1e12 ? (b / 1e12).toFixed(2) + ' TB' : (b / 1e9).toFixed(1) + ' GB';

  // ---- sign in ------------------------------------------------------------------------------------
  function signIn(reason) {
    $('#tabs').innerHTML = ''; $('#who').textContent = '';
    if (reason === 'off') { view.innerHTML = '<div class="empty"><h1>Not available</h1><p>Admin sign-in on the portal is switched off. Turn it on under Family portal in MediaLedger.</p></div>'; return; }
    view.innerHTML = `<h1>Admin sign-in</h1><div class="card"><form id="login" autocomplete="on">
      <div class="field"><span>Username</span><input type="text" id="lUser" autocomplete="username" autocapitalize="none" value="admin"></div>
      <div class="field"><span>Password</span><input type="password" id="lPass" autocomplete="current-password"></div>
      <div class="field" id="lCodeBox" hidden><span>Code from your authenticator app</span><input type="text" id="lCode" inputmode="numeric" autocomplete="one-time-code" placeholder="000000"></div>
      <button class="btn primary" id="lGo" type="submit">Sign in</button></form>
      <p class="muted tiny" style="margin-top:10px">This signs in the same account as the MediaLedger web app. Sessions end after twelve hours or an hour idle.</p></div>`;
    $('#login').onsubmit = async (e) => {
      e.preventDefault(); $('#lGo').disabled = true;
      try { await api('login', { username: $('#lUser').value, password: $('#lPass').value, code: $('#lCode').value || undefined }); await boot(); }
      catch (err) { if (err.reason === 'totp') { $('#lCodeBox').hidden = false; $('#lCode').focus(); toast('Enter the 6-digit code'); } else toast(err.message, true); }
      finally { if ($('#lGo')) $('#lGo').disabled = false; }
    };
    ($('#lPass')).focus();
  }

  // ---- Requests -----------------------------------------------------------------------------------
  const KIND = { movie: 'Movie', tv: 'TV show', anime: 'Anime', other: 'Other' };
  const STATUS = { pending: ['waiting', 'warn'], approved: ['approved', 'ok'], added: ['added', 'ok'], rejected: ['declined', 'bad'] };
  async function requests() {
    view.innerHTML = `<h1>Requests</h1><div class="seg" id="rSeg"><button data-s="pending" class="on">Waiting</button><button data-s="approved">Approved</button><button data-s="all">All</button></div><div class="list" id="rList"><div class="empty">Loading…</div></div>`;
    let rows = [], filter = 'pending';
    const draw = () => {
      const list = rows.filter(r => filter === 'all' || r.status === filter);
      $('#rList').innerHTML = list.map(r => { const [label, cls] = STATUS[r.status] || [r.status, '']; return `<div class="row" style="cursor:default" data-id="${r.id}"><div class="t">${esc(r.title)}${r.year ? ` <span class="muted">(${r.year})</span>` : ''} <span class="badge ${cls}">${label}</span></div>
        <div class="s"><span>${esc(KIND[r.kind] || r.kind)}</span><span>${esc((r.by || 'someone').replace(/^family: /, ''))}</span><span>${when(r.created)}</span></div>
        ${r.note ? `<div class="muted tiny" style="margin-top:4px">${esc(r.note)}</div>` : ''}
        <textarea class="reply" placeholder="Reply they will see (optional)">${esc(r.reply || '')}</textarea>
        <div class="acts">${r.status !== 'approved' ? '<button class="btn" data-act="approved">Approve</button>' : ''}${r.status !== 'added' ? '<button class="btn primary" data-act="added">Mark added</button>' : ''}${r.status !== 'rejected' ? '<button class="btn" data-act="rejected">Decline</button>' : ''}${r.status !== 'pending' ? '<button class="btn" data-act="pending">Back to waiting</button>' : ''}<button class="btn" data-act="reply">Save reply</button><button class="btn" data-act="delete">Delete</button></div></div>`; }).join('') || '<div class="empty">Nothing here.</div>';
    };
    const load = async () => { try { rows = await api('requests'); rows.sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || (b.created > a.created ? 1 : -1)); draw(); } catch (e) { if (e.reason === 'login') return signIn(); $('#rList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; } };
    $('#rSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; filter = b.dataset.s; [...$('#rSeg').children].forEach(x => x.classList.toggle('on', x === b)); draw(); };
    $('#rList').onclick = async (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const row = b.closest('.row'), id = Number(row.dataset.id), act = b.dataset.act, reply = $('textarea', row).value;
      try {
        if (act === 'delete') { if (!confirm('Delete this request?')) return; await api('requests/delete', { id }); }
        else if (act === 'reply') await api('requests/update', { id, reply });
        else await api('requests/update', { id, status: act, reply });
        toast(act === 'delete' ? 'Deleted' : act === 'reply' ? 'Reply saved' : 'Updated'); load();
      } catch (err) { if (err.reason === 'login') return signIn(); toast(err.message, true); }
    };
    load();
  }

  // ---- Invites ------------------------------------------------------------------------------------
  const linkBox = (title, url) => url ? `<div class="card"><div class="muted tiny">${esc(title)}</div><div class="qrbox">${window.qrSvg ? window.qrSvg(url, { size: 168, label: title }) : ''}</div><div class="linkrow"><input type="text" readonly value="${esc(url)}" onclick="this.select()"><button class="btn copy" data-url="${esc(url)}">Copy</button></div></div>` : '';
  async function invites() {
    view.innerHTML = `<h1>Invites</h1>
      <div class="card"><div class="field"><span>Name</span><input type="text" id="iName" maxlength="40" placeholder="e.g. Mom" autocomplete="off"></div>
      <div class="two"><div class="field"><span>Expires</span><select id="iDays"><option value="0">never</option><option value="7">7 days</option><option value="30">30 days</option><option value="365">1 year</option></select></div><div class="field"><span>May</span><div><label class="chk"><input type="checkbox" id="iBrowse" checked> browse</label><label class="chk"><input type="checkbox" id="iTonight" checked> tonight</label><label class="chk"><input type="checkbox" id="iRequest" checked> request</label></div></div></div>
      <button class="btn primary" id="iAdd">Create invite</button></div><div id="iNew"></div><h2>Existing</h2><div class="list" id="iList"><div class="empty">Loading…</div></div>`;
    const showLinks = (r, verb) => { $('#iNew').innerHTML = `<h2>${esc(verb)} for ${esc(r.invite.name)}</h2><p class="muted tiny">Send one of these once; the QR code opens the same link. Anyone with it can use the invite.</p>${linkBox('Away from home', r.links.public)}${linkBox('At home', r.links.home)}`; window.scrollTo({ top: 0, behavior: 'smooth' }); };
    const load = async () => {
      let rows; try { rows = await api('invites'); } catch (e) { if (e.reason === 'login') return signIn(); $('#iList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
      $('#iList').innerHTML = rows.map(i => `<div class="row" style="cursor:default" data-id="${esc(i.id)}"><div class="t">${esc(i.name)} <span class="badge ${i.active ? 'ok' : 'bad'}">${i.active ? 'active' : i.revoked ? 'revoked' : 'expired'}</span></div>
        <div class="s"><span>${i.devices} device${i.devices === 1 ? '' : 's'}</span><span>${i.requests || 0} request${i.requests === 1 ? '' : 's'}</span><span>${i.lastSeen ? 'seen ' + when(i.lastSeen) : 'never opened'}</span>${i.expires ? `<span>until ${when(i.expires).split(',')[0]}</span>` : ''}</div>
        <div class="muted tiny" style="margin-top:4px">${['browse', 'tonight', 'request'].filter(p => i.perms && i.perms[p]).join(' · ') || 'nothing'}</div>
        <div class="acts"><button class="btn" data-act="renew">New link</button>${i.active ? '<button class="btn" data-act="revoke">Revoke</button>' : ''}<button class="btn" data-act="delete">Delete</button></div></div>`).join('') || '<div class="empty">No invites yet.</div>';
    };
    $('#iAdd').onclick = async () => {
      $('#iAdd').disabled = true;
      try { const r = await api('invites', { name: $('#iName').value, days: Number($('#iDays').value), perms: { browse: $('#iBrowse').checked, tonight: $('#iTonight').checked, request: $('#iRequest').checked } }); $('#iName').value = ''; showLinks(r, 'Invite'); load(); }
      catch (e) { if (e.reason === 'login') return signIn(); toast(e.message, true); } finally { $('#iAdd').disabled = false; }
    };
    view.onclick = async (e) => {
      const c = e.target.closest('button.copy'); if (c) { try { await navigator.clipboard.writeText(c.dataset.url); toast('Copied'); } catch { toast('Select the link and copy it', true); } return; }
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const row = b.closest('.row'), id = row.dataset.id, name = $('.t', row).firstChild.textContent.trim(), act = b.dataset.act;
      try {
        if (act === 'renew') { if (!confirm(`Make a new link for ${name}? Their current devices will need it.`)) return; showLinks(await api('invites/renew', { id }), 'New link'); }
        if (act === 'revoke') { if (!confirm(`Revoke ${name}'s invite?`)) return; await api('invites/revoke', { id }); toast('Revoked'); }
        if (act === 'delete') { if (!confirm(`Delete ${name}'s invite?`)) return; await api('invites/delete', { id }); toast('Deleted'); }
        load();
      } catch (err) { if (err.reason === 'login') return signIn(); toast(err.message, true); }
    };
    load();
  }

  // ---- Status and jobs ----------------------------------------------------------------------------
  async function status() {
    view.innerHTML = '<h1>Status</h1><div id="sBox"><div class="empty">Loading…</div></div>';
    const check = (c, label) => c ? `<div class="row" style="cursor:default"><div class="t">${esc(label)} <span class="badge ${c.ok ? 'ok' : 'bad'}">${c.ok ? 'working' : 'not reachable'}</span></div><div class="s"><span>${esc(c.url)}</span><span>${c.ok ? c.ms + ' ms' : esc(c.error || '')}</span><span>${when(c.at)}</span></div></div>` : '';
    const load = async () => {
      let s; try { s = await api('status'); } catch (e) { if (e.reason === 'login') return signIn(); $('#sBox').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
      $('#sBox').innerHTML = `<div class="stat"><div class="card"><b>${(s.files || 0).toLocaleString()}</b><span class="muted tiny">files · ${gb(s.bytes)}</span></div><div class="card"><b>${gb(s.free_bytes)}</b><span class="muted tiny">free${s.months_left != null ? ` · about ${s.months_left} months` : ''}</span></div><div class="card"><b>${s.pending_requests || 0}</b><span class="muted tiny">requests waiting</span></div><div class="card"><b>${s.missing_episodes || 0}</b><span class="muted tiny">missing episodes</span></div><div class="card"><b>${s.airing_this_week || 0}</b><span class="muted tiny">airing this week</span></div><div class="card"><b>${s.scanning ? 'now' : s.last_scan ? esc(s.last_scan.status) : '–'}</b><span class="muted tiny">${s.scanning ? 'scanning' : s.last_scan ? 'last scan ' + when(s.last_scan.finished) : 'no scan yet'}</span></div></div>
        <h2>Addresses</h2><div class="list">${check(s.checks.public, 'Away from home') + check(s.checks.home, 'At home') || '<div class="empty">No address is set.</div>'}</div>
        <h2>Jobs</h2><div class="list" id="jobs">${s.jobs.map(j => `<div class="row ${j.overdue ? 'warn' : ''}" style="cursor:default"><div class="t">${esc(j.label)} ${j.running ? '<span class="badge ok">running</span>' : j.overdue ? '<span class="badge bad">overdue</span>' : j.enabled ? '' : '<span class="badge">off</span>'}</div><div class="s"><span>${esc(j.when || '')}</span>${j.last ? `<span>last ${when(j.last)}</span>` : ''}${j.next ? `<span>next ${when(j.next)}</span>` : ''}</div>${j.lastNote ? `<div class="muted tiny" style="margin-top:4px">${esc(j.lastNote)}</div>` : ''}${j.overdueWhy ? `<div class="note tiny">${esc(j.overdueWhy)}</div>` : ''}${j.remote ? `<div class="acts"><button class="btn" data-job="${esc(j.id)}" ${j.running ? 'disabled' : ''}>Run now</button></div>` : ''}</div>`).join('')}</div>
        <h2>Portal options</h2><div class="card"><label class="chk"><input type="checkbox" id="oRatings" ${me.showRatings ? 'checked' : ''}> Show my star ratings to family</label><div class="field"><span>Check the addresses every (minutes, 0 = off)</span><input type="number" id="oEvery" min="0" max="1440" value="${me.checkMinutes != null ? me.checkMinutes : 15}"></div><button class="btn" id="oSave">Save</button></div>
        <p class="muted tiny">The portal's own switches (on, port, admin sign-in) stay at home on purpose.</p>`;
      $('#jobs').onclick = async (e) => { const b = e.target.closest('button[data-job]'); if (!b) return; b.disabled = true; try { const r = await api('jobs/run', { id: b.dataset.job }); toast(r.message || 'Started'); setTimeout(load, 1500); } catch (err) { if (err.reason === 'login') return signIn(); toast(err.message, true); b.disabled = false; } };
      $('#oSave').onclick = async () => { try { const r = await api('options', { showRatings: $('#oRatings').checked, checkMinutes: Number($('#oEvery').value) || 0 }); me.showRatings = r.showRatings; me.checkMinutes = r.checkMinutes; toast('Saved'); } catch (err) { if (err.reason === 'login') return signIn(); toast(err.message, true); } };
    };
    load();
  }

  // ---- shell ----------------------------------------------------------------------------------------
  const TABS = [['requests', '✚', 'Requests'], ['invites', '✉', 'Invites'], ['status', '◔', 'Status']];
  function route() {
    if (!me) return;
    let tab = location.hash.replace(/^#/, '') || 'requests';
    if (tab === 'menu') { $('#tabs').innerHTML = ''; view.innerHTML = `<p><a href="#requests">‹ Back</a></p><h1>Account</h1><div class="card"><p class="muted">Signed in as <b>${esc(me.user)}</b>${me.twoFactor ? ' with two-factor codes' : ''}. ${me.sessions} admin session${me.sessions === 1 ? '' : 's'} open on the portal.</p>${me.twoFactor ? '' : '<div class="note tiny">Two-factor codes are off. Turn them on under Security in MediaLedger: this page is reachable from the internet.</div>'}<button class="btn" id="mOut" style="margin-top:8px">Sign out</button></div><p class="muted tiny">MediaLedger ${esc(me.version || '')} · portal admin</p>`; $('#mOut').onclick = async () => { try { await api('logout', {}); } catch { /* gone */ } me = null; signIn(); }; return; }
    if (!TABS.some(t => t[0] === tab)) tab = 'requests';
    $('#tabs').innerHTML = TABS.map(([id, icon, label]) => `<a href="#${id}" class="${id === tab ? 'on' : ''}"><i>${icon}</i>${label}</a>`).join('');
    view.onclick = null; window.scrollTo(0, 0);
    if (tab === 'requests') return requests(); if (tab === 'invites') return invites(); return status();
  }
  async function boot() { try { me = await api('me'); $('#who').textContent = me.user; route(); } catch (e) { me = null; signIn(e.message === 'off' ? 'off' : e.reason); } }
  window.addEventListener('hashchange', route);
  $('#menu').onclick = () => { if (me) location.hash = '#menu'; };
  boot();
})();
