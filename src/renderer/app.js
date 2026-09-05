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
const typeName = t => ({ tv: 'TV', anime: 'Anime', movie: 'Movies' }[t] || t);
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

let updateState = { state: 'idle' };
L.update.onStatus(s => { updateState = s; paintUpdatePill(); if (currentView === 'about') route(); });
function paintUpdatePill() {
  const p = $('#updatePill');
  if (updateState.state === 'ready') { p.textContent = 'restart'; p.hidden = false; }
  else if (updateState.state === 'available' || updateState.state === 'downloading') { p.textContent = 'update'; p.hidden = false; }
  else p.hidden = true;
}
async function refreshBadges() {
  try { const p = await L.data.problems(); const n = p.unparsed.length + p.probeErrors.length + p.missing.length; const b = $('#problemCount'); b.textContent = n; b.hidden = !n; } catch { /* ignore */ }
}

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
    if (isMovie) Object.assign(o, { movie_title: str('#ovTitle'), movie_year: num('#ovYear'), edition_tag: str('#ovEdition') });
    else Object.assign(o, { show_name: str('#ovShow'), season: num('#ovSeason'), episode: num('#ovEp'), episode_end: num('#ovEpEnd'), episode_title: str('#ovEpTitle') });
    const r = await L.override.save(o);
    closeModal();
    toast(r.file && r.file.parse_ok ? 'Fix saved and applied' : (o.ignore ? 'File ignored' : 'Saved, but still missing a season or episode'), !(r.file && (r.file.parse_ok || o.ignore)));
    after && after();
  };
}
const fixBtn = (r, after) => `<button class="small fixbtn" data-root="${esc(r.root_id)}" data-rel="${esc(r.rel_path)}">Fix…</button>`;
document.addEventListener('click', e => { const b = e.target.closest('.fixbtn'); if (b) { e.stopPropagation(); openFixModal(b.dataset.root, b.dataset.rel, () => route()); } });

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
      <div class="card"><h3>Season gaps <a class="right" href="#problems">problems →</a></h3><div id="gaps"></div></div>
      <div class="card"><h3>Scan history</h3><div id="scanHist"></div></div>
    </div>`;
  $('#recentAdded').append(d.recentlyAdded.length ? el(`<table>${d.recentlyAdded.map(r => `<tr><td><span class="badge ${r.library_type}">${typeName(r.library_type)}</span></td><td class="wrap">${esc(r.library_type === 'movie' ? `${r.movie_title} (${r.movie_year || '?'})` : `${r.show_name} ${sxe(r)}`)}<span class="sub">${esc(r.file_name)}</span></td><td class="num muted tiny">${fmtAgo(r.first_seen)}</td></tr>`).join('')}</table>`) : el('<div class="empty">Nothing yet</div>'));
  $('#biggest').append(el(`<table>${d.biggestShows.map(s => `<tr><td><span class="badge ${s.library_type}">${typeName(s.library_type)}</span></td><td class="wrap">${esc(s.show_name)}</td><td class="num">${s.episodes} eps</td><td class="num">${fmtBytes(s.bytes)}</td><td class="num muted">${fmtHours(s.seconds)}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table>`));
  $('#biggestMovies').append(el(`<table>${d.biggestMovies.map(m => `<tr><td class="wrap">${esc(m.movie_title)} <span class="muted">(${m.movie_year || '?'})</span></td><td>${esc(m.resolution || '')}</td><td class="muted">${esc(m.video_codec || '')}</td><td class="num">${fmtBytes(m.size)}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table>`));
  $('#gaps').append(d.gaps.length ? el(`<table>${d.gaps.map(g => `<tr><td><span class="badge ${g.library_type}">${typeName(g.library_type)}</span></td><td class="wrap"><a href="#${g.library_type}/${encodeURIComponent(g.show_name)}">${esc(g.show_name)}</a></td><td>S${g.season}</td><td class="num">${g.have} of ${g.mx - g.mn + 1}</td><td class="num warn">${g.mx - g.mn + 1 - g.have} missing</td></tr>`).join('')}</table>`) : el('<div class="empty">No numbering gaps detected</div>'));
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
    { key: 'unparsed', label: 'Issues', num: true, render: r => (r.unparsed ? `<span class="badge warn">${r.unparsed} unparsed</span>` : '') + (r.probed < r.episodes ? `<span class="badge">${r.episodes - r.probed} unprobed</span>` : '') },
  ];
  const table = makeTable(rows, cols, { search: r => r.show_name, defaultSort: { key: 'show_name' }, onRow: r => { location.hash = `#${type}/${encodeURIComponent(r.show_name)}`; } });
  const eps = rows.reduce((a, r) => a + r.episodes, 0), bytes = rows.reduce((a, r) => a + (r.bytes || 0), 0), secs = rows.reduce((a, r) => a + (r.seconds || 0), 0);
  view.innerHTML = `<h1>${typeName(type)}</h1><div class="tiles compact"><div class="tile ${type}"><div class="label">Series</div><div class="value">${rows.length}</div></div>${tile('', 'Episodes', eps.toLocaleString())}${tile('', 'Size', fmtBytes(bytes))}${tile('', 'Runtime', fmtHours(secs))}${tile('', 'Full captions', rows.filter(r => r.probed && r.captioned === r.episodes).length + ' series')}${tile('', 'With issues', rows.filter(r => r.unparsed).length + ' series')}</div>`;
  view.append(searchToolbar(table, rows.length), table.node);
}
views.tv = () => seriesView('tv');
views.anime = () => seriesView('anime');

async function episodesView(type, show) {
  const rows = await L.data.episodes(type, show);
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
  view.innerHTML = `<div class="detail-head"><span class="back" id="back">← ${typeName(type)}</span><h1>${esc(show)}</h1><span class="muted">${live.length} episodes · ${fmtBytes(bytes)} · ${fmtHours(secs)}</span></div>`;
  $('#back').onclick = () => { location.hash = '#' + type; };
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
      <div class="field"><label>GitHub token</label><input type="password" id="ghToken" value="${esc(s.githubToken)}" placeholder="only while the repository is private"><div class="hint">A fine-grained token with read access to the AxialForge/medialedger repository. Not needed once the repo is public.</div></div>

      <h2>Plex (later)</h2>
      <div class="field"><label>Enable Plex lookups</label><input type="checkbox" id="plexOn" ${s.plex.enabled ? 'checked' : ''}><div class="hint">Reserved for a later phase: matching files to Plex library items and watched state. Only the connection test works today.</div></div>
      <div class="field"><label>Plex URL</label><input type="text" id="plexUrl" value="${esc(s.plex.baseUrl)}"></div>
      <div class="field"><label>Plex token</label><div class="inline"><input type="password" id="plexToken" style="flex:1" value="${esc(s.plex.token)}"><button class="small" id="plexTest">Test</button></div><div class="hint" id="plexMsg"></div></div>

      <div class="inline" style="margin-top:18px"><button class="primary" id="save">Save settings</button></div>
    </div>`;

  const rootsBody = $('#roots');
  const rootRow = (r) => el(`<tr><td><input type="checkbox" class="r-on" ${r.enabled ? 'checked' : ''}></td><td><input type="text" class="r-label" value="${esc(r.label)}" style="width:110px"></td><td><div class="inline"><input type="text" class="r-path" value="${esc(r.path)}" style="flex:1"><button class="small r-pick">…</button></div></td><td><select class="r-type">${['tv', 'anime', 'movie'].map(t => `<option value="${t}" ${r.type === t ? 'selected' : ''}>${typeName(t)}</option>`).join('')}</select></td><td><button class="small r-del">✕</button></td></tr>`);
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
      plex: { enabled: $('#plexOn').checked, baseUrl: $('#plexUrl').value.trim(), token: $('#plexToken').value.trim() },
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
  $('#plexTest').onclick = async () => { $('#plexMsg').textContent = 'Testing…'; const r = await L.plexTest({ baseUrl: $('#plexUrl').value.trim(), token: $('#plexToken').value.trim() }); $('#plexMsg').textContent = r.message; };
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

views.about = async () => {
  const info = await L.appInfo();
  const u = updateState.state === 'idle' ? info.updateStatus : updateState;
  const updLine = {
    idle: info.packaged ? 'No check yet.' : 'Running from source: updates only apply to the installed app.',
    checking: 'Checking GitHub Releases…', available: `Version ${u.version} is available; downloading in the background.`,
    downloading: `Downloading update… ${u.percent || 0}%`, current: 'You are on the latest version.',
    ready: `Version ${u.version} is downloaded and will install on the next restart.`, error: `Update check failed: ${u.message}`,
  }[u.state] || '';
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
        <div class="inline" style="margin-top:10px"><button class="primary" id="chkUpd" ${info.packaged ? '' : 'disabled'}>Check for updates</button>${u.state === 'ready' ? '<button id="restartUpd">Restart and install</button>' : ''}<button id="relLink">Open releases page</button></div>
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
  $('#chkUpd').onclick = async () => { $('#updLine').textContent = 'Checking…'; const r = await L.update.check(); updateState = r; if (r.state === 'error') $('#updLine').textContent = 'Update check failed: ' + r.message; else setTimeout(() => views.about(), 1500); };
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
