'use strict';
/* Renderer: hash-routed views over the IPC API exposed by preload.js. No frameworks. */
const L = window.ledger;
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');

// ---------- helpers -----------------------------------------------------------
const fmtBytes = b => { if (b == null) return ''; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let n = Number(b); while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`; };
const fmtDur = s => { if (!s) return ''; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`; };
const fmtHours = s => s ? (s > 36000 ? `${Math.round(s / 3600).toLocaleString()} h` : `${(s / 3600).toFixed(1)} h`) : '';
const fmtMs = ms => ms == null ? '' : fmtDur(ms / 1000);
const fmtDate = iso => iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
const fmtAgo = iso => { if (!iso) return 'never'; const d = (Date.now() - new Date(iso)) / 1000; if (d < 90) return 'just now'; if (d < 5400) return Math.round(d / 60) + ' min ago'; if (d < 172800) return Math.round(d / 3600) + ' h ago'; return Math.round(d / 86400) + ' days ago'; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const typeName = t => ({ tv: 'TV', anime: 'Anime', movie: 'Movies', web: 'Web', adult: 'Adult' }[t] || t);
const yn = v => v == null ? '<span class="muted">?</span>' : v ? '<span class="badge ok">yes</span>' : '<span class="badge bad">no</span>';
const sxe = r => r.season == null || r.episode == null ? '' : `S${String(r.season).padStart(2, '0')}E${String(r.episode).padStart(2, '0')}${r.episode_end ? '-E' + String(r.episode_end).padStart(2, '0') : ''}`;
const uniqList = s => [...new Set(String(s || '').split(/[;,]/).filter(Boolean))].join(' ');
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;

let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}
function openModal(html) { $('#modalCard').innerHTML = html; $('#modal').hidden = false; return $('#modalCard'); }
function closeModal() { $('#modal').hidden = true; }
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// Sortable, filterable table. cols: [{key, label, num, render, sortVal, cls}]
function makeTable(rows, cols, { onRow, search, defaultSort, short } = {}) {
  let sortKey = defaultSort ? defaultSort.key : null, asc = defaultSort ? defaultSort.asc !== false : true, q = '';
  const wrap = el(`<div class="table-wrap ${short ? 'short' : ''}"></div>`);
  const render = () => {
    let data = rows;
    if (q && search) { const lq = q.toLowerCase(); data = rows.filter(r => search(r).toLowerCase().includes(lq)); }
    if (sortKey) {
      const c = cols.find(x => x.key === sortKey);
      const val = r => c.sortVal ? c.sortVal(r) : r[sortKey];
      data = [...data].sort((a, b) => { const va = val(a), vb = val(b); if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1; const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }); return asc ? r : -r; });
    }
    const head = cols.map(c => `<th class="${c.num ? 'num' : ''} ${c.key === sortKey ? 'sorted' + (asc ? ' asc' : '') : ''}" data-key="${c.key}">${esc(c.label)}</th>`).join('');
    const body = data.length ? data.map((r, i) => `<tr class="${onRow ? 'clickable' : ''}" data-i="${i}">${cols.map(c => `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="empty">Nothing here.</td></tr>`;
    wrap.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    wrap.querySelectorAll('th').forEach(th => th.onclick = () => { const k = th.dataset.key; if (sortKey === k) asc = !asc; else { sortKey = k; asc = true; } render(); });
    if (onRow) wrap.querySelectorAll('tbody tr').forEach(tr => tr.onclick = (ev) => { if (ev.target.closest('button,a')) return; onRow(data[Number(tr.dataset.i)]); });
    wrap.dispatchEvent(new CustomEvent('count', { detail: data.length }));
  };
  render();
  return { node: wrap, setQuery: v => { q = v; render(); }, rerender: render };
}
function searchToolbar(table, total, extra = '') {
  const tb = el(`<div class="toolbar"><input type="search" placeholder="Filter…"><span class="muted small count"></span><span class="grow"></span>${extra}</div>`);
  const cnt = $('.count', tb);
  const upd = n => cnt.textContent = `${n.toLocaleString()} of ${total.toLocaleString()}`;
  upd(total);
  table.node.addEventListener('count', e => upd(e.detail));
  $('input', tb).oninput = e => table.setQuery(e.target.value);
  return tb;
}
const tile = (cls, label, value, sub = '') => `<div class="tile ${cls}"><div class="label">${label}</div><div class="value" title="${esc(String(value).replace(/<[^>]+>/g, ''))}">${value}</div><div class="sub">${sub}</div></div>`;
function bars(rows, title, { order, legend = true, max: maxLimit = 10, keyLabel = k => k } = {}) {
  const keys = [...new Set(rows.map(r => String(r.k ?? 'unknown')))];
  const sum = k => rows.filter(r => String(r.k ?? 'unknown') === k).reduce((x, r) => x + r.n, 0);
  if (order) keys.sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)));
  else keys.sort((a, b) => sum(b) - sum(a));
  const max = Math.max(1, ...keys.map(sum));
  return `<div class="card"><h3>${title}</h3>${legend ? '<div class="legend"><span><i class="tv"></i>TV</span><span><i class="anime"></i>Anime</span><span><i class="movie"></i>Movies</span></div>' : ''}<div class="bars">${keys.slice(0, maxLimit).map(k => {
    const parts = rows.filter(r => String(r.k ?? 'unknown') === k); const n = sum(k);
    return `<div class="row"><span title="${esc(k)}">${esc(keyLabel(k))}</span><div class="track" style="width:${Math.round(n / max * 100)}%">${parts.map(p => `<div class="seg ${p.library_type || ''}" style="width:${p.n / n * 100}%" title="${typeName(p.library_type)}: ${p.n.toLocaleString()}"></div>`).join('')}</div><span class="num muted">${n.toLocaleString()}</span></div>`;
  }).join('') || '<div class="empty">—</div>'}</div></div>`;
}

// ---------- scan UI -----------------------------------------------------------
async function refreshScanUi() {
  const s = await L.scan.status();
  $('#btnScan').hidden = s.running; $('#btnCancel').hidden = !s.running; $('#scanProgress').hidden = !s.running;
  if (s.running && s.progress) showProgress(s.progress);
}
function showProgress(p) {
  const bar = $('#scanBar');
  if (p.total) { bar.className = ''; bar.style.width = Math.round(p.done / p.total * 100) + '%'; } else { bar.className = 'indeterminate'; }
  $('#scanMsg').textContent = (p.root ? p.root + ': ' : '') + (p.message || p.phase);
  $('#scanFile').textContent = p.file ? p.file.split('\\').pop() : '';
}
L.scan.onProgress(p => {
  if (p.phase === 'done') {
    refreshScanUi();
    toast(p.status === 'done' ? `Scan complete in ${fmtMs(p.duration_ms)}: +${p.added} added, −${p.removed} removed, ${p.modified} changed, ${p.probed} probed` : `Scan ${p.status}: ${p.message || ''}`, p.status === 'failed');
    if (['dashboard', 'changes', 'problems', 'export'].includes(currentView)) route();
    refreshBadges();
  } else { $('#scanProgress').hidden = false; $('#btnScan').hidden = true; $('#btnCancel').hidden = false; showProgress(p); }
});
$('#btnScan').onclick = async () => { try { $('#btnScan').hidden = true; $('#btnCancel').hidden = false; $('#scanProgress').hidden = false; showProgress({ message: 'Starting…' }); await L.scan.start('manual'); } catch (e) { toast(e.message, true); refreshScanUi(); } };
$('#btnCancel').onclick = () => L.scan.cancel();

$('#showAdult').onchange = async e => { await L.adult.toggle(e.target.checked); refreshBadges(); if (!e.target.checked && currentView === 'adult') location.hash = '#dashboard'; else route(); };
let updateState = { state: 'idle' };
L.update.onStatus(s => {
  const prev = updateState.state; updateState = s; paintUpdatePill();
  if (currentView !== 'about') return;
  const line = $('#updLine');
  if (line && s.state === prev) line.textContent = updLineText(s); // e.g. download percent: no full re-render, no flicker
  else route();
});
function updLineText(u, packaged = true) {
  return {
    idle: L.isWeb ? 'Press Check for updates. Installing on the Pi is one command: sudo medialedger-update.' : packaged ? 'No check yet.' : 'Running from source: updates only apply to the installed app.',
    checking: 'Checking GitHub Releases…', available: L.isWeb ? `Version ${u.version} is available. On the Pi run: sudo medialedger-update` : `Version ${u.version} is available; downloading in the background.`,
    downloading: `Downloading update… ${u.percent || 0}%`, current: 'You are on the latest version.',
    ready: `Version ${u.version} is downloaded and will install on the next restart.`, error: `Update check failed: ${u.message}`,
  }[u.state] || '';
}
function paintUpdatePill() {
  const p = $('#updatePill');
  if (updateState.state === 'ready') { p.textContent = 'restart'; p.hidden = false; }
  else if (updateState.state === 'available' || updateState.state === 'downloading') { p.textContent = 'update'; p.hidden = false; }
  else p.hidden = true;
}
async function refreshBadges() {
  try {
    const [p, d, s] = await Promise.all([L.data.problems(), L.data.dashboard(), L.settings.get()]);
    const n = p.unparsed.length + p.probeErrors.length + p.missing.length; const b = $('#problemCount'); b.textContent = n; b.hidden = !n;
    const m = $('#missingCount'); m.textContent = d.missingEpisodes.episodes.toLocaleString(); m.hidden = !d.missingEpisodes.episodes;
    const du = $('#dupCount'); du.textContent = d.duplicates; du.hidden = !d.duplicates;
    $('#navRename').style.opacity = s.renaming.enabled ? '' : '.45';
    try { const a = await L.adult.status(); $('#adultSwitch').hidden = !a.rootConfigured; $('#navAdult').hidden = !(a.rootConfigured && a.showAdult); $('#showAdult').checked = a.showAdult; const ac = $('#adultCount'); ac.textContent = a.count.toLocaleString(); ac.hidden = !a.count; } catch { /* ignore */ }
    try { const { plan } = await L.movie.plan(); const n = plan.filter(p => p.ok && !p.unchanged).length; const mp = $('#movieNameCount'); mp.textContent = n.toLocaleString(); mp.hidden = !n; } catch { /* ignore */ }
    const w = $('#watchLine'); w.hidden = !d.watch.enabled; w.textContent = d.watch.enabled ? `Watching ${d.watch.roots.length} root(s)${d.watch.pending ? ` · ${d.watch.pending} change(s) pending` : ''}` : '';
  } catch { /* ignore */ }
}
L.plex.onProgress(p => { const box = $('#metaProgress'); box.hidden = !p.running && !p.message; $('#metaBar').className = p.running ? 'indeterminate' : ''; $('#metaMsg').textContent = p.message || ''; if (!p.running) { setTimeout(() => { box.hidden = true; }, 8000); if (['ratings', 'settings', 'tv', 'anime', 'movies'].includes(currentView)) route(); } });
L.meta.onProgress(p => {
  const box = $('#metaProgress'); box.hidden = !p.running && !p.message;
  const bar = $('#metaBar'); if (p.total) { bar.className = ''; bar.style.width = Math.round(p.done / p.total * 100) + '%'; } else bar.className = 'indeterminate';
  $('#metaMsg').textContent = p.running ? `${p.message} (${p.done}/${p.total})` : p.message;
  if (!p.running) { setTimeout(() => { box.hidden = true; }, 8000); refreshBadges(); if (['missing', 'dashboard', 'tv', 'anime'].includes(currentView)) route(); }
});

// ---------- series match (expected episodes) modal ----------------------------------
async function openMatchModal(type, show, after) {
  const m = await L.meta.get(type, show);
  const seasons = m && m.seasons ? JSON.parse(m.seasons) : {};
  const card = openModal(`
    <h2>Expected episodes for “${esc(show)}”</h2>
    <div class="path">${m && m.source && m.source !== 'none' ? `Currently matched to <b>${esc(m.matched_title || '')}</b> via ${esc(m.source)}${m.status ? ` · ${esc(m.status)}` : ''}${m.locked ? ' · <span class="ok">locked by you</span>' : ' · automatic'}${m.url ? ` · <a href="#" id="mUrl">open</a>` : ''}` : (m && m.source === 'none' ? 'No match found automatically.' : 'Not looked up yet.')}</div>
    <h2 style="margin-top:4px">Search</h2>
    <div class="inline"><input id="mq" style="flex:1" value="${esc(show)}"><select id="mSrc"><option value="${type === 'anime' ? 'anilist' : 'tvmaze'}">${type === 'anime' ? 'AniList' : 'TVmaze'}</option><option value="${type === 'anime' ? 'tvmaze' : 'anilist'}">${type === 'anime' ? 'TVmaze' : 'AniList'}</option></select><button class="small" id="mSearch">Search</button></div>
    <div class="hint" style="margin-top:4px">Tip: TVmaze numbers anime by broadcast season (S1–S4), AniList by cour. Pick whichever matches how the folders are laid out.</div>
    <div id="mResults" style="margin-top:8px"></div>
    <h2>Or enter counts by hand</h2>
    <div class="seasons-edit" id="mSeasons">${[1, 2, 3, 4, 5, 6].map(s => `<label>S${s} <input type="number" min="0" data-s="${s}" value="${seasons[s] ?? ''}"></label>`).join('')}<label>+ <input type="number" min="0" id="mMoreS" placeholder="season"> <input type="number" min="0" id="mMoreN" placeholder="eps"></label></div>
    <div class="actions">
      <button class="small" id="mNone">No expected counts for this series</button>
      ${m && m.locked ? '<button class="small" id="mUnlock">Back to automatic</button>' : ''}
      <span class="grow"></span>
      <button id="mCancel">Cancel</button><button class="primary" id="mSaveManual">Save counts</button>
    </div>`);
  if ($('#mUrl', card)) $('#mUrl', card).onclick = e => { e.preventDefault(); L.openExternal(m.url); };
  $('#mCancel', card).onclick = closeModal;
  const search = async () => {
    $('#mResults', card).innerHTML = '<div class="muted small">Searching…</div>';
    try {
      const list = await L.meta.search($('#mSrc', card).value, $('#mq', card).value.trim());
      $('#mResults', card).innerHTML = list.length ? list.map(c => `<div class="candidate" data-src="${esc(c.source)}" data-id="${esc(c.id)}"><b>${esc(c.title)}</b><span class="muted">${esc(c.year || '')} · ${esc(c.format || '')}${c.episodes ? ` · ${c.episodes} eps` : ''}</span><span class="grow"></span><span class="tiny muted">use this →</span></div>`).join('') : '<div class="muted small">No results.</div>';
      card.querySelectorAll('.candidate').forEach(el => el.onclick = async () => { el.textContent = 'Loading seasons…'; try { await L.meta.setMatch(type, show, el.dataset.src, el.dataset.id); closeModal(); toast('Match saved'); after && after(); } catch (e) { toast(e.message, true); } });
    } catch (e) { $('#mResults', card).innerHTML = `<div class="bad small">${esc(e.message)}</div>`; }
  };
  $('#mSearch', card).onclick = search;
  $('#mq', card).onkeydown = e => { if (e.key === 'Enter') search(); };
  $('#mSaveManual', card).onclick = async () => {
    const out = {};
    card.querySelectorAll('#mSeasons input[data-s]').forEach(i => { if (i.value.trim() !== '') out[i.dataset.s] = Number(i.value); });
    const ms = $('#mMoreS', card).value, mn = $('#mMoreN', card).value; if (ms && mn) out[Number(ms)] = Number(mn);
    if (!Object.keys(out).length) return toast('Enter at least one season count', true);
    await L.meta.setManual(type, show, out, 'entered by hand'); closeModal(); toast('Counts saved'); after && after();
  };
  $('#mNone', card).onclick = async () => { await L.meta.setNone(type, show); closeModal(); after && after(); };
  if ($('#mUnlock', card)) $('#mUnlock', card).onclick = async () => { await L.meta.unlock(type, show); closeModal(); toast('Will be looked up automatically on the next refresh'); after && after(); };
}
const matchBtn = (type, show) => `<button class="small matchbtn" data-type="${esc(type)}" data-show="${esc(show)}">Match…</button>`;
document.addEventListener('click', e => { const b = e.target.closest('.matchbtn'); if (b) { e.stopPropagation(); openMatchModal(b.dataset.type, b.dataset.show, () => route()); } });

// ---------- fix (override) modal -------------------------------------------------
async function openFixModal(rootId, relPath, after) {
  const s = await L.override.suggest(rootId, relPath);
  if (!s) return toast('File not found in the database', true);
  const f = s.file, ov = s.override || {};
  const v = (k) => esc(ov[k] ?? f[k] ?? '');
  const isMovie = f.library_type === 'movie';
  const card = openModal(`
    <h2>Fix ${isMovie ? 'movie' : 'episode'} details</h2>
    <div class="path">${esc(f.rel_path)}</div>
    <div class="status-line" style="margin-bottom:12px">Parser currently thinks: ${isMovie ? `<b>${esc(f.movie_title || '?')}</b> (${f.movie_year || '?'})` : `<b>${esc(f.show_name || '?')}</b> ${sxe(f) || '<span class="bad">no episode</span>'}${f.episode_title ? ' · ' + esc(f.episode_title) : ''}`}${f.parse_note ? ` <span class="muted">· ${esc(f.parse_note)}</span>` : ''}</div>
    ${isMovie ? `
      <div class="field"><label>Title</label><input id="ovTitle" value="${v('movie_title')}"></div>
      <div class="field"><label>Year</label><input id="ovYear" type="number" value="${v('movie_year')}"></div>
      <div class="field"><label>Edition / tag</label><input id="ovEdition" value="${v('edition_tag')}" placeholder="4k, extended, …"></div>
      <div class="field"><label>Source</label><select id="ovSource"><option value="">detect from file name</option><option value="web" ${(ov.source || '').toLowerCase() === 'web' ? 'selected' : ''}>Web (download)</option><option value="rip" ${(ov.source || '').toLowerCase() === 'rip' ? 'selected' : ''}>Rip (disc)</option></select><div class="hint">Used by the movie naming engine. Set it when the file name has no LiLTV / WEB-DL / BRrip marker.</div></div>
    ` : `
      <div class="field"><label>Series</label><input id="ovShow" list="showList" value="${v('show_name')}"><datalist id="showList">${s.shows.map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
      <div class="field"><label>Season</label><input id="ovSeason" type="number" min="0" value="${v('season')}"></div>
      <div class="field"><label>Episode</label><div class="inline"><input id="ovEp" type="number" min="0" value="${v('episode')}" style="width:100px"> <span class="muted">to</span> <input id="ovEpEnd" type="number" min="0" value="${v('episode_end')}" style="width:100px" placeholder="(double ep)"></div></div>
      <div class="field"><label>Episode title</label><input id="ovEpTitle" value="${v('episode_title')}"></div>
    `}
    <div class="field"><label>Ignore this file</label><div class="inline"><input type="checkbox" id="ovIgnore" ${ov.ignore ? 'checked' : ''}> <span class="muted small">Not a media file to track (sample, trailer, junk). Hidden from lists and CSVs.</span></div></div>
    <div class="field"><label>Note</label><input id="ovNote" value="${esc(ov.note || '')}" placeholder="optional"></div>
    <p class="muted tiny">Saved fixes are stored in MediaLedger's database and re-applied on every future scan, even if the file is re-indexed. The file on the share is not touched.</p>
    <div class="actions">
      ${ov.id ? '<button id="ovDelete" class="danger small">Remove fix</button>' : ''}
      <span class="grow"></span>
      <button id="ovCancel">Cancel</button><button id="ovSave" class="primary">Save fix</button>
    </div>`);
  const num = id => { const x = $(id, card); if (!x) return null; const n = x.value.trim(); return n === '' ? null : Number(n); };
  const str = id => { const x = $(id, card); if (!x) return null; const t = x.value.trim(); return t === '' ? null : t; };
  $('#ovCancel', card).onclick = closeModal;
  if ($('#ovDelete', card)) $('#ovDelete', card).onclick = async () => { await L.override.delete(ov.id); closeModal(); toast('Fix removed; parser result restored'); after && after(); };
  $('#ovSave', card).onclick = async () => {
    const o = { root_id: f.root_id, rel_path: f.rel_path, library_type: f.library_type, ignore: $('#ovIgnore', card).checked ? 1 : 0, note: str('#ovNote') };
    if (isMovie) Object.assign(o, { movie_title: str('#ovTitle'), movie_year: num('#ovYear'), edition_tag: str('#ovEdition'), source: str('#ovSource'), keep: ov.keep ?? null });
    else Object.assign(o, { show_name: str('#ovShow'), season: num('#ovSeason'), episode: num('#ovEp'), episode_end: num('#ovEpEnd'), episode_title: str('#ovEpTitle'), keep: ov.keep ?? null });
    const r = await L.override.save(o);
    closeModal();
    toast(r.file && r.file.parse_ok ? 'Fix saved and applied' : (o.ignore ? 'File ignored' : 'Saved, but still missing a season or episode'), !(r.file && (r.file.parse_ok || o.ignore)));
    after && after();
  };
}
const fixBtn = (r, after) => `<button class="small fixbtn" data-root="${esc(r.root_id)}" data-rel="${esc(r.rel_path)}">Fix…</button>`;
document.addEventListener('click', e => { const b = e.target.closest('.fixbtn'); if (b) { e.stopPropagation(); openFixModal(b.dataset.root, b.dataset.rel, () => route()); } });

function starsHtml(v, type, key, title) {
  const n = Math.round((v || 0) * 2) / 2;
  return `<span class="stars" data-type="${esc(type)}" data-key="${esc(key)}" data-title="${esc(title || '')}" title="${v ? v + ' / 5' : 'not rated'}">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? 'on' : ''}" data-v="${i}">★</i>`).join('')}</span>`;
}
document.addEventListener('click', async e => {
  const st = e.target.closest('.stars i'); if (!st) return;
  const box = st.parentElement; const v = Number(st.dataset.v);
  const cur = box.querySelectorAll('i.on').length;
  const next = cur === v ? null : v; // clicking the current value clears it
  await L.ratings.setUser(box.dataset.type, box.dataset.key, box.dataset.title, next, box.dataset.note || null);
  box.querySelectorAll('i').forEach(i => i.classList.toggle('on', next != null && Number(i.dataset.v) <= next));
  box.title = next ? next + ' / 5' : 'not rated';
});

// ---------- views -----------------------------------------------------------
const views = {};

views.dashboard = async () => {
  const d = await L.data.dashboard();
  const t = Object.fromEntries(d.byType.map(r => [r.library_type, r]));
  const tot = d.byType.reduce((a, r) => ({ files: a.files + r.files, bytes: a.bytes + (r.bytes || 0), seconds: a.seconds + (r.seconds || 0), probed: a.probed + r.probed, captioned: a.captioned + r.captioned }), { files: 0, bytes: 0, seconds: 0, probed: 0, captioned: 0 });
  const capPct = r => r && r.probed ? pct(r.captioned, r.files) + '% captioned' : 'not probed yet';
  const last = d.lastScans[0];
  const lowRes = d.lowRes.reduce((a, r) => a + r.n, 0);
  const health = tot.files ? Math.max(0, 100 - pct(d.byType.reduce((a, r) => a + r.unparsed + r.probe_errors, 0) + d.missingFiles, tot.files)) : 0;

  view.innerHTML = `
    <h1>Dashboard</h1>
    <div class="tiles">
      ${tile('', 'Library', `${tot.files.toLocaleString()} files`, `${fmtBytes(tot.bytes)} · ${fmtHours(tot.seconds)} of video`)}
      ${tile('tv', 'TV Shows', `${d.titles.tv} series`, `${(t.tv?.files || 0).toLocaleString()} episodes · ${fmtBytes(t.tv?.bytes)} · ${capPct(t.tv)}`)}
      ${tile('anime', 'Anime', `${d.titles.anime} series`, `${(t.anime?.files || 0).toLocaleString()} episodes · ${fmtBytes(t.anime?.bytes)} · ${capPct(t.anime)}`)}
      ${tile('movie', 'Movies', `${d.titles.movie} titles`, `${(t.movie?.files || 0).toLocaleString()} files · ${fmtBytes(t.movie?.bytes)} · ${capPct(t.movie)}`)}
    </div>
    <div class="tiles compact">
      ${tile(d.multiples.n ? 'warnt' : '', 'Movie multiples', `${d.multiples.n} titles`, `${d.multiples.extra} extra file(s) · ${fmtBytes(d.multiples.bytes)}`)}
      ${tile(health > 97 ? 'okt' : 'warnt', 'Library health', `${health}%`, `${d.byType.reduce((a, r) => a + r.unparsed, 0)} unparsed · ${d.byType.reduce((a, r) => a + r.probe_errors, 0)} probe errors · ${d.missingFiles} missing`)}
      ${tile('', 'Captions', `${pct(tot.captioned, tot.files)}%`, `${tot.captioned.toLocaleString()} of ${tot.files.toLocaleString()} files have subtitles`)}
      ${tile(lowRes ? 'warnt' : 'okt', 'Below 720p', lowRes.toLocaleString(), d.lowRes.map(r => `${typeName(r.library_type)} ${r.n}`).join(' · ') || 'nothing SD')}
      ${tile('', 'Avg bitrate', t.tv || t.movie ? `${Math.round(d.byType.reduce((a, r) => a + (r.avg_kbps || 0) * r.files, 0) / Math.max(1, tot.files)).toLocaleString()} kbps` : '—', d.byType.map(r => `${typeName(r.library_type)} ${Math.round(r.avg_kbps || 0).toLocaleString()}`).join(' · '))}
      ${tile('', 'Last scan', last ? fmtAgo(last.started) : 'never', last ? `${last.status} in ${fmtMs(last.duration_ms)} · +${last.added} −${last.removed} ~${last.modified}` : 'Run a scan to populate the library')}
      ${tile('', 'Manual fixes', d.overrides, d.overrides ? 'applied on every scan' : 'none needed yet')}
      ${tile('', 'Last export', d.lastExport ? fmtAgo(d.lastExport.ts) : 'never', d.lastExport ? `${JSON.parse(d.lastExport.files || '[]').length} CSV files` : '')}
    </div>
    <div class="tiles compact">
      ${tile(d.missingEpisodes.episodes ? 'badt' : 'okt', 'Missing episodes', d.missingEpisodes.episodes.toLocaleString(), `${d.missingEpisodes.series} series · ${d.missingEpisodes.matched} matched · ${d.missingEpisodes.unmatched} unmatched${d.missingEpisodes.pending ? ` · ${d.missingEpisodes.pending} pending` : ''}`)}
      ${tile(d.duplicates ? 'warnt' : 'okt', 'Duplicate episodes', d.duplicates, 'same season/episode, several files')}
      ${tile(d.quality.mixedSeries ? 'warnt' : 'okt', 'Mixed-quality series', d.quality.mixedSeries, 'more than one resolution')}
      ${tile(d.quality.lowBitrate ? 'warnt' : 'okt', 'Low-bitrate files', d.quality.lowBitrate.toLocaleString(), 'below the threshold for their resolution')}
      ${tile('', 'Undefined audio language', d.quality.undAudio.toLocaleString(), 'no language tag on the audio track')}
      ${tile(d.watch.enabled ? 'okt' : '', 'Folder watch', d.watch.enabled ? `${d.watch.roots.length} roots` : 'off', d.watch.enabled ? (d.watch.lastEvent ? `last change ${fmtAgo(d.watch.lastEvent.ts)}` : 'no changes seen yet') : 'enable in Settings')}
    </div>
    <div class="grid4" style="margin-top:14px">
      ${bars(d.resolution, 'Resolution', { order: ['4K', '1440p', '1080p', '720p', '576p', '480p', 'SD', 'unknown'] })}
      ${bars(d.videoCodec, 'Video codec')}
      ${bars(d.audioCodec, 'Audio codec', { keyLabel: k => k.replace(/;/g, '+') })}
      ${bars(d.container, 'Container')}
    </div>
    <div class="grid4" style="margin-top:14px">
      ${bars(d.audioLang, 'Audio languages', { keyLabel: k => k.replace(/;/g, '+') })}
      ${bars(d.subLang, 'Subtitle languages', { keyLabel: k => k.replace(/;/g, '+') })}
      ${bars(d.fps, 'Frame rate', { keyLabel: k => k === 'unknown' ? k : k + ' fps' })}
      ${bars(d.hdr, 'Dynamic range')}
    </div>
    <div class="grid3" style="margin-top:14px">
      <div class="card"><h3>Recently added <a class="right" href="#changes">change log →</a></h3><div id="recentAdded"></div></div>
      <div class="card"><h3>Largest series</h3><div id="biggest"></div></div>
      <div class="card"><h3>Largest movie files</h3><div id="biggestMovies"></div></div>
    </div>
    <div class="grid2" style="margin-top:14px">
      <div class="card"><h3>Most missing episodes <a class="right" href="#missing">all series →</a></h3><div id="gaps"></div></div>
      <div class="card"><h3>Scan history</h3><div id="scanHist"></div></div>
    </div>`;
  $('#recentAdded').append(d.recentlyAdded.length ? el(`<table>${d.recentlyAdded.map(r => `<tr><td><span class="badge ${r.library_type}">${typeName(r.library_type)}</span></td><td class="wrap">${esc(r.library_type === 'movie' ? `${r.movie_title} (${r.movie_year || '?'})` : `${r.show_name} ${sxe(r)}`)}<span class="sub">${esc(r.file_name)}</span></td><td class="num muted tiny">${fmtAgo(r.first_seen)}</td></tr>`).join('')}</table>`) : el('<div class="empty">Nothing yet</div>'));
  $('#biggest').append(el(`<table>${d.biggestShows.map(s => `<tr><td><span class="badge ${s.library_type}">${typeName(s.library_type)}</span></td><td class="wrap">${esc(s.show_name)}</td><td class="num">${s.episodes} eps</td><td class="num">${fmtBytes(s.bytes)}</td><td class="num muted">${fmtHours(s.seconds)}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table>`));
  $('#biggestMovies').append(el(`<table>${d.biggestMovies.map(m => `<tr><td class="wrap">${esc(m.movie_title)} <span class="muted">(${m.movie_year || '?'})</span></td><td>${esc(m.resolution || '')}</td><td class="muted">${esc(m.video_codec || '')}</td><td class="num">${fmtBytes(m.size)}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table>`));
  $('#gaps').append(d.missingEpisodes.top.length ? el(`<table>${d.missingEpisodes.top.map(g => `<tr><td><span class="badge ${g.library_type}">${typeName(g.library_type)}</span></td><td class="wrap"><a href="#${g.library_type}/${encodeURIComponent(g.show_name)}">${esc(g.show_name)}</a>${g.matched_title && g.matched_title !== g.show_name ? `<span class="sub">${esc(g.matched_title)}</span>` : ''}</td><td class="num">${g.have} of ${g.expected}</td><td class="num bad">${g.missing_count} missing</td><td class="muted tiny wrap">${esc(missingText(g.missing, 6))}</td></tr>`).join('')}</table>`) : el(`<div class="empty">${d.missingEpisodes.matched ? 'Every matched series is complete' : 'No expected counts yet — they are fetched in the background after a scan'}</div>`));
  $('#scanHist').append(el(`<table>${d.lastScans.map(s => `<tr><td class="muted tiny">${fmtDate(s.started)}</td><td><span class="badge ${s.status === 'done' ? 'ok' : s.status === 'running' ? '' : 'bad'}">${s.status}</span></td><td class="muted">${s.trigger}${s.threads > 1 ? ` · ${s.threads}t` : ''}</td><td class="num">${fmtMs(s.duration_ms)}</td><td class="num"><span class="kind-added">+${s.added}</span> <span class="kind-removed">−${s.removed}</span> <span class="kind-modified">~${s.modified}</span></td><td class="num muted">${s.probed} probed</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table>`));
};

async function seriesView(type) {
  const rows = await L.data.series(type);
  const cols = [
    { key: 'show_name', label: 'Series', cls: 'wrap' },
    { key: 'seasons', label: 'Seasons', num: true, render: r => r.min_season === r.max_season ? `${r.seasons}` : `${r.seasons} <span class="muted tiny">S${r.min_season}–S${r.max_season}</span>` },
    { key: 'episodes', label: 'Episodes', num: true },
    { key: 'seconds', label: 'Runtime', num: true, render: r => fmtHours(r.seconds) },
    { key: 'bytes', label: 'Size', num: true, render: r => fmtBytes(r.bytes) },
    { key: 'resolutions', label: 'Resolution', render: r => (r.resolutions || '').split(',').filter(Boolean).map(x => `<span class="badge">${esc(x)}</span>`).join('') },
    { key: 'codecs', label: 'Codec', render: r => esc((r.codecs || '').replace(/,/g, ' ')) },
    { key: 'audio_langs', label: 'Audio', render: r => esc(uniqList(r.audio_langs)) },
    { key: 'sub_langs', label: 'Subs', render: r => esc(uniqList(r.sub_langs)) },
    { key: 'captioned', label: 'Captions', num: true, sortVal: r => r.probed ? r.captioned / r.episodes : -1, render: r => r.probed ? `<span class="badge ${r.captioned === r.episodes ? 'ok' : r.captioned ? 'warn' : 'bad'}">${pct(r.captioned, r.episodes)}%</span>` : '<span class="muted">—</span>' },
    { key: 'online_rating', label: 'Rating', num: true, render: r => r.online_rating != null ? `<span title="online average">${r.online_rating.toFixed(1)}</span>` : '<span class="muted">—</span>' },
    { key: 'my_rating', label: 'Mine', sortVal: r => r.my_rating || 0, render: r => starsHtml(r.my_rating, type, r.show_name, r.show_name) + (r.plex_user != null ? ` <span class="muted tiny" title="your Plex rating">P${Number(r.plex_user / 2).toFixed(1)}</span>` : '') },
    { key: 'watched', label: 'Watched', num: true, sortVal: r => r.plex_linked ? r.watched / r.episodes : -1, render: r => r.plex_linked ? `<span class="${r.watched === r.episodes ? 'ok' : ''}">${pct(r.watched, r.episodes)}%</span>` : '<span class="muted">—</span>' },
    { key: 'missing_count', label: 'Missing', num: true, sortVal: r => r.expected ? r.missing_count : -1, render: r => r.expected ? (r.missing_count ? `<span class="badge bad">${r.missing_count}</span> <span class="muted tiny">of ${r.expected}</span>` : '<span class="badge ok">complete</span>') : (r.meta_source === 'none' ? '<span class="badge" title="no match found">no match</span>' : '<span class="muted">—</span>') },
    { key: 'unparsed', label: 'Issues', num: true, render: r => (r.unparsed ? `<span class="badge warn">${r.unparsed} unparsed</span>` : '') + (r.probed < r.episodes ? `<span class="badge">${r.episodes - r.probed} unprobed</span>` : '') },
  ];
  const table = makeTable(rows, cols, { search: r => r.show_name, defaultSort: { key: 'show_name' }, onRow: r => { location.hash = `#${type}/${encodeURIComponent(r.show_name)}`; } });
  const eps = rows.reduce((a, r) => a + r.episodes, 0), bytes = rows.reduce((a, r) => a + (r.bytes || 0), 0), secs = rows.reduce((a, r) => a + (r.seconds || 0), 0);
  view.innerHTML = `<h1>${typeName(type)}</h1><div class="tiles compact"><div class="tile ${type}"><div class="label">Series</div><div class="value">${rows.length}</div></div>${tile('', 'Episodes', eps.toLocaleString())}${tile('', 'Size', fmtBytes(bytes))}${tile('', 'Runtime', fmtHours(secs))}${tile('', 'Full captions', rows.filter(r => r.probed && r.captioned === r.episodes).length + ' series')}${tile('', 'With issues', rows.filter(r => r.unparsed).length + ' series')}</div>`;
  view.append(searchToolbar(table, rows.length), table.node);
}
views.tv = () => seriesView('tv');
views.anime = () => seriesView('anime');

// "S3: 5,7; S6–S12 entirely" — whole missing seasons collapse into ranges, partial ones list episodes.
function missingText(list, max = 8) {
  if (!list || !list.length) return '';
  const whole = list.filter(x => x.missing.length >= x.expected).map(x => x.season).sort((a, b) => a - b);
  const partial = list.filter(x => x.missing.length < x.expected);
  const ranges = [];
  for (const s of whole) { const last = ranges[ranges.length - 1]; if (last && last[1] === s - 1) last[1] = s; else ranges.push([s, s]); }
  const parts = partial.map(x => `S${x.season}: ${x.missing.length > max ? x.missing.slice(0, max).join(',') + `,… (${x.missing.length})` : x.missing.join(',')}`);
  if (ranges.length) parts.push(ranges.map(([a, b]) => a === b ? `S${a}` : `S${a}–S${b}`).join(', ') + ' entirely');
  return parts.join('; ');
}

function missingGrid(m) {
  if (!m || !m.seasons) return '';
  const rows = Object.entries(m.seasons).filter(([s, n]) => s !== '0' && n).sort((a, b) => Number(a[0]) - Number(b[0])).map(([s, n]) => {
    const miss = new Set((m.missing.find(x => x.season === Number(s)) || { missing: [] }).missing);
    const cells = n <= 60 ? Array.from({ length: n }, (_, i) => `<i class="${miss.has(i + 1) ? 'miss' : ''}" title="S${s}E${i + 1}">${i + 1}</i>`).join('') : `<span class="muted tiny">${n} episodes · ${miss.size} missing${miss.size ? ': ' + [...miss].slice(0, 20).join(', ') + (miss.size > 20 ? '…' : '') : ''}</span>`;
    return `<div class="seasonrow"><b>S${s}</b><div class="epgrid">${cells}</div><span class="num ${miss.size ? 'bad' : 'ok'}">${n - miss.size}/${n}</span></div>`;
  }).join('');
  return `<div class="card" style="margin-bottom:12px"><h3>Expected episodes <span class="right muted">${esc(m.matched_title || '')}${m.status ? ` · ${esc(m.status)}` : ''} · via ${esc(m.source || '?')}${m.absolute ? ' · <span class="warn">absolute numbering on disk, some seasons skipped</span>' : ''}</span></h3>${rows || '<div class="empty">no season data</div>'}</div>`;
}

async function episodesView(type, show) {
  const data = await L.data.episodes(type, show);
  const rows = data.files, miss = data.missing;
  const live = rows.filter(r => !r.missing);
  const bytes = live.reduce((a, r) => a + (r.size || 0), 0), secs = live.reduce((a, r) => a + (r.duration_s || 0), 0);
  const cols = [
    { key: 'season', label: 'Ep', sortVal: r => (r.season ?? 999) * 10000 + (r.episode ?? 9999), render: r => sxe(r) || '<span class="badge warn">?</span>' },
    { key: 'episode_title', label: 'Title', cls: 'wrap', render: r => esc(r.episode_title || '') },
    { key: 'file_name', label: 'File', cls: 'wrap', render: r => `<span title="${esc(r.rel_path)}">${esc(r.file_name)}</span>${r.missing ? ' <span class="badge bad">missing</span>' : ''}${r.has_override ? ' <span class="badge ok" title="manual fix applied">fixed</span>' : ''}` },
    { key: 'duration_s', label: 'Length', num: true, render: r => fmtDur(r.duration_s) },
    { key: 'resolution', label: 'Res', render: r => r.resolution ? `${esc(r.resolution)} <span class="muted tiny">${r.width}×${r.height}</span>` : '' },
    { key: 'fps', label: 'FPS', num: true },
    { key: 'video_codec', label: 'Video', render: r => r.video_codec ? `${esc(r.video_codec)}${r.bit_depth && r.bit_depth !== 8 ? ` <span class="muted tiny">${r.bit_depth}-bit</span>` : ''}${r.hdr && r.hdr !== 'SDR' ? ` <span class="badge">${esc(r.hdr)}</span>` : ''}` : '' },
    { key: 'audio_langs', label: 'Audio', render: r => r.audio_codecs ? `${esc(r.audio_langs || '')} <span class="muted tiny">${esc(r.audio_codecs)} ${esc(r.audio_channels || '')}</span>` : '' },
    { key: 'sub_langs', label: 'Subs', render: r => r.sub_count ? `${esc(r.sub_langs || '')} <span class="muted tiny">${r.sub_count} track(s)</span>` : (r.sidecar_subs ? `<span class="muted tiny">${esc(r.sidecar_subs)}</span>` : '') },
    { key: 'has_captions', label: 'Captions', render: r => yn(r.has_captions) },
    { key: 'bitrate_kbps', label: 'kbps', num: true },
    { key: 'size', label: 'Size', num: true, render: r => fmtBytes(r.size) },
    { key: 'id', label: '', render: r => fixBtn(r) },
  ];
  const table = makeTable(rows, cols, { search: r => `${r.file_name} ${r.episode_title || ''} ${sxe(r)}`, defaultSort: { key: 'season' }, onRow: r => L.showItem(r.abs_path) });
  view.innerHTML = `<div class="detail-head"><span class="back" id="back">← ${typeName(type)}</span><h1>${esc(show)}</h1><span class="muted">${live.length} episodes · ${fmtBytes(bytes)} · ${fmtHours(secs)}</span>${miss && miss.expected ? (miss.missing_count ? `<span class="badge bad">${miss.missing_count} missing of ${miss.expected}</span>` : '<span class="badge ok">complete</span>') : ''}<span class="grow"></span>${matchBtn(type, show)}</div>`;
  $('#back').onclick = () => { location.hash = '#' + type; };
  if (miss && miss.expected) view.insertAdjacentHTML('beforeend', missingGrid(miss));
  view.append(searchToolbar(table, rows.length, '<span class="muted tiny">Click a row to reveal the file in Explorer · Fix… corrects the parsed details</span>'), table.node);
}

views.movies = async () => {
  const rows = await L.data.movies();
  const cols = [
    { key: 'title', label: 'Title', cls: 'wrap', render: r => `${esc(r.title)}${r.files > 1 ? ` <span class="badge warn">×${r.files}</span>` : ''}` },
    { key: 'year', label: 'Year', num: true },
    { key: 'files', label: 'Files', num: true },
    { key: 'resolutions', label: 'Versions', render: r => (r.resolutions || '').split(',').filter(Boolean).map(x => `<span class="badge">${esc(x)}</span>`).join('') + (r.editions ? ` <span class="muted tiny">${esc(r.editions)}</span>` : '') },
    { key: 'seconds', label: 'Length', num: true, render: r => fmtDur(r.seconds) },
    { key: 'codecs', label: 'Codec', render: r => esc((r.codecs || '').replace(/,/g, ' ')) },
    { key: 'audio_langs', label: 'Audio', render: r => esc(uniqList(r.audio_langs)) },
    { key: 'sub_langs', label: 'Subs', render: r => esc(uniqList(r.sub_langs)) },
    { key: 'has_captions', label: 'Captions', render: r => r.probed ? yn(r.has_captions) : '<span class="muted">—</span>' },
    { key: 'bytes', label: 'Size', num: true, render: r => fmtBytes(r.bytes) },
  ];
  let onlyMulti = false;
  const build = () => makeTable(onlyMulti ? rows.filter(r => r.files > 1) : rows, cols, { search: r => `${r.title} ${r.year || ''}`, defaultSort: { key: 'title' }, onRow: r => { location.hash = '#movies/' + encodeURIComponent(r.group_key); } });
  let table = build();
  const multi = rows.filter(r => r.files > 1);
  view.innerHTML = `<h1>Movies</h1><div class="tiles compact"><div class="tile movie"><div class="label">Titles</div><div class="value">${rows.length}</div></div>${tile('', 'Files', rows.reduce((a, r) => a + r.files, 0))}${tile('', 'Size', fmtBytes(rows.reduce((a, r) => a + (r.bytes || 0), 0)))}${tile(multi.length ? 'warnt' : '', 'Multiples', multi.length + ' titles', fmtBytes(multi.reduce((a, r) => a + (r.bytes || 0), 0)))}${tile('', 'With captions', rows.filter(r => r.has_captions === 1).length)}</div>`;
  const tb = searchToolbar(table, rows.length, '<label class="inline small"><input type="checkbox" id="multi"> Only titles with multiple files</label>');
  view.append(tb, table.node);
  $('#multi', tb).onchange = e => { onlyMulti = e.target.checked; const q = $('input[type=search]', tb).value; const nt = build(); table.node.replaceWith(nt.node); table = nt; nt.node.addEventListener('count', ev => $('.count', tb).textContent = `${ev.detail} of ${rows.length}`); nt.setQuery(q); };
};

async function movieFilesView(groupKey) {
  const rows = await L.data.movieFiles(groupKey);
  const r0 = rows[0] || {};
  const cols = [
    { key: 'file_name', label: 'File', cls: 'wrap', render: r => `<span title="${esc(r.rel_path)}">${esc(r.file_name)}</span>${r.missing ? ' <span class="badge bad">missing</span>' : ''}${r.has_override ? ' <span class="badge ok">fixed</span>' : ''}` },
    { key: 'edition_tag', label: 'Edition / tag' },
    { key: 'duration_s', label: 'Length', num: true, render: r => fmtDur(r.duration_s) },
    { key: 'resolution', label: 'Res', render: r => r.resolution ? `${esc(r.resolution)} <span class="muted tiny">${r.width}×${r.height}</span>` : '' },
    { key: 'fps', label: 'FPS', num: true },
    { key: 'video_codec', label: 'Video', render: r => r.video_codec ? `${esc(r.video_codec)} ${esc(r.video_profile || '')}${r.bit_depth && r.bit_depth !== 8 ? ` ${r.bit_depth}-bit` : ''}${r.hdr && r.hdr !== 'SDR' ? ` <span class="badge">${esc(r.hdr)}</span>` : ''}` : '' },
    { key: 'audio_langs', label: 'Audio', render: r => r.audio_codecs ? `${esc(r.audio_langs || '')} <span class="muted tiny">${esc(r.audio_codecs)} ${esc(r.audio_channels || '')}</span>` : '' },
    { key: 'sub_langs', label: 'Subs', render: r => r.sub_count ? `${esc(r.sub_langs || '')} <span class="muted tiny">${r.sub_count} track(s)</span>` : (r.sidecar_subs ? `<span class="muted tiny">${esc(r.sidecar_subs)}</span>` : '') },
    { key: 'has_captions', label: 'Captions', render: r => yn(r.has_captions) },
    { key: 'bitrate_kbps', label: 'kbps', num: true },
    { key: 'size', label: 'Size', num: true, render: r => fmtBytes(r.size) },
    { key: 'ext', label: 'Container' },
    { key: 'id', label: '', render: r => fixBtn(r) },
  ];
  const table = makeTable(rows, cols, { onRow: r => L.showItem(r.abs_path) });
  view.innerHTML = `<div class="detail-head"><span class="back" id="back">← Movies</span><h1>${esc(r0.movie_title || groupKey)}${r0.movie_year ? ` <span class="muted">(${r0.movie_year})</span>` : ''}</h1><span class="muted">${rows.length} file(s)</span></div>`;
  $('#back').onclick = () => { location.hash = '#movies'; };
  view.append(table.node);
}

views.changes = async () => {
  const [scans, st] = await Promise.all([L.scan.list(50), L.data.changeStats()]);
  const k = Object.fromEntries(st.byKind.map(r => [r.kind, r.n]));
  const k7 = Object.fromEntries(st.last7.map(r => [r.kind, r.n]));
  const maxDay = Math.max(1, ...st.perDay.map(d => d.added + d.removed + d.modified));
  view.innerHTML = `<h1>Change log</h1>
    <div class="tiles compact">
      ${tile('', 'Scans completed', st.scans.n, `avg ${fmtMs(st.scans.avg_ms)} · last ${fmtAgo(st.scans.last)}`)}
      ${tile('okt', 'Added', (k.added || 0).toLocaleString(), `${k7.added || 0} in the last 7 days`)}
      ${tile(k.removed ? 'badt' : '', 'Removed', (k.removed || 0).toLocaleString(), `${k7.removed || 0} in the last 7 days`)}
      ${tile(k.modified ? 'warnt' : '', 'Modified', (k.modified || 0).toLocaleString(), `${k7.modified || 0} in the last 7 days`)}
      ${tile('', 'Returned', (k.returned || 0).toLocaleString(), 'files that came back')}
      ${tile(k.probe_error ? 'warnt' : '', 'Errors logged', ((k.probe_error || 0) + (k.root_offline || 0) + (k.warning || 0)).toLocaleString(), `${k.root_offline || 0} root offline`)}
    </div>
    <div class="card" style="margin-top:12px"><h3>Last 30 days <span class="right legend"><span><i class="added"></i>added</span><span><i class="removed"></i>removed</span><span><i class="modified"></i>modified</span></span></h3>
      <div class="spark">${st.perDay.length ? st.perDay.map(d => `<div title="${d.day}: +${d.added} −${d.removed} ~${d.modified}"><i class="added" style="height:${Math.round(d.added / maxDay * 44)}px"></i><i class="modified" style="height:${Math.round(d.modified / maxDay * 44)}px"></i><i class="removed" style="height:${Math.round(d.removed / maxDay * 44)}px"></i></div>`).join('') : '<div class="empty" style="width:100%">No changes in the last 30 days</div>'}</div></div>
    <div class="toolbar" style="margin-top:14px"><label class="muted small">Scan</label><select id="scanSel"><option value="">Latest 500 changes</option>${scans.map(s => `<option value="${s.id}">#${s.id} · ${fmtDate(s.started)} · ${s.status} · ${s.trigger} · +${s.added} −${s.removed} ~${s.modified}</option>`).join('')}</select><label class="muted small">Kind</label><select id="kindSel"><option value="">all</option>${['added', 'removed', 'modified', 'returned', 'probe_error', 'root_offline', 'warning'].map(k => `<option>${k}</option>`).join('')}</select><span class="grow"></span></div><div id="scanSummary"></div><div id="changesTable"></div>`;
  const load = async () => {
    const scanId = Number($('#scanSel').value) || null;
    const kind = $('#kindSel').value;
    let rows = await L.data.changes(scanId, 5000);
    if (kind) rows = rows.filter(r => r.kind === kind);
    const s = scanId ? scans.find(x => x.id === scanId) : null;
    $('#scanSummary').innerHTML = s ? `<div class="status-line" style="margin-bottom:10px">Started ${fmtDate(s.started)} · took ${fmtMs(s.duration_ms)} · ${s.files_seen.toLocaleString()} files seen · ${s.probed.toLocaleString()} probed · ${s.errors} errors${s.threads > 1 ? ` · ${s.threads} threads` : ''}${s.note ? `<br><span class="mono">${esc(s.note)}</span>` : ''}</div>` : '';
    const cols = [
      { key: 'ts', label: 'When', render: r => fmtDate(r.ts) },
      { key: 'scan_id', label: 'Scan', num: true },
      { key: 'kind', label: 'Kind', render: r => `<span class="kind-${r.kind}">${r.kind}</span>` },
      { key: 'library_type', label: 'Library', render: r => r.library_type ? `<span class="badge ${r.library_type}">${typeName(r.library_type)}</span>` : '' },
      { key: 'path', label: 'Path', cls: 'pathcell' },
      { key: 'detail', label: 'Detail', cls: 'wrap', render: r => { try { const d = JSON.parse(r.detail); if (d.before && d.after) return `<span class="muted tiny">${esc(d.before.resolution || '?')} ${fmtDur(d.before.duration_s)} ${fmtBytes(d.before.size)} → ${esc(d.after.resolution || '?')} ${fmtDur(d.after.duration_s)}</span>`; if (d.message) return `<span class="tiny">${esc(d.message)}</span>`; return `<span class="muted tiny">${esc(Object.entries(d).filter(([, v]) => v != null).map(([k, v]) => `${k}=${typeof v === 'number' && k.includes('size') ? fmtBytes(v) : v}`).join(' '))}</span>`; } catch { return esc(r.detail || ''); } } },
    ];
    const t = makeTable(rows, cols, { search: r => `${r.path} ${r.kind}` });
    const box = $('#changesTable'); box.innerHTML = ''; box.append(searchToolbar(t, rows.length), t.node);
  };
  $('#scanSel').onchange = load; $('#kindSel').onchange = load;
  load();
};

views.problems = async () => {
  const p = await L.data.problems();
  const total = p.unparsed.length + p.probeErrors.length + p.missing.length;
  view.innerHTML = `<h1>Problems</h1>
    <p class="lead">Things the scanner could not resolve on its own. Use <b>Fix…</b> to correct a file's details; fixes are remembered and re-applied on every rescan, so a corrected file never shows up here again.</p>
    <div class="tiles compact">
      ${tile(total ? 'warnt' : 'okt', 'Open problems', total, total ? 'need attention' : 'all clear')}
      ${tile(p.unparsed.length ? 'warnt' : '', 'Unparsed names', p.unparsed.length, 'no season/episode found')}
      ${tile(p.probeErrors.length ? 'badt' : '', 'ffprobe errors', p.probeErrors.length, 'unreadable files')}
      ${tile(p.missing.length ? 'badt' : '', 'Missing files', p.missing.length, 'seen before, gone now')}
      ${tile(p.duplicates.length ? 'warnt' : '', 'Duplicate episodes', p.duplicates.length, 'same S/E, several files')}
      ${tile('okt', 'Fixes saved', p.overrides.length, `${p.ignored.length} ignored files`)}
    </div>`;
  const sec = (title, rows, cols, extra = '', search = r => r.rel_path) => { const t = makeTable(rows, cols, { search, short: true }); const box = el(`<div><div class="section-head"><h2>${title} <span class="muted">(${rows.length})</span></h2>${extra}</div></div>`); box.append(t.node); return box; };
  const lib = { key: 'library_type', label: 'Library', render: r => `<span class="badge ${r.library_type}">${typeName(r.library_type)}</span>` };
  view.append(
    sec('Unparsed file names', p.unparsed, [lib, { key: 'rel_path', label: 'Path', cls: 'pathcell' }, { key: 'parse_note', label: 'Why' }, { key: 'show_name', label: 'Guess', render: r => esc(r.library_type === 'movie' ? `${r.movie_title || ''} ${r.movie_year || ''}` : `${r.show_name || ''} ${r.season != null ? 'S' + r.season : ''} ${r.episode != null ? 'E' + r.episode : ''}`) }, { key: 'id', label: '', render: r => fixBtn(r) }]),
    sec('ffprobe errors', p.probeErrors, [lib, { key: 'rel_path', label: 'Path', cls: 'pathcell' }, { key: 'probe_error', label: 'Error', cls: 'wrap' }, { key: 'id', label: '', render: r => fixBtn(r) }]),
    sec('Duplicate episodes', p.duplicates, [lib, { key: 'show_name', label: 'Series' }, { key: 'season', label: 'Ep', render: r => sxe(r) }, { key: 'n', label: 'Files', num: true }, { key: 'paths', label: 'Paths', cls: 'pathcell', render: r => esc(r.paths).replace(/ \| /g, '<br>') }], '', r => `${r.show_name} ${r.paths}`),
    sec('Missing files', p.missing, [lib, { key: 'rel_path', label: 'Path', cls: 'pathcell' }, { key: 'last_seen', label: 'Last seen', render: r => fmtDate(r.last_seen) }], '<button class="small" id="purge">Forget missing files</button>'),
    sec('Manual fixes', p.overrides, [{ key: 'library_type', label: 'Library', render: r => `<span class="badge ${r.library_type}">${typeName(r.library_type)}</span>` }, { key: 'rel_path', label: 'Path', cls: 'pathcell' }, { key: 'show_name', label: 'Fix', cls: 'wrap', render: r => r.ignore ? '<span class="badge">ignored</span>' : esc(r.library_type === 'movie' ? `${r.movie_title || ''} ${r.movie_year ? '(' + r.movie_year + ')' : ''} ${r.edition_tag || ''}` : `${r.show_name || ''} ${r.season != null ? 'S' + r.season : ''}${r.episode != null ? 'E' + r.episode : ''} ${r.episode_title || ''}`) }, { key: 'note', label: 'Note' }, { key: 'updated', label: 'Updated', render: r => fmtDate(r.updated) }, { key: 'id', label: '', render: r => r.file_id ? fixBtn(r) : '<span class="muted tiny">file gone</span>' }]),
  );
  $('#purge').onclick = async () => { const n = await L.data.purgeMissing(); toast(`Removed ${n} missing file record(s)`); views.problems(); refreshBadges(); };
};

views.export = async () => {
  const [list, info, s] = await Promise.all([L.exportList(), L.appInfo(), L.settings.get()]);
  const last = list[0];
  view.innerHTML = `<h1>CSV export</h1>
    <p class="lead">Every export writes eight CSV files into a timestamped folder and refreshes the <span class="mono">latest\\</span> copy, so a spreadsheet can always point at the same file names.</p>
    <div class="tiles compact">
      ${tile('', 'Last export', last ? fmtAgo(last.ts) : 'never', last ? `${JSON.parse(last.files || '[]').length} files · ${(last.rows || 0).toLocaleString()} rows` : '')}
      ${tile('', 'Exports on record', list.length)}
      ${tile(s.autoExportAfterScan ? 'okt' : '', 'After each scan', s.autoExportAfterScan ? 'on' : 'off', 'change in Settings')}
    </div>
    <div class="card" style="margin-top:12px">
      <div class="inline"><button class="primary" id="runExport">Export now</button><button id="openLatest">Open latest folder</button><button id="openRoot">Open exports folder</button><span class="muted small mono">${esc(s.csvOutputDir || info.exportDir)}</span></div>
      <div id="exportMsg" class="muted small" style="margin-top:8px"></div>
    </div>
    <h2>Files produced</h2>
    <div class="card"><table class="kv">
      <tr><td>tv_episodes.csv / anime_episodes.csv</td><td>One row per episode file with every probed field</td></tr>
      <tr><td>tv_series.csv / anime_series.csv</td><td>One row per series: seasons, episodes, runtime, size, resolutions, languages, captions %, episode gaps</td></tr>
      <tr><td>movies.csv</td><td>One row per movie file, with the number of versions of that title</td></tr>
      <tr><td>movies_titles.csv</td><td>One row per title: file count, versions, best resolution, size</td></tr>
      <tr><td>movies_multiples.csv</td><td>Only titles that have more than one file</td></tr>
      <tr><td>web_videos.csv</td><td>One row per web video with channel, title, upload date and every probed field</td></tr>
      <tr><td>changes.csv</td><td>The change log for the scan that triggered the export (or the latest changes)</td></tr>
    </table></div>
    <h2>History</h2><div id="exportHist"></div>`;
  const t = makeTable(list, [
    { key: 'ts', label: 'When', render: r => fmtDate(r.ts) }, { key: 'trigger', label: 'Trigger' }, { key: 'scan_id', label: 'Scan', num: true, render: r => r.scan_id ? '#' + r.scan_id : '' },
    { key: 'rows', label: 'Rows', num: true, render: r => (r.rows || 0).toLocaleString() }, { key: 'dir', label: 'Folder', cls: 'pathcell' },
    { key: 'id', label: '', render: r => `<button class="small openDir" data-dir="${esc(r.dir)}">Open</button>` },
  ], { short: true });
  $('#exportHist').append(t.node);
  t.node.addEventListener('click', e => { const b = e.target.closest('.openDir'); if (b) L.openPath(b.dataset.dir); });
  $('#runExport').onclick = async () => { try { $('#exportMsg').textContent = 'Exporting…'; const r = await L.exportCsv(); toast('Export written to ' + r.dir); views.export(); } catch (e) { $('#exportMsg').textContent = ''; toast('Export failed: ' + e.message, true); } };
  $('#openLatest').onclick = () => L.openPath((s.csvOutputDir || info.exportDir) + '\\latest');
  $('#openRoot').onclick = () => L.openPath(s.csvOutputDir || info.exportDir);
};

views.missing = async () => {
  const [rows, s] = await Promise.all([L.data.missing(), L.settings.get()]);
  const matched = rows.filter(r => r.expected > 0), withMissing = matched.filter(r => r.missing_count > 0), unmatched = rows.filter(r => r.source === 'none'), pending = rows.filter(r => !r.source);
  view.innerHTML = `<h1>Missing episodes</h1>
    <p class="lead">Expected episode counts come from ${s.metadata.enabled ? 'TVmaze (TV) and AniList (anime), fetched in the background after each scan' : 'lookups that are currently <b>disabled</b> in Settings'}. Compared with what is on disk per season. Use <b>Match…</b> when a series was matched to the wrong entry, was not found, or you want to enter counts by hand.</p>
    <div class="tiles compact">
      ${tile(withMissing.length ? 'badt' : 'okt', 'Series with gaps', withMissing.length, `${withMissing.reduce((a, r) => a + r.missing_count, 0).toLocaleString()} episodes missing`)}
      ${tile('okt', 'Complete series', matched.length - withMissing.length)}
      ${tile(unmatched.length ? 'warnt' : '', 'No match found', unmatched.length, 'use Match… to search')}
      ${tile('', 'Not looked up yet', pending.length)}
      ${tile('', 'Locked by you', rows.filter(r => r.locked).length, 'manual matches or counts')}
    </div>
    <div class="toolbar" style="margin-top:12px"><button class="small" id="refreshNew">Look up new series</button><button class="small" id="refreshAll">Re-check all unlocked series</button><span class="muted tiny">Rate-limited: roughly 1–2 series per second.</span></div>`;
  const cols = [
    { key: 'library_type', label: 'Library', render: r => `<span class="badge ${r.library_type}">${typeName(r.library_type)}</span>` },
    { key: 'show_name', label: 'Series', cls: 'wrap', render: r => `<a href="#${r.library_type}/${encodeURIComponent(r.show_name)}">${esc(r.show_name)}</a>${r.matched_title && r.matched_title !== r.show_name ? `<span class="sub">matched: ${esc(r.matched_title)}</span>` : ''}` },
    { key: 'source', label: 'Source', render: r => r.source ? `${esc(r.source)}${r.locked ? ' <span class="badge ok">locked</span>' : ''}${r.url ? ` <a href="#" class="ext" data-url="${esc(r.url)}">↗</a>` : ''}` : '<span class="muted">pending</span>' },
    { key: 'status', label: 'Status' },
    { key: 'expected', label: 'Expected', num: true, render: r => r.expected || '' },
    { key: 'have', label: 'Have', num: true, render: r => r.expected ? r.have : '' },
    { key: 'missing_count', label: 'Missing', num: true, render: r => r.expected ? (r.missing_count ? `<span class="bad">${r.missing_count}</span>` : '<span class="ok">0</span>') : (r.source === 'none' ? '<span class="muted">no match</span>' : '') },
    { key: 'missing', label: 'Which', cls: 'wrap', render: r => esc(missingText(r.missing)) + (r.absolute ? ' <span class="badge warn" title="episode numbers on disk exceed the season length; that season was skipped">absolute numbering</span>' : '') },
    { key: 'id', label: '', render: r => matchBtn(r.library_type, r.show_name) },
  ];
  const t = makeTable(rows, cols, { search: r => `${r.show_name} ${r.matched_title || ''} ${r.source || ''}`, defaultSort: { key: 'missing_count', asc: false } });
  view.append(searchToolbar(t, rows.length), t.node);
  t.node.addEventListener('click', e => { const a = e.target.closest('a.ext'); if (a) { e.preventDefault(); e.stopPropagation(); L.openExternal(a.dataset.url); } });
  $('#refreshNew').onclick = async () => { toast('Looking up series in the background…'); L.meta.refresh({ onlyNew: true }); };
  $('#refreshAll').onclick = async () => { toast('Re-checking all unlocked series in the background…'); L.meta.refresh({ onlyNew: false }); };
};

views.duplicates = async () => {
  const groups = await L.data.duplicates();
  const decided = groups.filter(g => g.decided).length;
  const wasted = groups.reduce((a, g) => a + g.files.slice(1).reduce((x, f) => x + (f.size || 0), 0), 0);
  view.innerHTML = `<h1>Duplicate episodes</h1>
    <p class="lead">Episodes that exist as more than one file. Compare them side by side and mark the one to <b>keep</b>; the others are flagged as discard candidates. MediaLedger never deletes anything — use <i>Reveal</i> to open the file in Explorer and decide there. Decisions are remembered across scans.</p>
    <div class="tiles compact">
      ${tile(groups.length ? 'warnt' : 'okt', 'Duplicate episodes', groups.length)}
      ${tile('', 'Extra files', groups.reduce((a, g) => a + g.files.length - 1, 0))}
      ${tile('', 'Space in extras', fmtBytes(wasted), 'size of all but the largest file per episode')}
      ${tile('okt', 'Decided', decided, `${groups.length - decided} still to review`)}
    </div>
    <div class="toolbar" style="margin-top:12px"><input type="search" id="dupq" placeholder="Filter by series…"><label class="inline small"><input type="checkbox" id="hideDecided"> Hide decided</label><span class="muted small" id="dupCountLine"></span></div>
    <div id="dupList"></div>`;
  const order = ['4K', '1440p', '1080p', '720p', '576p', '480p', 'SD'];
  const render = () => {
    const q = $('#dupq').value.toLowerCase(), hide = $('#hideDecided').checked;
    const list = groups.filter(g => (!q || g.show_name.toLowerCase().includes(q)) && (!hide || !g.decided)).slice(0, 300);
    $('#dupCountLine').textContent = `${list.length} of ${groups.length}`;
    $('#dupList').innerHTML = list.map(g => {
      const best = [...g.files].sort((a, b) => (order.indexOf(a.resolution) === -1 ? 99 : order.indexOf(a.resolution)) - (order.indexOf(b.resolution) === -1 ? 99 : order.indexOf(b.resolution)) || (b.bitrate_kbps || 0) - (a.bitrate_kbps || 0))[0];
      return `<div class="dupgroup ${g.decided ? 'decided' : ''}"><div class="head"><span class="badge ${g.library_type}">${typeName(g.library_type)}</span><b>${esc(g.show_name)}</b><span class="muted">${sxe(g)}</span><span class="muted tiny">${g.files.length} files</span><span class="grow"></span>${g.decided ? `<button class="small dupclear" data-root="${esc(g.files[0].root_id)}" data-rel="${esc(g.files[0].rel_path)}">Clear decision</button>` : ''}</div>
        <div class="dupfiles">${g.files.map(f => `<div class="dupfile ${f.keep === 1 ? 'keep' : f.keep === 0 ? 'drop' : ''}">${f.id === best.id ? '<span class="best">best quality</span>' : ''}<div class="name" title="${esc(f.rel_path)}">${esc(f.file_name)}</div>
          <div class="specs"><span>Size <b>${fmtBytes(f.size)}</b></span><span>Length <b>${fmtDur(f.duration_s)}</b></span><span>Res <b>${esc(f.resolution || '?')}</b> <span class="tiny">${f.width || ''}×${f.height || ''}</span></span><span>Bitrate <b>${f.bitrate_kbps ? f.bitrate_kbps.toLocaleString() + ' kbps' : '?'}</b></span><span>Video <b>${esc(f.video_codec || '?')}</b>${f.bit_depth && f.bit_depth !== 8 ? ` ${f.bit_depth}-bit` : ''}${f.hdr && f.hdr !== 'SDR' ? ` ${esc(f.hdr)}` : ''}</span><span>Audio <b>${esc(f.audio_langs || '?')}</b> <span class="tiny">${esc(f.audio_codecs || '')}</span></span><span>Subs <b>${f.sub_count || 0}</b> ${esc(f.sub_langs || '')}</span><span>Type <b>${esc(f.ext)}</b></span></div>
          <div class="act"><button class="small primary dupkeep" data-root="${esc(f.root_id)}" data-rel="${esc(f.rel_path)}" data-id="${f.id}" ${f.keep === 1 ? 'disabled' : ''}>${f.keep === 1 ? 'Keeping' : 'Keep this'}</button><button class="small reveal" data-abs="${esc(f.abs_path)}">Reveal</button>${fixBtn(f)}</div></div>`).join('')}</div></div>`;
    }).join('') || '<div class="empty">No duplicate episodes.</div>';
  };
  render();
  $('#dupq').oninput = render; $('#hideDecided').onchange = render;
  $('#dupList').addEventListener('click', async e => {
    const k = e.target.closest('.dupkeep'); if (k) { await L.dup.keep(k.dataset.root, k.dataset.rel, Number(k.dataset.id)); return views.duplicates(); }
    const c = e.target.closest('.dupclear'); if (c) { await L.dup.clear(c.dataset.root, c.dataset.rel); return views.duplicates(); }
    const r = e.target.closest('.reveal'); if (r) L.showItem(r.dataset.abs);
  });
};

views.quality = async () => {
  const q = await L.data.quality();
  const thrText = Object.entries(q.thresholds).map(([k, v]) => `${k} < ${v}`).join(' · ');
  view.innerHTML = `<h1>Quality</h1>
    <p class="lead">Files and series whose technical quality looks off: seasons that mix resolutions, files whose bitrate is unusually low for their resolution, and files with no audio, no language tag or a suspiciously short runtime. Thresholds (kbps): ${esc(thrText)} — change them in Settings.</p>
    <div class="tiles compact">
      ${tile(q.mixed.length ? 'warnt' : 'okt', 'Mixed-resolution series', q.mixed.length)}
      ${tile(q.perSeasonMixed.length ? 'warnt' : 'okt', 'Mixed seasons', q.perSeasonMixed.length, 'one season, several resolutions')}
      ${tile(q.lowTotal ? 'warnt' : 'okt', 'Low-bitrate files', q.lowTotal.toLocaleString())}
      ${tile('', 'Undefined audio language', q.undAudio.reduce((a, r) => a + r.n, 0).toLocaleString(), q.undAudio.map(r => `${typeName(r.library_type)} ${r.n}`).join(' · '))}
      ${tile(q.noAudio.length ? 'badt' : 'okt', 'No audio track', q.noAudio.length)}
      ${tile(q.short.length ? 'warnt' : 'okt', 'Under 2 minutes', q.short.length, 'samples, trailers, broken files')}
    </div>`;
  const lib = { key: 'library_type', label: 'Library', render: r => `<span class="badge ${r.library_type}">${typeName(r.library_type)}</span>` };
  const sec = (title, rows, cols, search) => { const t = makeTable(rows, cols, { search, short: true }); const box = el(`<div><div class="section-head"><h2>${title} <span class="muted">(${rows.length})</span></h2></div></div>`); box.append(t.node); return box; };
  view.append(
    sec('Mixed-resolution series', q.mixed, [lib, { key: 'show_name', label: 'Series', render: r => `<a href="#${r.library_type}/${encodeURIComponent(r.show_name)}">${esc(r.show_name)}</a>` }, { key: 'files', label: 'Files', num: true }, { key: 'resolutions', label: 'Resolutions', render: r => (r.resolutions || '').split(',').map(x => `<span class="badge">${esc(x)}</span>`).join('') }, { key: 'codecs', label: 'Codecs', render: r => esc((r.codecs || '').replace(/,/g, ' ')) }], r => r.show_name),
    sec('Mixed seasons', q.perSeasonMixed, [lib, { key: 'show_name', label: 'Series', render: r => `<a href="#${r.library_type}/${encodeURIComponent(r.show_name)}">${esc(r.show_name)}</a>` }, { key: 'season', label: 'Season', render: r => 'S' + r.season }, { key: 'files', label: 'Files', num: true }, { key: 'resolutions', label: 'Resolutions', render: r => (r.resolutions || '').split(',').map(x => `<span class="badge">${esc(x)}</span>`).join('') }], r => r.show_name),
    sec('Low-bitrate files', q.low, [lib, { key: 'rel_path', label: 'Path', cls: 'pathcell' }, { key: 'resolution', label: 'Res' }, { key: 'bitrate_kbps', label: 'kbps', num: true, render: r => `<span class="warn">${r.bitrate_kbps.toLocaleString()}</span> <span class="muted tiny">/ ${q.thresholds[r.resolution]}</span>` }, { key: 'video_codec', label: 'Codec' }, { key: 'duration_s', label: 'Length', num: true, render: r => fmtDur(r.duration_s) }, { key: 'size', label: 'Size', num: true, render: r => fmtBytes(r.size) }, { key: 'id', label: '', render: r => fixBtn(r) }], r => r.rel_path),
    sec('No audio track', q.noAudio, [lib, { key: 'rel_path', label: 'Path', cls: 'pathcell' }, { key: 'id', label: '', render: r => fixBtn(r) }], r => r.rel_path),
    sec('Under 2 minutes', q.short, [lib, { key: 'rel_path', label: 'Path', cls: 'pathcell' }, { key: 'duration_s', label: 'Length', num: true, render: r => fmtDur(r.duration_s) }, { key: 'size', label: 'Size', num: true, render: r => fmtBytes(r.size) }, { key: 'id', label: '', render: r => fixBtn(r) }], r => r.rel_path),
  );
};

views.rename = async () => {
  const s = await L.settings.get();
  if (!s.renaming.enabled) {
    view.innerHTML = `<h1>Rename files</h1><div class="warnbox">Renaming is <b>off</b>. This is the only feature that writes to your share. Turn it on under <a href="#settings">Settings → Renaming</a> if you want MediaLedger to propose and apply Plex-standard file names.</div>
      <p class="lead">When enabled, this page lists every file whose name differs from the standard pattern (<span class="mono">Show - S01E02 - Title.ext</span>, <span class="mono">Title (Year) - Edition.ext</span>), built from the parsed details and your manual fixes. You tick the ones to rename; files are renamed in place, never moved, never overwritten, and every attempt is logged.</p>`;
    return;
  }
  const [{ list }, hist] = await Promise.all([L.rename.proposals({}), L.rename.history()]);
  const okHist = hist.filter(h => h.ok).length;
  view.innerHTML = `<h1>Rename files</h1>
    <div class="warnbox">This page <b>renames files on your share</b>. Proposals come from the parsed details plus your manual fixes, so fix anything wrong under Problems first. Files are renamed in place (same folder), never overwritten, and each attempt is logged below.</div>
    <div class="tiles compact">${tile(list.length ? 'warnt' : 'okt', 'Proposed renames', list.length)}${tile('', 'From manual fixes', list.filter(p => p.has_override).length)}${tile('', 'Renamed so far', okHist, `${hist.length - okHist} failed`)}</div>
    <div class="toolbar" style="margin-top:12px"><input type="search" id="rq" placeholder="Filter…"><select id="rtype"><option value="">all libraries</option><option value="tv">TV</option><option value="anime">Anime</option><option value="movie">Movies</option></select><label class="inline small"><input type="checkbox" id="rfixed"> Only files with manual fixes</label><span class="muted small" id="rcount"></span><span class="grow"></span><button class="small" id="selAll">Select shown</button><button class="small" id="selNone">Clear</button><button class="primary" id="apply" disabled>Rename 0 files</button></div>
    <div class="table-wrap" id="rtable"></div>
    <h2>History</h2><div id="rhist"></div>`;
  const selected = new Set();
  let shown = [];
  const render = () => {
    const q = $('#rq').value.toLowerCase(), t = $('#rtype').value, fx = $('#rfixed').checked;
    shown = list.filter(p => (!t || p.library_type === t) && (!fx || p.has_override) && (!q || `${p.from} ${p.to} ${p.show_name || ''} ${p.movie_title || ''}`.toLowerCase().includes(q))).slice(0, 1000);
    $('#rcount').textContent = `${shown.length} of ${list.length}`;
    $('#rtable').innerHTML = `<table><thead><tr><th></th><th>Library</th><th>Folder</th><th>Current name</th><th></th><th>Proposed name</th><th></th></tr></thead><tbody>${shown.map(p => `<tr class="rename-row"><td><input type="checkbox" class="rsel" data-id="${p.id}" ${selected.has(p.id) ? 'checked' : ''}></td><td><span class="badge ${p.library_type}">${typeName(p.library_type)}</span></td><td class="muted tiny wrap">${esc(p.rel_path.includes('\\') ? p.rel_path.slice(0, p.rel_path.lastIndexOf('\\')) : '')}</td><td class="wrap">${esc(p.from)}${p.has_override ? ' <span class="badge ok">fixed</span>' : ''}</td><td class="arrow">→</td><td class="wrap"><b>${esc(p.to)}</b></td><td>${fixBtn(p)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Every file already matches the standard pattern.</td></tr>'}</tbody></table>`;
    $('#apply').textContent = `Rename ${selected.size} file${selected.size === 1 ? '' : 's'}`; $('#apply').disabled = !selected.size;
  };
  render();
  ['#rq', '#rtype', '#rfixed'].forEach(id => { $(id).oninput = render; $(id).onchange = render; });
  $('#rtable').addEventListener('change', e => { const c = e.target.closest('.rsel'); if (c) { c.checked ? selected.add(Number(c.dataset.id)) : selected.delete(Number(c.dataset.id)); $('#apply').textContent = `Rename ${selected.size} file${selected.size === 1 ? '' : 's'}`; $('#apply').disabled = !selected.size; } });
  $('#selAll').onclick = () => { shown.forEach(p => selected.add(p.id)); render(); };
  $('#selNone').onclick = () => { selected.clear(); render(); };
  $('#apply').onclick = async () => {
    const ids = [...selected];
    const card = openModal(`<h2>Rename ${ids.length} file${ids.length === 1 ? '' : 's'} on the share?</h2><p class="muted">Each file is renamed in its current folder. Existing targets are skipped. This cannot be undone from MediaLedger (the history below records every old and new name).</p><div class="preview" style="max-height:240px;overflow:auto">${list.filter(p => selected.has(p.id)).slice(0, 50).map(p => `<div>${esc(p.from)} <span class="arrow">→</span> <b>${esc(p.to)}</b></div>`).join('')}${ids.length > 50 ? `<div class="muted">…and ${ids.length - 50} more</div>` : ''}</div><div class="actions"><span class="grow"></span><button id="rc">Cancel</button><button class="danger" id="rgo">Rename now</button></div>`);
    $('#rc', card).onclick = closeModal;
    $('#rgo', card).onclick = async () => {
      $('#rgo', card).disabled = true; $('#rgo', card).textContent = 'Renaming…';
      try { const res = await L.rename.apply(ids); const ok = res.filter(r => r.ok).length; closeModal(); toast(`${ok} renamed, ${res.length - ok} failed`, ok !== res.length); views.rename(); }
      catch (e) { closeModal(); toast(e.message, true); }
    };
  };
  const ht = makeTable(hist, [{ key: 'ts', label: 'When', render: r => fmtDate(r.ts) }, { key: 'from_rel', label: 'From', cls: 'pathcell' }, { key: 'to_rel', label: 'To', cls: 'pathcell' }, { key: 'ok', label: 'Result', render: r => r.ok ? '<span class="badge ok">renamed</span>' : `<span class="badge bad">failed</span> <span class="tiny">${esc(r.error || '')}</span>` }], { short: true });
  $('#rhist').append(ht.node);
};

views.movienames = async () => {
  const [{ plan, lock, settings: mr }, batches] = await Promise.all([L.movie.plan(), L.movie.batches()]);
  const ready = plan.filter(p => p.ok && !p.unchanged), unchanged = plan.filter(p => p.unchanged), blocked = plan.filter(p => !p.ok);
  const flagged = ready.filter(p => p.flags.length);
  const placeholders = ready.filter(p => p.flags.some(f => f === 'no_year' || f === 'no_source'));
  const flagCounts = {}; for (const p of ready) for (const f of p.flags) { const k = f.split(':')[0]; flagCounts[k] = (flagCounts[k] || 0) + 1; }
  const FLAG_TEXT = { plex_unlinked: 'truth source is Plex but this file is not linked to a Plex item; file-name title used', plex_title_differs: 'Plex\'s title differs from the file-name title; Plex\'s was used', no_source: 'no source marker → "Source" placeholder', no_year: 'no year → "(Year)" placeholder', res_mismatch: 'name claimed a different resolution; probe wins', hdr_uncertain: 'BT.2020 colour without HDR transfer; treated as HDR', hdr_claimed_but_sdr: 'name says HDR but probe says SDR', audio_und: 'audio language undefined in the file', audio_partly_und: 'some audio tracks have no language tag', audio_unknown: 'no audio language data' };
  view.innerHTML = `<h1>Movie names</h1>
    <p class="lead">Builds <span class="mono">Title (Year) - Source Resolution HDR Codec [Audio] [{edition-…}].ext</span> from the parsed title and year plus <b>probed</b> resolution, colour, codec and audio. Anything the probe cannot prove becomes a placeholder word for you to fill in; anything unsafe is blocked. Every batch is a dry run unless you flip the live switch, is pre-flighted as a whole, verified file by file, journaled, and can be undone.</p>
    ${lock ? `<div class="warnbox">A rename batch is running (${esc(lock.rootId)} since ${fmtDate(lock.since)}). Scans are paused until it finishes.</div>` : ''}
    <div class="tiles compact">
      ${tile(ready.length ? 'okt' : '', 'Ready', ready.length.toLocaleString(), 'would be renamed')}
      ${tile('', 'Already correct', unchanged.length.toLocaleString())}
      ${tile(blocked.length ? 'badt' : 'okt', 'Blocked', blocked.length, 'never renamed until fixed')}
      ${tile(placeholders.length ? 'warnt' : '', 'With placeholders', placeholders.length.toLocaleString(), 'Year / Source words in the name')}
      ${tile(flagged.length ? 'warnt' : '', 'Flagged', flagged.length.toLocaleString(), 'renamed, but worth a look')}
      ${tile(mr.enabled ? 'badt' : 'okt', 'Live renames', mr.enabled ? 'ALLOWED' : 'off', mr.enabled ? 'the switch below is armed' : 'dry runs only')}
    </div>
    <div class="card" style="margin-top:12px">
      <h3>Batch settings</h3>
      <div class="inline">
        <label class="inline small">Layout <select id="mrLayout"><option value="inplace" ${mr.layout === 'inplace' ? 'selected' : ''}>rename in place</option><option value="folders" ${mr.layout === 'folders' ? 'selected' : ''}>move into "Title (Year)" folders</option></select></label>
        <label class="inline small">Batch limit <input type="number" id="mrLimit" min="1" max="5000" value="${mr.batchLimit}" style="width:80px"></label>
        <label class="inline small">Title &amp; year from <select id="mrTruth"><option value="parser" ${(mr.truth || 'parser') === 'parser' ? 'selected' : ''}>file name + my fixes</option><option value="plex" ${mr.truth === 'plex' ? 'selected' : ''}>Plex match (falls back to file name)</option></select></label>
        <label class="inline small"><input type="checkbox" id="mrEnabled" ${mr.enabled ? 'checked' : ''}> <b class="bad">Allow live renames</b></label>
        <button class="small" id="mrSave">Save</button>
        <span class="muted tiny">Folder layout copies, verifies size and a head/tail hash, then deletes the original. In-place uses an atomic rename.</span>
      </div>
    </div>
    <div class="toolbar" style="margin-top:12px">
      <input type="search" id="mq" placeholder="Filter…">
      <select id="mstatus"><option value="ready">ready</option><option value="flagged">flagged only</option><option value="placeholders">placeholders only</option><option value="blocked">blocked</option><option value="unchanged">already correct</option><option value="all">all</option></select>
      <select id="mflag"><option value="">any flag</option>${Object.keys(flagCounts).map(k => `<option value="${k}">${k} (${flagCounts[k]})</option>`).join('')}</select>
      <span class="muted small" id="mcount"></span><span class="grow"></span>
      <button class="small" id="mSelAll">Select shown</button><button class="small" id="mSelNone">Clear</button>
      <select id="mBulkSrc" title="Set the source for every selected file"><option value="">Set source for selected…</option><option value="web">Web (download)</option><option value="rip">Rip (disc)</option><option value="clear">clear manual source</option></select>
      <button id="mDry" disabled>Dry run 0</button>
      <button class="danger" id="mLive" disabled>Rename 0 live</button>
    </div>
    <div class="table-wrap" id="mtable"></div>
    <div id="mCollisions"></div>
    <div id="mPlaceholders"></div>
    <details style="margin-top:14px"><summary class="muted">What the flags mean</summary><table class="kv" style="margin-top:6px">${Object.entries(FLAG_TEXT).map(([k, v]) => `<tr><td class="mono">${k}</td><td>${esc(v)}</td></tr>`).join('')}</table></details>
    <h2>Batches</h2><div id="mbatches"></div>`;

  const selected = new Set(); let shown = [];
  const render = () => {
    const q = $('#mq').value.toLowerCase(), st = $('#mstatus').value, fl = $('#mflag').value;
    shown = plan.filter(p => {
      if (st === 'ready' && !(p.ok && !p.unchanged)) return false;
      if (st === 'flagged' && !(p.ok && !p.unchanged && p.flags.length)) return false;
      if (st === 'placeholders' && !(p.ok && p.flags.some(f => f === 'no_year' || f === 'no_source'))) return false;
      if (st === 'blocked' && p.ok) return false;
      if (st === 'unchanged' && !p.unchanged) return false;
      if (fl && !p.flags.some(f => f.split(':')[0] === fl)) return false;
      return !q || `${p.from} ${p.name || ''} ${p.blocked || ''}`.toLowerCase().includes(q);
    }).slice(0, 1500);
    $('#mcount').textContent = `${shown.length.toLocaleString()} of ${plan.length.toLocaleString()}`;
    $('#mtable').innerHTML = `<table><thead><tr><th></th><th>Current name</th><th></th><th>Proposed name</th><th>Flags</th><th></th></tr></thead><tbody>${shown.map(p => `<tr class="rename-row ${p.ok ? '' : 'blockedrow'}"><td>${p.ok && !p.unchanged ? `<input type="checkbox" class="msel" data-id="${p.id}" ${selected.has(p.id) ? 'checked' : ''}>` : ''}</td><td class="wrap">${esc(p.from)}${p.dir ? `<span class="sub">${esc(p.dir)}</span>` : ''}</td><td class="arrow">→</td><td class="wrap">${p.ok ? (p.unchanged ? '<span class="muted">unchanged</span>' : `<b>${esc(p.name)}</b>`) : `<span class="bad">blocked: ${esc(p.blocked)}</span>`}</td><td class="wrap">${p.flags.map(f => `<span class="badge ${/^no_|mismatch|claimed/.test(f) ? 'warn' : ''}" title="${esc(FLAG_TEXT[f.split(':')[0]] || '')}">${esc(f)}</span>`).join('')}</td><td>${fixBtn(p)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nothing matches.</td></tr>'}</tbody></table>`;
    $('#mDry').textContent = `Dry run ${selected.size}`; $('#mDry').disabled = !selected.size;
    $('#mLive').textContent = `Rename ${selected.size} live`; $('#mLive').disabled = !selected.size || !mr.enabled || !!lock;
  };
  render();
  ['#mq', '#mstatus', '#mflag'].forEach(id => { $(id).oninput = render; $(id).onchange = render; });
  $('#mtable').addEventListener('change', e => { const c = e.target.closest('.msel'); if (c) { c.checked ? selected.add(Number(c.dataset.id)) : selected.delete(Number(c.dataset.id)); $('#mDry').textContent = `Dry run ${selected.size}`; $('#mDry').disabled = !selected.size; $('#mLive').textContent = `Rename ${selected.size} live`; $('#mLive').disabled = !selected.size || !mr.enabled || !!lock; } });
  $('#mSelAll').onclick = () => { shown.filter(p => p.ok && !p.unchanged).forEach(p => selected.add(p.id)); render(); };
  $('#mBulkSrc').onchange = async e => {
    const v = e.target.value; e.target.value = ''; if (!v) return;
    const ids = selected.size ? [...selected] : shown.filter(p => p.ok && !p.unchanged).map(p => p.id);
    if (!ids.length) return toast('Select files first (or filter to the ones you mean)', true);
    const card = openModal(`<h2>Set source to <b>${v === 'clear' ? 'auto-detect' : v === 'web' ? 'Web' : 'Rip'}</b> for ${ids.length} file${ids.length === 1 ? '' : 's'}?</h2><p class="muted">This only records a manual fix in MediaLedger's database. Nothing on the share changes until you run a live rename.</p><div class="actions"><span class="grow"></span><button id="bsC">Cancel</button><button class="primary" id="bsGo">Apply</button></div>`);
    $('#bsC', card).onclick = closeModal;
    $('#bsGo', card).onclick = async () => { const n = await L.override.bulkSource(ids, v === 'clear' ? '' : v); closeModal(); toast(`Source set on ${n} file(s)`); views.movienames(); };
  };
  $('#mSelNone').onclick = () => { selected.clear(); render(); };
  $('#mrSave').onclick = async () => { await L.settings.set({ movieRename: { layout: $('#mrLayout').value, batchLimit: Number($('#mrLimit').value) || 200, enabled: $('#mrEnabled').checked, truth: $('#mrTruth').value } }); toast('Batch settings saved'); views.movienames(); };

  const showResult = (r, live) => {
    const okN = r.results.filter(x => x.ok).length;
    const head = r.status === 'aborted' ? `<h2 class="bad">Aborted in pre-flight — nothing was touched</h2><p class="muted">${r.problems.length} problem(s). Fix them (or deselect those files) and run again.</p><div class="preview" style="max-height:260px;overflow:auto">${r.problems.map(p => `<div><b>${esc(p.from)}</b> — ${esc(p.reason)}</div>`).join('')}</div>`
      : `<h2>${live ? 'Renamed' : 'Dry run'}: ${okN} of ${r.results.length}${r.failed ? ` <span class="bad">· stopped after a failure</span>` : ''}</h2><div class="preview" style="max-height:300px;overflow:auto">${r.results.map(x => `<div>${x.ok ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>'} ${esc(x.from)} <span class="arrow">→</span> <b>${esc(x.to)}</b>${x.error ? ` <span class="bad tiny">${esc(x.error)}</span>` : ''}</div>`).join('')}</div>${live ? '' : '<p class="muted tiny">Nothing was renamed. Batch #' + r.batchId + ' is recorded as a dry run.</p>'}`;
    const card = openModal(`${head}<div class="actions"><span class="grow"></span><button id="mrClose" class="primary">Close</button></div>`);
    $('#mrClose', card).onclick = () => { closeModal(); views.movienames(); };
  };
  $('#mDry').onclick = async () => { try { const r = await L.movie.run([...selected], { live: false, layout: $('#mrLayout').value }); showResult(r, false); } catch (e) { toast(e.message, true); } };
  $('#mLive').onclick = async () => {
    const ids = [...selected]; const items = plan.filter(p => selected.has(p.id));
    const card = openModal(`<h2 class="bad">Rename ${ids.length} movie file${ids.length === 1 ? '' : 's'} on the share — live</h2>
      <p class="muted">Layout: <b>${$('#mrLayout').value === 'folders' ? 'move into Title (Year) folders' : 'rename in place'}</b>. Pre-flight checks every file first; if any check fails nothing is renamed. Each rename is verified before the database is updated, and the whole batch can be undone from the list below.</p>
      <div class="preview" style="max-height:240px;overflow:auto">${items.slice(0, 60).map(p => `<div>${esc(p.from)} <span class="arrow">→</span> <b>${esc(p.name)}</b></div>`).join('')}${ids.length > 60 ? `<div class="muted">…and ${ids.length - 60} more</div>` : ''}</div>
      <div class="field" style="margin-top:10px"><label>Type RENAME to confirm</label><input id="mrConfirm" autocomplete="off"></div>
      <div class="actions"><span class="grow"></span><button id="mrCancel">Cancel</button><button class="danger" id="mrGo" disabled>Rename now</button></div>`);
    $('#mrConfirm', card).oninput = e => { $('#mrGo', card).disabled = e.target.value.trim() !== 'RENAME'; };
    $('#mrCancel', card).onclick = closeModal;
    $('#mrGo', card).onclick = async () => {
      $('#mrGo', card).disabled = true; $('#mrGo', card).textContent = 'Renaming…';
      try { const r = await L.movie.run(ids, { live: true, layout: $('#mrLayout').value }); selected.clear(); showResult(r, true); } catch (e) { closeModal(); toast(e.message, true); }
    };
  };

  // ---- collisions: files that would share a name ----
  const colGroups = new Map();
  for (const p of plan) if (!p.ok && /^collision/.test(p.blocked || '')) { const k = (p.dir + '|' + (p.tokens.title || '') + '|' + (p.tokens.year || '') + '|' + (p.tokens.source || '') + '|' + (p.tokens.resolution || '') + '|' + (p.tokens.hdr || '') + '|' + (p.tokens.codec || '') + '|' + (p.tokens.audio || '') + '|' + (p.tokens.edition || '')).toLowerCase(); if (!colGroups.has(k)) colGroups.set(k, []); colGroups.get(k).push(p); }
  if (colGroups.size) {
    $('#mCollisions').innerHTML = `<div class="section-head"><h2>Name collisions <span class="muted">(${colGroups.size} group${colGroups.size === 1 ? '' : 's'})</span></h2><span class="muted tiny">Files that would end up with the identical name. Keep one and ignore the rest, or give one a distinguishing edition via Fix….</span></div>` +
      [...colGroups.values()].map(g => `<div class="dupgroup"><div class="head"><b>${esc(g[0].tokens.title)} (${esc(g[0].tokens.year)})</b><span class="muted tiny">→ ${esc(g[0].tokens.source)} ${esc(g[0].tokens.resolution)} ${esc(g[0].tokens.hdr)} ${esc(g[0].tokens.codec)}</span></div><div class="dupfiles">${g.map(p => `<div class="dupfile"><div class="name">${esc(p.from)}</div><div class="specs"><span>Size <b>${fmtBytes(p.size)}</b></span></div><div class="act"><button class="small primary colkeep" data-id="${p.id}" data-group="${esc([...colGroups.keys()].find(k => colGroups.get(k) === g))}">Keep this, ignore others</button>${fixBtn(p)}</div></div>`).join('')}</div></div>`).join('');
    $('#mCollisions').addEventListener('click', async e => {
      const b = e.target.closest('.colkeep'); if (!b) return;
      const g = colGroups.get(b.dataset.group); const keepId = Number(b.dataset.id);
      const others = g.filter(p => p.id !== keepId);
      const card = openModal(`<h2>Ignore ${others.length} file${others.length === 1 ? '' : 's'}?</h2><p class="muted">The other file${others.length === 1 ? '' : 's'} stay on disk untouched but are marked <i>ignored</i> in MediaLedger: hidden from lists, CSVs and the naming plan. You can undo that from Problems → Manual fixes.</p><div class="preview">${others.map(p => `<div>${esc(p.from)}</div>`).join('')}</div><div class="actions"><span class="grow"></span><button id="ckC">Cancel</button><button class="danger" id="ckGo">Ignore them</button></div>`);
      $('#ckC', card).onclick = closeModal;
      $('#ckGo', card).onclick = async () => { for (const p of others) { const sgt = await L.override.suggest(p.root_id, p.rel_path); const ov = (sgt && sgt.override) || { root_id: p.root_id, rel_path: p.rel_path, library_type: 'movie' }; await L.override.save({ ...ov, ignore: 1, note: (ov.note ? ov.note + '; ' : '') + 'ignored to resolve a name collision' }); } closeModal(); toast(`${others.length} file(s) ignored`); views.movienames(); };
    });
  }
  // ---- placeholders still on disk (renamed live but never filled in) ----
  const onDisk = plan.filter(p => /\(Year\)| - Source /.test(p.from));
  if (onDisk.length) {
    $('#mPlaceholders').innerHTML = `<div class="section-head"><h2>Placeholders on disk <span class="muted">(${onDisk.length})</span></h2><span class="muted tiny">These files were renamed with a placeholder word. Plex will not match a "(Year)" file; fill the value with Fix… and rename again.</span></div><div class="table-wrap short"><table><thead><tr><th>Current name</th><th>Missing</th><th>Proposed now</th><th></th></tr></thead><tbody>${onDisk.map(p => `<tr><td class="wrap">${esc(p.from)}</td><td>${/\(Year\)/.test(p.from) ? '<span class="badge warn">year</span>' : ''}${/ - Source /.test(p.from) ? '<span class="badge warn">source</span>' : ''}</td><td class="wrap">${p.ok && !p.unchanged ? `<b>${esc(p.name)}</b>` : '<span class="muted">still the same until fixed</span>'}</td><td>${fixBtn(p)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  const bt = makeTable(batches, [
    { key: 'id', label: '#', num: true }, { key: 'ts', label: 'When', render: r => fmtDate(r.ts) },
    { key: 'mode', label: 'Mode', render: r => r.mode === 'live' ? '<span class="badge bad">live</span>' : '<span class="badge">dry</span>' }, { key: 'layout', label: 'Layout' },
    { key: 'status', label: 'Status', render: r => `<span class="badge ${r.status === 'done' ? 'ok' : /abort|stopped/.test(r.status) ? 'bad' : ''}">${esc(r.status)}</span>` },
    { key: 'planned', label: 'Planned', num: true }, { key: 'done', label: 'Done', num: true }, { key: 'failed', label: 'Failed', num: true }, { key: 'undone', label: 'Undone', num: true },
    { key: 'note', label: '', render: r => `<button class="small mbItems" data-id="${r.id}">Items</button> ${r.mode === 'live' && r.done > (r.undone || 0) && !/undone$/.test(r.status) ? `<button class="small danger mbUndo" data-id="${r.id}">Undo</button>` : ''}` },
  ], { short: true });
  $('#mbatches').append(bt.node);
  bt.node.addEventListener('click', async e => {
    const u = e.target.closest('.mbUndo'); if (u) {
      const card = openModal(`<h2>Undo batch #${u.dataset.id}?</h2><p class="muted">Each renamed file is checked (still present, same size, original name free) and renamed back. Files that fail the check are left as they are and reported.</p><div class="actions"><span class="grow"></span><button id="uC">Cancel</button><button class="danger" id="uGo">Undo now</button></div>`);
      $('#uC', card).onclick = closeModal;
      $('#uGo', card).onclick = async () => { try { const r = await L.movie.undo(Number(u.dataset.id)); closeModal(); toast(`Undo: ${r.undone} restored, ${r.failed} could not be restored`, r.failed > 0); views.movienames(); } catch (err) { closeModal(); toast(err.message, true); } };
      return;
    }
    const b = e.target.closest('.mbItems'); if (b) {
      const items = await L.movie.batchItems(Number(b.dataset.id));
      const card = openModal(`<h2>Batch #${b.dataset.id} — ${items.length} item(s)</h2><div class="preview" style="max-height:60vh;overflow:auto">${items.map(i => `<div><span class="badge ${i.status === 'done' ? 'ok' : i.status === 'undone' ? '' : /fail|abort/.test(i.status) ? 'bad' : ''}">${esc(i.status)}</span> ${esc(i.from_rel)} <span class="arrow">→</span> ${esc(i.to_rel)}${i.error ? ` <span class="bad tiny">${esc(i.error)}</span>` : ''}</div>`).join('')}</div><div class="actions"><span class="grow"></span><button id="iC" class="primary">Close</button></div>`);
      $('#iC', card).onclick = closeModal;
    }
  });
};

views.web = async () => {
  const rows = await L.web.channels();
  const vids = rows.reduce((a, r) => a + r.videos, 0), bytes = rows.reduce((a, r) => a + (r.bytes || 0), 0), secs = rows.reduce((a, r) => a + (r.seconds || 0), 0);
  view.innerHTML = `<h1>Web videos</h1><p class="lead">Downloaded web videos grouped by channel folder. Titles come from the file name with yt-dlp ids and dates stripped when present.</p>
    <div class="tiles compact">${tile('', 'Channels', rows.length)}${tile('', 'Videos', vids.toLocaleString())}${tile('', 'Size', fmtBytes(bytes))}${tile('', 'Runtime', fmtHours(secs))}</div>`;
  const cols = [
    { key: 'channel', label: 'Channel', cls: 'wrap' }, { key: 'videos', label: 'Videos', num: true },
    { key: 'seconds', label: 'Runtime', num: true, render: r => fmtHours(r.seconds) }, { key: 'bytes', label: 'Size', num: true, render: r => fmtBytes(r.bytes) },
    { key: 'resolutions', label: 'Resolution', render: r => (r.resolutions || '').split(',').filter(Boolean).map(x => `<span class="badge">${esc(x)}</span>`).join('') },
    { key: 'last_upload', label: 'Uploads', render: r => r.first_upload ? `${esc(r.first_upload)} → ${esc(r.last_upload)}` : '<span class="muted">—</span>' },
    { key: 'last_added', label: 'Last added', render: r => fmtAgo(r.last_added) },
  ];
  const t = makeTable(rows, cols, { search: r => r.channel, defaultSort: { key: 'channel' }, onRow: r => { location.hash = '#web/' + encodeURIComponent(r.channel); } });
  view.append(searchToolbar(t, rows.length), t.node);
};
async function webVideosView(channel) {
  const rows = await L.web.videos(channel);
  const cols = [
    { key: 'movie_title', label: 'Title', cls: 'wrap', render: r => `${esc(r.movie_title)}${r.missing ? ' <span class="badge bad">missing</span>' : ''}` },
    { key: 'upload_date', label: 'Uploaded' }, { key: 'video_id', label: 'Video id', render: r => r.video_id ? `<a href="#" class="yt" data-id="${esc(r.video_id)}">${esc(r.video_id)}</a>` : '' },
    { key: 'duration_s', label: 'Length', num: true, render: r => fmtDur(r.duration_s) },
    { key: 'resolution', label: 'Res', render: r => r.resolution ? `${esc(r.resolution)} <span class="muted tiny">${r.width}×${r.height}</span>` : '' },
    { key: 'fps', label: 'FPS', num: true }, { key: 'video_codec', label: 'Video' }, { key: 'audio_langs', label: 'Audio', render: r => r.audio_codecs ? `${esc(r.audio_langs || '')} <span class="muted tiny">${esc(r.audio_codecs)}</span>` : '' },
    { key: 'has_captions', label: 'Captions', render: r => yn(r.has_captions) }, { key: 'size', label: 'Size', num: true, render: r => fmtBytes(r.size) }, { key: 'file_name', label: 'File', cls: 'wrap' },
  ];
  const t = makeTable(rows, cols, { search: r => `${r.movie_title} ${r.file_name}`, defaultSort: { key: 'upload_date', asc: false }, onRow: r => L.showItem(r.abs_path) });
  view.innerHTML = `<div class="detail-head"><span class="back" id="back">← Web videos</span><h1>${esc(channel)}</h1><span class="muted">${rows.length} videos · ${fmtBytes(rows.reduce((a, r) => a + (r.size || 0), 0))}</span><span class="grow"></span>${starsHtml(null, 'web', channel, channel)}</div>`;
  $('#back').onclick = () => { location.hash = '#web'; };
  view.append(searchToolbar(t, rows.length), t.node);
  t.node.addEventListener('click', e => { const a = e.target.closest('a.yt'); if (a) { e.preventDefault(); e.stopPropagation(); L.openExternal('https://www.youtube.com/watch?v=' + a.dataset.id); } });
  L.ratings.list().then(list => { const r = list.find(x => x.library_type === 'web' && x.key === channel); if (r && r.stars) { const box = $('.stars', view); box.querySelectorAll('i').forEach(i => i.classList.toggle('on', Number(i.dataset.v) <= r.stars)); } });
}

views.adult = async () => {
  const st = await L.adult.status();
  if (!st.showAdult) { view.innerHTML = '<h1>Adult</h1><p class="lead">Hidden. Turn on "Show adult content" at the bottom of the sidebar to view this library. The switch resets every time the app starts.</p>'; return; }
  const d = await L.adult.dashboard();
  const t = Object.fromEntries(d.byType.map(r => [r.library_type, r]));
  const files = d.byType.reduce((a, r) => a + r.files, 0), bytes = d.byType.reduce((a, r) => a + (r.bytes || 0), 0), secs = d.byType.reduce((a, r) => a + (r.seconds || 0), 0);
  view.innerHTML = `<h1>Adult</h1><p class="lead">Everything under adult roots, classified per file as anime, TV or movie. Series open in the normal episode view; all the usual tools (Fix…, Match…, ratings) work here. Excluded from CSVs unless allowed in Settings.</p>
    <div class="tiles compact">${tile('', 'Files', files.toLocaleString(), `${fmtBytes(bytes)} · ${fmtHours(secs)}`)}${tile('anime', 'Anime', `${d.series.filter(s => s.library_type === 'anime').length} series`, `${(t.anime?.files || 0).toLocaleString()} episodes`)}${tile('tv', 'TV', `${d.series.filter(s => s.library_type === 'tv').length} series`, `${(t.tv?.files || 0).toLocaleString()} episodes`)}${tile('movie', 'Movies', `${d.movies.length} titles`, `${(t.movie?.files || 0).toLocaleString()} files`)}${tile(d.unparsed.length ? 'warnt' : 'okt', 'Unparsed', d.unparsed.length)}</div>
    <div class="grid2" style="margin-top:12px">${bars(d.resolution, 'Resolution', { order: ['4K', '1440p', '1080p', '720p', '576p', '480p', 'SD', 'unknown'] })}<div class="card"><h3>Recently added</h3><div id="aRecent"></div></div></div>
    <h2>Series</h2><div id="aSeries"></div><h2>Movies</h2><div id="aMovies"></div>${d.unparsed.length ? '<h2>Unparsed</h2><div id="aUnparsed"></div>' : ''}`;
  $('#aRecent').append(el(`<table>${d.recent.map(r => `<tr><td><span class="badge ${r.library_type}">${typeName(r.library_type)}</span></td><td class="wrap">${esc(r.library_type === 'movie' ? r.movie_title : `${r.show_name} ${sxe(r)}`)}<span class="sub">${esc(r.file_name)}</span></td><td class="num muted tiny">${fmtAgo(r.first_seen)}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table>`));
  const st1 = makeTable(d.series, [{ key: 'library_type', label: 'Type', render: r => `<span class="badge ${r.library_type}">${typeName(r.library_type)}</span>` }, { key: 'show_name', label: 'Series', cls: 'wrap' }, { key: 'seasons', label: 'Seasons', num: true }, { key: 'episodes', label: 'Episodes', num: true }, { key: 'seconds', label: 'Runtime', num: true, render: r => fmtHours(r.seconds) }, { key: 'bytes', label: 'Size', num: true, render: r => fmtBytes(r.bytes) }, { key: 'resolutions', label: 'Resolution', render: r => (r.resolutions || '').split(',').filter(Boolean).map(x => `<span class="badge">${esc(x)}</span>`).join('') }, { key: 'captioned', label: 'Captions', num: true, render: r => `${pct(r.captioned, r.episodes)}%` }, { key: 'unparsed', label: 'Issues', num: true, render: r => r.unparsed ? `<span class="badge warn">${r.unparsed} unparsed</span>` : '' }], { search: r => r.show_name, defaultSort: { key: 'show_name' }, short: true, onRow: r => { location.hash = `#${r.library_type}/${encodeURIComponent(r.show_name)}`; } });
  $('#aSeries').append(st1.node);
  const mt = makeTable(d.movies, [{ key: 'title', label: 'Title', cls: 'wrap' }, { key: 'year', label: 'Year', num: true }, { key: 'files', label: 'Files', num: true }, { key: 'resolutions', label: 'Versions', render: r => (r.resolutions || '').split(',').filter(Boolean).map(x => `<span class="badge">${esc(x)}</span>`).join('') }, { key: 'bytes', label: 'Size', num: true, render: r => fmtBytes(r.bytes) }], { search: r => r.title, defaultSort: { key: 'title' }, short: true, onRow: r => { location.hash = '#movies/' + encodeURIComponent(r.group_key); } });
  $('#aMovies').append(mt.node);
  if (d.unparsed.length) { const ut = makeTable(d.unparsed, [{ key: 'library_type', label: 'Type', render: r => typeName(r.library_type) }, { key: 'rel_path', label: 'Path', cls: 'pathcell' }, { key: 'parse_note', label: 'Why' }, { key: 'id', label: '', render: r => fixBtn(r) }], { short: true }); $('#aUnparsed').append(ut.node); }
};

views.ratings = async () => {
  const rows = await L.ratings.list();
  const rated = rows.filter(r => r.stars), online = rows.filter(r => r.online != null);
  view.innerHTML = `<h1>Ratings</h1><p class="lead">Online averages come from TVmaze (TV) and AniList (anime) with the episode-count lookup; nothing extra is fetched. Your own rating is a 0–5 star score per title, stored locally and exported in the CSVs. Click a star to rate; click the same star again to clear. "Plex" is the audience score Plex shows; "Plex mine" is the rating you set in Plex (shown out of 5). Watched comes from Plex play counts. Run a Plex sync from Settings to refresh them.</p>
    <div class="tiles compact">${tile('', 'Titles', rows.length.toLocaleString())}${tile('', 'With online rating', online.length.toLocaleString(), online.length ? `avg ${(online.reduce((a, r) => a + r.online, 0) / online.length).toFixed(1)} / 10` : '')}${tile('okt', 'Rated by you', rated.length, rated.length ? `avg ${(rated.reduce((a, r) => a + r.stars, 0) / rated.length).toFixed(1)} / 5` : '')}${tile('', 'Top online', online.length ? online.sort((a, b) => b.online - a.online)[0].title : '—', online.length ? `${online[0].online} / 10` : '')}</div>
    <div class="toolbar" style="margin-top:12px"><select id="rType"><option value="">all libraries</option><option value="tv">TV</option><option value="anime">Anime</option><option value="movie">Movies</option><option value="web">Web channels</option></select><label class="inline small"><input type="checkbox" id="rMine"> Only rated by me</label><label class="inline small"><input type="checkbox" id="rPlex"> Only with a Plex rating of mine</label><label class="inline small"><input type="checkbox" id="rUnrated"> Only unrated by me</label></div><div id="rTable"></div>`;
  const cols = [
    { key: 'library_type', label: 'Library', render: r => `<span class="badge ${r.library_type}">${typeName(r.library_type)}</span>` },
    { key: 'title', label: 'Title', cls: 'wrap', render: r => r.library_type === 'movie' ? `<a href="#movies/${encodeURIComponent(r.key)}">${esc(r.title)}</a>` : r.library_type === 'web' ? `<a href="#web/${encodeURIComponent(r.key)}">${esc(r.title)}</a>` : `<a href="#${r.library_type}/${encodeURIComponent(r.key)}">${esc(r.title)}</a>` },
    { key: 'online', label: 'Online', num: true, render: r => r.online != null ? `<b>${r.online.toFixed(1)}</b><span class="muted tiny"> /10 ${esc(r.online_source || '')}${r.online_votes ? ' · ' + r.online_votes.toLocaleString() : ''}</span>` : '<span class="muted">—</span>' },
    { key: 'plex_audience', label: 'Plex', num: true, render: r => r.plex_audience != null ? `<b>${Number(r.plex_audience).toFixed(1)}</b><span class="muted tiny"> /10</span>` : (r.plex_linked ? '<span class="muted">—</span>' : '') },
    { key: 'plex_user', label: 'Plex mine', num: true, render: r => r.plex_user != null ? `<span class="warn">★ ${Number(r.plex_user / 2).toFixed(1)}</span><span class="muted tiny"> /5</span>` : '' },
    { key: 'watched', label: 'Watched', num: true, render: r => r.library_type === 'movie' ? (r.watched ? '<span class="badge ok">yes</span>' : (r.plex_linked ? '<span class="muted">no</span>' : '')) : (r.plex_linked ? `${pct(r.watched, r.files)}%` : '') },
    { key: 'stars', label: 'Mine', sortVal: r => r.stars || 0, render: r => starsHtml(r.stars, r.library_type, r.key, r.title) },
    { key: 'note', label: 'Note', cls: 'wrap', render: r => `<input class="ratingnote" data-type="${esc(r.library_type)}" data-key="${esc(r.key)}" data-title="${esc(r.title)}" data-stars="${r.stars ?? ''}" value="${esc(r.note || '')}" placeholder="note…">` },
    { key: 'files', label: 'Files', num: true }, { key: 'bytes', label: 'Size', num: true, render: r => fmtBytes(r.bytes) },
  ];
  const build = () => { const t = $('#rType').value, mine = $('#rMine').checked, un = $('#rUnrated').checked, px = $('#rPlex').checked; const list = rows.filter(r => (!t || r.library_type === t) && (!mine || r.stars) && (!un || !r.stars) && (!px || r.plex_user != null)); const tb = makeTable(list, cols, { search: r => r.title, defaultSort: { key: 'online', asc: false } }); const box = $('#rTable'); box.innerHTML = ''; box.append(searchToolbar(tb, list.length), tb.node); };
  build();
  ['#rType', '#rMine', '#rUnrated', '#rPlex'].forEach(id => { $(id).onchange = build; });
  $('#rTable').addEventListener('change', async e => { const i = e.target.closest('.ratingnote'); if (!i) return; await L.ratings.setUser(i.dataset.type, i.dataset.key, i.dataset.title, i.dataset.stars === '' ? null : Number(i.dataset.stars), i.value.trim() || null); toast('Note saved'); });
  $('#rTable').addEventListener('click', e => { if (e.target.closest('.ratingnote')) e.stopPropagation(); }, true);
};

views.settings = async () => {
  const s = await L.settings.get();
  const info = await L.appInfo();
  view.innerHTML = `
    <h1>Settings</h1>
    <div class="form">
      <h2>Library roots</h2>
      <table class="roots-table"><thead><tr><th>On</th><th>Label</th><th>Path (UNC or local)</th><th>Type</th><th></th></tr></thead><tbody id="roots"></tbody></table>
      <div class="inline" style="margin-top:8px"><button class="small" id="addRoot">Add root</button></div>

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
      <div class="field"><label>Watch roots for changes</label><div class="inline"><input type="checkbox" id="watchOn" ${s.watchFolders ? 'checked' : ''}> <span class="muted small">scan after changes settle for</span> <input type="number" id="watchSettle" min="15" value="${s.watchSettleSeconds}" style="width:70px"> <span class="muted small">seconds</span></div><div class="hint">Uses Windows change notifications on each root (works on UNC shares). A download that is still copying keeps pushing the timer back, so the scan starts once the folder is quiet. Status: ${info.watch.enabled ? `<span class="ok">watching ${info.watch.roots.length} root(s)</span>` : 'off'}.</div></div>

      <h2>Renaming <span class="badge warn">writes to the share</span></h2>
      <div class="field"><label>Enable rename tool</label><input type="checkbox" id="renOn" ${s.renaming.enabled ? 'checked' : ''}><div class="hint">Unlocks the <b>Rename files</b> page, which proposes Plex-standard names and renames only the files you tick, in place, never overwriting. Off by default because it is the one feature that modifies the NAS.</div></div>

      <h2>Adult content</h2>
      <div class="field"><label>Include in CSV exports</label><input type="checkbox" id="adultCsv" ${s.adult.exportCsv ? 'checked' : ''}><div class="hint">Off by default: adult roots are left out of every CSV. In the app they are hidden until the "Show adult content" switch in the sidebar is on; the switch resets each launch.</div></div>
      <div class="field"><label>When unsure, treat as</label><select id="adultDefault"><option value="anime" ${s.adult.defaultSubtype === 'anime' ? 'selected' : ''}>Anime</option><option value="tv" ${s.adult.defaultSubtype === 'tv' ? 'selected' : ''}>TV</option></select><div class="hint">Adult roots classify each file as anime, TV or movie from its folder and name. Files that match none of the patterns fall back to this.</div></div>

      <h2>Quality thresholds</h2>
      <div class="field"><label>Minimum bitrate (kbps)</label><div class="inline" id="thr">${Object.entries(s.quality.minKbps).map(([k, v]) => `<label class="inline small">${esc(k)} <input type="number" min="0" data-res="${esc(k)}" value="${v}" style="width:74px"></label>`).join('')}</div><div class="hint">Files below these values for their resolution are listed under Quality → Low-bitrate files.</div></div>

      <h2>CSV export</h2>
      <div class="field"><label>Output folder</label><div class="inline"><input type="text" id="csvDir" style="flex:1" placeholder="${esc(info.exportDir)}" value="${esc(s.csvOutputDir)}"><button class="small" id="pickCsv">Browse…</button><button class="small" id="openCsv">Open</button></div></div>
      <div class="field"><label>Export after every scan</label><input type="checkbox" id="autoExport" ${s.autoExportAfterScan ? 'checked' : ''}></div>

      <h2>Schedule</h2>
      <div class="field"><label>In-app timer</label><div class="inline"><input type="checkbox" id="inApp" ${s.schedule.inAppEnabled ? 'checked' : ''}> every <input type="number" id="inAppHours" min="0.25" step="0.25" value="${s.schedule.inAppIntervalHours}" style="width:80px"> hours</div><div class="hint">Runs only while MediaLedger is open. Next run: <span id="nextInApp">—</span></div></div>
      <div class="field"><label>Windows Task Scheduler</label><div class="inline">daily at <input type="time" id="taskTime" value="${esc(s.schedule.taskTime)}"> <button class="small" id="installTask">Install / update task</button> <button class="small" id="removeTask">Remove task</button> <button class="small" id="runTask">Run task now</button></div><div class="hint">Runs even when the app is closed: launches MediaLedger with <span class="mono">--scan</span>, scans, exports and exits. If the app is already open, the open window runs the scan instead.</div></div>
      <div class="field"><label></label><div class="status-line" id="taskStatus">Checking task…</div></div>

      <h2>Data</h2>
      <div class="field"><label>Database</label><div class="status-line"><span class="mono">${esc(info.dbFile)}</span><br><span class="muted">${fmtBytes(info.db.size)} · schema v${info.db.version} · ${info.db.files.toLocaleString()} files · ${info.db.scans} scans · ${info.db.changes.toLocaleString()} changes · ${info.db.overrides} fixes · ${info.db.backups} backups</span></div><div class="hint">Everything MediaLedger knows lives in this one file plus <span class="mono">settings.json</span> next to it. Both sit in your user profile, outside the install folder, so closing the app, reinstalling, or updating never loses them. A backup copy is taken automatically before any schema upgrade.</div></div>
      <div class="field"><label></label><div class="inline"><button class="small" id="backupNow">Back up database now</button><button class="small" id="openBackups">Open backups folder</button><button class="small" id="openData">Open data folder</button><button class="small" id="openLog">Open log</button></div></div>

      <h2>Updates</h2>
      <div class="field"><label>Automatic updates</label><input type="checkbox" id="updOn" ${s.updates.enabled ? 'checked' : ''}><div class="hint">Installed builds check GitHub Releases on launch and every 6 hours, download silently and apply on the next restart. Your database and settings are untouched by updates.</div></div>
      <div class="field"><label>GitHub token</label><input type="password" id="ghToken" value="${esc(s.githubToken)}" placeholder="not needed – the repository is public"><div class="hint">Leave empty. Only needed if the AxialForge/medialedger repository is ever made private again (fine-grained token, Contents: read). Takes effect on the next Check for updates.</div></div>

      <h2>Plex</h2>
      <div class="field"><label>Plex URL</label><input type="text" id="plexUrl" value="${esc(s.plex.baseUrl)}"><div class="hint">Your Plex Media Server on the LAN, e.g. <span class="mono">http://192.168.1.204:32400</span> if Plex runs on the NAS.</div></div>
      <div class="field"><label>Plex token</label><div class="inline"><input type="password" id="plexToken" style="flex:1" value="${esc(s.plex.token)}" autocomplete="off"><button class="small" id="plexTest">Test</button></div><div class="hint" id="plexMsg">In Plex Web: any item → ⋯ → Get Info → View XML; copy the value after <span class="mono">X-Plex-Token=</span> in that page's address. Stored only in settings.json on this PC.</div></div>
      <div class="field"><label>Sync after every scan</label><input type="checkbox" id="plexOn" ${s.plex.enabled ? 'checked' : ''}><div class="hint">Pulls every movie and show section, links each Plex item to a file by path, and stores Plex's title, year, ids, your Plex rating, audience rating and watched state. Read-only against Plex.</div></div>
      <div class="field"><label>Path mapping</label><div id="plexMap"></div><div class="hint">How Plex's file paths translate to yours. Derived automatically from the first match; edit if Plex runs elsewhere.</div></div>
      <div class="field"><label></label><div class="inline"><button class="small" id="plexSync">Sync now</button><span class="muted small" id="plexSyncMsg"></span></div></div>
      <div class="field"><label></label><div class="status-line" id="plexStatus">Loading…</div></div>

      <div class="inline" style="margin-top:18px"><button class="primary" id="save">Save settings</button></div>
    </div>`;

  const rootsBody = $('#roots');
  const rootRow = (r) => el(`<tr><td><input type="checkbox" class="r-on" ${r.enabled ? 'checked' : ''}></td><td><input type="text" class="r-label" value="${esc(r.label)}" style="width:110px"></td><td><div class="inline"><input type="text" class="r-path" value="${esc(r.path)}" style="flex:1"><button class="small r-pick">…</button></div></td><td><select class="r-type">${['tv', 'anime', 'movie', 'web', 'adult'].map(t => `<option value="${t}" ${r.type === t ? 'selected' : ''}>${t === 'adult' ? 'Adult (auto-detect anime / TV / movie)' : t === 'web' ? 'Web videos' : typeName(t)}</option>`).join('')}</select></td><td><button class="small r-del">✕</button></td></tr>`);
  const addRow = (r) => { const tr = rootRow(r); tr.dataset.id = r.id || ''; rootsBody.append(tr); $('.r-del', tr).onclick = () => tr.remove(); $('.r-pick', tr).onclick = async () => { const p = await L.pickFolder($('.r-path', tr).value); if (p) $('.r-path', tr).value = p; }; };
  s.roots.forEach(addRow);
  $('#addRoot').onclick = () => addRow({ id: '', label: 'New', path: '', type: 'tv', enabled: true });

  $('#pickFf').onclick = async () => { const p = await L.pickFile(); if (p) $('#ffprobePath').value = p; };
  $('#pickCsv').onclick = async () => { const p = await L.pickFolder($('#csvDir').value); if (p) $('#csvDir').value = p; };
  $('#openCsv').onclick = () => L.openPath($('#csvDir').value || info.exportDir);
  $('#openData').onclick = () => L.openPath(info.userData);
  $('#openLog').onclick = () => L.openPath(info.logFile);
  $('#openBackups').onclick = () => L.openPath(info.dbFile + '.backups');
  $('#backupNow').onclick = async () => { const p = await L.db.backup(); toast('Backup written: ' + p); };
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
      schedule: { ...s.schedule, inAppEnabled: $('#inApp').checked, inAppIntervalHours: Number($('#inAppHours').value) || 24, taskTime: $('#taskTime').value || '03:00' },
      updates: { enabled: $('#updOn').checked }, githubToken: $('#ghToken').value.trim(),
      metadata: { ...s.metadata, enabled: $('#metaOn').checked, refreshDays: Number($('#metaDays').value) || 14 },
      watchFolders: $('#watchOn').checked, watchSettleSeconds: Number($('#watchSettle').value) || 90,
      renaming: { ...s.renaming, enabled: $('#renOn').checked },
      adult: { exportCsv: $('#adultCsv').checked, defaultSubtype: $('#adultDefault').value },
      quality: { minKbps: Object.fromEntries([...document.querySelectorAll('#thr input[data-res]')].map(i => [i.dataset.res, Number(i.value) || 0])) },
      plex: { enabled: $('#plexOn').checked, baseUrl: $('#plexUrl').value.trim(), token: $('#plexToken').value.trim(), pathMap: [...document.querySelectorAll('#plexMap .inline')].map(r => ({ plex: $('.pm-plex', r).value.trim(), local: $('.pm-local', r).value.trim() })).filter(m => m.plex && m.local) },
      ui: s.ui,
    };
  };
  $('#save').onclick = async () => { await L.settings.replace(collect()); toast('Settings saved'); refreshTask(); };
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
  const refreshPlex = async () => {
    const st = await L.plex.status();
    $('#plexStatus').innerHTML = st.last ? `Last sync ${fmtDate(st.last.ts)}: ${st.last.matched.toLocaleString()} of ${st.last.items.toLocaleString()} Plex items matched to files · ${st.linked.toLocaleString()} of ${st.total.toLocaleString()} files linked · ${st.watched.toLocaleString()} watched · ${st.rated} with your Plex rating${st.unlinked.length ? `<br><span class="muted">${st.unlinked.length}${st.unlinked.length === 300 ? '+' : ''} files not in Plex, e.g. ${esc(st.unlinked.slice(0, 3).map(u => u.rel_path).join(' · '))}</span>` : ''}` : 'Never synced.';
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
  const EVENT_TEXT = { login: 'Signed in', login_failed: 'Failed sign-in', login_blocked: 'Blocked (locked out)', ip_locked: 'Address locked out', logout: 'Signed out', reauth: 'Password re-entered', reauth_failed: 'Re-entry failed', sensitive_action: 'Sensitive action', password_changed: 'Password changed', password_change_failed: 'Password change refused', '2fa_enabled': '2FA turned on', '2fa_disabled': '2FA turned off', options_changed: 'Options changed', session_revoked: 'Session revoked', sessions_revoked: 'Other sessions revoked', refused_non_lan: 'Refused: outside LAN', cross_origin_refused: 'Refused: cross-origin' };
  const evClass = (e) => /failed|blocked|locked|refused/.test(e) ? 'bad' : /sensitive|changed|revoked|disabled/.test(e) ? 'warn' : '';
  view.innerHTML = `<h1>Security</h1>
    <p class="muted">Web server on ${st.https ? 'HTTPS' : 'HTTP'} port ${st.port} · ${st.sessions.length} active session${st.sessions.length === 1 ? '' : 's'} · ${st.failedLogins24h} failed sign-in${st.failedLogins24h === 1 ? '' : 's'} in 24 h · ${st.banned.length} address${st.banned.length === 1 ? '' : 'es'} locked out</p>
    <div class="checks">${st.checks.map(c => `<div class="check ${c.ok ? '' : c.level}"><div class="dot"></div><div><b>${esc(c.name)}</b><span>${esc(c.detail)}</span></div></div>`).join('')}</div>
    <div class="grid2" style="margin-top:14px">
      <div class="card"><h3>Password</h3>
        <div class="field"><label>Current</label><input type="password" id="pwCur" autocomplete="current-password"></div>
        <div class="field"><label>New (${st.limits.minPassword}+ chars)</label><input type="password" id="pwNew" autocomplete="new-password"></div>
        <div class="field"><label>Repeat</label><input type="password" id="pwNew2" autocomplete="new-password"></div>
        <div class="inline"><button class="primary" id="pwChange">Change password</button><span class="muted tiny">Signs out every other session.</span></div>
        <h3 style="margin-top:16px">Options</h3>
        <div class="field"><label>LAN only</label><input type="checkbox" id="optLan" ${st.lanOnly ? 'checked' : ''}><div class="hint">Refuse connections from outside private address ranges. Leave on unless you know why.</div></div>
        <div class="field"><label>Idle sign-out</label><div class="inline"><input type="number" id="optIdle" min="0" max="10080" value="${st.idleMinutes}" style="width:90px"> <span class="muted">minutes (0 = off)</span></div></div>
        <div class="inline"><button id="optSave">Save options</button></div>
      </div>
      <div class="card"><h3>Two-factor codes ${st.totpEnabled ? '<span class="right ok">on</span>' : '<span class="right muted">off</span>'}</h3>
        ${st.totpEnabled
          ? `<p>Sign-in requires your password and a 6-digit code from your authenticator app.</p><div class="field"><label>Password</label><input type="password" id="totpPw"></div><div class="inline"><button class="danger" id="totpOff">Turn off 2FA</button></div>`
          : `<p class="muted">Adds a code from Google Authenticator, Aegis, Bitwarden, 1Password or any TOTP app. Even a leaked password then cannot sign in.</p><div id="totpBox"><button class="primary" id="totpStart">Set up 2FA</button></div>`}
        <h3 style="margin-top:16px">Sessions</h3>
        <table><thead><tr><th>Where</th><th>Browser</th><th>Last seen</th><th></th></tr></thead><tbody>${st.sessions.map(s => `<tr><td>${esc(s.ip || '')}${s.current ? ' <span class="badge ok">this</span>' : ''}</td><td class="muted tiny" title="${esc(s.ua)}">${esc((s.ua || '').replace(/^Mozilla\/5\.0 /, '').slice(0, 48))}</td><td>${ago(s.lastSeen)}</td><td>${s.current ? '' : `<button class="small revoke" data-id="${s.id}">Sign out</button>`}</td></tr>`).join('')}</tbody></table>
        <div class="inline" style="margin-top:8px"><button id="revokeOthers" ${st.sessions.length > 1 ? '' : 'disabled'}>Sign out other sessions</button><button id="logoutBtn">Sign out here</button></div>
        ${st.banned.length ? `<p class="muted tiny" style="margin-top:8px">Locked out: ${st.banned.map(b => `${esc(b.ip)} until ${new Date(b.until).toLocaleTimeString()}`).join(', ')}</p>` : ''}
      </div>
    </div>
    <h2>Audit log</h2>
    <div class="card"><table><thead><tr><th>When</th><th>Event</th><th>Address</th><th>Detail</th></tr></thead><tbody>${st.events.map(e => `<tr><td class="muted">${fmtDate(e.ts)}</td><td class="${evClass(e.event)}">${esc(EVENT_TEXT[e.event] || e.event)}</td><td>${esc(e.ip || '')}</td><td class="muted">${esc(e.detail || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No events yet.</td></tr>'}</tbody></table>
    <p class="muted tiny">Lockout after ${st.limits.lockFails} failures in ${st.limits.lockMinutes} min · sensitive actions ask for the password again after ${st.limits.reauthMinutes} min · sessions last ${st.limits.sessionDays} days · full log in ${esc(st.dataDir)}/security.log</p></div>`;
  const act = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg); views.security(); } catch (e) { toast(e.message, true); } };
  $('#pwChange').onclick = () => { if ($('#pwNew').value !== $('#pwNew2').value) return toast('New passwords differ', true); act(() => L.security.changePassword($('#pwCur').value, $('#pwNew').value), 'Password changed'); };
  $('#optSave').onclick = () => act(() => L.security.setOptions({ lanOnly: $('#optLan').checked, idleMinutes: Number($('#optIdle').value) }), 'Options saved');
  $('#revokeOthers').onclick = () => act(() => L.security.revokeOthers(), 'Other sessions signed out');
  $('#logoutBtn').onclick = () => L.logout();
  document.querySelectorAll('.revoke').forEach(b => { b.onclick = () => act(() => L.security.revoke(b.dataset.id), 'Session signed out'); });
  if ($('#totpStart')) $('#totpStart').onclick = () => act(async () => {
    const r = await L.security.totpSetup();
    $('#totpBox').innerHTML = `<p>1. In your authenticator app choose <b>Add account → enter key manually</b> and type this secret (or paste the link):</p><div class="secret">${esc(r.secret.replace(/(.{4})/g, '$1 ').trim())}</div><p class="muted tiny mono" style="word-break:break-all">${esc(r.url)}</p><p>2. Enter the 6-digit code it shows to confirm:</p><div class="inline"><input type="text" id="totpCode" inputmode="numeric" placeholder="000000" style="width:120px"><button class="primary" id="totpConfirm">Turn on 2FA</button></div>`;
    $('#totpConfirm').onclick = () => act(() => L.security.totpEnable($('#totpCode').value), 'Two-factor codes are on');
  });
  if ($('#totpOff')) $('#totpOff').onclick = () => act(() => L.security.totpDisable($('#totpPw').value), 'Two-factor codes are off');
};

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

// ---------- router -----------------------------------------------------------
let currentView = 'dashboard';
async function route() {
  const hash = location.hash.slice(1) || 'dashboard';
  const [name, arg] = hash.split('/');
  currentView = name;
  document.querySelectorAll('.sidebar a').forEach(a => a.classList.toggle('active', a.dataset.view === name));
  view.innerHTML = '<div class="empty">Loading…</div>';
  try {
    if ((name === 'tv' || name === 'anime') && arg) await episodesView(name, decodeURIComponent(arg));
    else if (name === 'movies' && arg) await movieFilesView(decodeURIComponent(arg));
    else if (name === 'web' && arg) await webVideosView(decodeURIComponent(arg));
    else if (views[name]) await views[name]();
    else await views.dashboard();
  } catch (e) { view.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', route);
L.appInfo().then(async i => {
  $('#versionLine').textContent = `v${i.version}${i.packaged ? '' : ' (dev)'}`;
  updateState = i.updateStatus || updateState; paintUpdatePill();
  if (!i.ffprobe) {
    // First launch without ffmpeg: fetch it so probing works out of the box.
    toast('ffprobe not found; downloading ffmpeg in the background…');
    const msg = document.createElement('span'), prog = el('<div class="progress"><div class="bar"><div></div></div></div>');
    downloadFfmpeg(msg, prog, $('.bar > div', prog), () => { toast('ffmpeg ready. Run a scan to probe your files.'); if (currentView === 'settings' || currentView === 'about') route(); });
  }
});
refreshScanUi();
refreshBadges();
route();
