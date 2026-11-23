'use strict';
/* Collections: sets of titles across TV, anime and movies. The list of sets, and one set with its titles in order.
   One of the plain scripts that make up the renderer; they share the page scope. See CLAUDE.md, "Renderer files". */

const COL_TYPE = { movie: 'Movie', tv: 'TV', anime: 'Anime', other: 'Other' };
const COL_SRC = { manual: 'Yours', plex: 'From Plex', franchise: 'Franchises' };
const colSrcBadge = (c) => c.source === 'plex' ? '<span class="badge" title="mirrored from Plex">Plex</span>' : c.source === 'franchise' ? '<span class="badge" title="kept up to date after each scan">Franchise</span>' : '';
const colSrcGet = () => { try { return localStorage.getItem('colSrc') || ''; } catch { return ''; } };
const colHref = (i) => i.library_type === 'movie' ? `#movies/${encodeURIComponent(i.title_key)}` : `#${i.library_type}/${encodeURIComponent(i.title_key)}`;
const canEditCollections = () => !L.isWeb || (me && me.role === 'admin');

views.collections = async (arg) => {
  if (arg === 'unassigned') return franchiseUnassignedView();
  if (arg) return collectionView(Number(arg));
  const [cols] = await Promise.all([L.collections.list(), loadPosterIndex()]);
  const fromPlex = cols.filter(c => c.source === 'plex').length, fromFr = cols.filter(c => c.source === 'franchise').length;
  const frAuto = canEditCollections() ? await L.settings.get().then(s => (s.franchises || {}).auto !== false).catch(() => true) : true;
  view.innerHTML = `<h1>Collections</h1>
    <p class="lead">Sets of titles that belong together, across TV, anime and movies: a film series, a shared universe, a director's work. Each shows what you have, what is missing, and the order to watch it in.${fromPlex ? ` ${fromPlex} came from Plex and follow Plex's lists; the titles you add to them yourself stay.` : ''}</p>
    <div class="tiles compact">${tile('', 'Collections', cols.length, `${fromPlex} from Plex · ${fromFr} franchises · ${cols.length - fromPlex - fromFr} yours`)}${tile(cols.some(c => c.missing) ? 'warnt' : 'okt', 'Complete', `${cols.filter(c => !c.missing && c.items).length} of ${cols.length}`, `${cols.reduce((a, c) => a + c.missing, 0)} titles not in the library`)}${tile('', 'Titles in sets', cols.reduce((a, c) => a + c.present, 0), fmtBytes(cols.reduce((a, c) => a + c.bytes, 0)))}</div>
    <div class="toolbar"><input type="search" id="colQ" placeholder="Filter…"><select id="colSrc" title="Which collections to show"><option value="">All (${cols.length})</option>${Object.keys(COL_SRC).map(k => `<option value="${k}" ${colSrcGet() === k ? 'selected' : ''}>${COL_SRC[k]} (${cols.filter(c => c.source === k).length})</option>`).join('')}</select>${canEditCollections() ? '<button class="primary" id="colNew">New collection</button>' : ''}<span class="muted tiny">Plex collections are read from Plex on each sync and never written back.</span></div>
    <div class="colgrid" id="colGrid"></div>
    ${canEditCollections() ? `<div class="card" style="margin-top:16px"><h3>Franchises</h3><p class="muted">After each scan the library is sorted into franchises across movies, TV and anime. Each one is a collection marked Franchise that lists what you have and what is missing, in release order. The lists of what belongs to a franchise were written from memory, not checked against a source, so read a missing title as something to check. Titles you add to a franchise yourself stay.</p><div class="inline"><button class="small primary" id="frSync">Update now</button><button class="small" id="frUn">Titles in no franchise…</button><label class="inline tiny"><input type="checkbox" id="frAuto" ${frAuto ? 'checked' : ''}> Update after each scan</label><span class="muted tiny" id="frLine"></span></div></div>` : ''}
    ${canEditCollections() ? `<div class="card" style="margin-top:16px"><h3>Find sets in the library</h3><p class="muted">Looks for titles that belong together: names in the library itself ("Rocky II", "Pirates of the Caribbean: …"), AniList's sequel and side-story links for matched anime, and Wikidata's "part of the series" for films and shows. All free, no key. Each suggestion lists what it would gather; nothing is made until you press Create.</p><div class="inline"><button class="small" id="sugLocal">From names only (instant)</button><button class="small primary" id="sugWeb">Names, AniList and Wikidata (a minute or two)</button><span class="muted tiny" id="sugLine"></span></div><div id="sugList"></div></div>` : ''}`;
  const sugRun = async (web) => {
    const line = $('#sugLine'), box = $('#sugList'); $('#sugLocal').disabled = $('#sugWeb').disabled = true; line.textContent = web ? 'Asking AniList and Wikidata…' : 'Looking…'; box.innerHTML = '';
    const off = L.collections.onSuggestProgress ? L.collections.onSuggestProgress(p => { line.textContent = `${p.phase === 'anilist' ? 'AniList' : 'Wikidata'} ${p.done} of ${p.total}: ${p.title}`; }) : null;
    try {
      const sugs = await L.collections.suggest({ web });
      line.textContent = sugs.length ? `${sugs.length} suggestion${sugs.length === 1 ? '' : 's'}` : 'Nothing found that is not already in a collection.';
      box.innerHTML = sugs.map((g, i) => `<div class="card" style="margin-top:10px" data-i="${i}"><div class="inline"><b>${esc(g.name)}</b><span class="badge">${g.source === 'local' ? 'names' : g.source === 'anilist' ? 'AniList' : 'Wikidata'}</span><span class="muted tiny">${esc(g.why)}</span><span class="grow"></span><button class="small primary sugMake">Create</button></div><div class="muted tiny" style="margin-top:6px">${g.items.map(it => `<span class="badge ${it.library_type}">${COL_TYPE[it.library_type] || it.library_type}</span> ${esc(it.title)}${it.year ? ` (${it.year})` : ''}`).join(' · ')}${g.missing.length ? `<br><span class="muted">Not in the library (added as placeholders): ${g.missing.slice(0, 12).map(m => esc(m.title) + (m.year ? ` (${m.year})` : '')).join(', ')}${g.missing.length > 12 ? ` … and ${g.missing.length - 12} more` : ''}</span>` : ''}</div></div>`).join('');
      box.querySelectorAll('.sugMake').forEach(b => { b.onclick = async () => { const g = sugs[Number(b.closest('.card').dataset.i)]; b.disabled = true; try { const c = await L.collections.createFromSuggestion(g); toast(`Created ${c.name}`); b.closest('.card').remove(); } catch (e) { toast(e.message, true); b.disabled = false; } }; });
    } catch (e) { line.textContent = e.message; }
    finally { if (off) off(); $('#sugLocal').disabled = $('#sugWeb').disabled = false; }
  };
  if ($('#sugLocal')) { $('#sugLocal').onclick = () => sugRun(false); $('#sugWeb').onclick = () => sugRun(true); }
  if ($('#frSync')) {
    $('#frUn').onclick = () => { location.hash = '#collections/unassigned'; };
    $('#frAuto').onchange = async (e) => { try { await L.settings.set({ franchises: { auto: e.target.checked } }); toast(e.target.checked ? 'Franchises follow each scan' : 'Franchises are left as they are'); } catch (err) { toast(err.message, true); } };
    $('#frSync').onclick = async () => { const b = $('#frSync'); b.disabled = true; $('#frLine').textContent = 'Sorting the library…'; try { const r = await L.franchises.sync(); toast(`${r.franchises} franchises: ${r.owned} titles, ${r.missing} missing`); route(); } catch (err) { $('#frLine').textContent = err.message; b.disabled = false; } };
  }
  const draw = () => {
    const q = $('#colQ').value.trim().toLowerCase(), src = $('#colSrc').value;
    const list = cols.filter(c => (!q || c.name.toLowerCase().includes(q)) && (!src || c.source === src));
    $('#colGrid').innerHTML = list.map(c => `<div class="card colcard ${c.cover ? 'with-cover' : ''}" data-id="${c.id}">${c.cover ? `<div class="cover">${posterTag(c.cover.library_type, c.cover.title_key, c.name, 'pcover')}</div>` : ''}<div class="colbody"><h3>${esc(c.name)} ${colSrcBadge(c)}<span class="right muted tiny">${c.types.map(t => COL_TYPE[t] || t).join(' · ')}</span></h3>
      <div class="strip">${c.preview.map(p => posterTag(p.library_type, p.title_key, p.title)).join('') || '<span class="muted tiny">nothing in the library yet</span>'}</div>
      <div class="muted tiny">${c.present} of ${c.items} title${c.items === 1 ? '' : 's'}${c.seconds ? ' · ' + fmtHours(c.seconds) : ''}${c.bytes ? ' · ' + fmtBytes(c.bytes) : ''}${c.missing ? ` · <span class="bad">${c.missing} missing</span>` : c.items ? ' · <span class="ok">complete</span>' : ''}${c.watched ? ` · ${c.watched} watched` : ''}</div>${c.note ? `<div class="muted tiny" style="margin-top:4px">${esc(c.note)}</div>` : ''}</div></div>`).join('') || '<div class="empty">No collections yet. Press New collection, or run a Plex sync to bring in the ones Plex has.</div>';
    $('#colGrid').querySelectorAll('.colcard').forEach(n => { n.onclick = () => { location.hash = '#collections/' + n.dataset.id; }; });
  };
  $('#colQ').oninput = draw; $('#colSrc').onchange = () => { try { localStorage.setItem('colSrc', $('#colSrc').value); } catch { /* private window */ } draw(); }; draw();
  if ($('#colNew')) $('#colNew').onclick = () => editCollectionDialog(null, (c) => { location.hash = '#collections/' + c.id; });
};

function editCollectionDialog(c, done) {
  const card = openModal(`<h2>${c ? 'Rename' : 'New collection'}</h2><div class="field"><label>Name</label><input type="text" id="cName" maxlength="80" value="${esc(c ? c.name : '')}" placeholder="Pirates of the Caribbean"></div><div class="field"><label>Note</label><textarea id="cNote" rows="3" placeholder="Optional: what belongs here, which order to watch it in…">${esc(c ? c.note || '' : '')}</textarea></div><div class="actions"><span class="grow"></span><button id="cCancel">Cancel</button><button class="primary" id="cSave">${c ? 'Save' : 'Create'}</button></div>`);
  $('#cCancel', card).onclick = closeModal;
  $('#cSave', card).onclick = async () => { try { const r = await L.collections.save({ id: c ? c.id : null, name: $('#cName', card).value, note: $('#cNote', card).value }); closeModal(); done(r); } catch (e) { toast(e.message, true); } };
  $('#cName', card).focus();
}

async function collectionView(id) {
  const [c] = await Promise.all([L.collections.get(id), loadPosterIndex()]);
  const fv = c && c.source === 'franchise' ? await L.franchises.view(id).catch(() => null) : null;
  const hasSubs = !!(fv && Object.keys(fv.subs).length), hasTl = !!(fv && fv.timeline.length);
  let bySub = hasSubs && frPref('sub', '1') === '1';
  if (!c) { view.innerHTML = '<h1>Collections</h1><div class="empty">No such collection. <a href="#collections">Back to the list</a>.</div>'; return; }
  const edit = canEditCollections();
  const present = c.items.filter(i => i.present), secs = present.reduce((a, i) => a + (i.seconds || 0), 0), bytes = present.reduce((a, i) => a + (i.bytes || 0), 0);
  const watched = present.filter(i => i.watched === 1 || (i.episodes && i.watched === i.episodes)).length;
  view.innerHTML = `<div class="detail-head"><span class="back" id="back">← Collections</span><h1>${esc(c.name)}</h1>${c.source === 'plex' ? '<span class="badge" title="Mirrored from Plex on each sync; titles you add stay">from Plex</span>' : c.source === 'franchise' ? '<span class="badge" title="Kept up to date after each scan; titles you add stay">Franchise</span>' : ''}<span class="grow"></span><button class="small" id="cExport" title="Download the list as a CSV file">Export CSV</button>${edit ? `<button class="small" id="cRename">Rename / note</button><button class="small" id="cSort" title="Order by release date, then year">Order by release</button><button class="small danger" id="cDelete">Delete</button>` : ''}</div>
    ${c.note ? `<p class="muted">${esc(c.note)}</p>` : ''}
    <div class="tiles compact">${tile(c.items.length && present.length === c.items.length ? 'okt' : (c.items.length ? 'warnt' : ''), 'In the library', `${present.length} of ${c.items.length}`, c.items.length - present.length ? `${c.items.length - present.length} to find` : 'complete')}${tile('', 'Runtime', fmtHours(secs), fmtBytes(bytes))}${tile(present.length && watched === present.length ? 'okt' : '', 'Watched', present.length ? `${watched} of ${present.length}` : '—', 'from Plex play counts')}${tile('', 'Kinds', [...new Set(c.items.map(i => i.library_type))].map(t => COL_TYPE[t] || t).join(' · ') || '—')}</div>
    ${edit ? `<div class="card addbox" style="margin:12px 0"><div class="inline"><input type="search" id="cAdd" placeholder="Add a title: type part of its name…" style="flex:1" autocomplete="off"><button class="small" id="cPlace" title="A title you do not own yet, so the set shows the gap">Add a placeholder…</button></div><div class="hits" id="cHits" hidden></div></div>` : ''}
    ${hasTl ? '<div class="card frtl" id="frTl" style="margin:12px 0"></div>' : ''}
    ${hasSubs ? `<div class="toolbar"><label class="inline"><input type="checkbox" id="frBySub" ${bySub ? 'checked' : ''}> Group by universe</label><span class="muted tiny">${fv.subOrder.filter(s => Object.values(fv.subs).includes(s)).map(esc).join(' · ')}</span></div>` : ''}
    <div class="table-wrap"><table class="colitems"><thead><tr><th>#</th><th></th><th>Title</th><th>Kind</th><th>Released</th><th>On hand</th><th>Watched</th><th>Note</th>${edit ? '<th></th>' : ''}</tr></thead><tbody id="cRows"></tbody></table></div>`;
  $('#back').onclick = () => { location.hash = '#collections'; };
  const draw = (col) => {
    // grouped by universe: the same rows, each still carrying its place in the real order (data-k), under a heading per universe
    const subOf = (i) => i.present ? (fv.subs[i.library_type + '|' + i.title_key] || 'Other') : 'Not in the library';
    const order = bySub ? [...fv.subOrder, 'Other', 'Not in the library'] : null; let lastSub = null;
    const seq = col.items.map((i, k) => ({ i, k })); if (bySub) seq.sort((a, b) => order.indexOf(subOf(a.i)) - order.indexOf(subOf(b.i)) || a.k - b.k);
    const head = (i) => { if (!bySub) return ''; const s = subOf(i); if (s === lastSub) return ''; lastSub = s; const n = col.items.filter(x => subOf(x) === s).length; return `<tr class="subhead"><td colspan="9">${esc(s)} <span class="muted tiny">${n} title${n === 1 ? '' : 's'}</span></td></tr>`; };
    $('#cRows').innerHTML = seq.map(({ i, k }) => `${head(i)}<tr class="${i.present ? 'clickable' : 'gone'}" data-item="${i.id}" data-k="${k}"><td class="pos">${i.position}</td><td>${i.present ? posterTag(i.library_type, i.title_key, i.title) : '<span class="pthumb none">–</span>'}</td><td class="wrap">${i.present ? `<a href="${colHref(i)}">${esc(i.title)}</a>` : `<b>${esc(i.title)}</b>`}${i.year ? ` <span class="muted">(${i.year})</span>` : ''}${i.from_plex ? ' <span class="muted tiny" title="from the Plex collection">Plex</span>' : ''}${c.source === 'franchise' && !i.from_franchise ? ' <span class="muted tiny" title="you added this one yourself">added by you</span>' : ''}</td><td><span class="badge ${i.library_type}">${COL_TYPE[i.library_type] || i.library_type}</span></td><td class="nowrap muted">${i.released ? dayOf(i.released) : ''}</td><td class="nowrap">${i.present ? (i.episodes != null ? `${i.episodes} ep · ${i.seasons} season${i.seasons === 1 ? '' : 's'}` : `${fmtDur(i.seconds)}`) + (i.resolutions ? ` <span class="badge">${esc(String(i.resolutions).split(',').sort().pop())}</span>` : '') : '<span class="badge warn">not in the library</span>'}</td><td class="nowrap">${i.watched == null ? '<span class="muted">—</span>' : i.episodes != null ? `${pct(i.watched, i.episodes)}%` : (i.watched ? '<span class="ok">yes</span>' : 'no')}</td><td class="wrap muted tiny">${esc(i.note || '')}</td>${edit ? `<td class="rowacts"><span class="ord"><button class="small" data-act="up" title="Move up" ${k === 0 || bySub ? 'disabled' : ''}>▲</button><button class="small" data-act="down" title="Move down" ${k === col.items.length - 1 || bySub ? 'disabled' : ''}>▼</button></span> <button class="small" data-act="note" title="Note on this title">✎</button> ${i.present ? `<button class="small" data-act="cover" title="${col.cover_type === i.library_type && col.cover_key === i.title_key ? 'This poster is the cover' : 'Use this poster as the cover'}" ${col.cover_type === i.library_type && col.cover_key === i.title_key ? 'disabled' : ''}>★</button>` : ''} <button class="small" data-act="remove" title="${i.from_franchise ? (i.present ? 'Not part of this franchise' : 'Stop listing this as missing') : 'Remove from the collection'}">✕</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="9" class="empty">Nothing in this collection yet.${edit ? ' Type a title above to add one.' : ''}</td></tr>`;
  };
  draw(c);
  if (hasSubs) $('#frBySub').onchange = (e) => { bySub = e.target.checked; frPref('sub', bySub ? '1' : '0', true); draw(c); };
  if (hasTl) franchiseTimeline(fv);
  const refresh = (col) => { draw(col); c.items = col.items; c.cover_type = col.cover_type; c.cover_key = col.cover_key; };
  $('#cExport').onclick = async () => { try { const r = await L.collections.exportCsv(c.id); downloadText(r.filename, r.csv, 'text/csv'); } catch (e) { toast(e.message, true); } };
  $('#cRows').onclick = async (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const tr = b.closest('tr'), itemId = Number(tr.dataset.item), k = Number(tr.dataset.k), act = b.dataset.act;
    try {
      if (act === 'remove' && c.items.find(i => i.id === itemId).from_franchise) {
        // a title the franchise list put here: removing the row would only last until the next scan, so record the decision instead
        const it = c.items.find(i => i.id === itemId), media = COL_TYPE[it.library_type];
        if (!confirm(it.present ? `Take "${it.title}" out of the franchises? It stays out after later scans. The files are not touched.` : `Stop listing "${it.title}" as missing from this franchise?`)) return;
        await L.franchises.block(it.present ? { kind: 'title', title: it.title, media } : { kind: 'missing', title: it.title, media, franchise: String(c.plex_key || '').slice(3) });
        const col = await L.collections.get(c.id); toast('Done. Undo it under Titles in no franchise.');
        if (!col) { location.hash = '#collections'; return; } refresh(col);
      }
      else if (act === 'remove') { if (!confirm('Remove this title from the collection? The files are not touched.')) return; refresh(await L.collections.removeItem(c.id, itemId)); }
      else if (act === 'cover') { const it = c.items.find(i => i.id === itemId); refresh(await L.collections.setCover(c.id, it.library_type, it.title_key)); toast('Cover set'); }
      else if (act === 'note') { const cur = c.items.find(i => i.id === itemId); const n = prompt('Note on this title (empty to clear):', cur.note || ''); if (n === null) return; refresh(await L.collections.setNote(c.id, itemId, n)); }
      else { const ids = c.items.map(i => i.id); const j = act === 'up' ? k - 1 : k + 1; if (j < 0 || j >= ids.length) return; [ids[k], ids[j]] = [ids[j], ids[k]]; refresh(await L.collections.reorder(c.id, ids)); }
    } catch (err) { toast(err.message, true); }
  };
  if (!edit) return;
  $('#cRename').onclick = () => editCollectionDialog(c, (col) => { c.name = col.name; c.note = col.note; route(); });
  $('#cSort').onclick = async () => { try { refresh(await L.collections.sortByRelease(c.id)); toast('Ordered by release date'); } catch (e) { toast(e.message, true); } };
  $('#cDelete').onclick = async () => { if (!confirm(`Delete the collection "${c.name}"? The titles stay in the library.${c.source === 'plex' ? ' The next Plex sync brings it back from Plex.' : c.source === 'franchise' ? ' The next scan brings it back while the library has titles from this franchise.' : ''}`)) return; await L.collections.remove(c.id); location.hash = '#collections'; };
  // the add box: a search over the whole library, one click adds
  let deb = null;
  $('#cAdd').oninput = () => { clearTimeout(deb); deb = setTimeout(async () => {
    const q = $('#cAdd').value.trim(); const hits = $('#cHits'); if (q.length < 2) { hits.hidden = true; return; }
    const r = await L.collections.search(q); const have = new Set(c.items.filter(i => i.title_key).map(i => i.library_type + '|' + i.title_key));
    hits.innerHTML = r.map(x => `<div data-t="${esc(x.library_type)}" data-k="${esc(x.title_key)}" class="${have.has(x.library_type + '|' + x.title_key) ? 'muted' : ''}"><span class="badge ${x.library_type}">${COL_TYPE[x.library_type]}</span> ${esc(x.title)}${x.year ? ` <span class="muted">(${x.year})</span>` : ''} <span class="muted tiny">${x.n} file${x.n === 1 ? '' : 's'}${have.has(x.library_type + '|' + x.title_key) ? ' · already in it' : ''}</span></div>`).join('') || '<div class="muted">Nothing in the library matches.</div>';
    hits.hidden = false;
    hits.querySelectorAll('div[data-k]').forEach(n => { n.onclick = async () => { try { refresh(await L.collections.addItem(c.id, { library_type: n.dataset.t, title_key: n.dataset.k })); toast('Added'); $('#cAdd').value = ''; hits.hidden = true; } catch (e) { toast(e.message, true); } }; });
  }, 200); };
  $('#cAdd').onblur = () => setTimeout(() => { $('#cHits').hidden = true; }, 250);
  $('#cPlace').onclick = () => {
    const card = openModal(`<h2>Add a placeholder</h2><p class="muted">For a title that belongs in the set but is not in the library yet. It shows as missing until a scan finds it; then add the real title and remove this.</p><div class="field"><label>Title</label><input type="text" id="phTitle" maxlength="200"></div><div class="two"><div class="field"><label>Year</label><input type="number" id="phYear" min="1800" max="2200"></div><div class="field"><label>Kind</label><select id="phKind"><option value="movie">Movie</option><option value="tv">TV</option><option value="anime">Anime</option><option value="other">Other</option></select></div></div><div class="actions"><span class="grow"></span><button id="phCancel">Cancel</button><button class="primary" id="phAdd">Add</button></div>`);
    $('#phCancel', card).onclick = closeModal;
    $('#phAdd', card).onclick = async () => { try { refresh(await L.collections.addItem(c.id, { library_type: $('#phKind', card).value, title: $('#phTitle', card).value, year: $('#phYear', card).value })); closeModal(); } catch (e) { toast(e.message, true); } };
  };
}

// ---------- franchises: the titles no franchise claims, and the decisions made by hand -------------------
async function franchiseUnassignedView() {
  if (!canEditCollections()) { view.innerHTML = '<h1>Collections</h1><div class="empty">Only an admin can sort titles into franchises. <a href="#collections">Back to the list</a>.</div>'; return; }
  const [rows, names, dec] = await Promise.all([L.franchises.unassigned(), L.franchises.names(), L.franchises.decisions()]);
  const SHOW = 300;
  view.innerHTML = `<div class="detail-head"><span class="back" id="back">← Collections</span><h1>Titles in no franchise</h1></div>
    <p class="lead">Most of a library stands alone, so a long list here is normal. Where a title does belong to a saga, press Assign and name the franchise: an existing one or a new one. The choice is remembered and applied after every scan.</p>
    <div class="tiles compact">${tile('', 'In no franchise', rows.length.toLocaleString(), ['movie', 'tv', 'anime'].map(t => `${rows.filter(r => r.library_type === t).length} ${COL_TYPE[t]}`).join(' · '))}${tile('', 'Your decisions', dec.rules.length + dec.blocks.length, `${dec.rules.length} assigned · ${dec.blocks.length} kept out`)}${tile('', 'Franchises known', names.length)}</div>
    <div class="toolbar"><input type="search" id="unQ" placeholder="Filter by title…"><select id="unKind"><option value="">All kinds</option><option value="movie">Movies</option><option value="tv">TV</option><option value="anime">Anime</option></select><span class="muted tiny" id="unLine"></span></div>
    <div class="table-wrap"><table><thead><tr><th>Title</th><th>Kind</th><th>Year</th><th></th></tr></thead><tbody id="unRows"></tbody></table></div>
    <div class="card" style="margin-top:16px"><h3>Your decisions</h3><div id="unDec"></div></div>
    <datalist id="frNames">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
  $('#back').onclick = () => { location.hash = '#collections'; };
  let shown = [];
  const draw = () => {
    const q = $('#unQ').value.trim().toLowerCase(), kind = $('#unKind').value;
    const list = rows.filter(r => (!q || r.title.toLowerCase().includes(q)) && (!kind || r.library_type === kind)); shown = list.slice(0, SHOW);
    $('#unLine').textContent = list.length > SHOW ? `Showing the first ${SHOW} of ${list.length.toLocaleString()}. Type to narrow it down.` : `${list.length.toLocaleString()} title${list.length === 1 ? '' : 's'}`;
    $('#unRows').innerHTML = shown.map((r, i) => `<tr data-i="${i}"><td class="wrap"><a href="${colHref(r)}">${esc(r.title)}</a>${r.blocked ? ' <span class="muted tiny">kept out by you</span>' : ''}</td><td><span class="badge ${r.library_type}">${COL_TYPE[r.library_type]}</span></td><td class="muted">${r.year || ''}</td><td class="rowacts"><button class="small" data-act="assign">Assign…</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nothing matches.</td></tr>';
  };
  $('#unQ').oninput = draw; $('#unKind').onchange = draw; draw();
  $('#unRows').onclick = (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return; const r = shown[Number(b.closest('tr').dataset.i)];
    const card = openModal(`<h2>Which franchise?</h2><p class="muted"><b>${esc(r.title)}</b>${r.year ? ` (${r.year})` : ''}. Pick one from the list or type a new name.</p><div class="field"><label>Franchise</label><input type="text" id="frName" list="frNames" maxlength="80" autocomplete="off"></div><div class="actions"><span class="grow"></span><button id="frCancel">Cancel</button><button class="primary" id="frOk">Assign</button></div>`);
    $('#frCancel', card).onclick = closeModal;
    const go = async () => { const name = $('#frName', card).value.trim(); try { await L.franchises.assign(r.title, name); closeModal(); toast(`${r.title} is now in ${name}`); route(); } catch (err) { toast(err.message, true); } };
    $('#frOk', card).onclick = go; $('#frName', card).onkeydown = (ev) => { if (ev.key === 'Enter') go(); }; $('#frName', card).focus();
  };
  $('#unDec').innerHTML = (dec.rules.length + dec.blocks.length) ? `<div class="table-wrap short"><table><tbody>${dec.rules.map(d => `<tr><td class="wrap"><b>${esc(d.title || d.pattern)}</b></td><td class="muted">belongs to ${esc(d.franchise)}</td><td class="rowacts"><button class="small" data-what="rule" data-id="${d.id}">Undo</button></td></tr>`).join('')}${dec.blocks.map(d => `<tr><td class="wrap"><b>${esc(d.title)}</b>${d.media ? ` <span class="muted tiny">${esc(d.media)}</span>` : ''}</td><td class="muted">${d.kind === 'missing' ? `not listed as missing from ${esc(d.franchise || '')}` : 'kept out of the franchises'}</td><td class="rowacts"><button class="small" data-what="block" data-id="${d.id}">Undo</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">None yet. Assigning a title here, or taking one out of a franchise on its page, is listed here and can be undone.</p>';
  $('#unDec').onclick = async (e) => { const b = e.target.closest('button[data-what]'); if (!b) return; b.disabled = true; try { await L.franchises.undo(b.dataset.what, Number(b.dataset.id)); toast('Undone'); route(); } catch (err) { toast(err.message, true); b.disabled = false; } };
}

// ---------- a franchise's timeline: the same entries in release order or in the order of the story ----------
function frPref(key, fallback, set) { try { if (set) localStorage.setItem('fr.' + key, fallback); return localStorage.getItem('fr.' + key) || fallback; } catch { return fallback; } }
const frDay = (d) => /^\d{4}-\d\d-\d\d$/.test(d || '') ? new Date(d + 'T12:00:00').toLocaleDateString([], { dateStyle: 'medium' }) : (d || '');
function franchiseTimeline(fv) {
  const box = $('#frTl'); if (!box) return;
  let mode = frPref('tl', 'release'), open = frPref('tlOpen', '1') === '1', only = '';
  const have = fv.timeline.filter(e => e.owned).length;
  const paint = () => {
    const list = fv.timeline.filter(e => !only || (only === 'have') === e.owned);
    const rows = mode === 'release'
      ? list.slice().sort((a, b) => a.rel.localeCompare(b.rel) || a.title.localeCompare(b.title)).map(e => ({ e, group: e.rel.slice(0, 4), when: frDay(e.rel) }))
      : list.slice().sort((a, b) => a.era - b.era || a.chron - b.chron || a.rel.localeCompare(b.rel)).map(e => ({ e, group: fv.eras[e.era] || '', when: e.label || '' }));
    let last = null;
    box.innerHTML = `<div class="inline"><h3 style="margin:0">Timeline</h3><span class="muted tiny">${have} of ${fv.timeline.length} in the library</span><span class="grow"></span>
        <span class="pick"><button class="small ${mode === 'release' ? 'primary' : ''}" data-mode="release" title="The order they came out">Release order</button><button class="small ${mode === 'story' ? 'primary' : ''}" data-mode="story" title="The order the story happens in">Story order</button></span>
        <select id="frTlOnly" class="small"><option value="">Everything</option><option value="have" ${only === 'have' ? 'selected' : ''}>In the library</option><option value="need" ${only === 'need' ? 'selected' : ''}>Not in the library</option></select>
        <button class="small" id="frTlOpen">${open ? 'Hide' : 'Show'}</button></div>
      ${open ? `<div class="table-wrap short" style="margin-top:10px"><table class="frtl-table"><tbody>${rows.map(({ e, group, when }, n) => `${group !== last ? ((last = group), `<tr class="subhead"><td colspan="6">${esc(group)}</td></tr>`) : ''}<tr class="${e.owned ? '' : 'gone'}"><td class="pos">${n + 1}</td><td class="nowrap muted">${esc(when)}</td><td class="wrap">${e.owned && e.title_key ? `<a href="${colHref(e)}">${esc(e.title)}</a>` : `<b>${esc(e.title)}</b>`}</td><td><span class="badge ${e.media === 'Movie' ? 'movie' : 'tv'}">${esc(e.media)}</span></td><td class="nowrap">${e.owned ? '<span class="ok">in the library</span>' : '<span class="badge warn">not in the library</span>'}</td><td class="nowrap muted tiny">${mode === 'release' ? esc(e.label || '') : frDay(e.rel)}</td></tr>`).join('') || '<tr><td class="empty">Nothing to show.</td></tr>'}</tbody></table></div>
      <p class="muted tiny" style="margin:8px 0 0">Release dates and story years were written from memory, not checked against a source. Titles with no fixed place in the story come last.</p>` : ''}`;
    box.querySelectorAll('button[data-mode]').forEach(b => { b.onclick = () => { mode = frPref('tl', b.dataset.mode, true); if (!open) open = frPref('tlOpen', '1', true) === '1'; paint(); }; });
    $('#frTlOnly').onchange = (ev) => { only = ev.target.value; paint(); };
    $('#frTlOpen').onclick = () => { open = !open; frPref('tlOpen', open ? '1' : '0', true); paint(); };
  };
  paint();
}
