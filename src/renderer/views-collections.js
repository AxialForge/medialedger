'use strict';
/* Collections: sets of titles across TV, anime and movies. The list of sets, and one set with its titles in order.
   One of the plain scripts that make up the renderer; they share the page scope. See CLAUDE.md, "Renderer files". */

const COL_TYPE = { movie: 'Movie', tv: 'TV', anime: 'Anime', other: 'Other' };
const colHref = (i) => i.library_type === 'movie' ? `#movies/${encodeURIComponent(i.title_key)}` : `#${i.library_type}/${encodeURIComponent(i.title_key)}`;
const canEditCollections = () => !L.isWeb || (me && me.role === 'admin');

views.collections = async (arg) => {
  if (arg) return collectionView(Number(arg));
  const [cols] = await Promise.all([L.collections.list(), loadPosterIndex()]);
  const fromPlex = cols.filter(c => c.source === 'plex').length;
  view.innerHTML = `<h1>Collections</h1>
    <p class="lead">Sets of titles that belong together, across TV, anime and movies: a film series, a shared universe, a director's work. Each shows what you have, what is missing, and the order to watch it in.${fromPlex ? ` ${fromPlex} came from Plex and follow Plex's lists; the titles you add to them yourself stay.` : ''}</p>
    <div class="tiles compact">${tile('', 'Collections', cols.length, `${fromPlex} from Plex · ${cols.length - fromPlex} yours`)}${tile(cols.some(c => c.missing) ? 'warnt' : 'okt', 'Complete', `${cols.filter(c => !c.missing && c.items).length} of ${cols.length}`, `${cols.reduce((a, c) => a + c.missing, 0)} titles not in the library`)}${tile('', 'Titles in sets', cols.reduce((a, c) => a + c.present, 0), fmtBytes(cols.reduce((a, c) => a + c.bytes, 0)))}</div>
    <div class="toolbar"><input type="search" id="colQ" placeholder="Filter…">${canEditCollections() ? '<button class="primary" id="colNew">New collection</button>' : ''}<span class="muted tiny">Plex collections are read from Plex on each sync and never written back.</span></div>
    <div class="colgrid" id="colGrid"></div>
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
  const draw = () => {
    const q = $('#colQ').value.trim().toLowerCase();
    const list = cols.filter(c => !q || c.name.toLowerCase().includes(q));
    $('#colGrid').innerHTML = list.map(c => `<div class="card colcard ${c.cover ? 'with-cover' : ''}" data-id="${c.id}">${c.cover ? `<div class="cover">${posterTag(c.cover.library_type, c.cover.title_key, c.name, 'pcover')}</div>` : ''}<div class="colbody"><h3>${esc(c.name)} ${c.source === 'plex' ? '<span class="badge" title="mirrored from Plex">Plex</span>' : ''}<span class="right muted tiny">${c.types.map(t => COL_TYPE[t] || t).join(' · ')}</span></h3>
      <div class="strip">${c.preview.map(p => posterTag(p.library_type, p.title_key, p.title)).join('') || '<span class="muted tiny">nothing in the library yet</span>'}</div>
      <div class="muted tiny">${c.present} of ${c.items} title${c.items === 1 ? '' : 's'}${c.seconds ? ' · ' + fmtHours(c.seconds) : ''}${c.bytes ? ' · ' + fmtBytes(c.bytes) : ''}${c.missing ? ` · <span class="bad">${c.missing} missing</span>` : c.items ? ' · <span class="ok">complete</span>' : ''}${c.watched ? ` · ${c.watched} watched` : ''}</div>${c.note ? `<div class="muted tiny" style="margin-top:4px">${esc(c.note)}</div>` : ''}</div></div>`).join('') || '<div class="empty">No collections yet. Press New collection, or run a Plex sync to bring in the ones Plex has.</div>';
    $('#colGrid').querySelectorAll('.colcard').forEach(n => { n.onclick = () => { location.hash = '#collections/' + n.dataset.id; }; });
  };
  $('#colQ').oninput = draw; draw();
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
  if (!c) { view.innerHTML = '<h1>Collections</h1><div class="empty">No such collection. <a href="#collections">Back to the list</a>.</div>'; return; }
  const edit = canEditCollections();
  const present = c.items.filter(i => i.present), secs = present.reduce((a, i) => a + (i.seconds || 0), 0), bytes = present.reduce((a, i) => a + (i.bytes || 0), 0);
  const watched = present.filter(i => i.watched === 1 || (i.episodes && i.watched === i.episodes)).length;
  view.innerHTML = `<div class="detail-head"><span class="back" id="back">← Collections</span><h1>${esc(c.name)}</h1>${c.source === 'plex' ? '<span class="badge" title="Mirrored from Plex on each sync; titles you add stay">from Plex</span>' : ''}<span class="grow"></span><button class="small" id="cExport" title="Download the list as a CSV file">Export CSV</button>${edit ? `<button class="small" id="cRename">Rename / note</button><button class="small" id="cSort" title="Order by release date, then year">Order by release</button><button class="small danger" id="cDelete">Delete</button>` : ''}</div>
    ${c.note ? `<p class="muted">${esc(c.note)}</p>` : ''}
    <div class="tiles compact">${tile(c.items.length && present.length === c.items.length ? 'okt' : (c.items.length ? 'warnt' : ''), 'In the library', `${present.length} of ${c.items.length}`, c.items.length - present.length ? `${c.items.length - present.length} to find` : 'complete')}${tile('', 'Runtime', fmtHours(secs), fmtBytes(bytes))}${tile(present.length && watched === present.length ? 'okt' : '', 'Watched', present.length ? `${watched} of ${present.length}` : '—', 'from Plex play counts')}${tile('', 'Kinds', [...new Set(c.items.map(i => i.library_type))].map(t => COL_TYPE[t] || t).join(' · ') || '—')}</div>
    ${edit ? `<div class="card addbox" style="margin:12px 0"><div class="inline"><input type="search" id="cAdd" placeholder="Add a title: type part of its name…" style="flex:1" autocomplete="off"><button class="small" id="cPlace" title="A title you do not own yet, so the set shows the gap">Add a placeholder…</button></div><div class="hits" id="cHits" hidden></div></div>` : ''}
    <div class="table-wrap"><table class="colitems"><thead><tr><th>#</th><th></th><th>Title</th><th>Kind</th><th>Released</th><th>On hand</th><th>Watched</th><th>Note</th>${edit ? '<th></th>' : ''}</tr></thead><tbody id="cRows"></tbody></table></div>`;
  $('#back').onclick = () => { location.hash = '#collections'; };
  const draw = (col) => {
    $('#cRows').innerHTML = col.items.map((i, k) => `<tr class="${i.present ? 'clickable' : 'gone'}" data-item="${i.id}" data-k="${k}"><td class="pos">${i.position}</td><td>${i.present ? posterTag(i.library_type, i.title_key, i.title) : '<span class="pthumb none">–</span>'}</td><td class="wrap">${i.present ? `<a href="${colHref(i)}">${esc(i.title)}</a>` : `<b>${esc(i.title)}</b>`}${i.year ? ` <span class="muted">(${i.year})</span>` : ''}${i.from_plex ? ' <span class="muted tiny" title="from the Plex collection">Plex</span>' : ''}</td><td><span class="badge ${i.library_type}">${COL_TYPE[i.library_type] || i.library_type}</span></td><td class="nowrap muted">${i.released ? dayOf(i.released) : ''}</td><td class="nowrap">${i.present ? (i.episodes != null ? `${i.episodes} ep · ${i.seasons} season${i.seasons === 1 ? '' : 's'}` : `${fmtDur(i.seconds)}`) + (i.resolutions ? ` <span class="badge">${esc(String(i.resolutions).split(',').sort().pop())}</span>` : '') : '<span class="badge warn">not in the library</span>'}</td><td class="nowrap">${i.watched == null ? '<span class="muted">—</span>' : i.episodes != null ? `${pct(i.watched, i.episodes)}%` : (i.watched ? '<span class="ok">yes</span>' : 'no')}</td><td class="wrap muted tiny">${esc(i.note || '')}</td>${edit ? `<td class="rowacts"><span class="ord"><button class="small" data-act="up" title="Move up" ${k === 0 ? 'disabled' : ''}>▲</button><button class="small" data-act="down" title="Move down" ${k === col.items.length - 1 ? 'disabled' : ''}>▼</button></span> <button class="small" data-act="note" title="Note on this title">✎</button> ${i.present ? `<button class="small" data-act="cover" title="${col.cover_type === i.library_type && col.cover_key === i.title_key ? 'This poster is the cover' : 'Use this poster as the cover'}" ${col.cover_type === i.library_type && col.cover_key === i.title_key ? 'disabled' : ''}>★</button>` : ''} <button class="small" data-act="remove" title="Remove from the collection">✕</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="9" class="empty">Nothing in this collection yet.${edit ? ' Type a title above to add one.' : ''}</td></tr>`;
  };
  draw(c);
  const refresh = (col) => { draw(col); c.items = col.items; c.cover_type = col.cover_type; c.cover_key = col.cover_key; };
  $('#cExport').onclick = async () => { try { const r = await L.collections.exportCsv(c.id); downloadText(r.filename, r.csv, 'text/csv'); } catch (e) { toast(e.message, true); } };
  $('#cRows').onclick = async (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const tr = b.closest('tr'), itemId = Number(tr.dataset.item), k = Number(tr.dataset.k), act = b.dataset.act;
    try {
      if (act === 'remove') { if (!confirm('Remove this title from the collection? The files are not touched.')) return; refresh(await L.collections.removeItem(c.id, itemId)); }
      else if (act === 'cover') { const it = c.items.find(i => i.id === itemId); refresh(await L.collections.setCover(c.id, it.library_type, it.title_key)); toast('Cover set'); }
      else if (act === 'note') { const cur = c.items.find(i => i.id === itemId); const n = prompt('Note on this title (empty to clear):', cur.note || ''); if (n === null) return; refresh(await L.collections.setNote(c.id, itemId, n)); }
      else { const ids = c.items.map(i => i.id); const j = act === 'up' ? k - 1 : k + 1; if (j < 0 || j >= ids.length) return; [ids[k], ids[j]] = [ids[j], ids[k]]; refresh(await L.collections.reorder(c.id, ids)); }
    } catch (err) { toast(err.message, true); }
  };
  if (!edit) return;
  $('#cRename').onclick = () => editCollectionDialog(c, (col) => { c.name = col.name; c.note = col.note; route(); });
  $('#cSort').onclick = async () => { try { refresh(await L.collections.sortByRelease(c.id)); toast('Ordered by release date'); } catch (e) { toast(e.message, true); } };
  $('#cDelete').onclick = async () => { if (!confirm(`Delete the collection "${c.name}"? The titles stay in the library.${c.source === 'plex' ? ' The next Plex sync brings it back from Plex.' : ''}`)) return; await L.collections.remove(c.id); location.hash = '#collections'; };
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
