'use strict';
/* The pages that change things: Rename TV / anime, Movie names and CSV export.
   One of six plain scripts that make up the renderer; they share the page scope. See CLAUDE.md, "Renderer files". */

views.export = async () => {
  const [list, info, s, sets] = await Promise.all([L.exportList(), L.appInfo(), L.settings.get(), L.exportSets()]);
  const last = list[0];
  const chosen = new Set((s.export && s.export.sets) || sets.map(x => x.key));
  const dl = (rel) => L.isWeb ? `<a href="exports/${encodeURIComponent(rel).replace(/%2F/g, '/')}" download>${esc(rel.split(/[\\/]/).pop())}</a>` : esc(rel.split(/[\\/]/).pop());
  view.innerHTML = `<h1>CSV export</h1>
    <p class="lead">Pick which sets to write. Each export goes into a timestamped folder and refreshes the <span class="mono">latest\\</span> copy, so a spreadsheet can always point at the same file names. Tick <b>Zip</b> to also get a single archive${L.isWeb ? ' you can download here' : ''}.</p>
    <div class="card" style="margin-bottom:12px"><h3>What to export</h3>
      <div class="inline" style="gap:16px;flex-wrap:wrap">${sets.map(x => `<label class="inline"><input type="checkbox" class="expSet" value="${x.key}" ${chosen.has(x.key) ? 'checked' : ''}> ${esc(x.label)} <span class="muted tiny">${esc(x.files)}</span></label>`).join('')}</div>
      <div class="inline" style="margin-top:10px"><label class="inline"><input type="checkbox" id="expZip" ${s.export && s.export.zip ? 'checked' : ''}> Zip the files as well</label><label class="inline muted">when at least <input type="number" id="expZipMin" min="1" max="20" value="${(s.export && s.export.zipMin) || 1}" style="width:60px"> files</label><button class="small" id="expSave">Remember as default</button><span class="muted tiny">The default is also what an automatic export after a scan uses.</span></div>
    </div>
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
    { key: 'files', label: 'Files', cls: 'wrap', render: r => { const fl = JSON.parse(r.files || '[]'); const stamp = r.dir.split(/[\\/]/).pop(); const names = fl.filter(f => typeof f === 'string'); const zip = fl.find(f => f && f.zip); return `${names.length} CSV${zip ? ' · ' + (L.isWeb ? `<a href="exports/${encodeURIComponent(zip.zip.split(/[\\/]/).pop())}" download>zip</a>` : 'zip') : ''}${L.isWeb && names.length ? '<div class="tiny">' + names.map(n => dl(stamp + '/' + n)).join(' · ') + '</div>' : ''}`; } },
    { key: 'id', label: '', render: r => L.isWeb ? '' : `<button class="small openDir" data-dir="${esc(r.dir)}">Open</button>` },
  ], { short: true });
  $('#exportHist').append(t.node);
  t.node.addEventListener('click', e => { const b = e.target.closest('.openDir'); if (b) L.openPath(b.dataset.dir); });
  const expOpts = () => ({ sets: [...document.querySelectorAll('.expSet:checked')].map(c => c.value), zip: $('#expZip').checked, zipMin: Math.max(1, Number($('#expZipMin').value) || 1) });
  $('#expSave').onclick = async () => { await L.settings.set({ export: expOpts() }); toast('Export defaults saved'); };
  $('#runExport').onclick = async () => { const o = expOpts(); if (!o.sets.length) return toast('Pick at least one set', true); try { $('#exportMsg').textContent = 'Exporting…'; const r = await L.exportCsv(o); toast(`Export written: ${r.files.length} file(s)${r.zip ? ' + zip' : ''}`); views.export(); } catch (e) { $('#exportMsg').textContent = ''; toast(e.message, true); } };
  $('#openLatest').onclick = () => L.openPath((s.csvOutputDir || info.exportDir) + '\\latest');
  $('#openRoot').onclick = () => L.openPath(s.csvOutputDir || info.exportDir);
};


views.rename = async () => {
  const s = await L.settings.get();
  if (!s.renaming.enabled) {
    view.innerHTML = `<h1>Rename files</h1><div class="warnbox">Renaming is <b>off</b>. This is the only feature that writes to your share. Turn it on under <a href="#settings">Settings → Renaming</a> if you want MediaLedger to propose and apply Plex-standard file names.</div>
      <p class="lead">When enabled, this page lists every file whose name differs from the standard pattern (<span class="mono">Show - S01E02 - Title.ext</span>, <span class="mono">Title (Year) - Edition.ext</span>), built from the parsed details and your manual fixes. You tick the ones to rename; files are renamed in place, never moved, never overwritten, and every attempt is logged.</p>`;
    return;
  }
  const [{ list, parts: savedParts, lock }, hist, allBatches] = await Promise.all([L.rename.proposals({}), L.rename.history(), L.movie.batches()]);
  const batches = allBatches.filter(b => b.layout === 'episodes');
  const okHist = hist.filter(h => h.ok).length + batches.reduce((a, b) => a + (b.mode === 'live' ? (b.done || 0) - (b.undone || 0) : 0), 0);
  view.innerHTML = `<h1>Rename files</h1>
    <div class="warnbox">This page <b>renames files on your share</b>. Proposals come from the parsed details plus your manual fixes, so fix anything wrong under Issues first. Files are renamed in place (same folder), never overwritten. Every run is a batch: pre-flighted as a whole, each rename verified, journaled below, and undoable.</div>
    <div class="card" style="margin-bottom:12px"><div class="inline" style="align-items:center;flex-wrap:wrap"><span class="small">Name parts</span><span class="chip fixed" title="Always present: Plex matches on it">Show - S01E02</span><span id="rParts"></span><span class="muted tiny">Click a part to leave it out or put it back. Preview: <span class="mono" id="rPreview"></span></span></div></div>
    <div class="tiles compact">${tile(list.length ? 'warnt' : 'okt', 'Proposed renames', list.length)}${tile('', 'From manual fixes', list.filter(p => p.has_override).length)}${tile('', 'Renamed so far', okHist, `${hist.length - okHist} failed`)}</div>
    <div class="toolbar" style="margin-top:12px"><input type="search" id="rq" placeholder="Filter…"><select id="rtype"><option value="">all libraries</option><option value="tv">TV</option><option value="anime">Anime</option><option value="movie">Movies</option></select><label class="inline small"><input type="checkbox" id="rfixed"> Only files with manual fixes</label><span class="muted small" id="rcount"></span><span class="grow"></span><button class="small" id="selNext" title="Clear the selection and tick only the next few shown files">Select next</button><input type="number" id="selN" min="1" max="200" value="${Number(localStorage.getItem('medialedger.renameN')) || 10}" style="width:64px" title="How many to select at a time"><button class="small" id="selAll">Select shown</button><button class="small" id="selNone">Clear</button><button id="rDry" disabled>Dry run 0</button><button class="primary" id="apply" disabled>Rename 0 files</button><button id="stepApply" disabled title="Walk through the ticked files one by one, confirming each">One at a time</button></div>
    <div class="table-wrap" id="rtable"></div>
    <h2>Batches</h2><div id="rbatches"></div>
    <details style="margin-top:12px"><summary class="muted">Older history (before batches)</summary><div id="rhist"></div></details>`;
  // ---- name parts chips (same idea as the movie tab; 'title' on by default)
  const EP_LABEL = { title: 'Episode title', resolution: 'Resolution', codec: 'Codec', dubsub: 'Sub/Dub' }, EP_SAMPLE = { title: 'Pilot', resolution: '1080p', codec: 'H264', dubsub: 'Sub' }, EP_ALL = ['title', 'resolution', 'codec', 'dubsub'];
  let parts = Array.isArray(savedParts) ? savedParts.filter(p => EP_ALL.includes(p)) : ['title'];
  const renderParts = () => {
    $('#rParts').innerHTML = [...parts, ...EP_ALL.filter(p => !parts.includes(p))].map(p => `<span class="chip ${parts.includes(p) ? '' : 'off'}" data-part="${p}">${EP_LABEL[p]}</span>`).join('');
    const extra = parts.filter(p => p !== 'title').map(p => EP_SAMPLE[p]);
    $('#rPreview').textContent = `Show - S01E02${parts.includes('title') ? ' - Pilot' : ''}${extra.length ? ' [' + extra.join(' ') + ']' : ''}.mkv`;
  };
  renderParts();
  $('#rParts').addEventListener('click', async e => { const chip = e.target.closest('.chip'); if (!chip || !chip.dataset.part) return; const p = chip.dataset.part; parts = parts.includes(p) ? parts.filter(x => x !== p) : [...parts, p]; renderParts(); await L.settings.set({ renaming: { ...s.renaming, parts } }); toast('Name parts saved'); views.rename(); });
  const selected = new Set();
  let shown = [];
  const render = () => {
    const q = $('#rq').value.toLowerCase(), t = $('#rtype').value, fx = $('#rfixed').checked;
    shown = list.filter(p => (!t || p.library_type === t) && (!fx || p.has_override) && (!q || `${p.from} ${p.to} ${p.show_name || ''} ${p.movie_title || ''}`.toLowerCase().includes(q))).slice(0, 1000);
    $('#rcount').textContent = `${shown.length} of ${list.length}`;
    $('#rtable').innerHTML = `<table><thead><tr><th></th><th>Library</th><th>Folder</th><th>Current name</th><th></th><th>Proposed name</th><th></th></tr></thead><tbody>${shown.map(p => `<tr class="rename-row"><td><input type="checkbox" class="rsel" data-id="${p.id}" ${selected.has(p.id) ? 'checked' : ''}></td><td><span class="badge ${p.library_type}">${typeName(p.library_type)}</span></td><td class="muted tiny wrap">${esc(p.rel_path.includes('\\') ? p.rel_path.slice(0, p.rel_path.lastIndexOf('\\')) : '')}</td><td class="wrap">${esc(p.from)}${p.has_override ? ' <span class="badge ok">fixed</span>' : ''}</td><td class="arrow">→</td><td class="wrap"><b>${p.segments ? p.segments.map(x => `<span class="seg${['show', 'code', 'ext'].includes(x.part) ? '' : ' seg-part'}" data-part="${x.part}" title="${['show', 'code', 'ext'].includes(x.part) ? '' : 'Click to leave ' + x.part + ' out of every name'}">${esc(x.text)}</span>`).join('') : esc(p.to)}</b></td><td class="nowrap">${fixBtn(p)} <button class="small rOne" data-id="${p.id}" title="Rename just this file">Rename</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Every file already matches the standard pattern.</td></tr>'}</tbody></table>`;
    $('#apply').textContent = `Rename ${selected.size} file${selected.size === 1 ? '' : 's'}`; $('#apply').disabled = !selected.size || !!lock;
    $('#stepApply').disabled = !selected.size || !!lock; $('#rDry').textContent = `Dry run ${selected.size}`; $('#rDry').disabled = !selected.size;
  };
  render();
  $('#rtable').addEventListener('click', e => { const seg = e.target.closest('.seg-part'); if (!seg) return; const p = seg.dataset.part; if (!EP_ALL.includes(p)) return; $(`#rParts .chip[data-part="${p}"]`).click(); });
  $('#rDry').onclick = async () => { try { const r = await L.rename.dry([...selected]); const okN = r.results.filter(x => x.ok).length; openModal(`<h2>Dry run: ${okN} of ${r.results.length} would rename</h2><div class="preview" style="max-height:300px;overflow:auto">${r.results.map(x => `<div>${x.ok ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>'} ${esc(x.from)} <span class="arrow">→</span> <b>${esc(x.to)}</b>${x.error ? ` <span class="bad tiny">${esc(x.error)}</span>` : ''}</div>`).join('')}</div><p class="muted tiny">Nothing was renamed. Batch #${r.batchId} is recorded as a dry run.</p><div class="actions"><span class="grow"></span><button id="dC">Close</button></div>`); $('#dC').onclick = closeModal; } catch (e) { toast(e.message, true); } };
  const runOne = async (p) => { const res = await L.rename.apply([p.id]); const x = res[0]; if (!x || !x.ok) { if (x && x.error) toast(x.error, true); return false; } return true; };
  const stepFiles = async (items) => { const r = await stepThrough(items, { what: 'Rename episode file', run: runOne }); if (r.done || r.failed) { selected.clear(); toast(`${r.done} renamed${r.failed ? `, ${r.failed} failed` : ''}${r.stopped ? ' · stopped' : ''}`, !!r.failed); views.rename(); } };
  $('#stepApply').onclick = () => stepFiles(list.filter(p => selected.has(p.id)));
  $('#rtable').addEventListener('click', e => { const b = e.target.closest('.rOne'); if (b) { const p = list.find(x => x.id === Number(b.dataset.id)); if (p) stepFiles([p]); } });
  ['#rq', '#rtype', '#rfixed'].forEach(id => { $(id).oninput = render; $(id).onchange = render; });
  $('#rtable').addEventListener('change', e => { const c = e.target.closest('.rsel'); if (c) { c.checked ? selected.add(Number(c.dataset.id)) : selected.delete(Number(c.dataset.id)); $('#apply').textContent = `Rename ${selected.size} file${selected.size === 1 ? '' : 's'}`; $('#apply').disabled = !selected.size || !!lock; $('#stepApply').disabled = !selected.size || !!lock; $('#rDry').textContent = `Dry run ${selected.size}`; $('#rDry').disabled = !selected.size; } });
  $('#selNext').onclick = () => { const n = Math.max(1, Math.min(200, Number($('#selN').value) || 10)); try { localStorage.setItem('medialedger.renameN', String(n)); } catch { /* ignore */ } selected.clear(); shown.slice(0, n).forEach(p => selected.add(p.id)); render(); toast(`${selected.size} selected; the rest stay untouched`); };
  $('#selAll').onclick = () => { if (shown.length > 50 && !confirm(`Select all ${shown.length} shown files? "Select next" ticks a smaller group.`)) return; shown.forEach(p => selected.add(p.id)); render(); };
  $('#selNone').onclick = () => { selected.clear(); render(); };
  $('#apply').onclick = async () => {
    const ids = [...selected];
    const card = openModal(`<h2>Rename ${ids.length} file${ids.length === 1 ? '' : 's'} on the share?</h2><p class="muted">Each file is renamed in its current folder. Pre-flight checks every file first; if any check fails nothing is renamed. Each rename is verified, and the batch can be undone from the Batches table below.</p><div class="preview" style="max-height:240px;overflow:auto">${list.filter(p => selected.has(p.id)).slice(0, 50).map(p => `<div>${esc(p.from)} <span class="arrow">→</span> <b>${esc(p.to)}</b></div>`).join('')}${ids.length > 50 ? `<div class="muted">…and ${ids.length - 50} more</div>` : ''}</div><div class="actions"><span class="grow"></span><button id="rc">Cancel</button><button class="danger" id="rgo">Rename now</button></div>`);
    $('#rc', card).onclick = closeModal;
    $('#rgo', card).onclick = async () => {
      $('#rgo', card).disabled = true; $('#rgo', card).textContent = 'Renaming…';
      try { const res = await L.rename.apply(ids); const ok = res.filter(r => r.ok).length; closeModal(); toast(`${ok} renamed, ${res.length - ok} failed`, ok !== res.length); views.rename(); }
      catch (e) { closeModal(); toast(e.message, true); }
    };
  };
  const bt = makeTable(batches, [
    { key: 'id', label: '#', num: true }, { key: 'ts', label: 'When', render: r => fmtDate(r.ts) },
    { key: 'mode', label: 'Mode', render: r => r.mode === 'live' ? '<span class="badge bad">live</span>' : '<span class="badge">dry</span>' },
    { key: 'status', label: 'Status', render: r => `<span class="badge ${r.status === 'done' ? 'ok' : /abort|stopped/.test(r.status) ? 'bad' : ''}">${esc(r.status)}</span>` },
    { key: 'planned', label: 'Planned', num: true }, { key: 'done', label: 'Done', num: true }, { key: 'failed', label: 'Failed', num: true }, { key: 'undone', label: 'Undone', num: true },
    { key: 'note', label: '', render: r => `<button class="small rbItems" data-id="${r.id}">Items</button> ${r.mode === 'live' && r.done > (r.undone || 0) && !/undone$/.test(r.status) ? `<button class="small danger rbUndo" data-id="${r.id}">Undo</button>` : ''}` },
  ], { short: true });
  $('#rbatches').append(bt.node);
  bt.node.addEventListener('click', async e => {
    const u = e.target.closest('.rbUndo'); if (u) { if (!confirm(`Undo batch #${u.dataset.id}? Each renamed file is checked and renamed back.`)) return; try { const r = await L.movie.undo(Number(u.dataset.id)); toast(`Undo: ${r.undone} restored, ${r.failed} could not be restored`, r.failed > 0); views.rename(); } catch (err) { toast(err.message, true); } return; }
    const b = e.target.closest('.rbItems'); if (b) { const items = await L.movie.batchItems(Number(b.dataset.id)); const card = openModal(`<h2>Batch #${b.dataset.id} — ${items.length} item(s)</h2><div class="preview" style="max-height:60vh;overflow:auto">${items.map(i => `<div><span class="badge ${i.status === 'done' ? 'ok' : i.status === 'undone' ? '' : /fail|abor/.test(i.status) ? 'bad' : ''}">${esc(i.status)}</span> ${esc(i.from_rel)} <span class="arrow">→</span> ${esc(i.to_rel)}${i.error ? ` <span class="bad tiny">${esc(i.error)}</span>` : ''}</div>`).join('')}</div><div class="actions"><span class="grow"></span><button id="iC">Close</button></div>`); $('#iC', card).onclick = closeModal; }
  });
  const ht = makeTable(hist, [{ key: 'ts', label: 'When', render: r => fmtDate(r.ts) }, { key: 'from_rel', label: 'From', cls: 'pathcell' }, { key: 'to_rel', label: 'To', cls: 'pathcell' }, { key: 'ok', label: 'Result', render: r => r.ok ? '<span class="badge ok">renamed</span>' : `<span class="badge bad">failed</span> <span class="tiny">${esc(r.error || '')}</span>` }], { short: true });
  $('#rhist').append(ht.node);
};

views.movienames = async () => {
  const [{ plan, lock, settings: mr }, allBatches] = await Promise.all([L.movie.plan(), L.movie.batches()]);
  const batches = allBatches.filter(b => b.layout !== 'episodes');
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
      <div class="inline" style="margin-top:10px;align-items:center;flex-wrap:wrap">
        <span class="small">Name parts</span>
        <span class="chip fixed" title="Always present: Plex matches on it">Title (Year)</span><span class="muted">-</span>
        <span id="mrParts"></span>
        <span class="muted tiny">Click a part to leave it out or put it back; ◂ ▸ move it. The same works by clicking a word in any proposed name below. Preview: <span class="mono" id="mrPreview"></span></span>
      </div>
    </div>
    <div class="toolbar" style="margin-top:12px">
      <input type="search" id="mq" placeholder="Filter…">
      <select id="mstatus"><option value="ready">ready</option><option value="flagged">flagged only</option><option value="placeholders">placeholders only</option><option value="blocked">blocked</option><option value="unchanged">already correct</option><option value="all">all</option></select>
      <select id="mflag"><option value="">any flag</option>${Object.keys(flagCounts).map(k => `<option value="${k}">${k} (${flagCounts[k]})</option>`).join('')}</select>
      <span class="muted small" id="mcount"></span><span class="grow"></span>
      <button class="small" id="mSelNext" title="Clear the selection and tick only the next few shown titles">Select next</button><input type="number" id="mSelN" min="1" max="200" value="${Number(localStorage.getItem('medialedger.renameN')) || 10}" style="width:64px"><button class="small" id="mSelAll">Select shown</button><button class="small" id="mSelNone">Clear</button>
      <select id="mBulkSrc" title="Set the source for every selected file"><option value="">Set source for selected…</option><option value="web">Web (download)</option><option value="rip">Rip (disc)</option><option value="clear">clear manual source</option></select>
      <button id="mDry" disabled>Dry run 0</button>
      <button class="danger" id="mLive" disabled>Rename 0 live</button>
      <button class="danger" id="mStep" disabled title="Walk through the ticked files one by one, confirming each">One at a time</button>
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
    $('#mtable').innerHTML = `<table><thead><tr><th></th><th>Current name</th><th></th><th>Proposed name</th><th>Flags</th><th></th></tr></thead><tbody>${shown.map(p => `<tr class="rename-row ${p.ok ? '' : 'blockedrow'}"><td>${p.ok && !p.unchanged ? `<input type="checkbox" class="msel" data-id="${p.id}" ${selected.has(p.id) ? 'checked' : ''}>` : ''}</td><td class="wrap">${esc(p.from)}${p.dir ? `<span class="sub">${esc(p.dir)}</span>` : ''}</td><td class="arrow">→</td><td class="wrap">${p.ok ? (p.unchanged ? '<span class="muted">unchanged</span>' : `<b>${p.segments ? p.segments.map(x => `<span class="seg${['title', 'year', 'ext'].includes(x.part) ? '' : ' seg-part'}" data-part="${x.part}" title="${['title', 'year', 'ext'].includes(x.part) ? '' : 'Click to leave ' + x.part + ' out of every name'}">${esc(x.text)}</span>`).join('') : esc(p.name)}</b>`) : `<span class="bad">blocked: ${esc(p.blocked)}</span>`}</td><td class="wrap">${p.flags.map(f => `<span class="badge ${/^no_|mismatch|claimed/.test(f) ? 'warn' : ''}" title="${esc(FLAG_TEXT[f.split(':')[0]] || '')}">${esc(f)}</span>`).join('')}</td><td class="nowrap">${fixBtn(p)}${p.ok && !p.unchanged && mr.enabled && !lock ? ` <button class="small danger mOne" data-id="${p.id}" title="Rename just this file, live">Rename</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nothing matches.</td></tr>'}</tbody></table>`;
    syncButtons();
  };
  const syncButtons = () => {
    $('#mDry').textContent = `Dry run ${selected.size}`; $('#mDry').disabled = !selected.size;
    $('#mLive').textContent = `Rename ${selected.size} live`; $('#mLive').disabled = !selected.size || !mr.enabled || !!lock;
    $('#mStep').textContent = selected.size ? `One at a time (${selected.size})` : 'One at a time'; $('#mStep').disabled = !selected.size || !mr.enabled || !!lock;
  };
  // One file per batch: the same pre-flight, verification and journal as a big batch, so every step can be undone from the Batches table.
  const runOne = async (p) => { const r = await L.movie.run([p.id], { live: true, layout: $('#mrLayout').value }); const x = r.results && r.results[0]; if (!x || !x.ok) { if (x && x.error) toast(x.error, true); return false; } return true; };
  const stepMovies = async (items) => { const r = await stepThrough(items, { what: 'Rename movie file', run: runOne }); if (r.done || r.failed) { selected.clear(); toast(`${r.done} renamed${r.failed ? `, ${r.failed} failed` : ''}${r.stopped ? ' · stopped' : ''}`, !!r.failed); views.movienames(); } };
  $('#mStep').onclick = () => stepMovies(plan.filter(p => selected.has(p.id)));
  $('#mtable').addEventListener('click', e => { const b = e.target.closest('.mOne'); if (b) { const p = plan.find(x => x.id === Number(b.dataset.id)); if (p) stepMovies([p]); } });
  render();
  ['#mq', '#mstatus', '#mflag'].forEach(id => { $(id).oninput = render; $(id).onchange = render; });
  $('#mtable').addEventListener('change', e => { const c = e.target.closest('.msel'); if (c) { c.checked ? selected.add(Number(c.dataset.id)) : selected.delete(Number(c.dataset.id)); syncButtons(); } });
  $('#mSelNext').onclick = () => { const n = Math.max(1, Math.min(200, Number($('#mSelN').value) || 10)); try { localStorage.setItem('medialedger.renameN', String(n)); } catch { /* ignore */ } selected.clear(); shown.filter(p => p.ok && !p.unchanged).slice(0, n).forEach(p => selected.add(p.id)); render(); toast(`${selected.size} selected; the rest stay untouched`); };
  $('#mSelAll').onclick = () => { const c = shown.filter(p => p.ok && !p.unchanged); if (c.length > 50 && !confirm(`Select all ${c.length} shown titles? "Select next" ticks a smaller group.`)) return; c.forEach(p => selected.add(p.id)); render(); };
  $('#mBulkSrc').onchange = async e => {
    const v = e.target.value; e.target.value = ''; if (!v) return;
    const ids = selected.size ? [...selected] : shown.filter(p => p.ok && !p.unchanged).map(p => p.id);
    if (!ids.length) return toast('Select files first (or filter to the ones you mean)', true);
    const card = openModal(`<h2>Set source to <b>${v === 'clear' ? 'auto-detect' : v === 'web' ? 'Web' : 'Rip'}</b> for ${ids.length} file${ids.length === 1 ? '' : 's'}?</h2><p class="muted">This only records a manual fix in MediaLedger's database. Nothing on the share changes until you run a live rename.</p><div class="actions"><span class="grow"></span><button id="bsC">Cancel</button><button class="primary" id="bsGo">Apply</button></div>`);
    $('#bsC', card).onclick = closeModal;
    $('#bsGo', card).onclick = async () => { const n = await L.override.bulkSource(ids, v === 'clear' ? '' : v); closeModal(); toast(`Source set on ${n} file(s)`); views.movienames(); };
  };
  $('#mSelNone').onclick = () => { selected.clear(); render(); };
  // ---- name parts: ordered chips, off = left out of every name. Saved with the batch settings; the plan is rebuilt by the core.
  const PART_LABEL = { source: 'Source', resolution: 'Resolution', hdr: 'HDR/SDR', codec: 'Codec', audio: '[Audio]', edition: '{edition}', dubsub: 'Sub/Dub' };
  const PART_SAMPLE = { source: 'Web', resolution: '1080p', hdr: 'SDR', codec: 'H264', audio: '[eng]', edition: '{edition-Extended}', dubsub: 'Sub' };
  const ALL_PARTS = ['source', 'resolution', 'hdr', 'codec', 'audio', 'edition', 'dubsub']; // dubsub is off unless you switch it on
  let parts = Array.isArray(mr.parts) ? mr.parts.filter(p => ALL_PARTS.includes(p)) : ALL_PARTS.slice();
  const partsOrder = () => [...parts, ...ALL_PARTS.filter(p => !parts.includes(p))];
  const renderParts = () => {
    $('#mrParts').innerHTML = partsOrder().map((p, i, arr) => { const on = parts.includes(p); return `<span class="chip ${on ? '' : 'off'}" data-part="${p}" title="${on ? 'Click to leave out' : 'Click to include'}">${on && i > 0 && parts.includes(arr[i - 1]) ? `<i class="mv" data-dir="-1" title="Move left">◂</i>` : ''}${PART_LABEL[p]}${on && i < parts.length - 1 ? `<i class="mv" data-dir="1" title="Move right">▸</i>` : ''}</span>`; }).join('');
    const tail = parts.map(p => PART_SAMPLE[p]).join(' ');
    $('#mrPreview').textContent = `Movie (2019)${tail ? ' - ' + tail : ''}.mkv`;
  };
  renderParts();
  const savePartsAndRebuild = async () => { await L.settings.set({ movieRename: { ...mr, parts } }); toast(parts.length === ALL_PARTS.length ? 'All name parts on' : `Names now: Title (Year)${parts.length ? ' - ' + parts.map(p => PART_LABEL[p]).join(' ') : ''}`); views.movienames(); };
  const togglePart = (p) => { if (parts.includes(p)) parts = parts.filter(x => x !== p); else parts.push(p); renderParts(); savePartsAndRebuild(); };
  $('#mrParts').addEventListener('click', e => {
    const mv = e.target.closest('.mv'); const chip = e.target.closest('.chip');
    if (!chip || !chip.dataset.part) return;
    if (mv) { const p = chip.dataset.part, i = parts.indexOf(p), j = i + Number(mv.dataset.dir); if (i < 0 || j < 0 || j >= parts.length) return; [parts[i], parts[j]] = [parts[j], parts[i]]; renderParts(); savePartsAndRebuild(); return; }
    togglePart(chip.dataset.part);
  });
  $('#mtable').addEventListener('click', e => { const seg = e.target.closest('.seg[data-part]'); if (seg && ALL_PARTS.includes(seg.dataset.part)) togglePart(seg.dataset.part); });
  $('#mrSave').onclick = async () => { await L.settings.set({ movieRename: { layout: $('#mrLayout').value, batchLimit: Number($('#mrLimit').value) || 200, enabled: $('#mrEnabled').checked, truth: $('#mrTruth').value, parts } }); toast('Batch settings saved'); views.movienames(); };

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
