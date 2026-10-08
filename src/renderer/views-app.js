'use strict';
/* The application pages: Settings (with its groups), System, Security, Family portal, Log, About, the folder browser, network shares and the welcome guide.
   One of six plain scripts that make up the renderer; they share the page scope. See CLAUDE.md, "Renderer files". */


// The web server cannot update itself from the page; it can say when a newer release exists. Cached for six hours.
async function webUpdateInfo() {
  try { const c = JSON.parse(sessionStorage.getItem('medialedger.upd') || 'null'); if (c && Date.now() - c.t < 6 * 3600000) return c.v; } catch { /* ignore */ }
  const v = await L.update.check();
  try { sessionStorage.setItem('medialedger.upd', JSON.stringify({ t: Date.now(), v })); } catch { /* ignore */ }
  return v;
}

// ---- Family portal: invites and the switch for the second, read-only front door ----
views.family = async () => {
  const st = await L.portal.status();
  if (!st.available) { view.innerHTML = `<h1>Family portal</h1><div class="card"><p>The family portal is part of the web server. It gives people you invite a small read-only site: browse the libraries, pick something for tonight, and send media requests. Nothing on it can change the library.</p><p class="muted">Open this page on the Raspberry Pi's site to set it up.</p></div>`; return; }
  const active = st.invites.filter(i => i.active);
  const checkTile = (title, c, url) => !url ? tile('', title, 'not set', 'add it under Addresses') : !c ? tile('', title, 'not checked yet', esc(url.replace(/^https?:\/\//, ''))) : tile(c.ok ? 'okt' : (c.fails >= 2 ? 'badt' : 'warnt'), title, c.ok ? 'working' : (c.fails >= 2 ? 'not reachable' : 'one failed check'), `${c.ok ? `${c.ms} ms` : `<span title="${esc(c.error)}">${esc(c.error)}</span>`} · checked ${fmtAgo(c.at)}${c.since && c.since !== c.at ? ` · ${c.ok ? 'up' : 'down'} since ${fmtAgo(c.since).replace(' ago', '')}` : ''}${c.certDays != null ? ` · certificate ${c.certDays} days left` : ''}${c.verified === false ? ' · certificate not verified' : ''}`);
  const hasAddress = !!(st.publicUrl || st.homeUrl);
  const linkBox = (title, url, note) => url ? `<div><div class="qrbox">${qrSvg(url, { size: 168, label: title })}</div><div class="muted tiny" style="margin:6px 0 2px">${esc(title)}${note ? ' · ' + esc(note) : ''}</div><div class="inline"><input type="text" readonly value="${esc(url)}" onclick="this.select()"><button class="small copyLink" data-url="${esc(url)}">Copy</button></div></div>` : '';
  view.innerHTML = `<h1>Family portal</h1>
    <p class="lead">A second front door for people you invite: they can browse the libraries, use What to watch tonight, and send media requests. It serves its own small site on its own port. Sign-in, settings, scans, renames, file paths, watch history and the adult library do not exist there.</p>
    <div class="tiles compact">${tile(st.enabled ? (st.listening ? 'okt' : 'badt') : '', 'Portal', st.enabled ? (st.listening ? 'on' : 'not running') : 'off', st.listening ? `listening on ${esc(st.listening)}` : esc(st.error || 'switched off'))}${tile('', 'Active invites', active.length, `${st.invites.length - active.length} revoked or expired`)}${tile('', 'Requests from family', st.invites.reduce((a, i) => a + (i.requests || 0), 0))}${tile('', 'Last visit', st.lastVisit ? fmtAgo(st.lastVisit.at) : 'none yet', st.lastVisit ? `${esc(st.lastVisit.name)} · ${esc(st.lastVisit.ip)}` : 'since the server started')}${checkTile('Public address', st.checks && st.checks.public, st.publicUrl)}${checkTile('Home address', st.checks && st.checks.home, st.homeUrl)}</div>
    ${[['Public address', st.checks && st.checks.public], ['Home address', st.checks && st.checks.home]].filter(([, c]) => c && !c.ok).map(([n, c]) => `<div class="warnbox" style="margin:8px 0"><b>${n} is not answering:</b> ${esc(c.error)}.</div>`).join('')}
    <div class="toolbar" style="margin-top:4px"><button class="small" id="fvCheck" ${st.enabled && hasAddress ? '' : 'disabled'}>Check the addresses now</button><span class="muted tiny">${st.enabled ? (st.checkMinutes ? `The server opens each address the way a visitor would, every ${st.checkMinutes} minutes${st.checks && st.checks.next ? `; next ${fmtDate(st.checks.next)}` : ''}. Two failures in a row send a notification.` : 'Automatic checks are off.') : 'Switch the portal on to check its addresses.'}</span></div>
    <h2>Invites</h2>
    <div class="card"><div class="inline" style="flex-wrap:wrap;gap:8px"><input type="text" id="fvName" placeholder="Name, e.g. Mom" maxlength="40" style="width:200px"><select id="fvDays" class="small"><option value="0">never expires</option><option value="7">7 days</option><option value="30">30 days</option><option value="365">1 year</option></select><label class="inline small"><input type="checkbox" id="fvBrowse" checked> browse</label><label class="inline small"><input type="checkbox" id="fvTonight" checked> tonight</label><label class="inline small"><input type="checkbox" id="fvRequest" checked> requests</label><button class="primary" id="fvAdd" ${hasAddress ? '' : 'disabled title="Set a public or home address first"'}>Create invite</button></div>${hasAddress ? '' : '<div class="warnbox" style="margin-top:10px">Set a <b>public</b> or <b>home address</b> below and press Save before creating invites: the link and the QR code are built from it.</div>'}<div id="fvNew"></div></div>
    <div id="fvTable"></div>
    <h2>Addresses</h2>
    <div class="field"><label>Public address</label><input type="text" id="fvPublic" value="${esc(st.publicUrl)}" placeholder="https://aether.your-tailnet.ts.net"><div class="hint">What family outside your home opens. With Tailscale Funnel it is the address <span class="mono">tailscale funnel status</span> prints. Invite links and QR codes use it.</div></div>
    <div class="field"><label>Home address</label><input type="text" id="fvHome" value="${esc(st.homeUrl)}" placeholder="https://family.home"><div class="hint">Optional, for people on your own network: a name Caddy serves, pointing at the portal port.</div></div>
    <h2>Server</h2>
    <div class="field"><label>Portal</label><div class="inline"><label class="inline"><input type="checkbox" id="fvOn" ${st.enabled ? 'checked' : ''}> on</label> port <input type="number" id="fvPort" min="1024" max="65535" value="${st.port}" style="width:90px"> reachable from <select id="fvBind" class="small"><option value="127.0.0.1" ${st.bind === '127.0.0.1' ? 'selected' : ''}>this machine only (Caddy, Tailscale)</option><option value="0.0.0.0" ${st.bind === '0.0.0.0' ? 'selected' : ''}>the whole network</option></select></div><div class="hint">"This machine only" is right when Caddy or Tailscale Funnel sits in front, which is the intended setup. Switching the portal off closes the door for everyone at once; invites are kept.</div></div>
    <div class="field"><label>Check the addresses</label><div class="inline">every <input type="number" id="fvEvery" min="0" max="1440" value="${st.checkMinutes != null ? st.checkMinutes : 15}" style="width:80px"> minutes (0 = off)</div><div class="hint">Also listed under Settings → Schedules. Turn on "family portal not reachable" under Notifications to be told.</div></div>
    <div class="field"><label>Show my star ratings</label><div class="inline"><input type="checkbox" id="fvRatings" ${st.showRatings ? 'checked' : ''}> <span class="muted">Your notes are never shown.</span></div></div>
    <div class="field"><label>Admin sign-in from outside</label><div class="inline"><input type="checkbox" id="fvAdmin" ${st.admin ? 'checked' : ''}> <span class="muted">Lets you sign in with your admin account at <span class="mono">${esc((st.publicUrl || st.homeUrl || 'the portal address') + '/admin')}</span> to handle requests, invites, jobs and the status card without being on the home network.</span></div><div class="hint">Only admin accounts get in, with the same lockout and two-factor rules as this app; sessions last twelve hours. The switch itself, the port and the address can only be changed here.${st.totp ? '' : ' <b>Two-factor codes are off:</b> turn them on under Security before switching this on.'}${st.adminSessions ? ` ${st.adminSessions} admin session${st.adminSessions === 1 ? '' : 's'} open right now; switching this off ends them.` : ''}</div></div>
    <div class="field"><label></label><div class="inline"><button class="primary" id="fvSave">Save</button></div></div>`;
  const showLinks = (r, what) => { $('#fvNew').innerHTML = `<div class="warnbox" style="margin-top:10px"><b>${esc(what)} for ${esc(r.invite.name)}.</b> This is the only time the link is shown: send it now. Anyone holding it gets in as ${esc(r.invite.name)}.${!r.links.public && !r.links.home ? ' Set a public or home address below first, then press New link.' : ''}</div><div class="invite-links">${linkBox('Away from home', r.links.public, 'public address')}${linkBox('At home', r.links.home, 'home address')}</div>`; document.querySelectorAll('.copyLink').forEach(b => { b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.url); toast('Link copied'); } catch { toast('Select the text and copy it by hand', true); } }; }); };
  const t = makeTable(st.invites, [
    { key: 'name', label: 'Name', render: r => `<b>${esc(r.name)}</b>` },
    { key: 'active', label: 'State', render: r => r.revoked ? '<span class="badge bad">revoked</span>' : r.active ? '<span class="badge ok">active</span>' : '<span class="badge warn">expired</span>' },
    { key: 'perms', label: 'May', render: r => ['browse', 'tonight', 'request'].filter(p => r.perms[p]).join(', ') },
    { key: 'lastSeen', label: 'Last seen', render: r => r.lastSeen ? fmtAgo(r.lastSeen) : '<span class="muted">never</span>' },
    { key: 'devices', label: 'Devices', num: true }, { key: 'requests', label: 'Requests', num: true },
    { key: 'expires', label: 'Expires', render: r => r.expires ? fmtDate(r.expires) : '<span class="muted">never</span>' },
    { key: 'id', label: '', render: r => `<button class="small fvRenew" data-id="${r.id}" title="Make a new link; the old one and its devices stop working">New link</button> ${r.revoked ? `<button class="small danger fvDel" data-id="${r.id}">Delete</button>` : `<button class="small danger fvRevoke" data-id="${r.id}">Revoke</button>`}` },
  ], { short: true, defaultSort: { key: 'name', asc: true } });
  $('#fvTable').append(t.node);
  $('#fvAdd').onclick = async () => { try { const r = await L.portal.invite({ name: $('#fvName').value, days: Number($('#fvDays').value), perms: { browse: $('#fvBrowse').checked, tonight: $('#fvTonight').checked, request: $('#fvRequest').checked } }); await views.family(); showLinks(r, 'Invite created'); } catch (e) { toast(e.message, true); } };
  t.node.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return; const id = b.dataset.id; const inv = st.invites.find(i => i.id === id);
    try {
      if (b.classList.contains('fvRenew')) { if (!confirm(`Make a new link for ${inv.name}? The old link and every device using it stop working.`)) return; const r = await L.portal.renew(id); await views.family(); showLinks(r, 'New link'); }
      else if (b.classList.contains('fvRevoke')) { if (!confirm(`Revoke ${inv.name}'s access?`)) return; await L.portal.revoke(id); toast('Revoked'); views.family(); }
      else if (b.classList.contains('fvDel')) { await L.portal.remove(id); views.family(); }
    } catch (err) { toast(err.message, true); }
  });
  $('#fvCheck').onclick = async () => { $('#fvCheck').disabled = true; $('#fvCheck').textContent = 'Checking…'; try { await L.portal.check(); } catch (e) { toast(e.message, true); } views.family(); };
  $('#fvSave').onclick = async () => { try { await L.portal.set({ enabled: $('#fvOn').checked, port: Number($('#fvPort').value), bind: $('#fvBind').value, publicUrl: $('#fvPublic').value, homeUrl: $('#fvHome').value, showRatings: $('#fvRatings').checked, admin: $('#fvAdmin').checked, checkMinutes: Number($('#fvEvery').value) || 0 }); toast('Saved'); setTimeout(() => views.family(), 600); } catch (e) { toast(e.message, true); } };
};

// ---- Log: the tail of medialedger.log with a filter, so diagnosing the server does not need SSH ----
let logTimer = null;
views.log = async () => {
  view.innerHTML = `<h1>Log</h1>
    <p class="lead">What MediaLedger has been doing: scans, Plex syncs, backups, migrations, failures. Newest at the bottom.</p>
    <div class="toolbar"><input type="search" id="lgQ" placeholder="Filter, e.g. plex, backup, migrate…"><select id="lgLevel" class="small"><option value="">everything</option><option value="error">problems only</option></select><select id="lgN" class="small"><option>300</option><option>1000</option><option>2000</option></select><label class="inline small"><input type="checkbox" id="lgAuto" checked> refresh every 5 s</label><button class="small" id="lgCopy">Copy</button><span class="muted tiny" id="lgInfo"></span></div>
    <pre class="logview" id="lgBox">Loading…</pre>`;
  const load = async () => {
    if (currentView !== 'log') { clearInterval(logTimer); return; }
    const box = $('#lgBox'); if (!box) return;
    try {
      const r = await L.logTail({ lines: Number($('#lgN').value), q: $('#lgQ').value.trim(), level: $('#lgLevel').value });
      const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
      box.innerHTML = r.lines.map(l => `<span class="${/error|fail|denied|rejected|could not/i.test(l) ? 'bad' : /warn|overdue|skipped/i.test(l) ? 'warn' : ''}">${esc(l)}</span>`).join('\n') || '<span class="muted">Nothing matches.</span>';
      $('#lgInfo').textContent = `${r.lines.length} lines · ${fmtBytes(r.size)} · ${r.file}`;
      if (atBottom) box.scrollTop = box.scrollHeight;
    } catch (e) { box.textContent = e.message; }
  };
  await load(); $('#lgBox').scrollTop = $('#lgBox').scrollHeight;
  let deb = null; $('#lgQ').oninput = () => { clearTimeout(deb); deb = setTimeout(load, 250); };
  $('#lgLevel').onchange = load; $('#lgN').onchange = load;
  $('#lgCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#lgBox').innerText); toast('Copied'); } catch { toast('Select the text and copy it by hand', true); } };
  clearInterval(logTimer); logTimer = setInterval(() => { if ($('#lgAuto') && $('#lgAuto').checked) load(); }, 5000);
};


const SETTINGS_GROUPS = [
  ['Library', 'Where the files are and how they are read', ['Library roots', 'Network shares', 'Scanning', 'ffprobe', 'Folder watch', 'Adult content']],
  ['Episodes and quality', 'What counts as complete and as good enough', ['Expected episodes', 'Quality thresholds', 'Posters']],
  ['Automation', 'What runs by itself and what it tells you', ['Schedules', 'Notifications', 'Updates']],
  ['Connections', 'Other programs MediaLedger talks to', ['Plex', 'CSV export']],
  ['Renaming', 'Changes to file names on the share', ['Renaming']],
  ['Backup and data', 'The database, its backups and restore', ['Data']],
  ['Appearance', 'How this device shows MediaLedger', ['Appearance']],
];
function groupSettings(form) {
  const saveRow = $('#save', form).closest('.inline');
  const secs = []; let cur = null;
  for (const n of [...form.childNodes]) {
    if (n === saveRow) break;
    if (n.nodeType === 1 && n.tagName === 'H2') { cur = el('<section class="ssec"></section>'); cur.dataset.title = n.childNodes[0].textContent.trim(); secs.push(cur); }
    if (cur) cur.append(n);
  }
  const groups = SETTINGS_GROUPS.map(([name, about, titles]) => ({ name, about, secs: secs.filter(s => titles.some(t => s.dataset.title.startsWith(t))) }));
  const rest = secs.filter(s => !groups.some(g => g.secs.includes(s))); if (rest.length) groups.push({ name: 'Other', about: '', secs: rest });
  const tabs = el(`<div class="stabs"><button data-g="">All</button>${groups.map(g => `<button data-g="${esc(g.name)}" title="${esc(g.about)}">${esc(g.name)}</button>`).join('')}<span class="grow"></span><input type="search" placeholder="Find a setting…" id="setFind"></div>`);
  form.insertBefore(tabs, saveRow);
  for (const g of groups) { const box = el(`<div class="sgroup" data-g="${esc(g.name)}"><div class="sgroup-title">${esc(g.name)}<span>${esc(g.about)}</span></div></div>`); box.append(...g.secs); form.insertBefore(box, saveRow); }
  let on = ''; try { on = localStorage.getItem('medialedger.settingsTab') || ''; } catch { /* private mode */ }
  if (!groups.some(g => g.name === on)) on = '';
  const paint = () => {
    const q = $('#setFind', form).value.trim().toLowerCase();
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', !q && b.dataset.g === on));
    form.querySelectorAll('.sgroup').forEach(box => {
      let any = false;
      box.querySelectorAll('.ssec').forEach(s => { const hit = !q || s.textContent.toLowerCase().includes(q) || [...s.querySelectorAll('input,select')].some(i => String(i.value || '').toLowerCase().includes(q)); s.hidden = !hit; any = any || hit; });
      box.hidden = q ? !any : !!on && box.dataset.g !== on;
    });
  };
  tabs.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; on = b.dataset.g; $('#setFind', form).value = ''; try { localStorage.setItem('medialedger.settingsTab', on); } catch { /* private mode */ } paint(); view.scrollTo({ top: 0 }); };
  $('#setFind', form).oninput = paint;
  paint();
}
views.settings = async () => {
  const s = await L.settings.get();
  const info = await L.appInfo();
  view.innerHTML = `
    <h1>Settings</h1>
    <div class="form">
      <h2>Appearance</h2>
      <div class="field"><label>Colour theme</label><select id="themeSel">${THEMES.map(([k, v]) => `<option value="${k}" ${currentTheme() === k ? 'selected' : ''}>${v}</option>`).join('')}</select><div class="hint">Applies at once and is remembered in this browser only, so every device and person can pick their own.</div></div>

      <h2>Library roots <span class="right"><button class="small" id="checkRoots">Check reachability</button></span></h2>
      <table class="roots-table"><thead><tr><th>On</th><th>Label</th><th>Path (UNC or local)</th><th>Type</th><th>Status</th><th></th></tr></thead><tbody id="roots"></tbody></table>
      <div class="hint" id="rootDiag" hidden style="margin-top:6px"></div>
      <div class="inline" style="margin-top:8px"><button class="small" id="addRoot">Add root</button></div>

      ${L.isWeb ? '<h2>Network shares</h2><p class="muted" style="margin-top:0">The file servers this server reads from. Connect one here, then add folders inside it as library roots above.</p><div id="sharesBox"><p class="muted">Loading…</p></div>' : ''}

      <h2>Scanning</h2>
      <div class="field"><label>Multi-threaded listing</label><div class="inline"><input type="checkbox" id="mt" ${s.multiThreaded ? 'checked' : ''}> <span class="muted small">use</span> <input type="number" id="threads" min="0" max="32" value="${s.scanThreads}" style="width:70px"> <span class="muted small">worker threads (0 = auto, this PC has ${info.cpus} cores)</span></div><div class="hint">Deals the show folders out to worker threads so the SMB directory listing overlaps instead of queueing. Turn off if the NAS struggles.</div></div>
      <div class="field"><label>Parallel ffprobe processes</label><input type="number" id="conc" min="1" max="32" value="${s.probeConcurrency}"><div class="hint">How many files are probed at once. 8 is a good default over gigabit SMB; raise it if the NAS keeps up.</div></div>
      <div class="field"><label>Re-probe unchanged files</label><input type="checkbox" id="reprobe" ${s.reprobeUnchanged ? 'checked' : ''}><div class="hint">Normally a file is only probed when it is new or its size/date changed.</div></div>
      <div class="field"><label>Video extensions</label><input type="text" id="vext" value="${esc(s.videoExtensions.join(', '))}"></div>
      <div class="field"><label>Subtitle sidecar extensions</label><input type="text" id="sext" value="${esc(s.subtitleExtensions.join(', '))}"></div>
      <div class="field"><label>Ignore patterns</label><input type="text" id="ignore" value="${esc(s.ignorePatterns.join(', '))}"></div>

      <h2>ffprobe (ffmpeg)</h2>
      <div class="field"><label>Status</label><div class="status-line" id="ffStatus">${info.ffprobe ? `<span class="ok">Found</span> · <span class="mono">${esc(info.ffprobe)}</span><br><span class="muted">${esc(info.ffprobeVersion || '')}</span>` : '<span class="bad">Not found.</span> MediaLedger can index files without it, but cannot read resolution, length, languages or subtitles.'}</div></div>
      <div class="field"><label>Path override</label><div class="inline"><input type="text" id="ffprobePath" style="flex:1" placeholder="auto-detect" value="${esc(s.ffprobePath)}"><button class="small" id="pickFf">Browse…</button></div><div class="hint">Leave empty to auto-detect from <span class="mono">C:\\ffmpeg</span>, winget, scoop, PATH, or MediaLedger's own download.</div></div>
      <div class="field"><label>Download</label><div class="inline"><button class="small" id="dlFf">${info.ffprobe ? 'Download latest ffmpeg build anyway' : 'Download ffmpeg now'}</button><span class="muted small" id="dlMsg"></span></div><div class="hint">Fetches the latest static Windows build from BtbN's FFmpeg-Builds on GitHub (about 100 MB) into MediaLedger's data folder and points the path at it. Runs automatically on first launch when nothing is found.</div></div>
      <div class="progress" id="dlProg" hidden><div class="bar"><div id="dlBar"></div></div></div>

      <h2>Expected episodes</h2>
      <div class="field"><label>Look up episode counts</label><input type="checkbox" id="metaOn" ${s.metadata.enabled ? 'checked' : ''}><div class="hint">TV series are matched on <b>TVmaze</b>, anime on <b>AniList</b>. Both are free and need no account or key. Runs in the background after each scan for series not yet looked up; airing series are re-checked every <input type="number" id="metaDays" min="1" value="${s.metadata.refreshDays}" style="width:60px"> days.</div></div>

      <h2>Folder watch</h2>
      <div class="field"><label>Check roots every</label><div class="inline"><input type="number" id="rootCheckMin" min="0" max="1440" value="${s.rootCheckMinutes ?? 5}" style="width:80px"> <span class="muted">minutes (0 = off)</span></div><div class="hint">Background reachability check of every enabled root. A red counter appears on Settings and a message pops up the moment a share drops out, and again when it is back. Scans already skip unreachable roots without marking anything missing.</div></div>
      <div class="field"><label>Watch roots for changes</label><div class="inline"><input type="checkbox" id="watchOn" ${s.watchFolders ? 'checked' : ''}> <span class="muted small">scan after changes settle for</span> <input type="number" id="watchSettle" min="15" value="${s.watchSettleSeconds}" style="width:70px"> <span class="muted small">seconds</span></div><div class="hint">Uses Windows change notifications on each root (works on UNC shares). A download that is still copying keeps pushing the timer back, so the scan starts once the folder is quiet. Status: ${info.watch.enabled ? `<span class="ok">watching ${info.watch.roots.length} root(s)</span>` : 'off'}.</div></div>

      <h2>Renaming <span class="badge warn">writes to the share</span></h2>
      <div class="field"><label>Enable rename tool</label><input type="checkbox" id="renOn" ${s.renaming.enabled ? 'checked' : ''}><div class="hint">Unlocks the <b>Rename files</b> page, which proposes Plex-standard names and renames only the files you tick, in place, never overwriting, through the same batch engine as the movie tool (pre-flight, verification, journal, undo). Off by default because it is the one feature that modifies the NAS.</div></div>

      <h2>Adult content</h2>
      <div class="field"><label>Include in CSV exports</label><input type="checkbox" id="adultCsv" ${s.adult.exportCsv ? 'checked' : ''}><div class="hint">Off by default: adult roots are left out of every CSV. In the app they are hidden until the "Show adult content" switch in the sidebar is on; the switch resets each launch.</div></div>
      <div class="field"><label>When unsure, treat as</label><select id="adultDefault"><option value="anime" ${s.adult.defaultSubtype === 'anime' ? 'selected' : ''}>Anime</option><option value="tv" ${s.adult.defaultSubtype === 'tv' ? 'selected' : ''}>TV</option></select><div class="hint">Adult roots classify each file as anime, TV or movie from its folder and name. Files that match none of the patterns fall back to this.</div></div>

      <h2>Quality thresholds</h2>
      <div class="field"><label>Minimum bitrate (kbps)</label><div class="inline" id="thr">${Object.entries(s.quality.minKbps).map(([k, v]) => `<label class="inline small">${esc(k)} <input type="number" min="0" data-res="${esc(k)}" value="${v}" style="width:74px"></label>`).join('')}</div><div class="hint">Files below these values for their resolution are listed under Quality → Low-bitrate files.</div></div>

      <h2>CSV export</h2>
      <div class="field"><label>Output folder</label><div class="inline"><input type="text" id="csvDir" style="flex:1" placeholder="${esc(info.exportDir)}" value="${esc(s.csvOutputDir)}"><button class="small" id="pickCsv">Browse…</button><button class="small" id="openCsv">Open</button></div></div>
      <div class="field"><label>Export after every scan</label><input type="checkbox" id="autoExport" ${s.autoExportAfterScan ? 'checked' : ''}></div>

      <h2>Schedules</h2>
      <div class="field"><label>All timed jobs</label><div id="jobsBox" class="muted small">Loading…</div><div class="hint">Everything MediaLedger does on its own, with the last and next run. <b>Run now</b> starts a job straight away. Change the timing below and press Save.</div></div>
      <div class="field"><label>Plex sync</label><div class="inline">every <input type="number" id="plexEvery" min="0" step="0.5" value="${s.plex && s.plex.everyHours != null ? s.plex.everyHours : 6}" style="width:70px"> hours (0 = only after scans)</div><div class="hint">Pulls ratings, watched state and the play history for every account. A timer keeps the Watched tab current on days without a scan; 6 hours is a sensible value.</div></div>
      <div class="field"><label>Backup</label><div class="inline">daily at <input type="time" id="bkTime" value="${esc((s.backup && s.backup.time) || '03:30')}"> keep <input type="number" id="bkKeep" min="1" max="60" value="${(s.backup && s.backup.keep) || 7}" style="width:60px"> newest</div><div class="hint">Turn it on and choose the folder under Data.</div></div>
      <div class="field"><label>Daily snapshot</label><div class="inline">at <input type="time" id="snapTime" value="${esc((s.snapshot && s.snapshot.time) || '03:05')}"> if no scan has taken one that day</div></div>
      <div class="field"><label>Daily summary</label><div class="inline">at <input type="time" id="nfTime" value="${esc((s.notify && s.notify.dailyTime) || '08:00')}"></div><div class="hint">Sent by webhook or e-mail as set under Notifications.</div></div>
      <div class="field"><label>In-app scan timer</label><div class="inline"><input type="checkbox" id="inApp" ${s.schedule.inAppEnabled ? 'checked' : ''}> every <input type="number" id="inAppHours" min="0.25" step="0.25" value="${s.schedule.inAppIntervalHours}" style="width:80px"> hours</div><div class="hint">Runs only while MediaLedger is open. Next run: <span id="nextInApp">—</span></div></div>
      <div class="field"><label>Windows Task Scheduler</label><div class="inline">daily at <input type="time" id="taskTime" value="${esc(s.schedule.taskTime)}"> <button class="small" id="installTask">Install / update task</button> <button class="small" id="removeTask">Remove task</button> <button class="small" id="runTask">Run task now</button></div><div class="hint">Runs even when the app is closed: launches MediaLedger with <span class="mono">--scan</span>, scans, exports and exits. If the app is already open, the open window runs the scan instead.</div></div>
      <div class="field"><label></label><div class="status-line" id="taskStatus">Checking task…</div></div>

      <h2>Data</h2>
      <div class="field"><label>Database</label><div class="status-line"><span class="mono">${esc(info.dbFile)}</span><br><span class="muted">${fmtBytes(info.db.size)} · schema v${info.db.version} · ${info.db.files.toLocaleString()} files · ${info.db.scans} scans · ${info.db.changes.toLocaleString()} changes · ${info.db.overrides} fixes · ${info.db.backups} backups</span></div><div class="hint">Everything MediaLedger knows lives in this one file plus <span class="mono">settings.json</span> next to it. Both sit in your user profile, outside the install folder, so closing the app, reinstalling, or updating never loses them. A backup copy is taken automatically before any schema upgrade.</div></div>
      <div class="field"><label></label><div class="inline"><button class="small" id="backupNow">Back up database now</button><button class="small" id="openBackups">Open backups folder</button><button class="small" id="openData">Open data folder</button><button class="small" id="openLog">Open log</button></div></div>
      <div class="field"><label>Nightly backup to a folder</label><div class="inline"><input type="checkbox" id="bkOn" ${s.backup && s.backup.enabled ? 'checked' : ''}> <input type="text" id="bkDir" style="flex:1" placeholder="${L.isWeb ? '/mnt/media/Backups/MediaLedger' : '\\\\192.168.1.204\\Apocrypha_Media_Pool\\Backups\\MediaLedger'}" value="${esc((s.backup && s.backup.dir) || '')}"><button class="small" id="pickBk">Browse…</button> <button class="small" id="bkNow">Back up there now</button> <button class="small" id="bkRestore">Restore…</button></div><div class="hint">Copies the database (every fix, rating, tag, match and the change log), the settings and, on the web server, the accounts file to that folder once a day, dated, keeping the newest N sets. <b>Restore…</b> brings one back. Put it on the NAS so a dead SD card or PC costs nothing. ${s.backup && s.backup.lastRun ? `Last: ${esc(fmtDate(s.backup.lastRun))} → <span class="mono">${esc(s.backup.lastFile || '')}</span>` : 'Never run yet.'}${s.backup && s.backup.lastError ? ` <span class="bad">Last error: ${esc(s.backup.lastError)}</span>` : ''}</div></div>

      <h2>Posters</h2>
      <div class="field"><label>Posters</label><div class="inline"><label class="inline"><input type="checkbox" id="poOn" ${!s.posters || s.posters.enabled !== false ? 'checked' : ''}> fetch posters</label> <label class="inline"><input type="checkbox" id="poOnline" ${!s.posters || s.posters.online !== false ? 'checked' : ''}> also from AniList and TVmaze</label> width <select id="poWidth" class="small">${[200, 300, 400].map(w => `<option value="${w}" ${((s.posters && s.posters.width) || 300) === w ? 'selected' : ''}>${w} px</option>`).join('')}</select></div><div class="hint">One small image per title, from Plex first (resized by Plex itself), then AniList or TVmaze for series Plex does not have. New titles are fetched after each scan and Plex sync. Adult titles never get one.</div></div>
      <div class="field"><label>Posters folder</label><div class="inline"><input type="text" id="poDir" style="flex:1" placeholder="${L.isWeb ? '/mnt/medialedger/Posters' : '\\\\192.168.1.204\\Apocrypha_Main_Pool\\Service_Pool\\MediaLedger\\Posters'}" value="${esc((s.posters && s.posters.dir) || '')}"><button class="small" id="pickPo">Browse…</button></div><div class="hint">Empty keeps them next to the database. A folder on the NAS lets the desktop app and the web server share one set; about 100 MB for a library this size. Changing the folder does not move files: press Fetch again afterwards.</div></div>
      <div class="field"><label></label><div><div class="status-line" id="poStatus">Checking…</div><div class="inline" style="margin-top:6px"><button class="small" id="poRun">Fetch missing posters</button><button class="small" id="poAll">Fetch all again</button><button class="small danger" id="poClear">Delete all posters</button></div></div></div>

      <h2>Updates</h2>
      <div class="field"><label>Automatic updates</label><input type="checkbox" id="updOn" ${s.updates.enabled ? 'checked' : ''}><div class="hint">Installed builds check GitHub Releases on launch and every 6 hours, download silently and apply on the next restart. Your database and settings are untouched by updates.</div></div>
      <div class="field"><label>GitHub token</label><input type="password" id="ghToken" value="${esc(s.githubToken)}" placeholder="not needed – the repository is public"><div class="hint">Leave empty. Only needed if the AxialForge/medialedger repository is ever made private again (fine-grained token, Contents: read). Takes effect on the next Check for updates.</div></div>

      <h2>Notifications</h2>
      <div class="field"><label>Webhook URL</label><input type="text" id="nfHook" value="${esc((s.notify && s.notify.webhookUrl) || '')}" placeholder="https://homeassistant.local:8123/api/webhook/medialedger"><div class="hint">MediaLedger POSTs a small JSON body (<span class="mono">event, title, message, …</span>) here for every event below. Works with a Home Assistant webhook trigger, ntfy (<span class="mono">https://ntfy.sh/your-topic</span>), Discord or anything that accepts a POST.</div></div>
      <div class="field"><label>E-mail</label><div class="inline" style="flex-wrap:wrap;gap:6px"><label class="inline"><input type="checkbox" id="nfMailOn" ${s.notify && s.notify.email && s.notify.email.enabled ? 'checked' : ''}> on</label><input type="text" id="nfHost" placeholder="smtp.gmail.com" value="${esc((s.notify && s.notify.email && s.notify.email.host) || '')}" style="width:170px"><input type="number" id="nfPort" placeholder="587" value="${(s.notify && s.notify.email && s.notify.email.port) || 587}" style="width:80px"><label class="inline"><input type="checkbox" id="nfSecure" ${s.notify && s.notify.email && s.notify.email.secure ? 'checked' : ''}> TLS on 465</label><input type="text" id="nfUser" placeholder="user" value="${esc((s.notify && s.notify.email && s.notify.email.user) || '')}" style="width:160px" autocomplete="off"><input type="password" id="nfPass" placeholder="password / app password" value="${esc((s.notify && s.notify.email && s.notify.email.pass) || '')}" style="width:160px" autocomplete="new-password"><input type="text" id="nfTo" placeholder="to@example.com" value="${esc((s.notify && s.notify.email && s.notify.email.to) || '')}" style="width:180px"></div><div class="hint">Any ordinary mailbox. Gmail: host smtp.gmail.com, port 587, your address as user and an <b>app password</b> (Google account → Security → App passwords). The password stays in settings.json on this machine.</div></div>
      <div class="field"><label>Send for</label><div class="inline" style="flex-wrap:wrap;gap:10px">${[['request', 'new media request'], ['dailySummary', 'daily summary'], ['backupFailed', 'backup failed'], ['jobStale', 'a scheduled job is overdue'], ['portalDown', 'family portal not reachable'], ['airing', 'episodes airing (in the summary)']].map(([k, l]) => `<label class="inline"><input type="checkbox" class="nfEv" data-ev="${k}" ${!s.notify || !s.notify.events || s.notify.events[k] !== false ? 'checked' : ''}> ${l}</label>`).join('')}<button class="small" id="nfTest">Send a test</button><span class="muted tiny" id="nfMsg"></span></div></div>
      <div class="field"><label>Home Assistant status</label><div id="statusBox" class="muted small">Loading…</div><div class="hint">A read-only JSON summary (files, free space, pending requests, missing episodes, what airs this week, last scan) at a URL with its own key. In Home Assistant add a <b>RESTful sensor</b> with that URL and pick values with <span class="mono">value_template</span>, e.g. <span class="mono">{{ value_json.pending_requests }}</span>.</div></div>

      <h2>Plex</h2>
      <div class="field"><label>Plex URL</label><input type="text" id="plexUrl" value="${esc(s.plex.baseUrl)}"><div class="hint">Your Plex Media Server on the LAN, e.g. <span class="mono">http://192.168.1.204:32400</span> if Plex runs on the NAS.</div></div>
      <div class="field"><label>Plex token</label><div class="inline"><input type="password" id="plexToken" style="flex:1" value="${esc(s.plex.token)}" autocomplete="off"><button class="small" id="plexTest">Test</button></div><div class="hint" id="plexMsg">In Plex Web: any item → ⋯ → Get Info → View XML; copy the value after <span class="mono">X-Plex-Token=</span> in that page's address. Stored only in settings.json on this PC.</div></div>
      <div class="field"><label>Paste the XML address</label><input type="text" id="plexXmlUrl" placeholder="http://192.168.1.204:32400/library/metadata/1234?…&X-Plex-Token=…" autocomplete="off"><div class="hint">The easy way to get the token. In Plex Web open any movie or episode, click <b>⋯</b> → <b>Get Info</b> → <b>View XML</b>. A new tab opens: copy its whole address from the browser's address bar and paste it here. The token (and the server address, when the page came from your LAN) are filled in above; the pasted text itself is not kept. Then press <b>Test</b> and <b>Save settings</b>.</div></div>
      <div class="field"><label>Sync after every scan</label><input type="checkbox" id="plexOn" ${s.plex.enabled ? 'checked' : ''}><div class="hint">Pulls every movie and show section, links each Plex item to a file by path, and stores Plex's title, year, ids, your Plex rating, audience rating and watched state. Read-only against Plex.</div></div>
      <div class="field"><label>Path mapping</label><div id="plexMap"></div><div class="hint">How Plex's file paths translate to yours. Derived automatically from the first match; edit if Plex runs elsewhere.</div></div>
      <div class="field"><label></label><div class="inline"><button class="small" id="plexSync">Sync now</button><span class="muted small" id="plexSyncMsg"></span></div><div class="hint">Syncs run after each scan when enabled above, and on a timer: <b>${(s.plex && s.plex.everyHours) ? `every ${s.plex.everyHours} hours` : 'timer off'}</b>. Set the interval under <a href="#settings" id="toSchedules">Schedules</a> further up this page.</div></div>
      <div class="field"><label></label><div class="status-line" id="plexStatus">Loading…</div></div>
      <div class="field"><label>Webhook (Plex Pass)</label><div id="plexHook" class="muted small">Loading…</div><div class="hint">Plex calls this server the moment something is added, watched or rated: additions queue a scan two minutes later, watched and rated update the linked file at once. In Plex Web: Settings → Webhooks → Add webhook, paste the URL. LAN-only still applies and the key in the URL is the credential.</div></div>

      <div class="inline" style="margin-top:18px"><button class="primary" id="save">Save settings</button></div>
    </div>`;
  groupSettings($('.form', view));
  if ($('#sharesBox')) paintShares($('#sharesBox')).catch(e => { $('#sharesBox').innerHTML = `<p class="muted">${esc(e.message)}</p>`; });

  const rootsBody = $('#roots');
  const rootRow = (r) => el(`<tr><td><input type="checkbox" class="r-on" ${r.enabled ? 'checked' : ''}></td><td><input type="text" class="r-label" value="${esc(r.label)}" style="width:110px"></td><td><div class="inline"><input type="text" class="r-path" value="${esc(r.path)}" style="flex:1"><button class="small r-pick" title="${L.isWeb ? 'Browse folders on the server' : 'Browse…'}">…</button></div></td><td><select class="r-type">${['tv', 'anime', 'movie', 'web', 'adult'].map(t => `<option value="${t}" ${r.type === t ? 'selected' : ''}>${t === 'adult' ? 'Adult (auto-detect anime / TV / movie)' : t === 'web' ? 'Web videos' : typeName(t)}</option>`).join('')}</select></td><td class="r-status muted tiny">…</td><td><button class="small r-del">✕</button></td></tr>`);
  const pickFolder = async (start) => L.isWeb ? browseServerFolder(start) : L.pickFolder(start);
  const addRow = (r) => { const tr = rootRow(r); tr.dataset.id = r.id || ''; rootsBody.append(tr); $('.r-del', tr).onclick = () => tr.remove(); $('.r-pick', tr).onclick = async () => { const p = await pickFolder($('.r-path', tr).value); if (p) { $('.r-path', tr).value = p; checkRoots(); } }; $('.r-path', tr).onchange = () => checkRoots(); };
  s.roots.forEach(addRow);
  $('#addRoot').onclick = () => addRow({ id: '', label: 'New', path: '', type: 'tv', enabled: true });
  // Live reachability per root: checks what is typed in the form, not only what is saved.
  const STATUS = { ok: ['ok', 'Reachable'], unmounted: ['bad', 'Share not mounted'], nas_down: ['bad', 'NAS not answering'], unreachable: ['bad', 'Not reachable'] };
  async function checkRoots() {
    const rows = [...rootsBody.querySelectorAll('tr')];
    rows.forEach(tr => { $('.r-status', tr).innerHTML = '<span class="muted">checking…</span>'; });
    const res = await L.roots.check(rows.map(tr => ({ id: tr.dataset.id, label: $('.r-label', tr).value, path: $('.r-path', tr).value.trim() })));
    rows.forEach((tr, i) => { const r = res[i]; if (!r) return; const [cls, text] = STATUS[r.status] || STATUS.unreachable; $('.r-status', tr).innerHTML = `<span class="${cls}">● ${text}</span><br><span class="muted">${esc(r.detail || '')}</span>`; $('.r-status', tr).title = r.path; });
    const first = res.find(r => r.status !== 'ok');
    const diag = $('#rootDiag');
    if (!first) { diag.hidden = true; return; }
    diag.hidden = false;
    const lines = [];
    if (first.nas) lines.push(`NAS ${esc(first.nas.host)} port 445: <b class="${first.nas.reachable ? 'ok' : 'bad'}">${first.nas.reachable ? 'answers' : 'no answer'}</b>${first.nas.reachable ? '' : ' — the network path between this machine and the NAS is broken (cable, switch port, VLAN, NAS off)'}`);
    if (first.mount) lines.push(`Mount ${esc(first.mount.point)} ← ${esc(first.mount.source)}: ${first.mount.inFstab ? 'in fstab' : 'not in fstab'}, <b class="${first.mount.mounted ? 'ok' : 'bad'}">${first.mount.mounted ? 'mounted' : first.mount.automount ? 'automount armed but not mounted' : 'not mounted'}</b>`);
    if (first.status === 'unmounted' && first.nas && first.nas.reachable) lines.push('The NAS answers, the share is just not mounted. On the Pi: <span class="mono">sudo mount ' + esc(first.mount ? first.mount.point : '/mnt/media') + '</span> (or reboot; the automount retries on access).');
    if (first.status === 'nas_down') lines.push('Fix the network first; the mount will come back on its own once the NAS answers. Check from the Pi: <span class="mono">ping ' + esc(first.nas.host) + '</span>');
    if (!first.mount && !first.nas && !first.exists) lines.push('The path does not exist on this machine. Check spelling and case (Linux paths are case-sensitive).');
    diag.innerHTML = `<b>Diagnostics for ${esc(first.label || first.path)}</b><br>${lines.join('<br>')}`;
  }
  $('#checkRoots').onclick = checkRoots;
  checkRoots();

  $('#pickFf').onclick = async () => { const p = await L.pickFile(); if (p) $('#ffprobePath').value = p; };
  $('#pickCsv').onclick = async () => { const p = await L.pickFolder($('#csvDir').value); if (p) $('#csvDir').value = p; };
  $('#openCsv').onclick = () => L.openPath($('#csvDir').value || info.exportDir);
  $('#openData').onclick = () => L.openPath(info.userData);
  $('#openLog').onclick = () => L.openPath(info.logFile);
  $('#openBackups').onclick = () => L.openPath(info.dbFile + '.backups');
  $('#backupNow').onclick = async () => { const p = await L.db.backup(); toast('Backup written: ' + p); };
  $('#nfTest').onclick = async () => { $('#nfMsg').textContent = 'Saving and sending…'; try { await L.settings.set({ notify: collect().notify }); await L.notifyTest(); $('#nfMsg').textContent = 'Sent. Check the webhook target / mailbox.'; } catch (e) { $('#nfMsg').textContent = ''; toast(e.message, true); } };
  const refreshStatusBox = async () => { const box = $('#statusBox'); if (!box) return; let st; try { st = await L.status.info(); } catch (e) { box.textContent = e.message; return; } if (!st.available) { box.textContent = 'The status URL is served by the web server (the Pi); the desktop app has none.'; return; } box.innerHTML = `<span class="mono" style="user-select:all;word-break:break-all">${esc(st.url)}</span> <button class="small" id="stRotate">New key</button>`; $('#stRotate').onclick = async () => { if (confirm('Generate a new key? Update Home Assistant afterwards.')) { await L.status.rotate(); refreshStatusBox(); } }; };
  refreshStatusBox();
  $('#pickBk').onclick = async () => { const p = await pickFolder($('#bkDir').value); if (p) $('#bkDir').value = p; };
  $('#bkRestore').onclick = async () => {
    const dir = $('#bkDir').value.trim(); if (!dir) return toast('Set the backup folder first', true);
    let sets; try { sets = await L.restoreList(dir); } catch (e) { return toast(e.message, true); }
    if (!sets.length) return toast('No backups found in that folder', true);
    const card = openModal(`<h2>Restore from a backup</h2><p class="muted">The current database is moved aside, not deleted, into a <span class="mono">pre-restore-…</span> folder next to it. MediaLedger restarts to put the backup in place.</p>
      <div class="field"><label>Backup</label><select id="rsSet">${sets.map(x => `<option value="${x.stamp}">${esc(fmtDate(x.when))} · ${fmtBytes(x.bytes)}${x.files.settings ? ' · settings' : ''}${x.files.web ? ' · accounts' : ''}</option>`).join('')}</select></div>
      <div class="field"><label>Also restore</label><div class="inline"><label class="inline"><input type="checkbox" id="rsSettings"> settings</label> <label class="inline"><input type="checkbox" id="rsWeb"> web accounts and 2FA</label></div><div class="hint">Leave both off to bring back only the library data. Restoring accounts signs everyone out and brings back the passwords from that day.</div></div>
      <div class="inline" style="justify-content:flex-end"><button id="rsCancel">Cancel</button><button class="danger" id="rsGo">Restore and restart</button></div>`);
    $('#rsCancel', card).onclick = closeModal;
    $('#rsGo', card).onclick = async () => {
      if (!confirm('Replace the current database with this backup?')) return;
      $('#rsGo', card).disabled = true; $('#rsGo', card).textContent = 'Checking the backup…';
      try { const r = await L.restoreStage($('#rsSet', card).value, { settings: $('#rsSettings', card).checked, web: $('#rsWeb', card).checked }, dir); closeModal(); toast(`Backup verified (${r.files.toLocaleString()} files, schema v${r.version}). Restarting…`); setTimeout(() => location.reload(), 6000); }
      catch (e) { $('#rsGo', card).disabled = false; $('#rsGo', card).textContent = 'Restore and restart'; toast(e.message, true); }
    };
  };
  $('#bkNow').onclick = async () => { try { const p = await L.backupTo($('#bkDir').value.trim(), Number($('#bkKeep').value) || 7); toast('Backup copied to ' + p); } catch (e) { toast(e.message, true); } };
  $('#dlFf').onclick = () => downloadFfmpeg($('#dlMsg'), $('#dlProg'), $('#dlBar'), () => views.settings());

  const collect = () => {
    const roots = [...rootsBody.querySelectorAll('tr')].map((tr, i) => {
      const label = $('.r-label', tr).value.trim(); const p = $('.r-path', tr).value.trim();
      return { id: tr.dataset.id || (label.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'root') + '-' + (i + 1), label, path: p, type: $('.r-type', tr).value, enabled: $('.r-on', tr).checked };
    }).filter(r => r.path);
    const list = v => v.split(/[,\s]+/).map(x => x.trim().replace(/^\./, '')).filter(Boolean);
    return {
      roots, ffprobePath: $('#ffprobePath').value.trim(), probeConcurrency: Number($('#conc').value) || 8, reprobeUnchanged: $('#reprobe').checked,
      multiThreaded: $('#mt').checked, scanThreads: Number($('#threads').value) || 0,
      videoExtensions: list($('#vext').value), subtitleExtensions: list($('#sext').value), ignorePatterns: $('#ignore').value.split(',').map(x => x.trim()).filter(Boolean),
      csvOutputDir: $('#csvDir').value.trim(), autoExportAfterScan: $('#autoExport').checked,
      backup: { ...(s.backup || {}), enabled: $('#bkOn').checked, dir: $('#bkDir').value.trim(), time: $('#bkTime').value || '03:30', keep: Number($('#bkKeep').value) || 7 },
      notify: { ...(s.notify || {}), webhookUrl: $('#nfHook').value.trim(), email: { enabled: $('#nfMailOn').checked, host: $('#nfHost').value.trim(), port: Number($('#nfPort').value) || 587, secure: $('#nfSecure').checked, user: $('#nfUser').value.trim(), pass: $('#nfPass').value, from: $('#nfUser').value.trim(), to: $('#nfTo').value.trim() }, events: Object.fromEntries([...document.querySelectorAll('.nfEv')].map(c => [c.dataset.ev, c.checked])), dailyTime: $('#nfTime').value || '08:00' },
      schedule: { ...s.schedule, inAppEnabled: $('#inApp').checked, inAppIntervalHours: Number($('#inAppHours').value) || 24, taskTime: $('#taskTime').value || '03:00' },
      snapshot: { ...(s.snapshot || {}), time: $('#snapTime').value || '03:05' },
      posters: { ...(s.posters || {}), enabled: $('#poOn').checked, online: $('#poOnline').checked, width: Number($('#poWidth').value) || 300, dir: $('#poDir').value.trim() },
      updates: { enabled: $('#updOn').checked }, githubToken: $('#ghToken').value.trim(),
      metadata: { ...s.metadata, enabled: $('#metaOn').checked, refreshDays: Number($('#metaDays').value) || 14 },
      watchFolders: $('#watchOn').checked, rootCheckMinutes: Number($('#rootCheckMin').value) || 0, watchSettleSeconds: Number($('#watchSettle').value) || 90,
      renaming: { ...s.renaming, enabled: $('#renOn').checked },
      adult: { exportCsv: $('#adultCsv').checked, defaultSubtype: $('#adultDefault').value },
      quality: { minKbps: Object.fromEntries([...document.querySelectorAll('#thr input[data-res]')].map(i => [i.dataset.res, Number(i.value) || 0])) },
      plex: { enabled: $('#plexOn').checked, everyHours: Math.max(0, Number($('#plexEvery').value) || 0), baseUrl: $('#plexUrl').value.trim(), token: $('#plexToken').value.trim(), pathMap: [...document.querySelectorAll('#plexMap .inline')].map(r => ({ plex: $('.pm-plex', r).value.trim(), local: $('.pm-local', r).value.trim() })).filter(m => m.plex && m.local) },
      ui: s.ui,
    };
  };
  $('#save').onclick = async () => { await L.settings.replace(collect()); toast('Settings saved'); refreshTask(); refreshJobs(); };
  const refreshPosters = async () => { const box = $('#poStatus'); if (!box) return; try { const p = await L.posters.status(); box.innerHTML = `${p.job.running ? `<span class="badge warn">running</span> ${esc(p.job.message)}` : `<b>${p.have.toLocaleString()}</b> of ${p.titles.toLocaleString()} titles have a poster (${fmtBytes(p.bytes)})${p.none ? ` · ${p.none.toLocaleString()} without art` : ''}${p.errors ? ` · <span class="bad">${p.errors.toLocaleString()} failed</span>` : ''}${p.bySource.length ? ' · ' + p.bySource.map(x => `${esc(x.source)} ${x.n.toLocaleString()}`).join(', ') : ''}`}<br><span class="mono tiny">${esc(p.dir)}</span> ${p.writable ? '<span class="badge ok">writable</span>' : `<span class="badge bad">${p.exists ? 'not writable' : 'not found'}</span>`}${p.lastError ? `<br><span class="bad">${esc(p.lastError)}</span>` : ''}${p.lastRun ? ` <span class="muted tiny">last run ${fmtAgo(p.lastRun)}</span>` : ''}`; } catch (e) { box.textContent = e.message; } };
  refreshPosters();
  L.posters.onProgress(() => { if (currentView === 'settings') refreshPosters(); posterIdxAt = 0; });
  $('#poRun').onclick = async () => { await L.settings.replace(collect()); await L.posters.run({ retry: true }); toast('Fetching posters in the background'); setTimeout(refreshPosters, 800); };
  $('#poAll').onclick = async () => { if (!confirm('Fetch every poster again? This replaces the ones you have.')) return; await L.settings.replace(collect()); await L.posters.run({ all: true }); toast('Fetching every poster again'); setTimeout(refreshPosters, 800); };
  $('#poClear').onclick = async () => { if (!confirm('Delete every poster file MediaLedger fetched? They can be fetched again.')) return; const n = await L.posters.clear(); posterIdxAt = 0; toast(`${n} posters deleted`); refreshPosters(); };
  $('#pickPo').onclick = async () => { const d = await pickFolder($('#poDir').value); if (d) $('#poDir').value = d; };
  const refreshJobs = async () => {
    const jobs = await L.jobs.list();
    $('#jobsBox').innerHTML = `<table class="jobs"><tr><th>Job</th><th>When</th><th>Last run</th><th>Next</th><th></th></tr>${jobs.map(j => `<tr class="${j.enabled ? '' : 'muted'}"><td class="nowrap"><b>${esc(j.label)}</b></td><td class="wrap">${esc(j.when)}</td><td class="wrap">${j.overdue ? `<span class="badge bad" title="${esc(j.overdueWhy || '')}">overdue</span> ` : ''}${j.running ? '<span class="badge warn">running</span>' : j.last ? `<span title="${esc(fmtDate(j.last))}">${fmtAgo(j.last)}</span>${j.lastNote ? `<span class="sub">${esc(String(j.lastNote)).slice(0, 80)}</span>` : ''}` : '<span class="muted">never</span>'}</td><td class="nowrap">${j.next ? (j.next === 'soon' ? 'soon' : fmtDate(j.next)) : '<span class="muted">—</span>'}</td><td><button class="small job-run" data-job="${j.id}" ${j.running ? 'disabled' : ''}>Run now</button></td></tr>`).join('')}</table>`;
    document.querySelectorAll('#jobsBox .job-run').forEach(b => { b.onclick = async () => { b.disabled = true; try { const r = await L.jobs.run(b.dataset.job); toast(r.message || 'Started'); } catch (e) { toast(e.message, true); } setTimeout(refreshJobs, 1500); }; });
  };
  refreshJobs();
  { const a = $('#toSchedules'); if (a) a.onclick = (e) => { e.preventDefault(); const h = [...document.querySelectorAll('h2')].find(x => x.textContent.trim() === 'Schedules'); if (h) h.scrollIntoView({ behavior: 'smooth' }); }; }
  const refreshTask = async () => {
    const t = await L.schedule.taskStatus();
    $('#taskStatus').innerHTML = t.exists ? `Task installed · status ${esc(t.status)} · next run ${esc(t.nextRun)} · last run ${esc(t.lastRun)} (result ${esc(t.lastResult)})<br><span class="mono tiny">${esc(t.command || '')}</span>` : 'No scheduled task installed.';
    const n = await L.schedule.nextInApp(); $('#nextInApp').textContent = n ? fmtDate(n) : 'off';
  };
  $('#installTask').onclick = async () => { await L.settings.replace(collect()); const r = await L.schedule.installTask(); toast(r.message || (r.ok ? 'Task installed' : 'Failed'), !r.ok); refreshTask(); };
  $('#removeTask').onclick = async () => { const r = await L.schedule.removeTask(); toast(r.message || 'Task removed', !r.ok); refreshTask(); };
  $('#runTask').onclick = async () => { const r = await L.schedule.runTaskNow(); toast(r.message || 'Task started', !r.ok); setTimeout(refreshTask, 2000); };
  $('#plexTest').onclick = async () => { $('#plexMsg').textContent = 'Testing…'; const r = await L.plexTest({ baseUrl: $('#plexUrl').value.trim(), token: $('#plexToken').value.trim() }); $('#plexMsg').textContent = r.message; $('#plexMsg').className = 'hint ' + (r.ok ? 'ok' : 'bad'); };
  const mapBox = $('#plexMap');
  const mapRow = (m) => el(`<div class="inline" style="margin-bottom:4px"><input class="pm-plex" placeholder="/media" value="${esc(m.plex || '')}" style="width:220px"> <span class="muted">→</span> <input class="pm-local" placeholder="\\\\nas\\share" value="${esc(m.local || '')}" style="flex:1"> <button class="small pm-del">✕</button></div>`);
  const addMap = (m) => { const r = mapRow(m); mapBox.append(r); $('.pm-del', r).onclick = () => r.remove(); };
  (s.plex.pathMap || []).forEach(addMap);
  mapBox.append(el('<button class="small" id="pmAdd">Add mapping</button>'));
  $('#pmAdd').onclick = () => { addMap({}); mapBox.append($('#pmAdd')); };
  const refreshHook = async () => {
    const box = $('#plexHook'); if (!box) return;
    let h; try { h = await L.plex.webhookInfo(); } catch (e) { box.textContent = e.message; return; }
    if (!h.available) { box.textContent = 'Webhooks need the always-on web server (the Pi); the desktop app cannot receive them.'; return; }
    box.innerHTML = `<label class="inline"><input type="checkbox" id="hookOn" ${h.enabled ? 'checked' : ''}> Enabled</label>${h.enabled && h.url ? ` <span class="mono" style="user-select:all;word-break:break-all">${esc(h.url)}</span> <button class="small" id="hookRotate">New key</button>` : ''}${h.events.length ? `<div class="tiny" style="margin-top:6px">Last events: ${h.events.slice(0, 5).map(e => `${esc(e.event.replace('media.', '').replace('library.', ''))}${e.title ? ' · ' + esc(e.title) : ''}${e.updated ? ' ✓' : ''}`).join(' · ')}</div>` : ''}`;
    $('#hookOn').onchange = async () => { try { await L.plex.webhookSet({ enabled: $('#hookOn').checked }); refreshHook(); } catch (e) { toast(e.message, true); } };
    if ($('#hookRotate')) $('#hookRotate').onclick = async () => { if (confirm('Generate a new key? Update the URL in Plex afterwards.')) { await L.plex.webhookSet({ rotate: true }); refreshHook(); } };
  };
  refreshHook();
  $('#themeSel').onchange = () => { applyTheme($('#themeSel').value); toast('Theme applied'); };
  $('#plexXmlUrl').oninput = () => {
    const v = $('#plexXmlUrl').value.trim(); const m = v.match(/X-Plex-Token=([A-Za-z0-9_-]{8,})/);
    if (!m) return;
    $('#plexToken').value = m[1];
    try { const u = new URL(v); if (u.port === '32400' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)) $('#plexUrl').value = u.origin; } catch { /* not a full URL: the token alone is fine */ }
    $('#plexXmlUrl').value = '';
    $('#plexMsg').textContent = 'Token filled in from the address. Press Test, then Save settings.'; $('#plexMsg').className = 'hint ok';
  };
  const refreshPlex = async () => {
    const st = await L.plex.status();
    $('#plexStatus').innerHTML = st.last ? `Last sync ${fmtDate(st.last.ts)}: ${st.last.matched.toLocaleString()} of ${st.last.items.toLocaleString()} Plex items matched to files · ${st.linked.toLocaleString()} of ${st.total.toLocaleString()} files linked · ${st.watched.toLocaleString()} watched · ${st.rated} with your Plex rating${st.unlinked.length ? `<br><span class="muted">${st.unlinked.length}${st.unlinked.length === 300 ? '+' : ''} files not in Plex, e.g. ${esc(st.unlinked.slice(0, 3).map(u => u.rel_path).join(' · '))}</span>` : ''}${(st.bySection || []).length ? `<table class="jobs" style="margin-top:8px"><tr><th>Plex library</th><th>Items</th><th>Matched</th><th>Unmatched</th><th>Why</th></tr>${st.bySection.map(b => { const R = { 'no path mapping': 'no path mapping covers this folder', 'not in MediaLedger': 'file is not in a scanned root', 'no file part': 'Plex reports no file' }; return `<tr><td><b>${esc(b.section)}</b></td><td>${b.items.toLocaleString()}</td><td>${b.matched.toLocaleString()}</td><td>${b.unmatched ? `<span class="bad">${b.unmatched.toLocaleString()}</span>` : '<span class="ok">0</span>'}</td><td class="wrap">${Object.entries(b.reasons || {}).map(([k, n]) => `${n.toLocaleString()} × ${esc(R[k] || k)}`).join('; ')}${b.unmatched && b.sample ? `<span class="sub mono">${esc(b.sample.file || '')}${b.sample.local ? ' → ' + esc(b.sample.local) : ''}</span>` : ''}</td></tr>`; }).join('')}</table>` : ''}` : 'Never synced.';
    if (st.job && st.job.running) $('#plexSyncMsg').textContent = st.job.message || 'Syncing…';
  };
  $('#plexSync').onclick = async () => { await L.settings.replace(collect()); $('#plexSyncMsg').textContent = 'Starting…'; try { const r = await L.plex.sync(); toast(`Plex sync: ${r.matched.toLocaleString()} of ${r.items.toLocaleString()} matched`); views.settings(); } catch (e) { toast(e.message, true); $('#plexSyncMsg').textContent = e.message; } };
  refreshPlex();
  refreshTask();
};

let ffDlUnsub = null;
async function downloadFfmpeg(msgEl, progEl, barEl, after) {
  if (ffDlUnsub) ffDlUnsub();
  progEl.hidden = false; barEl.className = 'indeterminate';
  ffDlUnsub = L.ffmpeg.onProgress(p => { if (p.percent != null && p.phase === 'download') { barEl.className = ''; barEl.style.width = p.percent + '%'; } else barEl.className = 'indeterminate'; msgEl.textContent = p.message; });
  try { const r = await L.ffmpeg.download(); toast('ffprobe installed: ' + r.version); after && after(); }
  catch (e) { toast('Download failed: ' + e.message, true); msgEl.textContent = e.message; }
  finally { progEl.hidden = true; if (ffDlUnsub) { ffDlUnsub(); ffDlUnsub = null; } }
}

// ---- System: host health and hardware ------------------------------------------------
let sysTimer = null;
const fmtRate = (bps) => bps == null ? '—' : bps >= 1e6 ? (bps / 1e6).toFixed(1) + ' MB/s' : (bps / 1e3).toFixed(0) + ' kB/s';
const fmtUptime = (s) => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
function sparkline(values, { max = null, min = 0 } = {}) {
  const v = values.filter(x => x != null);
  if (v.length < 2) return '<svg class="spark" viewBox="0 0 100 44" preserveAspectRatio="none"></svg>';
  const hi = max != null ? max : Math.max(...v) * 1.05 || 1, lo = min;
  const pts = values.map((x, i) => x == null ? null : [i / (values.length - 1) * 100, 42 - (Math.min(Math.max(x, lo), hi) - lo) / (hi - lo) * 40]).filter(Boolean);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return `<svg class="spark" viewBox="0 0 100 44" preserveAspectRatio="none"><path class="fill" d="${d} L${pts[pts.length - 1][0].toFixed(1)} 44 L${pts[0][0].toFixed(1)} 44 Z"></path><path d="${d}"></path></svg>`;
}
const meter = (pct, warn = 80, bad = 92) => `<div class="meter ${pct >= bad ? 'bad' : pct >= warn ? 'warn' : ''}"><div style="width:${Math.min(100, pct || 0)}%"></div></div>`;
views.system = async () => {
  const s = await L.sys.stats();
  const h = s.history, last = (k) => h.map(x => x[k]);
  const health = s.health || { level: 'ok', reasons: [] };
  const pill = $('#sysPill'); pill.hidden = health.level === 'ok'; pill.textContent = health.level === 'bad' ? '!' : '•'; pill.className = 'pill ' + (health.level === 'bad' ? 'bad' : 'warn');
  const pi = s.pi;
  const tempTile = pi && pi.tempC != null ? tile(pi.tempC >= 80 ? 'bad' : pi.tempC >= 70 ? 'warn' : '', 'SoC temperature', `${pi.tempC.toFixed(1)} °C`, `${pi.clockMHz ? pi.clockMHz + ' MHz' : ''}${pi.voltage ? ' · ' + pi.voltage.toFixed(2) + ' V' : ''}`) : '';
  const thr = pi && pi.throttled;
  const thrTile = thr ? tile(thr.now ? 'bad' : thr.ever ? 'warn' : 'ok', 'Power & throttling', thr.now ? 'Throttled now' : thr.ever ? 'Throttled earlier' : 'Healthy', thr.flags.length ? esc(thr.flags.join(' · ')) : 'no under-voltage or frequency capping since boot') : '';
  const dataDisk = s.disks[0];
  view.innerHTML = `<h1>System</h1>
    <p class="muted">${esc(s.host.hostname)} · ${esc(pi ? pi.model : s.host.platform)} · up ${fmtUptime(s.host.uptimeS)} · MediaLedger service up ${fmtUptime(s.service.uptimeS)} · refreshes every ${Math.round(s.sampleMs / 1000)} s</p>
    <div class="tiles">
      ${tile(health.level === 'ok' ? 'ok' : health.level, 'Health', `<span class="health-${health.level}">${health.level === 'ok' ? 'All good' : health.level === 'warn' ? 'Attention' : 'Problem'}</span>`, health.reasons.length ? esc(health.reasons.join(' · ')) : 'no rule triggered')}
      ${tempTile}${thrTile}
      ${tile('', 'CPU', s.cpu.pct == null ? '…' : `${s.cpu.pct}%`, `${s.cpu.cores} cores · load ${s.cpu.load.join(' / ')}`)}
      ${tile('', 'Memory', `${s.memory.pct}%`, `${fmtBytes(s.memory.used)} of ${fmtBytes(s.memory.total)}${s.memory.swap ? ` · swap ${fmtBytes(s.memory.swap.used)}` : ''}`)}
      ${tile(dataDisk.ok ? (dataDisk.pct >= 92 ? 'bad' : dataDisk.pct >= 80 ? 'warn' : '') : 'bad', 'Data disk', dataDisk.ok ? `${dataDisk.pct}%` : 'unreadable', dataDisk.ok ? `${fmtBytes(dataDisk.free)} free · database ${fmtBytes(s.service.dbBytes || 0)}` : esc(dataDisk.error || ''))}
      ${tile('', 'Network', s.network.rate ? `↓ ${fmtRate(s.network.rate.rxBps)}` : (s.network.interfaces[0] ? esc(s.network.interfaces[0].address) : '—'), s.network.rate ? `↑ ${fmtRate(s.network.rate.txBps)} · ${esc(s.network.interfaces.map(i => `${i.name} ${i.address}`).join(', '))}` : esc(s.network.interfaces.map(i => i.name).join(', ')))}
    </div>
    <div class="grid2">
      <div class="card"><h3>CPU <span class="right">${s.cpu.pct == null ? '' : s.cpu.pct + '%'}</span></h3>${sparkline(last('cpu'), { max: 100 })}<div class="cores">${(s.cpu.perCore || []).map(p => `<div title="${p}%"><div style="height:${p}%"></div></div>`).join('')}</div><div class="muted tiny" style="margin-top:6px">${esc(s.cpu.model || '')}</div></div>
      <div class="card"><h3>Memory <span class="right">${s.memory.pct}%</span></h3>${sparkline(last('mem'), { max: 100 })}${meter(s.memory.pct)}<div class="muted tiny" style="margin-top:6px">MediaLedger process ${fmtBytes(s.service.rss)} · Node ${esc(s.service.node)} · pid ${s.service.pid}${s.service.scanRunning ? ' · <b>scan running</b>' : ''}</div></div>
      ${pi && pi.tempC != null ? `<div class="card"><h3>Temperature <span class="right">${pi.tempC.toFixed(1)} °C</span></h3>${sparkline(last('temp'), { min: 30, max: 90 })}${meter(pi.tempC, 70, 80)}<div class="muted tiny" style="margin-top:6px">Pi firmware soft-limits at 80 °C and throttles at 85 °C</div></div>` : ''}
      ${s.network.rate ? `<div class="card"><h3>Network <span class="right">↓ ${fmtRate(s.network.rate.rxBps)} · ↑ ${fmtRate(s.network.rate.txBps)}</span></h3>${sparkline(last('rx'))}<div class="muted tiny">download (share reads during a scan show here)</div></div>` : ''}
    </div>
    <h2>Storage</h2>
    <div class="card"><table class="kv">${s.disks.map(d => `<tr><td>${esc(d.label)}</td><td>${d.ok ? `${fmtBytes(d.free)} free of ${fmtBytes(d.total)} (${d.pct}% used)${meter(d.pct, 90, 97)}` : `<span class="bad">not reachable: ${esc(d.error || '')}</span>`}<div class="muted tiny mono">${esc(d.path)}</div></td></tr>`).join('')}</table></div>`;
  clearInterval(sysTimer);
  sysTimer = setInterval(() => { if (currentView === 'system') views.system(); else clearInterval(sysTimer); }, s.sampleMs);
};


// ---- Security: web-server access controls -------------------------------------------
views.security = async () => {
  if (me.role !== 'admin' && L.isWeb) { view.innerHTML = '<h1>Security</h1><div class="card"><p>Only admins manage security. You can change your own password here.</p><div class="field"><label>Current</label><input type="password" id="pwCur"></div><div class="field"><label>New (8+ chars)</label><input type="password" id="pwNew"></div><div class="inline"><button class="primary" id="pwChange">Change password</button></div></div>'; $('#pwChange').onclick = async () => { try { await L.security.changePassword($('#pwCur').value, $('#pwNew').value); toast('Password changed'); } catch (e) { toast(e.message, true); } }; return; }
  const st = await L.security.status();
  const pill = $('#secPill');
  if (!st.available) {
    pill.hidden = true;
    view.innerHTML = `<h1>Security</h1><div class="card"><p>The desktop app has no login: it runs as you, on this PC, and only this PC can reach it.</p><p class="muted">Password, two-factor codes, sessions, lockout and the audit log live on the Raspberry Pi web server, where anyone on the LAN could otherwise open the page. Open this tab there to manage them.</p></div>`;
    return;
  }
  const bad = st.checks.filter(c => !c.ok && c.level === 'bad').length, warn = st.checks.filter(c => !c.ok && c.level === 'warn').length;
  pill.hidden = !bad; pill.textContent = bad; pill.className = 'pill bad';
  const ago = (ms) => { const s = Math.round((Date.now() - ms) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
  const EVENT_TEXT = { login: 'Signed in', login_failed: 'Failed sign-in', login_blocked: 'Blocked (locked out)', ip_locked: 'Address locked out', logout: 'Signed out', reauth: 'Password re-entered', reauth_failed: 'Re-entry failed', sensitive_action: 'Sensitive action', password_changed: 'Password changed', password_change_failed: 'Password change refused', '2fa_enabled': '2FA turned on', '2fa_disabled': '2FA turned off', options_changed: 'Options changed', session_revoked: 'Session revoked', sessions_revoked: 'Other sessions revoked', tls_enabled: 'HTTPS turned on', refused_non_lan: 'Refused: outside LAN', cross_origin_refused: 'Refused: cross-origin' };
  const evClass = (e) => /failed|blocked|locked|refused/.test(e) ? 'bad' : /sensitive|changed|revoked|disabled/.test(e) ? 'warn' : '';
  view.innerHTML = `<h1>Security</h1>
    <p class="muted">Web server on ${st.https ? 'HTTPS' : 'HTTP'} port ${st.port}${st.proxyHttps ? ', behind a reverse proxy that serves HTTPS' : ''} · ${st.sessions.length} active session${st.sessions.length === 1 ? '' : 's'} · ${st.failedLogins24h} failed sign-in${st.failedLogins24h === 1 ? '' : 's'} in 24 h · ${st.banned.length} address${st.banned.length === 1 ? '' : 'es'} locked out</p>
    <div class="checks">${st.checks.map(c => `<div class="check ${c.ok ? '' : c.level}"><div class="dot"></div><div><b>${esc(c.name)}</b><span>${esc(c.detail)}</span></div></div>`).join('')}</div>
    <div class="grid2" style="margin-top:14px">
      <div class="card"><h3>Password</h3>
        <div class="field"><label>Current</label><input type="password" id="pwCur" autocomplete="current-password"></div>
        <div class="field"><label>New (${st.limits.minPassword}+ chars)</label><input type="password" id="pwNew" autocomplete="new-password"></div>
        <div class="field"><label>Repeat</label><input type="password" id="pwNew2" autocomplete="new-password"></div>
        <div class="inline"><button class="primary" id="pwChange">Change password</button><span class="muted tiny">Signs out every other session.</span></div>
        <h3 style="margin-top:16px">Options</h3>
        <div class="field"><label>LAN only</label><input type="checkbox" id="optLan" ${st.lanOnly ? 'checked' : ''}><div class="hint">Refuse connections from outside private address ranges. Leave on unless you know why.</div></div>
        <div class="field"><label>Idle sign-out</label><div class="inline"><input type="number" id="optIdle" min="0" max="10080" value="${st.idleMinutes}" style="width:90px"> <span class="muted">minutes (0 = off)</span><button class="small" id="optIdleSave">Save</button></div></div>
        <div class="field"><label>Guest access</label><input type="checkbox" id="optGuest" ${st.guestEnabled ? 'checked' : ''}><div class="hint">Anyone on the LAN can open the page without signing in and see library statistics and lists, and file media requests. Guests never see adult content, issues, settings or any control.</div></div>
        ${st.guestEnabled ? `<div class="field"><label>Guest link</label><div class="inline" style="align-items:flex-start;gap:14px"><div class="qrbox">${qrSvg(location.origin + '/request', { size: 132, label: 'Guest request link' })}</div><div class="muted tiny">Anyone on your Wi-Fi can scan this to open the request form at <span class="mono">${esc(location.origin)}/request</span> as a guest. Screenshot it or print this page and put it by the TV.</div></div></div>` : ''}
        <div class="inline"><button id="optSave">Save options</button></div>
        <h3 style="margin-top:16px">Users</h3>
        <table><thead><tr><th>User</th><th>Role</th><th>Last sign-in</th><th>Sessions</th><th></th></tr></thead><tbody>${st.users.map(u => `<tr><td><b>${esc(u.username)}</b>${st.me && u.username === st.me.username ? ' <span class="badge ok">you</span>' : ''}</td><td><select class="small uRole" data-u="${esc(u.username)}"><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option><option value="standard" ${u.role === 'standard' ? 'selected' : ''}>standard</option></select></td><td class="muted">${u.lastLogin ? ago(u.lastLogin) : 'never'}</td><td>${u.sessions}</td><td class="nowrap"><button class="small uReset" data-u="${esc(u.username)}">Reset password</button> <button class="small uDel" data-u="${esc(u.username)}">✕</button></td></tr>`).join('')}</tbody></table>
        <div class="inline" style="margin-top:8px"><input type="text" id="nuName" placeholder="username" style="width:130px" autocomplete="off"><input type="password" id="nuPw" placeholder="password (8+)" style="width:150px" autocomplete="new-password"><select id="nuRole"><option value="standard">standard</option><option value="admin">admin</option></select><button class="primary" id="nuAdd">Add user</button></div>
        <p class="muted tiny" style="margin:6px 0 0"><b>admin</b>: everything. <b>standard</b>: sees every library and review page, can rate titles, file requests and show adult content for their own session; no settings, system, security, scans, fixes or renames.</p>
      </div>
      <div class="card"><h3>Two-factor codes ${st.totpEnabled ? '<span class="right ok">on</span>' : '<span class="right muted">off</span>'}</h3>
        ${st.totpEnabled
          ? `<p>Sign-in requires your password and a 6-digit code from your authenticator app.</p><div class="field"><label>Password</label><input type="password" id="totpPw"></div><div class="inline"><button class="danger" id="totpOff">Turn off 2FA</button></div>`
          : `<p class="muted">Adds a code from Google Authenticator, Aegis, Bitwarden, 1Password or any TOTP app. Even a leaked password then cannot sign in.</p><div id="totpBox"><button class="primary" id="totpStart">Set up 2FA</button></div>`}
        <h3 style="margin-top:16px">HTTPS ${st.https ? '<span class="right ok">on</span>' : st.proxyHttps ? '<span class="right ok">on, by the reverse proxy</span>' : '<span class="right muted">off</span>'}</h3>
        ${st.proxyHttps ? `<p class="muted">A reverse proxy on this machine (Caddy) serves HTTPS in front of this server, so browsers already get an encrypted connection and nothing needs turning on here. The built-in certificate is for a server with no proxy; switching it on now would break the proxy's connection to this port.</p>` : st.https
          ? `<p class="muted">Traffic between browsers and this server is encrypted with a self-signed certificate on port ${st.port}. Each device warns once until the certificate is installed on it.</p><div class="inline"><button class="danger" id="tlsOff" title="Behind a reverse proxy such as Caddy the proxy should hold the certificate, not this server">Turn HTTPS off</button> <a href="tls/medialedger-cert.crt" download="medialedger-cert.crt"><button>Download certificate</button></a></div>`
          : `<p class="muted">Encrypts the traffic between browsers and this server with a self-signed certificate made here, for every name and address the server answers to. The service restarts, sign-in sessions are kept${st.tlsPort !== st.port ? `, and the site moves to port ${st.tlsPort} with a redirect left on ${st.port}` : ''}.</p><div class="inline"><button class="primary" id="tlsOn" ${st.opensslAvailable ? '' : 'disabled title="openssl is not installed on the server"'}>Turn on HTTPS</button></div>`}
        <details style="margin-top:8px"><summary class="muted tiny" style="cursor:pointer">Removing the browser warning: install the certificate once per device</summary><div class="tiny" style="margin-top:6px;line-height:1.6">
          <b>Windows</b>: download it, double-click the .crt → Install Certificate → Local Machine → Place all certificates in the following store → <i>Trusted Root Certification Authorities</i>. Restart the browser.<br>
          <b>Android</b>: download it, then Settings → Security → Encryption &amp; credentials → Install a certificate → <i>CA certificate</i> → pick the file. Chrome trusts it at once.<br>
          <b>iPhone / iPad</b>: open the download in Safari, allow the profile, then Settings → General → VPN &amp; Device Management → install it, and finally Settings → General → About → Certificate Trust Settings → switch it on.<br>
          <b>macOS</b>: double-click → Keychain Access → find it under System → Get Info → Trust → Always Trust.<br>
          The certificate lasts ten years. If you later add a new name for the Pi, delete <span class="mono">tls/</span> in the data folder, restart, and turn HTTPS on again so the new name is included.</div></details>
        <h3 style="margin-top:16px">Sessions</h3>
        <table><thead><tr><th>User</th><th>Where</th><th>Browser</th><th>Last seen</th><th></th></tr></thead><tbody>${st.sessions.map(s => `<tr><td>${esc(s.user || '')} <span class="muted tiny">${esc(s.role || '')}</span></td><td>${esc(s.ip || '')}${s.current ? ' <span class="badge ok">this</span>' : ''}</td><td class="muted tiny" title="${esc(s.ua)}">${esc((s.ua || '').replace(/^Mozilla\/5\.0 /, '').slice(0, 48))}</td><td>${ago(s.lastSeen)}</td><td>${s.current ? '' : `<button class="small revoke" data-id="${s.id}">Sign out</button>`}</td></tr>`).join('')}</tbody></table>
        <div class="inline" style="margin-top:8px"><button id="revokeOthers" ${st.sessions.length > 1 ? '' : 'disabled'}>Sign out other sessions</button><button id="logoutBtn">Sign out here</button></div>
        ${st.banned.length ? `<p class="muted tiny" style="margin-top:8px">Locked out: ${st.banned.map(b => `${esc(b.ip)} until ${new Date(b.until).toLocaleTimeString()}`).join(', ')}</p>` : ''}
      </div>
    </div>
    <h2>Audit log</h2>
    <div class="card"><table><thead><tr><th>When</th><th>Event</th><th>Address</th><th>Detail</th></tr></thead><tbody>${st.events.map(e => `<tr><td class="muted">${fmtDate(e.ts)}</td><td class="${evClass(e.event)}">${esc(EVENT_TEXT[e.event] || e.event)}</td><td>${esc(e.ip || '')}</td><td class="muted">${esc(e.detail || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No events yet.</td></tr>'}</tbody></table>
    <p class="muted tiny">Lockout after ${st.limits.lockFails} failures in ${st.limits.lockMinutes} min · sensitive actions ask for the password again after ${st.limits.reauthMinutes} min · sessions last ${st.limits.sessionDays} days · full log in ${esc(st.dataDir)}/security.log</p></div>`;
  const act = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg); views.security(); } catch (e) { toast(e.message, true); } };
  $('#pwChange').onclick = () => { if ($('#pwNew').value !== $('#pwNew2').value) return toast('New passwords differ', true); act(() => L.security.changePassword($('#pwCur').value, $('#pwNew').value), 'Password changed'); };
  const saveOptions = () => act(() => L.security.setOptions({ lanOnly: $('#optLan').checked, idleMinutes: Number($('#optIdle').value), guestEnabled: $('#optGuest').checked }), 'Options saved');
  $('#optSave').onclick = saveOptions; $('#optIdleSave').onclick = saveOptions;
  if ($('#tlsOff')) $('#tlsOff').onclick = () => { if (!confirm('Turn HTTPS off and restart on plain HTTP? Do this when a reverse proxy (Caddy) handles HTTPS in front of this server. The certificate is kept in tls-off.')) return; act(async () => {
    const r = await L.security.tlsDisable();
    const target = `http://${location.hostname}${r.port === 80 ? '' : ':' + r.port}/#security`;
    toast(`HTTPS off. Restarting on plain HTTP; this page will open ${target} in a few seconds.`);
    setTimeout(() => { location.href = target; }, 5000);
  }); };
  if ($('#tlsOn')) $('#tlsOn').onclick = () => { if (!confirm('Create a certificate and restart on HTTPS? Every browser will warn once until the certificate is installed on it.')) return; act(async () => {
    const r = await L.security.tlsEnable();
    const target = `https://${location.hostname}${r.port === 443 ? '' : ':' + r.port}/#security`;
    toast(`Certificate created. Restarting on HTTPS; this page will open ${target} in a few seconds.`);
    setTimeout(() => { location.href = target; }, 7000);
  }); };
  $('#nuAdd').onclick = () => act(() => L.security.addUser($('#nuName').value, $('#nuPw').value, $('#nuRole').value), 'User added');
  document.querySelectorAll('.uRole').forEach(s => { s.onchange = () => act(() => L.security.setRole(s.dataset.u, s.value), 'Role changed'); });
  document.querySelectorAll('.uReset').forEach(b => { b.onclick = () => { const pw = prompt(`New password for ${b.dataset.u} (8+ characters). They will be signed out everywhere.`); if (pw) act(() => L.security.resetPassword(b.dataset.u, pw), 'Password reset'); }; });
  document.querySelectorAll('.uDel').forEach(b => { b.onclick = () => { if (confirm(`Delete user ${b.dataset.u}?`)) act(() => L.security.deleteUser(b.dataset.u), 'User deleted'); }; });
  $('#revokeOthers').onclick = () => act(() => L.security.revokeOthers(), 'Other sessions signed out');
  $('#logoutBtn').onclick = () => L.logout();
  document.querySelectorAll('.revoke').forEach(b => { b.onclick = () => act(() => L.security.revoke(b.dataset.id), 'Session signed out'); });
  // Not through act(): that re-renders the tab and would wipe the QR code before it can be scanned.
  if ($('#totpStart')) $('#totpStart').onclick = async () => { try {
    const r = await L.security.totpSetup();
    $('#totpBox').innerHTML = `<p>1. In Google Authenticator (or Aegis, Bitwarden, 1Password…) tap <b>+</b> → <b>Scan a QR code</b> and point the camera here:</p><div class="qrbox">${qrSvg(r.url, { size: 184, label: 'Two-factor setup code' })}</div><p class="muted tiny" style="margin-top:8px">No camera? Choose <b>Enter a setup key</b> instead and type this secret (time-based, 6 digits):</p><div class="secret">${esc(r.secret.replace(/(.{4})/g, '$1 ').trim())}</div><p class="muted tiny mono" style="word-break:break-all">${esc(r.url)}</p><p>2. Enter the 6-digit code it shows to confirm:</p><div class="inline"><input type="text" id="totpCode" inputmode="numeric" placeholder="000000" style="width:120px"><button class="primary" id="totpConfirm">Turn on 2FA</button></div>`;
    $('#totpConfirm').onclick = () => act(() => L.security.totpEnable($('#totpCode').value), 'Two-factor codes are on');
  } catch (e) { toast(e.message, true); } };
  if ($('#totpOff')) $('#totpOff').onclick = () => act(() => L.security.totpDisable($('#totpPw').value), 'Two-factor codes are off');
};

// Server-side folder browser for the web build (the browser cannot open a native picker on the Pi).
function browseServerFolder(start) {
  return new Promise((resolve) => {
    let current = start || '';
    const card = openModal(`<h2>Choose a folder</h2><div class="fb-short" id="fbShort"></div><div class="inline" style="margin-bottom:8px"><button class="small" id="fbUp">↑ Up</button><input type="text" id="fbPath" style="flex:1" placeholder="/mnt/medialedger"><button class="small" id="fbGo">Go</button></div><div id="fbList" class="preview" style="max-height:340px;overflow:auto"></div><div class="actions"><span class="muted tiny" id="fbHint">Click a folder to open it. Hidden folders are not shown.</span><span class="grow"></span><button id="fbCancel">Cancel</button><button class="primary" id="fbUse">Use this folder</button></div>`);
    let parent = null;
    const load = async (p) => {
      const r = await L.roots.listDirs(p);
      current = r.path; parent = r.parent; $('#fbPath', card).value = r.path;
      const files = r.files ? `${r.files.toLocaleString()} file${r.files === 1 ? '' : 's'} here` : '';
      $('#fbList', card).innerHTML = r.error ? `<div class="bad">Cannot open this folder: ${esc(r.error === 'ENOENT' ? 'it does not exist' : r.error === 'EACCES' ? 'the server is not allowed to read it' : r.error)}</div>` : (r.dirs.map(d => `<div class="fb-item" data-p="${esc(d.path)}">📁 ${esc(d.name)}</div>`).join('') || `<div class="muted">No folders inside this one${files ? ` (${files})` : ''}. If this is where the media is, press <b>Use this folder</b>.</div>`);
      $('#fbHint', card).textContent = r.error ? '' : `${r.dirs.length.toLocaleString()}${r.total > r.dirs.length ? ` of ${r.total.toLocaleString()}` : ''} folder${r.dirs.length === 1 ? '' : 's'}${files ? ` · ${files}` : ''}`;
      card.querySelectorAll('.fb-item').forEach(n => { n.onclick = () => load(n.dataset.p); });
      $('#fbUp', card).disabled = parent == null;
    };
    // Shortcuts: each connected share, and the way to connect another (web server on Linux only).
    L.shares.status().then(st => {
      const up = (st.shares || []).filter(x => x.mounted);
      $('#fbShort', card).innerHTML = (up.length ? '<span class="muted tiny">Shares:</span>' + up.map(x => `<button class="small fb-jump" data-p="${esc(x.mount)}" title="${esc(x.source)}">⛁ ${esc(x.name)}</button>`).join('') : '') + (st.available ? '<button class="small" id="fbShare">＋ Connect a network share…</button>' : '');
      card.querySelectorAll('.fb-jump').forEach(b => { b.onclick = () => load(b.dataset.p); });
      if ($('#fbShare', card)) $('#fbShare', card).onclick = async () => { const m = await connectShareDialog(); resolve(await browseServerFolder(m || current)); };
      if (!start && up.length) load(up[0].mount);
    }).catch(() => {});
    $('#fbUp', card).onclick = () => load(parent == null ? '' : parent);
    $('#fbGo', card).onclick = () => load($('#fbPath', card).value.trim());
    $('#fbPath', card).onkeydown = e => { if (e.key === 'Enter') $('#fbGo', card).click(); };
    $('#fbCancel', card).onclick = () => { closeModal(); resolve(null); };
    $('#fbUse', card).onclick = () => { closeModal(); resolve(current); };
    load(current);
  });
}

// ---- Network shares: sign in to a file server, tick its shares, and the server's root helper mounts them ----
// Resolves with the folder of the first share connected, or null.
function connectShareDialog() {
  return new Promise((resolve) => { (async () => {
    const st = await L.shares.status();
    if (!st.available) { const c = openModal(`<h2>Connect a network share</h2><p>${esc(st.why || 'Not available here.')}</p><div class="actions"><span class="grow"></span><button id="csCancel">Close</button></div>`); $('#csCancel', c).onclick = () => { closeModal(); resolve(null); }; return; }
    const known = (st.shares[0] && /^\/\/([^/]+)\//.exec(st.shares[0].source) || [])[1] || '';
    const card = openModal(`<h2>Connect a network share</h2><p class="muted">Sign in to the file server that holds your media: a NAS, or a PC that shares folders. MediaLedger lists its shares, and the ones you tick appear as folders under <span class="mono">${esc(st.base)}</span>, ready to pick as library folders.</p>
      <div class="field"><label>Server address</label><input type="text" id="csHost" value="${esc(known)}" placeholder="192.168.1.50 or nas.home" autocomplete="off" spellcheck="false"></div>
      <div class="field"><label>Username</label><input type="text" id="csUser" autocomplete="off" spellcheck="false"></div>
      <div class="field"><label>Password</label><input type="password" id="csPass" autocomplete="new-password"></div>
      ${st.canProbe ? '' : '<div class="field"><label>Share name</label><input type="text" id="csShare" placeholder="the name of the shared folder" autocomplete="off"></div>'}
      <div id="csOut"></div>
      <div class="actions"><span class="muted tiny" style="max-width:380px">The sign-in is kept on the server in a file only root can read, so the share reconnects after a restart. It is never stored in MediaLedger's own settings.</span><span class="grow"></span><button id="csCancel">Cancel</button><button class="primary" id="csFind">${st.canProbe ? 'Find shares' : 'Connect'}</button></div>`);
    let first = null;
    const creds = () => ({ host: $('#csHost', card).value.trim(), user: $('#csUser', card).value.trim(), pass: $('#csPass', card).value });
    const out = $('#csOut', card);
    const connect = async (names) => {
      const c = creds(); const lines = [];
      for (const share of names) {
        out.innerHTML = `<p class="muted">Connecting ${esc(share)}…</p>` + lines.join('');
        try { const r = await L.shares.add({ ...c, share }); first = first || r.mount; lines.push(`<div class="ok">✓ ${esc(share)} connected at <span class="mono">${esc(r.mount)}</span></div>`); }
        catch (e) { lines.push(`<div class="bad">✗ ${esc(share)}: ${esc(e.message)}</div>`); }
      }
      out.innerHTML = lines.join('') + (first ? '<p class="muted tiny">Next: pick the folders inside it that hold TV, Anime and Movies.</p>' : '');
      if (first) { $('#csFind', card).textContent = 'Done'; $('#csFind', card).onclick = () => { closeModal(); resolve(first); }; }
    };
    $('#csCancel', card).onclick = () => { closeModal(); resolve(first); };
    $('#csFind', card).onclick = async () => {
      const c = creds(); if (!c.host) return toast('Type the server address', true);
      if (!st.canProbe) { const sh = $('#csShare', card).value.trim(); if (!sh) return toast('Type the share name', true); return connect([sh]); }
      out.innerHTML = '<p class="muted">Asking the server for its shares…</p>';
      try {
        const r = await L.shares.probe(c);
        const have = new Set(st.shares.filter(x => x.source.toLowerCase().startsWith(`//${c.host.toLowerCase()}/`)).map(x => x.source.split('/').pop().toLowerCase()));
        out.innerHTML = `<div class="sharelist">${r.shares.map(x => `<label class="inline"><input type="checkbox" value="${esc(x.name)}" ${have.has(x.name.toLowerCase()) ? 'disabled' : ''}> <b>${esc(x.name)}</b> <span class="muted tiny">${have.has(x.name.toLowerCase()) ? 'already connected' : esc(x.comment || '')}</span></label>`).join('')}</div><p class="muted tiny">Tick the shares that hold your media, then press Connect.</p>`;
        $('#csFind', card).textContent = 'Connect'; $('#csFind', card).onclick = () => { const names = [...out.querySelectorAll('input:checked')].map(i => i.value); if (!names.length) return toast('Tick at least one share', true); connect(names); };
      } catch (e) { out.innerHTML = `<div class="warnbox">${esc(e.message)}.</div>`; }
    };
    $('#csHost', card).focus();
  })().catch(e => { toast(e.message, true); resolve(null); }); });
}
async function paintShares(box, after) {
  const st = await L.shares.status();
  if (st.platform !== 'linux') { box.innerHTML = `<p class="muted">${esc(st.why || '')}</p>`; return st; }
  box.innerHTML = `${st.shares.length ? `<table class="roots-table"><thead><tr><th>Share</th><th>Folder on this server</th><th>Status</th><th></th></tr></thead><tbody>${st.shares.map(x => `<tr><td class="mono">${esc(x.source)}</td><td class="mono">${esc(x.mount)}</td><td>${x.mounted ? `<span class="ok">● Connected</span>${x.entries != null ? ` <span class="muted tiny">${x.entries} entries</span>` : ''}` : '<span class="bad">● Not connected</span> <span class="muted tiny">the server retries every minute</span>'}</td><td>${x.managed ? `<button class="small danger sh-del" data-n="${esc(x.name)}">Remove</button>` : '<span class="muted tiny" title="Made by the installer; edit /etc/fstab to change it">installer</span>'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No network share is connected yet.</p>'}
    <div class="inline" style="margin-top:8px"><button class="small" id="shAdd" ${st.available ? '' : 'disabled'}>＋ Connect a network share…</button><a href="#welcome" class="small">Open the setup guide</a></div>${st.available ? '' : `<div class="warnbox" style="margin-top:8px">${esc(st.why)}</div>`}`;
  const again = () => paintShares(box, after).then(x => { if (after) after(x); });
  if ($('#shAdd', box)) $('#shAdd', box).onclick = async () => { await connectShareDialog(); again(); };
  box.querySelectorAll('.sh-del').forEach(b => { b.onclick = async () => { if (!confirm(`Disconnect ${b.dataset.n}? Library folders inside it will show as unreachable until it is connected again. Nothing on the file server is changed.`)) return; try { await L.shares.remove(b.dataset.n); toast('Share removed'); } catch (e) { toast(e.message, true); } again(); }; });
  return st;
}

// ---- The welcome guide: storage, folders, a check, the first scan. Opens by itself on a new install. ----
views.welcome = async () => {
  const [s, info, scans] = await Promise.all([L.settings.get(), L.appInfo(), L.scan.list(1).catch(() => [])]);
  const KINDS = [['tv', 'TV shows', /^(tv|tv[ _-]?shows?|shows?|series)$/i], ['anime', 'Anime', /anime/i], ['movie', 'Movies', /^(movies?|films?)$/i]];
  const rootOf = (type) => (s.roots || []).find(r => r.type === type) || null;
  view.innerHTML = `<h1>Welcome to MediaLedger</h1>
    <p class="lead">MediaLedger reads your TV, anime and movie folders, records what is in each file, and shows what is missing, duplicated or worth upgrading. It only looks: nothing is renamed or moved unless you switch that on later. Four steps get it going.</p>
    <div class="wz">
      <div class="card wz-step"><h2><span class="wz-n">1</span> Connect your storage</h2><div id="wzShares"><p class="muted">Loading…</p></div></div>
      <div class="card wz-step"><h2><span class="wz-n">2</span> Point at the folders</h2>
        <p class="muted">One folder per kind of media. Press <b>Browse…</b> and open the folder that holds the shows (one folder per series inside it) or the movies. Leave a kind empty if you do not have it.</p>
        ${KINDS.map(([t, label]) => { const r = rootOf(t); return `<div class="field"><label>${label}</label><div class="inline"><input type="text" class="wz-path" data-t="${t}" value="${esc(r && r.path || '')}" placeholder="${L.isWeb ? '/mnt/medialedger/…' : '\\\\server\\share\\…'}" style="flex:1" spellcheck="false"><button class="small wz-pick" data-t="${t}">Browse…</button><span class="wz-st tiny" data-t="${t}"></span></div></div>`; }).join('')}
        <div class="inline"><button class="primary" id="wzSave">Save and check the folders</button><button class="small" id="wzGuess" title="Look inside the connected shares for folders named TV, Anime, Movies…">Find them for me</button><span class="muted tiny" id="wzSaved"></span></div>
        <p class="muted tiny">More folders, web videos and other kinds are added later under Settings, Library.</p></div>
      <div class="card wz-step"><h2><span class="wz-n">3</span> Check</h2><div id="wzCheck"><p class="muted">Save the folders first.</p></div></div>
      <div class="card wz-step"><h2><span class="wz-n">4</span> First scan</h2>
        <p class="muted">The scan lists every file and measures each one with ffprobe (resolution, codecs, languages, length). The first one takes a while on a big library; progress shows in the sidebar, and you can use the app while it runs.</p>
        <div class="inline"><button class="primary" id="wzScan">Start the first scan</button><span class="muted tiny" id="wzScanMsg">${scans.length ? 'A scan has already run here.' : ''}</span></div></div>
      <div class="card wz-step"><h2><span class="wz-n">✓</span> Worth doing next</h2>
        <ul class="wz-next"><li><a href="#settings">Plex</a>: watched state, ratings and posters from your Plex server (Settings, Connections).</li>${L.isWeb ? '<li><a href="#security">Two-factor codes</a> for the admin account (Security).</li><li><a href="#family">Family portal</a>: let family browse and send requests.</li>' : ''}<li><a href="#settings">Schedules and backups</a>: when scans and backups run (Settings, Automation).</li></ul>
        <div class="inline"><button class="primary" id="wzDone">Finish and open the dashboard</button><button class="small" id="wzSkip">Skip the guide</button></div></div>
    </div>`;
  const pathOf = (t) => view.querySelector(`.wz-path[data-t="${t}"]`), stOf = (t) => view.querySelector(`.wz-st[data-t="${t}"]`);
  const pick = async (start) => L.isWeb ? browseServerFolder(start) : L.pickFolder(start);
  view.querySelectorAll('.wz-pick').forEach(b => { b.onclick = async () => { const p = await pick(pathOf(b.dataset.t).value); if (p) pathOf(b.dataset.t).value = p; }; });
  let shareState = null;
  const sharesBox = $('#wzShares');
  const afterShares = (st) => { shareState = st; };
  afterShares(await paintShares(sharesBox, afterShares));
  if (shareState.platform !== 'linux') sharesBox.innerHTML = `<p>On this computer there is nothing to connect: in step 2, browse straight to the folders. For a NAS, type its path once in the address bar of File Explorer (for example <span class="mono">\\\\192.168.1.50\\Media</span>), sign in there and tick <i>Remember my credentials</i>; MediaLedger then reaches it the same way.</p>`;
  // Look one and two levels into each connected share for folders with the usual names.
  $('#wzGuess').onclick = async () => {
    const bases = L.isWeb ? ((await L.shares.status()).shares || []).filter(x => x.mounted).map(x => x.mount) : [];
    if (!bases.length) return toast(L.isWeb ? 'Connect a share first (step 1)' : 'Use Browse… on this computer', true);
    let found = 0;
    for (const b of bases) { const top = await L.roots.listDirs(b); const level = [...(top.dirs || [])]; for (const d of (top.dirs || []).slice(0, 12)) { try { level.push(...((await L.roots.listDirs(d.path)).dirs || [])); } catch { /* skip */ } }
      for (const [t, , re] of KINDS) { const hit = level.find(d => re.test(d.name)); if (hit) { pathOf(t).value = hit.path; found++; } } }
    toast(found ? `Found ${found} folder${found === 1 ? '' : 's'}. Check them, then save.` : 'No folders with the usual names. Use Browse…', !found);
  };
  const check = async () => {
    const roots = (await L.settings.get()).roots.filter(r => r.enabled);
    const box = $('#wzCheck'); box.innerHTML = '<p class="muted">Checking…</p>';
    const res = roots.length ? await L.roots.check(roots) : [];
    KINDS.forEach(([t]) => { const i = roots.findIndex(r => r.type === t); const r = i >= 0 ? res[i] : null; stOf(t).innerHTML = r ? (r.status === 'ok' ? '<span class="ok">● readable</span>' : '<span class="bad">● not readable</span>') : ''; });
    const bad = res.filter(r => r.status !== 'ok');
    box.innerHTML = `<div class="wz-line">${info.ffprobe ? '<span class="ok">✓</span> ffprobe is installed, so files can be measured.' : '<span class="bad">✗</span> ffprobe is missing. ' + (L.isWeb ? 'On the server run: <span class="mono">sudo apt-get install -y ffmpeg</span>' : 'It is downloading in the background; see Settings, Library.')}</div>
      ${roots.map((r, i) => `<div class="wz-line">${res[i] && res[i].status === 'ok' ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>'} <b>${esc(r.label)}</b> <span class="mono tiny">${esc(r.path)}</span> <span class="muted">${esc((res[i] && res[i].detail) || '')}</span></div>`).join('') || '<div class="wz-line"><span class="bad">✗</span> No folder is set yet.</div>'}
      ${bad.length ? '<div class="warnbox" style="margin-top:8px">A folder that cannot be read is usually a share that is not connected (step 1) or a path typed slightly wrong. Use Browse… to pick it instead.</div>' : ''}`;
    return roots.length > 0 && !bad.length;
  };
  $('#wzSave').onclick = async () => {
    const cur = (await L.settings.get()).roots || []; const next = cur.filter(r => !KINDS.some(([t]) => t === r.type));
    for (const [t, label] of KINDS) { const p = pathOf(t).value.trim(); if (!p) continue; const old = cur.find(r => r.type === t); next.push({ id: old ? old.id : t === 'movie' ? 'movies' : t, label: old ? old.label : label, path: p, type: t, enabled: true }); }
    await L.settings.set({ roots: next }); $('#wzSaved').textContent = 'Saved.'; const ok = await check(); refreshBadges();
    toast(ok ? 'Folders saved and readable' : 'Saved, but check step 3', !ok);
  };
  $('#wzScan').onclick = async () => { try { await L.scan.start('manual'); $('#wzScanMsg').textContent = 'Scan started. Progress is in the sidebar.'; refreshScanUi(); } catch (e) { toast(e.message, true); } };
  const done = async () => { await L.settings.set({ welcomeDone: true }); location.hash = '#dashboard'; };
  $('#wzDone').onclick = done; $('#wzSkip').onclick = done;
  if ((s.roots || []).length && scans.length) check();
};
// A new install (no scan has ever run and the guide was not finished) opens the guide instead of an empty dashboard.
async function maybeWelcome() {
  try {
    if (me && me.role && me.role !== 'admin') return;
    const s = await L.settings.get(); if (s.welcomeDone) return;
    const scans = await L.scan.list(1); if (scans && scans.length) return;
    if (!location.hash || location.hash === '#dashboard') location.hash = '#welcome';
  } catch { /* not signed in yet, or a guest */ }
}

views.about = async () => {
  const info = await L.appInfo();
  const u = updateState.state === 'idle' ? info.updateStatus : updateState;
  const updLine = updLineText(u, info.packaged);
  view.innerHTML = `<h1>About</h1>
    <div class="grid2">
      <div class="card">
        <div class="inline"><span class="about-logo">▣</span><div><div style="font-size:20px;font-weight:700">MediaLedger <span class="muted">v${esc(info.version)}</span></div><div class="muted">Local media-share ledger for Plex libraries</div></div></div>
        <p class="muted" style="margin:12px 0 0">Inventories TV, anime and movie files on your NAS with ffprobe, tracks what changed between scans, exports CSVs, and keeps your manual fixes. Everything runs on this PC; nothing is sent anywhere except the update check.</p>
        <table class="kv" style="margin-top:12px">
          <tr><td>Author</td><td>AxialForge (Joseph Costarella)</td></tr>
          <tr><td>License</td><td>MIT</td></tr>
          <tr><td>Source &amp; releases</td><td><a href="#" id="repoLink">${esc(info.repo)}</a></td></tr>
          <tr><td>Report a problem</td><td><a href="#" id="issueLink">${esc(info.repo)}/issues</a></td></tr>
        </table>
      </div>
      <div class="card">
        <h3>Updates</h3>
        <div class="status-line" id="updLine">${esc(updLine)}</div>
        <div class="inline" style="margin-top:10px"><button class="primary" id="chkUpd" ${info.packaged || L.isWeb ? '' : 'disabled'}>Check for updates</button>${u.state === 'ready' ? '<button id="restartUpd">Restart and install</button>' : ''}<button id="relLink">Open releases page</button></div>
        <p class="muted tiny" style="margin:10px 0 0">Updates come from GitHub Releases for this repository, are verified against the release manifest, and never touch your database or settings.</p>
        <h3 style="margin-top:16px">Runtime</h3>
        <table class="kv">
          <tr><td>Electron</td><td>${esc(info.electron)}</td></tr>
          <tr><td>Node</td><td>${esc(info.node)}</td></tr>
          <tr><td>Chromium</td><td>${esc(info.chrome)}</td></tr>
          <tr><td>Platform</td><td>${esc(info.platform)} · ${info.cpus} cores</td></tr>
          <tr><td>ffprobe</td><td>${info.ffprobe ? `<span class="mono">${esc(info.ffprobe)}</span><br><span class="muted">${esc(info.ffprobeVersion || '')}</span>` : '<span class="bad">not found</span>'}</td></tr>
          <tr><td>Data folder</td><td><a href="#" id="dataLink" class="mono">${esc(info.userData)}</a></td></tr>
          <tr><td>Database</td><td>${fmtBytes(info.db.size)} · schema v${info.db.version} · ${info.db.files.toLocaleString()} files</td></tr>
        </table>
      </div>
    </div>
    <h2>Credits</h2>
    <div class="card"><table class="kv">
      <tr><td>Electron</td><td>Desktop shell · MIT</td></tr>
      <tr><td>electron-updater</td><td>Release updates · MIT</td></tr>
      <tr><td>ffmpeg / ffprobe</td><td>Media inspection · LGPL/GPL, downloaded separately from BtbN's FFmpeg-Builds</td></tr>
      <tr><td>SQLite</td><td>Storage via Node's built-in module · public domain</td></tr>
    </table></div>`;
  $('#repoLink').onclick = e => { e.preventDefault(); L.openExternal(info.repo); };
  $('#issueLink').onclick = e => { e.preventDefault(); L.openExternal(info.repo + '/issues'); };
  $('#relLink').onclick = () => L.openExternal(info.repo + '/releases');
  $('#dataLink').onclick = e => { e.preventDefault(); L.openPath(info.userData); };
  $('#chkUpd').onclick = async () => { $('#updLine').textContent = 'Checking…'; const r = await L.update.check(); updateState = r; if (r.state === 'error') $('#updLine').textContent = 'Update check failed: ' + r.message; else if (L.isWeb) $('#updLine').textContent = r.message; else setTimeout(() => views.about(), 1500); };
  if ($('#restartUpd')) $('#restartUpd').onclick = () => L.update.install();
};
