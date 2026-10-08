'use strict';
/* Shared by every page: the bridge, DOM helpers, tables and their sort menu, modals, the scan and update strips, themes, the account, the match / collect / fix dialogs, tags, storage tiles, posters and the wall view. Loaded first.
   One of six plain scripts that make up the renderer; they share the page scope. See CLAUDE.md, "Renderer files". */

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
// What ui-shim.js forwards to (dash.js talks to window.UI). Filled in here, used from the first route() on.
window.__ml = { toast: (...x) => toast(...x), openModal: (...x) => openModal(...x), closeModal: () => closeModal(), api: L, isGuest: () => !!(me && (me.guest || me.role === 'guest')), level: () => (prefs && prefs.editorLevel) || 'standard', setLevel: async (l) => { prefs = await L.prefs.set({ editorLevel: l }); } };
// Walks a list of rename proposals one file at a time: Rename / Skip / Stop per file. Each confirmed file runs as its own
// batch through the same pre-flight, verification and journal as a big batch, so a mistake is one file and still undoable.
function stepThrough(items, { what, run }) {
  let i = 0, done = 0, failed = 0;
  return new Promise(resolve => {
    const show = () => {
      if (i >= items.length) { closeModal(); resolve({ done, failed, stopped: false }); return; }
      const p = items[i];
      const card = openModal(`<h2 class="bad">${esc(what)} · ${i + 1} of ${items.length}</h2>
        <div class="preview"><div class="muted tiny">${esc(p.dir || (p.rel_path && p.rel_path.includes('\\') ? p.rel_path.slice(0, p.rel_path.lastIndexOf('\\')) : '') || '')}</div><div>${esc(p.from)}</div><div class="arrow" style="margin:4px 0">↓</div><div><b>${esc(p.name || p.to)}</b></div>${p.flags && p.flags.length ? `<div style="margin-top:6px">${p.flags.map(f => `<span class="badge ${/^no_|mismatch|claimed/.test(f) ? 'warn' : ''}">${esc(f)}</span>`).join('')}</div>` : ''}</div>
        <p class="muted tiny">Renamed ${done} · failed ${failed} · ${items.length - i} to go. Only this one file is touched when you press Rename; nothing happens on Skip or Stop.</p>
        <div class="actions"><button id="stStop">Stop</button><span class="grow"></span><button id="stSkip">Skip</button><button class="danger" id="stGo">Rename this file</button></div>`);
      $('#stStop', card).onclick = () => { closeModal(); resolve({ done, failed, stopped: true }); };
      $('#stSkip', card).onclick = () => { i++; show(); };
      $('#stGo', card).onclick = async () => {
        $('#stGo', card).disabled = true; $('#stSkip', card).disabled = true; $('#stStop', card).disabled = true; $('#stGo', card).textContent = 'Renaming…';
        try { (await run(p)) ? done++ : failed++; } catch (e) { failed++; toast(e.message, true); }
        i++; show();
      };
    };
    show();
  });
}
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// Sortable, filterable table. cols: [{key, label, num, render, sortVal, cls}]
function makeTable(rows, cols, { onRow, search, defaultSort, short, sorts, hover } = {}) {
  let sortKey = defaultSort ? defaultSort.key : null, asc = defaultSort ? defaultSort.asc !== false : true, q = '', shown = [];
  const wrap = el(`<div class="table-wrap ${short ? 'short' : ''}"></div>`);
  const render = () => {
    let data = rows;
    if (q && search) { const lq = q.toLowerCase(); data = rows.filter(r => search(r).toLowerCase().includes(lq)); }
    if (sortKey) {
      const c = cols.find(x => x.key === sortKey) || {}, extra = (sorts || []).find(x => x.key === sortKey);
      const val = r => extra && extra.val ? extra.val(r) : c.sortVal ? c.sortVal(r) : r[sortKey];
      data = [...data].sort((a, b) => { const va = val(a), vb = val(b); if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1; const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }); return asc ? r : -r; });
    }
    const head = cols.map(c => `<th class="${c.num ? 'num' : ''} ${c.key === sortKey ? 'sorted' + (asc ? ' asc' : '') : ''}" data-key="${c.key}">${esc(c.label)}</th>`).join('');
    const body = data.length ? data.map((r, i) => `<tr class="${onRow ? 'clickable' : ''}" data-i="${i}">${cols.map(c => `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="empty">Nothing here.</td></tr>`;
    wrap.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    wrap.querySelectorAll('th').forEach(th => th.onclick = () => { const k = th.dataset.key; if (sortKey === k) asc = !asc; else { sortKey = k; asc = true; } render(); wrap.dispatchEvent(new CustomEvent('sort', { detail: { key: sortKey, asc } })); });
    shown = data;
    if (onRow) wrap.querySelectorAll('tbody tr').forEach(tr => tr.onclick = (ev) => { if (ev.target.closest('button,a')) return; onRow(data[Number(tr.dataset.i)]); });
    wrap.dispatchEvent(new CustomEvent('count', { detail: data.length }));
  };
  render();
  if (hover) {
    let cur = null;
    wrap.addEventListener('mouseover', (e) => { if (!wrap.classList.contains('wall')) return; const tr = e.target.closest('tbody tr'); if (!tr) { cur = null; return hoverCard.hide(); } if (tr === cur) return; cur = tr; const r = shown[Number(tr.dataset.i)]; if (r) hoverCard.later(tr, () => hover(r)); });
    wrap.addEventListener('mouseleave', () => { cur = null; hoverCard.hide(); });
    wrap.addEventListener('click', () => hoverCard.hide());
  }
  return { node: wrap, setQuery: v => { q = v; render(); }, rerender: render, setSort: (k, a) => { sortKey = k; asc = a; render(); } };
}
// One floating card for the poster wall: more about a title without leaving the wall.
const hoverCard = (() => {
  let node = null, timer = null;
  const hide = () => { clearTimeout(timer); if (node) node.hidden = true; };
  const show = (anchor, html) => {
    if (!anchor.isConnected) return;
    if (!node) { node = el('<div class="hovercard" hidden></div>'); document.body.append(node); }
    node.innerHTML = html; node.hidden = false;
    const a = anchor.getBoundingClientRect(), w = node.offsetWidth, h = node.offsetHeight;
    let x = a.right + 10; if (x + w > innerWidth - 8) x = a.left - w - 10; if (x < 8) x = 8;
    node.style.left = x + 'px'; node.style.top = Math.max(8, Math.min(a.top, innerHeight - h - 8)) + 'px';
  };
  window.addEventListener('scroll', hide, true); window.addEventListener('hashchange', hide);
  return { hide, later: (anchor, html) => { clearTimeout(timer); timer = setTimeout(() => show(anchor, html()), 350); } };
})();
const hcRow = (k, v) => v ? `<div class="hc-row"><span>${k}</span><span>${v}</span></div>` : '';
const dayOf = (iso) => iso ? new Date(iso).toLocaleDateString([], { dateStyle: 'medium' }) : '';
// The sort menu of a list page: every entry sorts both ways and the choice is remembered per list.
// sorts: [{ key, label, desc (start descending), val (when it is not a column), pick (run when chosen) }]
const loadSort = (id, dflt) => { try { return { ...dflt, ...JSON.parse(localStorage.getItem('medialedger.sort.' + id) || '{}') }; } catch { return { ...dflt }; } };
function sortControl(id, sorts, state, apply) {
  const node = el(`<span class="sortctl inline"><span class="muted tiny">Sort by</span><select class="small" title="Sort the list"><option value="" hidden>a column</option>${sorts.map(s => `<option value="${s.key}">${esc(s.label)}</option>`).join('')}</select><button class="small dir"></button></span>`);
  const sel = $('select', node), dir = $('.dir', node);
  const paint = () => { sel.value = sorts.some(s => s.key === state.key) ? state.key : ''; dir.textContent = state.asc ? '↑' : '↓'; dir.title = state.asc ? 'Ascending. Click for descending' : 'Descending. Click for ascending'; try { localStorage.setItem('medialedger.sort.' + id, JSON.stringify({ key: state.key, asc: state.asc })); } catch { /* private mode */ } };
  sel.onchange = () => { const s = sorts.find(x => x.key === sel.value); if (!s) return; state.key = s.key; state.asc = !s.desc; if (s.pick) s.pick(); paint(); apply(); };
  dir.onclick = () => { state.asc = !state.asc; const s = sorts.find(x => x.key === state.key); if (s && s.pick) s.pick(); paint(); apply(); };
  const first = sorts.find(x => x.key === state.key); if (first && first.pick) first.pick();
  paint();
  return { node, paint };
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
// Dropdown filters over a list's rows (genre, sub/dub, your tag, watched). `rebuild(rows)` swaps the table for the filtered rows.
function filterBar(rows, rebuild, { watched = true } = {}) {
  const uniq = (get) => [...new Set(rows.flatMap(get).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const genres = uniq(r => r.genres || []), tags = uniq(r => r.tags || []), audios = uniq(r => r.audio_type ? [r.audio_type] : []);
  const sel = (id, label, opts) => `<select id="${id}" class="small"><option value="">${label}</option>${opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`;
  const bar = el(`<div class="toolbar filterbar">${sel('fGenre', 'any genre', genres.map(g => [g, g]))}${sel('fAudio', 'sub or dub', audios.map(a => [a, AUDIO_LABEL[a] || a]))}${sel('fTag', 'any tag', tags.map(t => [t, t]))}${watched ? sel('fWatched', 'watched or not', [['unwatched', 'unwatched'], ['started', 'partly watched'], ['watched', 'watched'], ['unknown', 'not in Plex']]) : ''}<button class="small" id="fClear" hidden>Clear filters</button></div>`);
  const state = () => ({ genre: $('#fGenre', bar).value, audio: $('#fAudio', bar).value, tag: $('#fTag', bar).value, watched: watched ? $('#fWatched', bar).value : '' });
  const pass = (r, f) => (!f.genre || (r.genres || []).includes(f.genre)) && (!f.audio || r.audio_type === f.audio) && (!f.tag || (r.tags || []).includes(f.tag))
    && (!f.watched || (r.unwatched == null ? f.watched === 'unknown' : f.watched === 'unwatched' ? r.unwatched > 0 && r.watched === 0 : f.watched === 'started' ? r.watched > 0 && r.unwatched > 0 : f.watched === 'watched' ? r.unwatched === 0 : false));
  const apply = () => { const f = state(); const any = Object.values(f).some(Boolean); $('#fClear', bar).hidden = !any; rebuild(any ? rows.filter(r => pass(r, f)) : rows); };
  bar.querySelectorAll('select').forEach(x => { x.onchange = apply; });
  $('#fClear', bar).onclick = () => { bar.querySelectorAll('select').forEach(x => { x.value = ''; }); apply(); };
  return bar;
}
const chips = (list, cls = 'tag-genre', n = 3) => list.slice(0, n).map(x => `<span class="badge ${cls}">${esc(x)}</span>`).join('') || '<span class="muted">—</span>';
const topOf = (rows, get) => { const m = new Map(); for (const r of rows) for (const x of (get(r) || [])) m.set(x, (m.get(x) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };
const linkTile = (href, html) => `<a href="${href}" class="tilelink">${html}</a>`;
// Number card with an id: colour comes from the rule saved in prefs (or the shipped default), the gear edits it.
const DEFAULT_RULES = { health: { higher: true, warn: 97, bad: 90 }, missing: { higher: false, warn: 1, bad: 100 }, pending: { higher: false, warn: 1, bad: 5 }, upgrades: { higher: false, warn: 1, bad: 20 }, ended: { higher: false, warn: 1, bad: 10 }, dups: { higher: false, warn: 1, bad: 50 }, lowbit: { higher: false, warn: 1, bad: 1000 }, lowres: { higher: false, warn: 1, bad: 500 }, storage: { higher: true, warn: 12, bad: 3 } };
const ruleFor = (id) => (prefs.cards && prefs.cards[id] && prefs.cards[id].rule) || DEFAULT_RULES[id] || null;
function ncard(id, label, num, value, sub = '', opts = {}) { return window.Cards.number(label, { id, num, value, sub, rule: opts.rule !== undefined ? opts.rule : ruleFor(id), href: opts.href, gear: opts.gear !== false && me.role !== 'guest', tip: opts.tip }); }
async function openCardSettings(id) {
  const level = prefs.editorLevel || 'standard'; const rule = ruleFor(id) || { higher: false, warn: '', bad: '' }; const def = DEFAULT_RULES[id];
  const card = openModal(`<h2>Card settings <span class="muted tiny">${esc(id)}</span></h2>
    <div class="field"><label>Editor level</label><select id="csLevel"><option value="simple" ${level === 'simple' ? 'selected' : ''}>Simple: ready-made cards, no knobs</option><option value="standard" ${level === 'standard' ? 'selected' : ''}>Standard: pick what a card shows</option><option value="advanced" ${level === 'advanced' ? 'selected' : ''}>Advanced: colour rules, switches, labels</option></select><div class="hint">Applies to every card editor for your account. The dashboard builder (next release) shows more or fewer options depending on this.</div></div>
    <div id="csRule" ${level === 'advanced' ? '' : 'hidden'}>
      <div class="field"><label>Colour rule</label><div class="inline" style="flex-wrap:wrap;gap:8px"><label class="inline"><input type="radio" name="csDir" value="lower" ${!rule.higher ? 'checked' : ''}> lower is better</label><label class="inline"><input type="radio" name="csDir" value="higher" ${rule.higher ? 'checked' : ''}> higher is better</label></div></div>
      <div class="field"><label>Amber from</label><input type="number" id="csWarn" value="${rule.warn ?? ''}" placeholder="none" style="width:120px"><div class="hint">Green until this value${rule.higher ? ' (counting down)' : ''}.</div></div>
      <div class="field"><label>Red from</label><input type="number" id="csBad" value="${rule.bad ?? ''}" placeholder="none" style="width:120px"></div>
      ${def ? `<p class="muted tiny">Shipped default: ${def.higher ? 'higher is better' : 'lower is better'}, amber ${def.warn}, red ${def.bad}.</p>` : ''}
    </div>
    <div id="csNote" class="muted" ${level === 'advanced' ? 'hidden' : ''}>Switch to <b>Advanced</b> to set this card's colour thresholds. Standard keeps the shipped defaults.</div>
    <div class="actions">${def ? '<button id="csReset">Use default</button>' : ''}<span class="grow"></span><button id="csCancel">Cancel</button><button class="primary" id="csSave">Save</button></div>`);
  $('#csLevel', card).onchange = () => { const adv = $('#csLevel', card).value === 'advanced'; $('#csRule', card).hidden = !adv; $('#csNote', card).hidden = adv; };
  $('#csCancel', card).onclick = closeModal;
  const persist = async (patch) => { try { prefs = await L.prefs.set(patch); closeModal(); route(); } catch (e) { toast(e.message, true); } };
  if ($('#csReset', card)) $('#csReset', card).onclick = () => { const cards = { ...(prefs.cards || {}) }; delete cards[id]; persist({ editorLevel: $('#csLevel', card).value, cards }); };
  $('#csSave', card).onclick = () => {
    const lvl = $('#csLevel', card).value;
    const cards = { ...(prefs.cards || {}) };
    if (lvl === 'advanced') { const w = $('#csWarn', card).value, b = $('#csBad', card).value; cards[id] = { ...(cards[id] || {}), rule: { higher: $('input[name=csDir]:checked', card).value === 'higher', warn: w === '' ? null : Number(w), bad: b === '' ? null : Number(b) } }; }
    persist({ editorLevel: lvl, cards });
  };
}
document.addEventListener('click', e => { const g = e.target.closest && e.target.closest('.card-gear'); if (g) { e.preventDefault(); e.stopPropagation(); openCardSettings(g.dataset.card); } });
const tile = (cls, label, value, sub = '') => `<div class="tile ${cls}"><div class="label">${label}</div><div class="value" title="${esc(String(value).replace(/<[^>]+>/g, ''))}">${value}</div><div class="sub">${sub}</div></div>`;
// Horizontal bar chart: square-root scale, exact counts and shares, stacked by library, drill-down on click. See cards.js.
function bars(rows, title, opts = {}) { return window.Cards.bars(rows, title, opts); }

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
    try { const a = await L.adult.status(); $('#adultSwitch').hidden = !a.rootConfigured || a.canToggle === false; $('#navAdult').hidden = !(a.rootConfigured && a.showAdult); $('#showAdult').checked = a.showAdult; const ac = $('#adultCount'); ac.textContent = a.count.toLocaleString(); ac.hidden = !a.count; } catch { /* ignore */ }
    try { const { plan } = await L.movie.plan(); const n = plan.filter(p => p.ok && !p.unchanged).length; const mp = $('#movieNameCount'); mp.textContent = n.toLocaleString(); mp.hidden = !n; } catch { /* ignore */ }
    try { if (me.role === 'admin') { const rq = await L.requests.list(); const n = rq.filter(r => r.status === 'pending').length; const rp = $('#reqCount'); rp.textContent = n; rp.hidden = !n; } } catch { /* ignore */ }
    const w = $('#watchLine'); w.hidden = !d.watch.enabled; w.textContent = d.watch.enabled ? `Watching ${d.watch.roots.length} root(s)${d.watch.pending ? ` · ${d.watch.pending} change(s) pending` : ''}` : '';
  } catch { /* ignore */ }
}
L.plex.onProgress(p => { const box = $('#metaProgress'); box.hidden = !p.running && !p.message; $('#metaBar').className = p.running ? 'indeterminate' : ''; $('#metaMsg').textContent = p.message || ''; if (!p.running) { setTimeout(() => { box.hidden = true; }, 8000); if (['ratings', 'settings', 'tv', 'anime', 'movies'].includes(currentView)) route(); } });
// Who am I? Drives which navigation entries and controls are shown; the server enforces the same rules.
// Colour themes: names must match html[data-theme="…"] blocks in styles.css. '' is the default palette.
const THEMES = [['', 'Graphite (default)'], ['midnight', 'Midnight blue'], ['obsidian', 'Obsidian'], ['forest', 'Forest'], ['rose', 'Rose quartz'], ['lavender', 'Lavender'], ['gunmetal', 'Gunmetal'], ['crimson', 'Crimson steel']];
function applyTheme(name) {
  if (name) document.documentElement.dataset.theme = name; else delete document.documentElement.dataset.theme;
  try { if (name) localStorage.setItem('medialedger.theme', name); else localStorage.removeItem('medialedger.theme'); } catch { /* storage blocked */ }
  const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0f1115';
}
const currentTheme = () => { try { return localStorage.getItem('medialedger.theme') || ''; } catch { return ''; } };

let me = { role: 'admin', guest: false, username: null, available: false, guestEnabled: false };
let routeQuery = {};   // ?q=… on a list hash pre-fills the filter box (drill-down from a chart)
let prefs = {};        // per-account preferences: card colour rules, editor level
const loadPrefs = async () => { try { prefs = (await L.prefs.get()) || {}; } catch { prefs = {}; } return prefs; };
const applyQuery = (tb, table) => { if (routeQuery.q) { const inp = $('input[type=search]', tb); if (inp) { inp.value = routeQuery.q; table.setQuery(routeQuery.q); } } };
async function loadMe() {
  try { me = await L.security.me(); } catch { /* desktop or pre-login */ }
  document.body.classList.remove('role-admin', 'role-standard', 'role-guest');
  document.body.classList.add('role-' + (me.role || 'admin'));
  const line = $('#accountLine');
  if (!L.isWeb) { line.hidden = true; return; }
  line.hidden = false;
  line.innerHTML = me.guest ? `Viewing as guest · <a href="#" id="signInLink">Sign in</a>` : `Signed in as <b>${esc(me.username || '')}</b> (${me.role}) · <a href="#" id="signOutLink">Sign out</a>`;
  if ($('#signInLink')) $('#signInLink').onclick = e => { e.preventDefault(); L.signIn(); };
  if ($('#signOutLink')) $('#signOutLink').onclick = e => { e.preventDefault(); L.logout(); };
}
const paintRoots = (st) => { const pill = $('#rootsPill'); const n = (st && st.problems || []).length; pill.hidden = !n; pill.textContent = n; pill.title = n ? st.problems.map(p => `${p.label}: ${p.detail}`).join('\n') : ''; };
L.roots.onStatus(st => { paintRoots(st); if (st.problems.length) toast(`Library root not reachable: ${st.problems.map(p => p.label).join(', ')}`, true); else toast('All library roots are reachable again'); if (currentView === 'settings') route(); });
L.roots.last().then(paintRoots).catch(() => {});
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
// Collecting policy: what counts as missing for one series (everything, from an episode onward, or nothing).
async function openCollectModal(type, show, raw, done) {
  const cur = await L.collect.get(type, show) || {};
  const mode = cur.mute ? 'mute' : (cur.from_season != null || cur.from_episode != null) ? 'from' : 'all';
  const card = openModal(`<h2>What are you collecting of ${esc(show)}?</h2>
    <p class="muted">${Number(raw) ? `${Number(raw).toLocaleString()} episodes are missing against the online listing.` : ''} This only changes what MediaLedger counts as missing; no file is touched.</p>
    <div class="field"><label class="inline"><input type="radio" name="cm" value="all" ${mode === 'all' ? 'checked' : ''}> Everything</label><div class="hint">Every aired episode counts.</div></div>
    <div class="field"><label class="inline"><input type="radio" name="cm" value="from" ${mode === 'from' ? 'checked' : ''}> From season <input type="number" id="cmS" min="0" value="${cur.from_season != null ? cur.from_season : 1}" style="width:64px"> episode <input type="number" id="cmE" min="1" value="${cur.from_episode || 1}" style="width:80px"> onward</label><div class="hint">For long runners you joined late. Shows numbered straight through (One Piece) use season 1 and the episode number.</div></div>
    <div class="field"><label class="inline"><input type="radio" name="cm" value="mute" ${mode === 'mute' ? 'checked' : ''}> Mute this series</label><div class="hint">Nothing counts as missing; it stays listed with a "muted" badge.</div></div>
    <div class="field"><label>Note</label><input type="text" id="cmNote" value="${esc(cur.note || '')}" placeholder="optional, e.g. only the dub"></div>
    <div class="inline" style="justify-content:flex-end"><button id="cmCancel">Cancel</button><button class="primary" id="cmSave">Save</button></div>`);
  $('#cmS', card).onfocus = $('#cmE', card).onfocus = () => { card.querySelector('input[value=from]').checked = true; };
  $('#cmCancel', card).onclick = closeModal;
  $('#cmSave', card).onclick = async () => {
    const m = card.querySelector('input[name=cm]:checked').value;
    try { await L.collect.set(type, show, m === 'mute' ? { mute: true, note: $('#cmNote', card).value } : m === 'from' ? { from_season: $('#cmS', card).value, from_episode: $('#cmE', card).value, note: $('#cmNote', card).value } : {}); closeModal(); toast('Saved'); refreshBadges(); if (done) done(); }
    catch (e) { toast(e.message, true); }
  };
}
document.addEventListener('click', e => { const b = e.target.closest('.collectbtn'); if (b) { e.stopPropagation(); openCollectModal(b.dataset.type, b.dataset.show, b.dataset.raw, () => route()); } });
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

// ---------- tags ----------------------------------------------------------
const AUDIO_LABEL = { dual: 'Dual audio', sub: 'Subbed', dub: 'Dubbed', raw: 'Raw', mixed: 'Mixed sub/dub' };
const audioBadge = (t) => t ? `<span class="badge tag-audio tag-${t}" title="from the audio and subtitle languages ffprobe found">${AUDIO_LABEL[t] || t}</span>` : '';
// Compact cell for list tables: genres (grey), sub/dub, then your own tags (accent).
function tagCell(r) { return `${(r.genres || []).slice(0, 4).map(g => `<span class="badge tag-genre">${esc(g)}</span>`).join('')}${(r.genres || []).length > 4 ? `<span class="muted tiny" title="${esc(r.genres.slice(4).join(', '))}">+${r.genres.length - 4}</span>` : ''}${audioBadge(r.audio_type)}${(r.tags || []).map(t => `<span class="badge tag-mine">${esc(t)}</span>`).join('')}`; }
const tagText = (r) => [...(r.genres || []), r.audio_type ? AUDIO_LABEL[r.audio_type] + ' ' + r.audio_type : '', ...(r.tags || [])].join(' ');
// Editable strip for a title page: online genres, sub/dub, and your tags with × and an add box.
function tagStrip(type, key, { genres = [], audio = null, tags = [] } = {}) {
  const canEdit = me.role !== 'guest';
  return `<div class="tagstrip" data-type="${esc(type)}" data-key="${esc(key)}">
    ${genres.map(g => `<span class="badge tag-genre" title="genre from the online match / Plex">${esc(g)}</span>`).join('')}${audioBadge(audio)}
    <span class="mine">${tags.map(t => `<span class="badge tag-mine">${esc(t)}${canEdit ? ` <i class="tag-x" data-tag="${esc(t)}" title="Remove tag">×</i>` : ''}</span>`).join('')}</span>
    ${canEdit ? `<input type="text" class="tag-add" placeholder="+ tag" list="tagSuggest" maxlength="40" title="Your own tag: kids, Christmas, watch with… Enter to add">` : ''}
    ${!genres.length && !audio && !tags.length && !canEdit ? '<span class="muted tiny">no tags</span>' : ''}
  </div>`;
}
document.addEventListener('click', async e => {
  const x = e.target.closest('.tag-x'); if (!x) return;
  const strip = x.closest('.tagstrip');
  try { const tags = await L.tags.remove(strip.dataset.type, strip.dataset.key, x.dataset.tag); $('.mine', strip).innerHTML = tags.map(t => `<span class="badge tag-mine">${esc(t)} <i class="tag-x" data-tag="${esc(t)}" title="Remove tag">×</i></span>`).join(''); } catch (err) { toast(err.message, true); }
});
document.addEventListener('keydown', async e => {
  const inp = e.target.closest && e.target.closest('.tag-add'); if (!inp || e.key !== 'Enter') return;
  const strip = inp.closest('.tagstrip'); const v = inp.value.trim(); if (!v) return;
  try { const tags = await L.tags.add(strip.dataset.type, strip.dataset.key, v); inp.value = ''; $('.mine', strip).innerHTML = tags.map(t => `<span class="badge tag-mine">${esc(t)} <i class="tag-x" data-tag="${esc(t)}" title="Remove tag">×</i></span>`).join(''); refreshTagSuggestions(); } catch (err) { toast(err.message, true); }
});
async function refreshTagSuggestions() {
  try { const all = await L.tags.all(); let dl = $('#tagSuggest'); if (!dl) { dl = el('<datalist id="tagSuggest"></datalist>'); document.body.append(dl); } dl.innerHTML = all.map(t => `<option value="${esc(t.tag)}">`).join(''); } catch { /* guest or offline */ }
}

// ---------- storage forecast ---------------------------------------------------
const fmtMonths = (m) => m == null ? '' : m > 120 ? 'over 10 years' : m >= 24 ? `${(m / 12).toFixed(1)} years` : `${Math.round(m)} month${Math.round(m) === 1 ? '' : 's'}`;
function storageTile(st) {
  if (!st.disks.length) return tile('', 'Free on the share', '—', 'no root reachable');
  const cls = st.monthsLeft != null && st.monthsLeft < 3 ? 'badt' : st.monthsLeft != null && st.monthsLeft < 12 ? 'warnt' : 'okt';
  return tile(cls, 'Free on the share', fmtBytes(st.free), st.monthsLeft != null ? `full in about ${fmtMonths(st.monthsLeft)} at ${fmtBytes(st.perMonth)}/month` : st.basis ? 'nothing added lately' : 'growth unknown yet');
}
function storagePanel(st) {
  const max = Math.max(1, ...st.months.map(m => m.bytes || 0));
  const usedPct = st.capacity ? Math.round(100 * (st.capacity - st.free) / st.capacity) : 0;
  return `<div class="card" style="margin-top:12px"><h3>Storage <span class="muted tiny">added per month, from when each file was first seen</span></h3>
    <div class="bars">${st.months.map(m => `<div class="row"><span class="k">${esc(m.ym)}</span><div class="track"><div class="seg added" style="width:${Math.round(100 * (m.bytes || 0) / max)}%"></div></div><span class="n">${fmtBytes(m.bytes || 0)} <span class="muted tiny">${m.files} files</span></span></div>`).join('') || '<div class="muted">No dated files yet.</div>'}</div>
    <p class="muted tiny" style="margin:8px 0 0">${st.disks.map(d => `${esc(d.label)}: ${fmtBytes(d.free)} free of ${fmtBytes(d.total)}`).join(' · ')}${st.capacity ? ` · ${usedPct}% used` : ''}${st.basis ? ` · average of the last ${st.basis} complete month${st.basis === 1 ? '' : 's'}: ${fmtBytes(st.perMonth)}/month` : ''}${st.monthsLeft != null ? ` · <b>full in about ${fmtMonths(st.monthsLeft)}</b>` : ''}</p></div>`;
}

// ---------- views -----------------------------------------------------------
const views = {};

// ---- Posters ----------------------------------------------------------------------------------------
// The index lists the titles that have a poster, so nothing is requested for the rest. On the web server the
// image is a normal URL the browser caches; in the desktop app it arrives over the bridge when the row scrolls
// into view.
let posterIdx = {}, posterIdxAt = 0;
const posterMem = new Map();
async function loadPosterIndex(force) { if (!force && Date.now() - posterIdxAt < 60000) return posterIdx; try { posterIdx = await L.posters.index(); posterIdxAt = Date.now(); } catch { posterIdx = {}; } return posterIdx; }
const posterTag = (type, key, title, cls = 'pthumb') => { const v = posterIdx[type + '|' + key]; return v ? `<img class="${cls}" alt="" decoding="async" data-poster="${esc(type)}|${esc(key)}" data-v="${v}">` : `<span class="${cls} none">${esc(String(title || '?').trim().slice(0, 1).toUpperCase())}</span>`; };
const posterSeen = new IntersectionObserver((entries) => { for (const e of entries) { if (!e.isIntersecting) continue; const img = e.target; posterSeen.unobserve(img); const [type, ...rest] = img.dataset.poster.split('|'); const key = rest.join('|');
  if (L.isWeb) { img.src = `poster/${type}/${encodeURIComponent(key)}?v=${img.dataset.v}`; continue; }
  const id = img.dataset.poster + img.dataset.v; if (posterMem.has(id)) { img.src = posterMem.get(id); continue; }
  L.posters.get(type, key).then(u => { if (u) { if (posterMem.size > 600) posterMem.delete(posterMem.keys().next().value); posterMem.set(id, u); img.src = u; } }).catch(() => {}); } }, { rootMargin: '300px' });
new MutationObserver(() => { document.querySelectorAll('img[data-poster]:not([data-w])').forEach(i => { i.dataset.w = '1'; posterSeen.observe(i); }); }).observe(document.body, { childList: true, subtree: true });
const wallOn = () => { try { return localStorage.getItem('medialedger.wall') === '1'; } catch { return false; } };
const wallify = (t) => { t.node.classList.toggle('wall', wallOn()); return t; };
const wallToggle = () => `<button class="small" id="wallBtn" title="Switch between the table and a wall of posters">${wallOn() ? '☰ Table' : '▦ Posters'}</button>`;
const wireWall = (root) => { const b = $('#wallBtn', root); if (b) b.onclick = () => { try { localStorage.setItem('medialedger.wall', wallOn() ? '0' : '1'); } catch { /* ignore */ } route(); }; };
