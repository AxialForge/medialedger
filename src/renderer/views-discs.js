'use strict';
/* Discs: the physical media on the shelf, by barcode. Scan | Owned | Wishlist, and one release with its copies.
   Also the badge and the title-page button the library pages use.
   One of the plain scripts that make up the renderer; they share the page scope. See CLAUDE.md, "Renderer files". */

const DISC_FORMATS = ['4K UHD', 'Blu-ray', 'DVD', '3D', 'HD DVD', 'other'];
const DISC_KINDS = { movie: 'Movie', tv: 'TV', collection: 'Collection' };
const DISC_STATUS = { owned: 'Owned', loaned: 'Loaned', wishlist: 'Wishlist', sold: 'Sold' };
const DISC_CODES = { none: 'none', unredeemed: 'not redeemed yet', redeemed: 'redeemed' };
const canEditDiscs = () => document.body.classList.contains('cap-metadata');
const discOpts = (list, cur) => (Array.isArray(list) ? list.map(v => [v, v]) : Object.entries(list)).map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
const discTitleHref = (t) => t.library_type === 'movie' ? `#movies/${encodeURIComponent(t.title_key)}` : `#${t.library_type}/${encodeURIComponent(t.title_key)}`;

// ---------- used by the library pages ---------------------------------------------------------
const discBadge = (format, location) => format ? `<span class="badge disc" title="You own this on ${esc(format)}${location ? ' · ' + esc(location) : ''}">💿 ${esc(format)}</span>` : '';
// Title page: a link to the disc you hold, or (for whoever may edit) a button to record one.
const discBtn = (type, key, title, year, held) => held && held.length
  ? `<a class="badge disc" href="#discs/${held[0].release_id}" title="Open this disc">💿 ${esc(held[0].format)}${held[0].location ? ' · ' + esc(held[0].location) : ''}${held.length > 1 ? ` · ${held.length} copies` : ''}${held.some(h => h.status === 'loaned') ? ' · lent out' : ''}</a>`
  : `<button class="small discbtn cap-metadata-only" data-type="${esc(type)}" data-key="${esc(key)}" data-title="${esc(title || key)}" data-year="${year || ''}" title="Record that you own the physical disc">💿 Own the disc?</button>`;
document.addEventListener('click', e => {
  const b = e.target.closest('.discbtn'); if (!b) return;
  const d = b.dataset;
  discReleaseForm({ title: d.title, year: d.year, kind: d.type === 'movie' ? 'movie' : 'tv', link: { library_type: d.type, title_key: d.key, title: d.title, year: d.year || null } }, () => route());
});

// ---------- sounds: three you can tell apart without looking --------------------------------------
let discAudio = null;
function discBeep(kind) {
  try {
    discAudio = discAudio || new (window.AudioContext || window.webkitAudioContext)();
    const tones = { ok: [[880, 0.09]], duplicate: [[660, 0.08], [660, 0.08]], unknown: [[330, 0.2]], invalid: [[220, 0.3]] }[kind] || [];
    let t = discAudio.currentTime;
    for (const [hz, len] of tones) { const o = discAudio.createOscillator(), g = discAudio.createGain(); o.type = 'square'; o.frequency.value = hz; g.gain.value = 0.05; o.connect(g); g.connect(discAudio.destination); o.start(t); o.stop(t + len); t += len + 0.06; }
  } catch { /* no audio device: the card still says what happened */ }
}

// ---------- title typeahead over the library --------------------------------------------------
function discTypeahead(input, box, onPick) {
  let timer = null, seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer); const q = input.value.trim(); const mine = ++seq;
    if (q.length < 2) { box.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      let rows = []; try { rows = await L.disc.searchTitles(q); } catch { /* not allowed or offline: type it by hand */ }
      if (mine !== seq) return;
      box.innerHTML = rows.slice(0, 12).map((r, i) => `<button type="button" data-i="${i}"><span class="badge ${esc(r.library_type)}">${typeName(r.library_type)}</span> ${esc(r.title)}${r.year ? ` <span class="muted">(${r.year})</span>` : ''}</button>`).join('');
      box.querySelectorAll('button').forEach(b => { b.onclick = () => { box.innerHTML = ''; onPick(rows[Number(b.dataset.i)]); }; });
    }, 180);
  });
}

// ---------- forms -----------------------------------------------------------------------------
/** A new release with its first copy. `o`: { upc, title, year, kind, link, location, status }. */
function discReleaseForm(o = {}, onSaved) {
  let link = o.link || null, extra = {}, touched = false;
  const card = openModal(`<h2>New disc</h2>
    <p class="muted small">${o.upc ? `Barcode <b class="mono">${esc(o.upc)}</b> is not known yet. Say what it is once and every later scan of it is recognised.` : 'A disc entered by hand. Add its barcode later by editing the release.'}</p>
    <div id="drLook" class="disclook" hidden></div>
    <div class="discform">
      <label class="wide">Title <input type="text" id="drTitle" value="${esc(o.title || '')}" placeholder="Start typing: titles from your library appear below" autocomplete="off"><div class="discsug" id="drSug"></div></label>
      <label class="wide" id="drLinkRow"></label>
      <label>Year <input type="number" id="drYear" value="${esc(o.year || '')}" min="1880" max="2100"></label>
      <label>Kind <select id="drKind">${discOpts(DISC_KINDS, o.kind || 'movie')}</select></label>
      <label>Format <select id="drFormat">${discOpts(DISC_FORMATS, o.format || 'Blu-ray')}</select></label>
      <label>Edition <input type="text" id="drEdition" placeholder="Steelbook, Director's Cut, Criterion…"></label>
      <label>Location <input type="text" id="drLoc" value="${esc(o.location || '')}" placeholder="shelf, box, binder"></label>
      <label>This copy is <select id="drStatus">${discOpts({ owned: 'owned', wishlist: 'on my wishlist' }, o.status || 'owned')}</select></label>
    </div>
    <div class="actions"><span class="grow"></span><button id="drCancel">Cancel</button><button id="drSave" class="primary">Save</button></div>`);
  const paintLink = () => { $('#drLinkRow', card).innerHTML = link ? `Library title <span><span class="badge ${esc(link.library_type)}">${typeName(link.library_type)}</span> ${esc(link.title || link.title_key)} <button type="button" class="small" id="drUnlink">not this one</button></span>` : '<span class="muted">Not linked to a library title. Pick one from the suggestions to show the disc badge on its page.</span>'; if ($('#drUnlink', card)) $('#drUnlink', card).onclick = () => { link = null; paintLink(); }; };
  paintLink();
  discTypeahead($('#drTitle', card), $('#drSug', card), (r) => { link = { library_type: r.library_type, title_key: r.title_key, title: r.title, year: r.year }; $('#drTitle', card).value = r.title; if (r.year) $('#drYear', card).value = r.year; $('#drKind', card).value = r.library_type === 'movie' ? 'movie' : 'tv'; paintLink(); });
  $('#drTitle', card).addEventListener('input', () => { touched = true; });
  // An unknown barcode is looked up while the form is already open. The answer fills the form unless you have
  // started typing, and it is only a suggestion: nothing is saved until Save.
  if (o.upc) {
    const look = $('#drLook', card); look.hidden = false; look.className = 'disclook'; look.textContent = 'Looking the barcode up…';
    const when = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    L.disc.lookup(o.upc).then(r => {
      if (!card.isConnected || !$('#drLook', card)) return;
      if (r.status === 'found' && r.isDisc) {
        look.className = 'disclook ok'; look.innerHTML = `Looks like <b>${esc(r.raw_title)}</b> <span class="muted">· from UPCitemdb${r.tmdb ? ' and TMDB' : ''}. Check it, then save.</span>`;
        if (!touched) {
          const f = r.release; $('#drTitle', card).value = f.title || ''; $('#drYear', card).value = f.year || ''; $('#drKind', card).value = f.kind || 'movie'; if (f.format) $('#drFormat', card).value = f.format; $('#drEdition', card).value = f.edition || '';
          extra = { discs_count: f.discs_count, studio: f.studio, lookup_source: r.source };
          if (r.link && !link) { link = r.link; paintLink(); }
        }
      } else if (r.status === 'found') { look.className = 'disclook bad'; look.innerHTML = `This barcode is <b>${esc(r.raw_title)}</b>${r.category ? ` <span class="muted">(${esc(r.category)})</span>` : ''}, which does not look like a disc. Nothing was filled in.`; }
      else if (r.status === 'none') look.textContent = 'The online database does not know this barcode. Type it in once and it is remembered.';
      else if (r.status === 'limited') look.textContent = `Online lookup is resting until ${when(r.retryAt)} (the free service allows 6 a minute and 100 a day). Type it in, or try again later.`;
      else if (r.status === 'off') look.textContent = 'Online lookup is switched off in Settings → Discs.';
      else if (r.status === 'local') look.textContent = 'This barcode is already a release.';
      else look.textContent = (r.message || 'The lookup did not work') + '. Type it in.';
    }).catch(() => { if ($('#drLook', card)) look.hidden = true; });
  }
  $('#drCancel', card).onclick = closeModal;
  $('#drSave', card).onclick = async () => {
    try {
      const saved = await L.disc.saveRelease({ ...extra, upc: o.upc || null, title: $('#drTitle', card).value, year: $('#drYear', card).value, kind: $('#drKind', card).value, format: $('#drFormat', card).value, edition: $('#drEdition', card).value, link, copy: { status: $('#drStatus', card).value, location: $('#drLoc', card).value } });
      closeModal(); toast(`Saved ${saved.release.title}`); if (onSaved) onSaved(saved);
    } catch (e) { toast(e.message, true); }
  };
  setTimeout(() => $('#drTitle', card).focus(), 30);
}
function discEditRelease(r, onSaved) {
  const f = (id, label, val, extra = '') => `<label>${label} <input type="text" id="${id}" value="${esc(val == null ? '' : val)}" ${extra}></label>`;
  const card = openModal(`<h2>Edit release</h2><div class="discform">
      <label class="wide">Title <input type="text" id="erTitle" value="${esc(r.title)}"></label>
      ${f('erUpc', 'Barcode (UPC or EAN)', r.upc, 'inputmode="numeric"')}
      <label>Year <input type="number" id="erYear" value="${esc(r.year || '')}"></label>
      <label>Kind <select id="erKind">${discOpts(DISC_KINDS, r.kind)}</select></label>
      <label>Format <select id="erFormat">${discOpts(DISC_FORMATS, r.format)}</select></label>
      ${f('erEdition', 'Edition', r.edition)}${f('erRegion', 'Region', r.region)}${f('erStudio', 'Studio', r.studio)}
      <label>Discs in the case <input type="number" id="erCount" value="${esc(r.discs_count || '')}" min="1"></label>
      ${f('erPack', 'Packaging', r.packaging)}${f('erHdr', 'HDR', r.hdr)}${f('erAudio', 'Audio', r.audio)}
      <label class="inline"><input type="checkbox" id="erSlip" ${r.slipcover ? 'checked' : ''}> Has a slipcover</label>
      <label class="inline"><input type="checkbox" id="erImax" ${r.imax_var ? 'checked' : ''}> IMAX scenes change aspect ratio</label>
      <label class="wide">Notes <textarea id="erNotes" rows="3">${esc(r.notes || '')}</textarea></label>
    </div><div class="actions"><span class="grow"></span><button id="erCancel">Cancel</button><button id="erSave" class="primary">Save</button></div>`);
  $('#erCancel', card).onclick = closeModal;
  $('#erSave', card).onclick = async () => {
    const v = id => $('#' + id, card).value;
    try { const saved = await L.disc.saveRelease({ id: r.id, title: v('erTitle'), upc: v('erUpc'), year: v('erYear'), kind: v('erKind'), format: v('erFormat'), edition: v('erEdition'), region: v('erRegion'), studio: v('erStudio'), discs_count: v('erCount'), packaging: v('erPack'), hdr: v('erHdr'), audio: v('erAudio'), slipcover: $('#erSlip', card).checked, imax_var: $('#erImax', card).checked, notes: v('erNotes') }); closeModal(); toast('Saved'); onSaved(saved); } catch (e) { toast(e.message, true); }
  };
}
function discCopyForm(releaseId, c, onSaved) {
  c = c || {};
  const card = openModal(`<h2>${c.id ? 'Edit copy' : 'Add a copy'}</h2><div class="discform">
      <label>Status <select id="dcStatus">${discOpts(DISC_STATUS, c.status || 'owned')}</select></label>
      <label>Location <input type="text" id="dcLoc" value="${esc(c.location || '')}" placeholder="shelf, box, binder"></label>
      <label>Condition <input type="text" id="dcCond" value="${esc(c.condition || '')}" placeholder="new, good, scratched"></label>
      <label>Lent to <input type="text" id="dcLoan" value="${esc(c.loaned_to || '')}"></label>
      <label>Bought on <input type="date" id="dcDate" value="${esc(c.purchase_date || '')}"></label>
      <label>Price <input type="number" id="dcPrice" step="0.01" min="0" value="${c.price == null ? '' : c.price}"></label>
      <label>Store <input type="text" id="dcStore" value="${esc(c.store || '')}"></label>
      <label>Digital code <select id="dcCode">${discOpts(DISC_CODES, c.digital_code || 'none')}</select></label>
      <label class="wide">Notes <textarea id="dcNotes" rows="2">${esc(c.notes || '')}</textarea></label>
    </div><div class="actions"><span class="grow"></span><button id="dcCancel">Cancel</button><button id="dcSave" class="primary">Save</button></div>`);
  $('#dcCancel', card).onclick = closeModal;
  $('#dcSave', card).onclick = async () => {
    const v = id => $('#' + id, card).value;
    const o = { status: v('dcStatus'), location: v('dcLoc'), condition: v('dcCond'), loaned_to: v('dcLoan'), purchase_date: v('dcDate'), price: v('dcPrice'), store: v('dcStore'), digital_code: v('dcCode'), notes: v('dcNotes') };
    try { const saved = c.id ? await L.disc.saveCopy(c.id, o) : await L.disc.addCopy(releaseId, o); closeModal(); toast('Saved'); onSaved(saved); } catch (e) { toast(e.message, true); }
  };
}

// ---------- the page --------------------------------------------------------------------------
const discQueue = [];          // this session's scans, newest first (kept while the app is open)
let discBurst = '', discBurstAt = 0;
const discLocGet = () => { try { return localStorage.getItem('medialedger.discLocation') || ''; } catch { return ''; } };
const discLocSet = (v) => { try { localStorage.setItem('medialedger.discLocation', v); } catch { /* private mode */ } };

views.discs = async (arg) => {
  if (arg && /^\d+$/.test(arg)) return discReleaseView(Number(arg));
  const tab = ['scan', 'owned', 'wishlist', 'gaps'].includes(arg) ? arg : (canEditDiscs() ? 'scan' : 'owned');
  const { rows, counts } = await L.disc.list({ status: tab === 'wishlist' ? 'wishlist' : 'owned' });
  view.innerHTML = `<h1>Discs</h1>
    <div class="toolbar" style="margin:-6px 0 12px">${canEditDiscs() ? `<button class="${tab === 'scan' ? 'primary' : ''}" data-tab="scan">Scan</button>` : ''}<button class="${tab === 'owned' ? 'primary' : ''}" data-tab="owned">Owned</button><button class="${tab === 'wishlist' ? 'primary' : ''}" data-tab="wishlist">Wishlist</button><button class="${tab === 'gaps' ? 'primary' : ''}" data-tab="gaps">Gaps</button><span class="muted tiny">The physical discs you have, by barcode. A film can be ripped, owned on disc, or both.</span></div>
    <div class="tiles compact">${tile('', 'On the shelf', counts.owned + counts.loaned, `${counts.releases} release${counts.releases === 1 ? '' : 's'} known`)}${tile(counts.loaned ? 'warnt' : '', 'Lent out', counts.loaned)}${tile('', 'Wishlist', counts.wishlist)}${tile(counts.unredeemed ? 'warnt' : '', 'Digital codes', counts.unredeemed, 'not redeemed yet')}</div>
    <div id="discBody"></div>`;
  view.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { location.hash = '#discs/' + b.dataset.tab; }; });
  if (tab === 'scan') return discScanTab();
  if (tab === 'gaps') return discGapsTab();
  discListTab(tab, rows);
};

function discListTab(tab, rows) {
  const body = $('#discBody');
  const cols = [
    { key: 'title', label: 'Title', cls: 'wrap', render: r => `${esc(r.title)}${r.loaned ? ' <span class="badge warn">lent out</span>' : ''}` },
    { key: 'year', label: 'Year', num: true, render: r => r.year || '' },
    { key: 'format', label: 'Format', render: r => `<span class="badge disc">${esc(r.format)}</span>` },
    { key: 'edition', label: 'Edition', cls: 'wrap', render: r => esc(r.edition || '') },
    { key: 'locations', label: 'Location', cls: 'wrap', render: r => esc((r.locations || '').split(',').join(', ')) },
    { key: 'copies', label: 'Copies', num: true },
    { key: 'titles', label: 'In library', num: true, render: r => r.titles ? `${r.titles} linked` : '<span class="muted">not linked</span>' },
  ];
  const tb = el(`<div class="toolbar"><input type="search" placeholder="Filter by title, edition or barcode…">${canEditDiscs() ? '<button id="discNew" class="primary">New disc</button>' : ''}<button id="discCsv">Export CSV</button><span class="grow"></span><span class="muted tiny">${rows.length} release${rows.length === 1 ? '' : 's'}</span></div>`);
  const t = makeTable(rows, cols, { search: r => `${r.title} ${r.edition || ''} ${r.upc || ''} ${r.locations || ''}`, defaultSort: { key: 'title' }, onRow: r => { location.hash = '#discs/' + r.id; } });
  $('input', tb).oninput = (e) => t.setQuery(e.target.value);
  if ($('#discNew', tb)) $('#discNew', tb).onclick = () => discReleaseForm({ status: tab === 'wishlist' ? 'wishlist' : 'owned' }, () => route());
  $('#discCsv', tb).onclick = async () => { try { const r = await L.disc.exportCsv(); downloadText(r.filename, r.csv, 'text/csv'); } catch (e) { toast(e.message, true); } };
  body.append(tb, rows.length ? t.node : el(`<div class="empty">${tab === 'wishlist' ? 'Nothing on the wishlist. Add a disc and mark its copy as "on my wishlist".' : 'No discs yet. Scan a barcode on the Scan tab, or add one by hand.'}</div>`));
}

async function discScanTab() {
  const body = $('#discBody');
  body.innerHTML = `<div class="card discscan">
      <input type="text" id="discScanIn" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="Scan a barcode, or type it and press Enter">
      <div class="inline"><label class="inline">Location for these scans <input type="text" id="discLoc" value="${esc(discLocGet())}" placeholder="shelf, box, binder (kept until you change it)" style="min-width:260px"></label><label class="inline" title="Keep scanning: unknown barcodes wait in the list below instead of opening the form"><input type="checkbox" id="discBulk"> Bulk: do not stop for unknown barcodes</label></div>
    </div>
    <div id="discLast"></div>
    <div class="card" style="margin-top:12px"><h3>This session <span class="right muted tiny" id="discQn"></span></h3><div id="discQ"></div></div>
    <div class="card" style="margin-top:12px"><h3>Recent scans</h3><div id="discRecent" class="muted">Loading…</div></div>
    <div class="card" style="margin-top:12px"><h3>Shelf labels</h3><p class="muted small">Print a code for each place you keep discs and stick it on the shelf or box. Scan the label, then the discs that live there: the label sets the location for the scans that follow. This needs a scanner that reads QR codes (a 2D scanner); a laser-line scanner reads only barcodes.</p>
      <div class="inline" style="align-items:flex-start;gap:14px;flex-wrap:wrap"><textarea id="discLabNames" rows="5" style="min-width:260px;flex:1" placeholder="One place per line: Shelf A, Box 3, Binder 1…"></textarea><div><button id="discLabPrint" class="primary">Print labels</button><div class="muted tiny" style="margin-top:6px" id="discLabNote"></div></div></div>
      <div class="disclabs" id="discLabPrev"></div></div>`;
  const inp = $('#discScanIn');
  $('#discLoc').oninput = (e) => discLocSet(e.target.value.trim());
  inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const code = inp.value; inp.value = ''; if (code.trim()) discSubmit(code); } };
  // Always ready for the scanner: focus comes back unless you are typing somewhere else on purpose.
  inp.onblur = () => setTimeout(() => { const a = document.activeElement; if ($('#discScanIn') === inp && $('#modal').hidden && !(a && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(a.tagName))) inp.focus(); }, 150);
  discPaintQueue(); discPaintRecent(); discLabels();
  inp.focus();
}
// A scanner is a keyboard. If the box lost focus, a burst of digits that ends in Enter is still a scan.
document.addEventListener('keydown', (e) => {
  const inp = $('#discScanIn'); if (!inp || e.target === inp || !$('#modal').hidden) return;
  if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const now = Date.now(); if (now - discBurstAt > 400) discBurst = ''; discBurstAt = now;
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) discBurst += e.key;
  else if (e.key === 'Shift') { /* part of typing ":" and capitals */ }
  else if (e.key === 'Enter' && (/^\d{8,}$/.test(discBurst) || DISC_LOC.test(discBurst))) { e.preventDefault(); const code = discBurst; discBurst = ''; inp.focus(); discSubmit(code); }
  else discBurst = '';
});

// A shelf label: "ml:loc:Shelf A". Scanning one changes where the next discs are filed; nothing is sent anywhere.
const DISC_LOC = /^\s*ml:loc:(.+?)\s*$/i;
const discLabelText = (name) => 'ml:loc:' + String(name).trim().slice(0, 80);
function discSetLocation(name) {
  name = String(name).trim().slice(0, 120); discLocSet(name); if ($('#discLoc')) $('#discLoc').value = name;
  discBeep('ok');
  const box = $('#discLast'); if (box) box.innerHTML = `<div class="card disclast ok" style="margin-top:12px">Location is now <b>${esc(name)}</b>. The discs you scan next are filed there.</div>`;
}
async function discLabels() {
  const ta = $('#discLabNames'); if (!ta) return;
  let known = []; try { known = await L.disc.locations(); } catch { /* start empty */ }
  if (!$('#discLabNames')) return;
  if (!ta.value) ta.value = known.map(k => k.location).join('\n');
  const names = () => [...new Set(ta.value.split('\n').map(s => s.trim()).filter(Boolean))].slice(0, 60);
  const paint = () => { const n = names(); $('#discLabPrev').innerHTML = n.slice(0, 8).map(x => `<div class="disclab"><div class="qrbox">${qrSvg(discLabelText(x), { size: 96, label: 'Shelf label ' + x })}</div><div>${esc(x)}</div></div>`).join(''); $('#discLabNote').textContent = n.length ? `${n.length} label${n.length === 1 ? '' : 's'}${n.length > 8 ? ', first 8 shown' : ''}` : 'Type a place to make its label.'; };
  ta.oninput = paint; paint();
  $('#discLabPrint').onclick = () => {
    const n = names(); if (!n.length) return toast('Type at least one place', true);
    let sheet = $('#printSheet'); if (!sheet) { sheet = el('<div id="printSheet"></div>'); document.body.append(sheet); }
    sheet.innerHTML = n.map(x => `<div class="plabel">${qrSvg(discLabelText(x), { size: 150, label: 'Shelf label ' + x })}<div>${esc(x)}</div></div>`).join('');
    document.body.classList.add('print-labels');
    const done = () => { document.body.classList.remove('print-labels'); sheet.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  };
}

async function discSubmit(code, force = false) {
  const loc = DISC_LOC.exec(String(code)); if (loc) return discSetLocation(loc[1]);
  const location = ($('#discLoc') ? $('#discLoc').value : discLocGet()).trim();
  let r; try { r = await L.disc.scan(code, { location, force }); } catch (e) { toast(e.message, true); return; }
  const kind = r.invalid ? 'invalid' : r.unknown ? 'unknown' : r.duplicate && !r.ok ? 'duplicate' : 'ok';
  discBeep(kind);
  const entry = { kind, code: r.upc || String(code).trim(), release: r.release || null, at: new Date().toISOString(), second: r.ok && r.duplicate, wished: !!r.fromWishlist };
  if (!force || kind !== 'ok') discQueue.unshift(entry); else { const q = discQueue.find(x => x.kind === 'duplicate' && x.code === entry.code); if (q) Object.assign(q, entry); else discQueue.unshift(entry); }
  discPaintLast(entry); discPaintQueue(); discPaintRecent();
  if (kind !== 'unknown') return;
  if (!($('#discBulk') && $('#discBulk').checked)) return discDescribe(entry);
  L.disc.lookup(entry.code).then(l => { entry.hint = l.status === 'found' ? (l.isDisc ? `Looks like ${l.release.title}${l.release.format ? ` (${l.release.format})` : ''}.` : `Not a disc: ${l.raw_title}.`) : l.status === 'limited' ? 'Lookup resting (free limit).' : l.status === 'none' ? 'Not in the online database.' : ''; discPaintQueue(); if (discQueue[0] === entry) discPaintLast(entry); }).catch(() => {});
}
// An unknown barcode becomes a release: the form opens with the barcode filled in.
function discDescribe(entry) {
  discReleaseForm({ upc: entry.code, location: discLocGet() }, (saved) => { entry.kind = 'ok'; entry.release = saved.release; discBeep('ok'); discPaintLast(entry); discPaintQueue(); discPaintRecent(); const i = $('#discScanIn'); if (i) i.focus(); });
}
const discLine = (q) => q.kind === 'invalid' ? 'Not a barcode: the check digit does not match. Scan it again.'
  : q.kind === 'unknown' ? `Not known yet.${q.hint ? ' ' + esc(q.hint) : ''}`
  : q.kind === 'duplicate' ? `You already have ${esc(q.release.title)} (${esc(q.release.format)}). Nothing was added.`
  : `${q.wished ? 'Off the wishlist: ' : q.second ? 'Another copy of ' : 'Added '}${esc(q.release.title)}${q.release.year ? ` (${q.release.year})` : ''} · ${esc(q.release.format)}`;
function discPaintLast(q) {
  const box = $('#discLast'); if (!box) return;
  box.innerHTML = `<div class="card disclast ${q.kind}" style="margin-top:12px"><div class="inline"><b class="mono">${esc(q.code)}</b><span>${discLine(q)}</span><span class="grow"></span>${q.kind === 'duplicate' ? '<button id="dlAgain">Add another copy</button>' : ''}${q.kind === 'unknown' ? '<button id="dlWhat" class="primary">Say what it is</button>' : ''}${q.release ? `<a href="#discs/${q.release.id}">Open</a>` : ''}</div></div>`;
  if ($('#dlAgain')) $('#dlAgain').onclick = () => discSubmit(q.code, true);
  if ($('#dlWhat')) $('#dlWhat').onclick = () => discDescribe(q);
}
function discPaintQueue() {
  const box = $('#discQ'); if (!box) return;
  const ok = discQueue.filter(q => q.kind === 'ok').length, waiting = discQueue.filter(q => q.kind === 'unknown').length;
  $('#discQn').textContent = discQueue.length ? `${ok} added${waiting ? ` · ${waiting} waiting for details` : ''}` : '';
  box.innerHTML = discQueue.length ? `<div class="discq">${discQueue.slice(0, 60).map((q, i) => `<span class="mono">${esc(q.code)}</span><span>${discLine(q)}</span><span>${q.kind === 'unknown' ? `<button class="small" data-what="${i}">Say what it is</button>` : q.kind === 'duplicate' ? `<button class="small" data-again="${i}">Add another copy</button>` : q.release ? `<a href="#discs/${q.release.id}">Open</a>` : ''}</span>`).join('')}</div>` : '<div class="muted">Nothing scanned yet. Each scan appears here as it happens.</div>';
  box.querySelectorAll('[data-what]').forEach(b => { b.onclick = () => discDescribe(discQueue[Number(b.dataset.what)]); });
  box.querySelectorAll('[data-again]').forEach(b => { b.onclick = () => discSubmit(discQueue[Number(b.dataset.again)].code, true); });
}
async function discPaintRecent() {
  const box = $('#discRecent'); if (!box) return;
  let rows = []; try { rows = await L.disc.recentScans(25); } catch { /* shown as empty */ }
  if (!$('#discRecent')) return;
  const word = { ok: 'added', duplicate: 'already owned', unknown: 'not known', invalid: 'not a barcode' };
  box.className = ''; box.innerHTML = rows.length ? `<div class="discq">${rows.map(s => `<span class="mono">${esc(s.upc || '')}</span><span>${s.title ? esc(s.title) + ` <span class="muted">${esc(s.format || '')}</span>` : `<span class="muted">${word[s.result] || esc(s.result)}</span>`}</span><span class="muted tiny">${word[s.result] || esc(s.result)} · ${fmtDate(s.ts)}</span>`).join('')}</div>` : '<div class="muted">No scans yet.</div>';
}

async function discReleaseView(id) {
  const d = await L.disc.get(id);
  if (!d) { view.innerHTML = '<div class="empty">That disc is not in the list any more. <a href="#discs/owned">Back to Discs</a></div>'; return; }
  const r = d.release, edit = canEditDiscs(), admin = !L.isWeb || (me && me.role === 'admin');
  const repaint = () => discReleaseView(id);
  const fact = (k, v) => v == null || v === '' ? '' : `<tr><td>${k}</td><td>${v}</td></tr>`;
  view.innerHTML = `<div class="detail-head"><span class="back" id="back">← Discs</span><h1>${esc(r.title)}${r.year ? ` <span class="muted">(${r.year})</span>` : ''}</h1><span class="badge disc">💿 ${esc(r.format)}</span><span class="badge">${esc(DISC_KINDS[r.kind] || r.kind)}</span>${r.edition ? `<span class="badge">${esc(r.edition)}</span>` : ''}<span class="grow"></span>${edit ? '<button class="small" id="drEdit">Edit</button><button class="small primary" id="drAddCopy">Add a copy</button>' : ''}${admin ? '<button class="small danger" id="drDelete">Delete</button>' : ''}</div>
    <div class="card"><table class="kv">${fact('Barcode', r.upc ? `<span class="mono">${esc(r.upc)}</span>` : '<span class="muted">none: entered by hand</span>')}${fact('Region', esc(r.region || ''))}${fact('Studio', esc(r.studio || ''))}${fact('Discs in the case', r.discs_count || '')}${fact('Packaging', esc([r.packaging, r.slipcover ? 'slipcover' : ''].filter(Boolean).join(' · ')))}${fact('HDR', esc(r.hdr || ''))}${fact('Audio', esc(r.audio || ''))}${fact('IMAX', r.imax_var ? 'scenes change aspect ratio' : '')}${fact('Notes', esc(r.notes || ''))}</table></div>
    <div class="section-head"><h2>Copies <span class="muted">(${d.copies.length})</span></h2></div><div id="drCopies"></div>
    <div class="section-head"><h2>In the library <span class="muted">(${d.titles.length})</span></h2></div>
    <div class="card"><div id="drTitles">${d.titles.map(t => `<div class="inline" style="padding:3px 0"><span class="badge ${esc(t.library_type)}">${typeName(t.library_type)}</span><a href="${discTitleHref(t)}">${esc(t.title || t.title_key)}</a>${t.season != null ? `<span class="muted">season ${t.season}</span>` : ''}<span class="grow"></span>${edit ? `<button class="small" data-unlink="${t.id}">Unlink</button>` : ''}</div>`).join('') || '<div class="muted">Not linked to anything in the library. A linked title shows the disc badge on its page and in the lists.</div>'}</div>
      ${edit ? '<div style="margin-top:10px"><input type="text" id="drLinkQ" placeholder="Link a library title: start typing…" autocomplete="off" style="width:100%"><div class="discsug" id="drLinkSug"></div></div>' : ''}</div>`;
  $('#back').onclick = () => { location.hash = '#discs/owned'; };
  const copyCols = [
    { key: 'status', label: 'Status', render: c => edit ? `<select class="small dcSt" data-id="${c.id}">${discOpts(DISC_STATUS, c.status)}</select>` : esc(DISC_STATUS[c.status] || c.status) },
    { key: 'location', label: 'Location', cls: 'wrap', render: c => esc(c.location || '') },
    { key: 'condition', label: 'Condition', render: c => esc(c.condition || '') },
    { key: 'loaned_to', label: 'Lent to', render: c => esc(c.loaned_to || '') },
    { key: 'purchase_date', label: 'Bought', render: c => esc(c.purchase_date || '') },
    { key: 'price', label: 'Price', num: true, render: c => c.price == null ? '' : Number(c.price).toFixed(2) },
    { key: 'store', label: 'Store', render: c => esc(c.store || '') },
    { key: 'digital_code', label: 'Digital code', render: c => c.digital_code === 'none' ? '' : `<span class="badge ${c.digital_code === 'unredeemed' ? 'warn' : 'ok'}">${esc(DISC_CODES[c.digital_code])}</span>` },
    { key: 'notes', label: 'Notes', cls: 'wrap', render: c => esc(c.notes || '') },
    ...(edit ? [{ key: 'id', label: '', cls: 'rowacts', render: c => `<button class="small dcEdit" data-id="${c.id}">Edit</button>` }] : []),
  ];
  $('#drCopies').append(d.copies.length ? makeTable(d.copies, copyCols, { short: true }).node : el('<div class="empty">No copies. This release is known, but you do not have one: add a copy, or put it on the wishlist.</div>'));
  view.querySelectorAll('.dcSt').forEach(s => { s.onclick = e => e.stopPropagation(); s.onchange = async () => { try { await L.disc.setCopyStatus(Number(s.dataset.id), s.value); toast('Saved'); repaint(); } catch (e) { toast(e.message, true); } }; });
  view.querySelectorAll('.dcEdit').forEach(b => { b.onclick = (e) => { e.stopPropagation(); discCopyForm(id, d.copies.find(c => c.id === Number(b.dataset.id)), repaint); }; });
  view.querySelectorAll('[data-unlink]').forEach(b => { b.onclick = async () => { try { await L.disc.unlinkTitle(Number(b.dataset.unlink)); repaint(); } catch (e) { toast(e.message, true); } }; });
  if (edit) {
    $('#drEdit').onclick = () => discEditRelease(r, repaint);
    $('#drAddCopy').onclick = () => discCopyForm(id, { location: discLocGet() }, repaint);
    discTypeahead($('#drLinkQ'), $('#drLinkSug'), async (t) => { try { await L.disc.linkTitle(id, { library_type: t.library_type, title_key: t.title_key, title: t.title, year: t.year }); repaint(); } catch (e) { toast(e.message, true); } });
  }
  if ($('#drDelete')) $('#drDelete').onclick = () => {
    const card = openModal(`<h2>Delete this release?</h2><p>${esc(r.title)} · ${esc(r.format)}${d.copies.length ? `. Its <b>${d.copies.length} cop${d.copies.length === 1 ? 'y' : 'ies'}</b> and library links go with it.` : '.'} The scan log is kept. If you sold or gave the disc away, change the copy's status instead: that keeps the history.</p><div class="actions"><span class="grow"></span><button id="ddCancel">Cancel</button><button id="ddGo" class="danger">Delete</button></div>`);
    $('#ddCancel', card).onclick = closeModal;
    $('#ddGo', card).onclick = async () => { try { await L.disc.deleteRelease(id, { force: true }); closeModal(); toast('Deleted'); location.hash = '#discs/owned'; } catch (e) { toast(e.message, true); } };
  };
}

// ---------- gaps: where the shelf and the library disagree ----------------------------------------
let discGapPick = 'discOnly';
const DISC_GAPS = [
  ['discOnly', 'On disc, not in the library', 'Discs you hold whose film is missing from the library, or not linked to it yet. Rip these, or link them.'],
  ['discNotRipped', 'Disc owned, library copy is not a rip', 'You hold the disc, but the file in the library did not come from one. Ripping your own disc usually beats it.'],
  ['ripNoDisc', 'Ripped, no disc recorded', 'The file came from a disc, but no disc is on the list. Record the disc, or note that it is gone.'],
  ['both', 'A rip and a download', 'The library has the same title from a disc and from a download. One of them can usually go.'],
  ['noDisc', 'In the library, no disc', 'Everything in the library you do not hold on disc.'],
];
async function discGapsTab() {
  const body = $('#discBody');
  body.innerHTML = '<div class="empty">Comparing the shelf with the library…</div>';
  const g = await L.disc.gaps();
  if (!$('#discBody')) return;
  const edit = canEditDiscs();
  const paint = () => {
    const [key, , blurb] = DISC_GAPS.find(d => d[0] === discGapPick) || DISC_GAPS[0];
    const rows = g[key];
    body.innerHTML = `<div class="tiles compact">${DISC_GAPS.map(([k, label]) => `<div class="tilelink" role="button" tabindex="0" data-gap="${k}">${tile(k === key ? 'okt' : '', label, g[k].length)}</div>`).join('')}</div>
      ${!g.originsSet ? '<div class="card" style="margin-bottom:12px"><b>No root says where its files came from yet.</b> <span class="muted">The rip-or-download lists stay empty until you set <i>From</i> on your roots in Settings → Library roots (for example <i>ripped from disc</i> on Movies_Rip).</span></div>' : ''}
      <p class="lead" style="margin:4px 0 10px">${blurb}</p><div id="discGapTable"></div>`;
    body.querySelectorAll('[data-gap]').forEach(a => { a.onclick = () => { discGapPick = a.dataset.gap; paint(); }; });
    const box = $('#discGapTable');
    if (!rows.length) { box.append(el('<div class="empty">Nothing here.</div>')); return; }
    const cols = key === 'discOnly' ? [
      { key: 'title', label: 'Disc', cls: 'wrap', render: r => esc(r.title) + (r.edition ? ` <span class="muted">${esc(r.edition)}</span>` : '') },
      { key: 'year', label: 'Year', num: true, render: r => r.year || '' },
      { key: 'format', label: 'Format', render: r => `<span class="badge disc">${esc(r.format)}</span>` },
      { key: 'locations', label: 'Location', cls: 'wrap', render: r => esc((r.locations || '').split(',').join(', ')) },
      { key: 'reason', label: 'Why', cls: 'wrap', render: r => r.reason === 'unlinked' ? (r.candidate ? `not linked: looks like <b>${esc(r.candidate.title)}</b>${r.candidate.year ? ` (${r.candidate.year})` : ''} in the library` : 'not linked to a library title, and nothing in the library has this name') : r.reason === 'absent' ? 'the linked title is not in the library any more' : `${r.missing} of its ${r.linked} titles are not in the library` },
      ...(edit ? [{ key: 'id', label: '', cls: 'rowacts', render: r => r.candidate ? `<button class="small gapLink" data-id="${r.id}">Link</button>` : '' }] : []),
    ] : [
      { key: 'library_type', label: 'Type', render: r => `<span class="badge ${esc(r.library_type)}">${typeName(r.library_type)}</span>` },
      { key: 'title', label: 'Title', cls: 'wrap', render: r => esc(r.title) },
      { key: 'year', label: 'Year', num: true, render: r => r.year || '' },
      { key: 'origins', label: 'Files from', render: r => originBadges(r.origins) || '<span class="muted">not set</span>' },
      ...(key === 'noDisc' || key === 'ripNoDisc' ? [] : [{ key: 'disc_format', label: 'Disc', render: r => r.disc_format ? discBadge(r.disc_format, r.disc_location) + (r.disc_location ? ` <span class="muted">${esc(r.disc_location)}</span>` : '') : '<span class="muted">none</span>' }]),
    ];
    const tb = el('<div class="toolbar"><input type="search" placeholder="Filter…"><span class="grow"></span><span class="muted tiny">' + rows.length + ' title' + (rows.length === 1 ? '' : 's') + '</span></div>');
    const t = makeTable(rows, cols, { search: r => `${r.title} ${r.edition || ''} ${r.locations || ''}`, defaultSort: { key: 'title' }, onRow: r => { location.hash = key === 'discOnly' ? '#discs/' + r.id : discTitleHref(r).slice(0); } });
    $('input', tb).oninput = (e) => t.setQuery(e.target.value);
    box.append(tb, t.node);
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('.gapLink'); if (!b) return; e.stopPropagation();
      const r = rows.find(x => x.id === Number(b.dataset.id)); if (!r || !r.candidate) return;
      try { await L.disc.linkTitle(r.id, r.candidate); toast(`Linked to ${r.candidate.title}`); discGapsTab(); } catch (err) { toast(err.message, true); }
    }, true);
  };
  paint();
}
