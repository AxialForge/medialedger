'use strict';
/* The review pages: Missing, Issues (problems and duplicates), Quality, Upgrades, Reclaim space, Watched, Change log and Requests.
   One of six plain scripts that make up the renderer; they share the page scope. See CLAUDE.md, "Renderer files". */

// ---- Upgrades: titles worth replacing with a better copy, ranked by upgrades.js ----
views.upgrades = async () => {
  const all = await L.upgrades();
  const cands = all.filter(r => r.score > 0), rest = all.filter(r => r.score <= 0);
  view.innerHTML = `<h1>Upgrade candidates</h1>
    <p class="lead">Which titles deserve a better copy, and which are not worth the disk. The score weighs how low the current copy is (resolution, bitrate) against how much it matters (Plex plays, your stars, the online rating). Ranking lives in <span class="mono">src/main/upgrades.js</span>.</p>
    <div class="tiles compact">${tile(cands.length ? 'warnt' : 'okt', 'Worth upgrading', cands.length)}${tile('', 'Not worth it', rest.filter(r => !r.plays && !r.my_rating && (r.best === '720p' || r.best === '480p' || r.best === 'SD' || r.best === '576p')).length, 'low copy, never played, unrated')}${tile('', 'Already 4K or HDR', all.filter(r => r.best === '4K' || r.hdr).length)}${tile('', 'Titles scored', all.length)}</div>
    <div id="uTable"></div>`;
  const cols = [
    { key: 'title', label: 'Title', cls: 'wrap ptitle', render: r => `${posterTag(r.type, r.key, r.title)}<span class="badge ${r.type}">${r.kind === 'movie' ? 'Movie' : typeName(r.type)}</span> ${esc(r.title)}${r.year ? ` <span class="muted">(${r.year})</span>` : ''}` },
    { key: 'score', label: 'Score', num: true, render: r => r.score > 0 ? `<b>${Number(r.score).toFixed(1)}</b>` : '<span class="muted">0</span>' },
    { key: 'reasons', label: 'Why', cls: 'wrap', render: r => r.reasons.map(x => `<span class="badge ${/low|never/.test(x) ? 'warn' : ''}">${esc(x)}</span>`).join(' ') },
    { key: 'best', label: 'Best copy', render: r => r.best ? `<span class="badge">${esc(r.best)}</span>${r.hdr ? ' <span class="badge ok">HDR</span>' : ''}` : '' },
    { key: 'plays', label: 'Plays', num: true }, { key: 'my_rating', label: 'Mine', sortVal: r => r.my_rating || 0, render: r => starsHtml(r.my_rating, r.type, r.key, r.title) },
    { key: 'online_rating', label: 'Rating', num: true, render: r => r.online_rating != null ? Number(r.online_rating).toFixed(1) : '<span class="muted">—</span>' },
    { key: 'gb', label: 'Size', num: true, render: r => fmtBytes(r.gb * 1e9) },
  ];
  const t = makeTable(all, cols, { search: r => `${r.title} ${r.reasons.join(' ')}`, defaultSort: { key: 'score', asc: false }, onRow: r => { location.hash = r.kind === 'movie' ? '#movies/' + encodeURIComponent(r.key) : `#${r.type}/${encodeURIComponent(r.key)}`; } });
  $('#uTable').append(searchToolbar(t, all.length), t.node);
};

// ---- Reclaim space: large titles nobody has played in a long time. A list to think about; nothing is deleted here. ----
views.reclaim = async () => {
  const pref = (() => { try { return JSON.parse(localStorage.getItem('medialedger.reclaim') || '{}'); } catch { return {}; } })();
  let months = pref.months || 12, minGb = pref.minGb != null ? pref.minGb : 2;
  const load = async () => {
    const [r, st] = await Promise.all([L.reclaim({ months, minGb }), L.storage().catch(() => null)]);
    try { localStorage.setItem('medialedger.reclaim', JSON.stringify({ months, minGb })); } catch { /* ignore */ }
    view.innerHTML = `<h1>Reclaim space</h1>
      <p class="lead">The mirror image of Upgrades: large titles that <b>nobody</b> on the Plex server has played for a long time, or ever. It is a list to think about. MediaLedger never deletes media, and titles you rated 4★ or higher are left out.</p>
      <div class="toolbar"><label class="inline small">not played for <select id="rcMonths" class="small">${[6, 12, 24, 36].map(m => `<option value="${m}" ${m === months ? 'selected' : ''}>${m} months</option>`).join('')}</select></label><label class="inline small">at least <input type="number" id="rcGb" min="0" step="1" value="${minGb}" style="width:70px"> GB</label></div>
      <div class="tiles compact">${tile(r.candidates.length ? 'warnt' : 'okt', 'Candidates', r.candidates.length.toLocaleString(), `added over ${months} months ago`)}${tile('', 'Could free', fmtBytes(r.totalBytes), 'if all of them went')}${tile('', 'Never played', r.neverPlayed.toLocaleString(), 'by anyone')}${st && st.free != null ? tile('', 'Free now', fmtBytes(st.free), st.months_left != null ? `about ${st.months_left} months at this rate` : '') : ''}</div>
      ${r.candidates.length && r.candidates.every(c => !c.in_plex) ? '<div class="warnbox" style="margin-top:12px">None of these titles is linked to Plex on this machine, so there is no play data behind the list. Sync Plex here (Settings → Plex), or open this page on the server that does.</div>' : ''}
      <div id="rcTable" style="margin-top:12px"></div>`;
    const cols = [
      { key: 'title', label: 'Title', cls: 'wrap', render: x => `<span class="badge ${x.library_type}">${typeName(x.library_type)}</span> ${esc(x.title || x.key)}${x.year ? ` <span class="muted">(${x.year})</span>` : ''}` },
      { key: 'bytes', label: 'Size', num: true, render: x => fmtBytes(x.bytes) },
      { key: 'files', label: 'Files', num: true },
      { key: 'last_played', label: 'Last played', sortVal: x => x.last_played || '', render: x => x.last_played ? fmtAgo(x.last_played) : (x.in_plex ? '<span class="badge warn">never</span>' : '<span class="muted">not in Plex</span>') },
      { key: 'plays', label: 'Plays', num: true },
      { key: 'added', label: 'Added', render: x => fmtAgo(x.added) },
      { key: 'my_rating', label: 'Mine', sortVal: x => x.my_rating || 0, render: x => x.my_rating ? '★'.repeat(x.my_rating) : '' },
    ];
    const t = makeTable(r.candidates, cols, { search: x => x.title || x.key, defaultSort: { key: 'bytes', asc: false }, onRow: x => { location.hash = x.library_type === 'movie' ? '#movies/' + encodeURIComponent(x.key) : `#${x.library_type}/${encodeURIComponent(x.key)}`; } });
    $('#rcTable').append(t.node);
    $('#rcMonths').onchange = () => { months = Number($('#rcMonths').value); load(); };
    $('#rcGb').onchange = () => { minGb = Math.max(0, Number($('#rcGb').value) || 0); load(); };
  };
  await load();
};

// ---- Watched: who watched what, from Plex play history (every account on the server) ----
views.watched = async () => {
  const pref = (() => { try { return JSON.parse(localStorage.getItem('medialedger.watched') || '{}'); } catch { return {}; } })();
  let days = pref.days != null ? pref.days : 30, account = pref.account || '';
  const titleOf = r => r.show_title ? `${esc(r.show_title)} <span class="muted">${r.season != null ? `S${String(r.season).padStart(2, '0')}` : ''}${r.episode != null ? `E${String(r.episode).padStart(2, '0')}` : ''}</span> <span class="muted tiny">${esc(r.title || '')}</span>` : esc(r.title || '?');
  const linkOf = r => r.library_type === 'movie' && r.group_key ? '#movies/' + encodeURIComponent(r.group_key) : (r.library_type === 'tv' || r.library_type === 'anime') && r.show_name ? `#${r.library_type}/${encodeURIComponent(r.show_name)}` : null;
  const whenFull = iso => iso ? new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const load = async () => {
    const w = await L.watched({ days: days || 'all', account: account || null });
    const nu = await L.nextUp({ days: 60, account: account || null }).catch(() => []);
    try { localStorage.setItem('medialedger.watched', JSON.stringify({ days, account })); } catch { /* ignore */ }
    const t = w.totals, hours = t.seconds / 3600;
    const periodLabel = days ? `last ${days} days` : 'all time';
    view.innerHTML = `<h1>Watched</h1>
      <p class="lead">Every play Plex has recorded, for every account on the server: who watched what, when, and on which device. Refreshed by each Plex sync; scrobble webhooks fill in between.</p>
      <div class="toolbar">
        <select id="wDays" class="small">${[[7, 'last 7 days'], [30, 'last 30 days'], [90, 'last 90 days'], [365, 'last year'], [0, 'all time']].map(([v, l]) => `<option value="${v}" ${v === days ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select id="wWho" class="small"><option value="">everyone</option>${w.accounts.map(a => `<option value="${a.id}" ${String(a.id) === String(account) ? 'selected' : ''}>${esc(a.name)} (${a.plays.toLocaleString()})</option>`).join('')}</select>
        <span class="muted tiny">${t.last ? `latest play ${fmtAgo(t.last)}` : 'no plays recorded yet'}</span>
      </div>
      ${!t.plays ? `<div class="card"><h3>Nothing here yet</h3><p class="muted">Run a Plex sync (Settings → Plex) and the play history for every account comes across. Plex keeps history for as long as its own settings allow, so older plays may be gone already. For plays between syncs, point the Plex webhook at MediaLedger.</p></div>` : `
      <div class="tiles compact">
        ${tile('', 'Plays', t.plays.toLocaleString(), periodLabel)}
        ${tile('', 'Hours', hours >= 100 ? Math.round(hours).toLocaleString() : hours.toFixed(1), 'from file lengths')}
        ${tile('', 'Titles', t.titles.toLocaleString(), 'distinct shows and movies')}
        ${tile('', 'People', t.people.toLocaleString(), 'Plex accounts that played')}
        ${tile('', 'Per day', (t.plays / Math.max(1, days || Math.ceil((Date.now() - new Date(t.first)) / 86400000))).toFixed(1), 'average plays')}
      </div>
      <div class="grid2" style="margin-top:12px">
        ${bars(w.byPerson, 'By person', { max: 12, drill: false })}
        ${bars(w.byLibrary, 'By library', { keyLabel: typeName, drill: false })}
        ${bars(w.byWeekday, 'By weekday', { order: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], scale: 'linear', drill: false })}
        ${bars(w.byHour, 'By hour of day', { order: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00'), max: 24, scale: 'linear', legend: false, drill: false })}
        ${bars(w.byDevice, 'By device', { max: 8, drill: false })}
        ${window.Cards.trend(w.perDay.map(d => ({ x: d.day, y: d.plays })), 'Plays per day', { note: 'Appears once there are plays on two different days.' })}
      </div>
      <div class="grid2" style="margin-top:12px">
        <div class="card"><h3>Most watched series</h3>${w.top.series.length ? `<table>${w.top.series.slice(0, 15).map(s => `<tr><td class="wrap"><span class="badge ${s.library_type}">${typeName(s.library_type)}</span> ${esc(s.title)}<span class="sub">${esc(s.who || '')}</span></td><td class="num"><b>${s.plays}</b><span class="sub">${fmtDur(s.seconds)}</span></td><td class="muted tiny nowrap">${fmtAgo(s.last)}</td></tr>`).join('')}</table>` : '<p class="muted">No episodes played.</p>'}</div>
        <div class="card"><h3>Most watched movies</h3>${w.top.movies.length ? `<table>${w.top.movies.slice(0, 15).map(s => `<tr><td class="wrap">${esc(s.title)}<span class="sub">${esc(s.who || '')}</span></td><td class="num"><b>${s.plays}</b><span class="sub">${s.people > 1 ? s.people + ' people' : ''}</span></td><td class="muted tiny nowrap">${fmtAgo(s.last)}</td></tr>`).join('')}</table>` : '<p class="muted">No movies played.</p>'}</div>
      </div>
      ${nu.length ? `<div class="card" style="margin-top:12px"><h3>Next up <span class="muted tiny">the episode after the furthest one each person watched in the last 60 days</span></h3><table>${nu.slice(0, 20).map(n => `<tr><td class="nowrap"><b>${esc(n.who)}</b></td><td class="wrap"><a href="#${n.library_type}/${encodeURIComponent(n.show)}">${esc(n.show)}</a><span class="sub">watched S${String(n.last.season).padStart(2, '0')}E${String(n.last.episode).padStart(2, '0')} ${fmtAgo(n.last.at)}</span></td><td class="wrap">${n.next ? `S${String(n.next.season).padStart(2, '0')}E${String(n.next.episode).padStart(2, '0')}${n.next.title ? ' · ' + esc(n.next.title) : ''}${n.next.gap ? ' <span class="badge warn" title="The episode right after the last one watched is not on disk">gap before it</span>' : ''}` : '<span class="badge ok">caught up</span>'}</td><td class="num nowrap">${n.left ? n.left + ' left' : ''}</td></tr>`).join('')}</table></div>` : ''}
      ${w.binge.length ? `<div class="card" style="margin-top:12px"><h3>Binges <span class="muted tiny">three or more episodes of one show in a sitting</span></h3><table>${w.binge.map(b => `<tr><td class="wrap"><b>${esc(b.who)}</b> · ${esc(b.show)}</td><td class="num">${b.episodes} episodes</td><td class="muted tiny nowrap">${whenFull(b.start)} → ${new Date(b.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td></tr>`).join('')}</table></div>` : ''}
      <h2 style="margin-top:16px">Recent plays <span class="muted tiny">newest ${w.recent.length.toLocaleString()}</span></h2><div id="wTable"></div>`}`;
    if (t.plays) {
      const cols = [
        { key: 'viewed_at', label: 'When', render: r => `<span title="${esc(whenFull(r.viewed_at))}">${fmtAgo(r.viewed_at)}</span>` },
        { key: 'who', label: 'Who', render: r => `<b>${esc(r.who)}</b>` },
        { key: 'title', label: 'Title', cls: 'wrap', render: r => `<span class="badge ${r.library_type}">${typeName(r.library_type)}</span> ${titleOf(r)}` },
        { key: 'device', label: 'Device', render: r => esc(r.device || '') },
        { key: 'duration_s', label: 'Length', num: true, render: r => fmtDur(r.duration_s) },
      ];
      const tb = makeTable(w.recent, cols, { search: r => `${r.who} ${r.show_title || ''} ${r.title || ''} ${r.device || ''}`, defaultSort: { key: 'viewed_at', asc: false }, onRow: r => { const h = linkOf(r); if (h) location.hash = h; } });
      $('#wTable').append(tb.node);
    }
    $('#wDays').onchange = () => { days = Number($('#wDays').value); load(); };
    $('#wWho').onchange = () => { account = $('#wWho').value; load(); };
  };
  await load();
};



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
      ${tile(p.duplicates ? 'warnt' : '', 'Duplicate episodes', p.duplicates, 'see the Duplicates button')}
      ${tile((p.misfiled || []).length ? 'warnt' : '', 'Episodes under Movies', (p.misfiled || []).length, 'episode-style names in a movie folder')}
      ${tile('okt', 'Fixes saved', p.overrides.length, `${p.ignored.length} ignored files`)}
    </div>`;
  const sec = (title, rows, cols, extra = '', search = r => r.rel_path) => { const t = makeTable(rows, cols, { search, short: true }); const box = el(`<div><div class="section-head"><h2>${title} <span class="muted">(${rows.length})</span></h2>${extra}</div></div>`); box.append(t.node); return box; };
  const lib = { key: 'library_type', label: 'Library', render: r => `<span class="badge ${r.library_type}">${typeName(r.library_type)}</span>` };
  view.append(
    sec('Unparsed file names', p.unparsed, [lib, { key: 'rel_path', label: 'Path', cls: 'pathcell' }, { key: 'parse_note', label: 'Why' }, { key: 'show_name', label: 'Guess', render: r => esc(r.library_type === 'movie' ? `${r.movie_title || ''} ${r.movie_year || ''}` : `${r.show_name || ''} ${r.season != null ? 'S' + r.season : ''} ${r.episode != null ? 'E' + r.episode : ''}`) }, { key: 'id', label: '', render: r => fixBtn(r) }]),
    sec('Episodes filed under Movies', p.misfiled || [], [lib, { key: 'rel_path', label: 'Path', cls: 'pathcell' }, { key: 'movie_title', label: 'Read as', render: r => esc(`${r.movie_title || ''}${r.movie_year ? ' (' + r.movie_year + ')' : ''}`) }, { key: 'id', label: '', render: r => fixBtn(r) }], '<span class="muted tiny">The name carries a season or episode marker. Move the file to a TV or anime folder, or use Fix to ignore it if it really is a film.</span>'),
    sec('ffprobe errors', p.probeErrors, [lib, { key: 'rel_path', label: 'Path', cls: 'pathcell' }, { key: 'probe_error', label: 'Error', cls: 'wrap' }, { key: 'id', label: '', render: r => fixBtn(r) }]),
    sec('Missing files', p.missing, [lib, { key: 'rel_path', label: 'Path', cls: 'pathcell' }, { key: 'last_seen', label: 'Last seen', render: r => fmtDate(r.last_seen) }], '<button class="small" id="purge">Forget missing files</button>'),
    sec('Manual fixes', p.overrides, [{ key: 'library_type', label: 'Library', render: r => `<span class="badge ${r.library_type}">${typeName(r.library_type)}</span>` }, { key: 'rel_path', label: 'Path', cls: 'pathcell' }, { key: 'show_name', label: 'Fix', cls: 'wrap', render: r => r.ignore ? '<span class="badge">ignored</span>' : esc(r.library_type === 'movie' ? `${r.movie_title || ''} ${r.movie_year ? '(' + r.movie_year + ')' : ''} ${r.edition_tag || ''}` : `${r.show_name || ''} ${r.season != null ? 'S' + r.season : ''}${r.episode != null ? 'E' + r.episode : ''} ${r.episode_title || ''}`) }, { key: 'note', label: 'Note' }, { key: 'updated', label: 'Updated', render: r => fmtDate(r.updated) }, { key: 'id', label: '', render: r => r.file_id ? fixBtn(r) : '<span class="muted tiny">file gone</span>' }]),
  );
  $('#purge').onclick = async () => { const n = await L.data.purgeMissing(); toast(`Removed ${n} missing file record(s)`); views.problems(); refreshBadges(); };
};


views.missing = async () => {
  const [all, s] = await Promise.all([L.data.missing(), L.settings.get()]);
  // Work on one library at a time: the choice narrows the tiles, the two airing cards and the table, and is remembered.
  const types = [...new Set(all.map(r => r.library_type))];
  const stored = (k) => { try { return localStorage.getItem('medialedger.missing.' + k) || ''; } catch { return ''; } };
  const pickType = types.includes(stored('type')) ? stored('type') : '', onlyGaps = stored('gaps') === '1';
  const inType = (r) => !pickType || r.library_type === pickType;
  const rows = all.filter(inType);
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
    { key: 'missing_count', label: 'Missing', num: true, render: r => (r.expected ? (r.missing_count ? `<span class="bad">${r.missing_count}</span>` : '<span class="ok">0</span>') : (r.source === 'none' ? '<span class="muted">no match</span>' : '')) + (r.policy === 'mute' ? ` <span class="badge" title="Muted: ${r.raw_missing_count} missing episodes are not counted">muted</span>` : r.policy === 'from' ? ` <span class="badge" title="Counting from S${r.collect.from_season != null ? r.collect.from_season : 1}E${r.collect.from_episode || 1}; ${r.raw_missing_count} missing in total">from S${r.collect.from_season != null ? r.collect.from_season : 1}E${r.collect.from_episode || 1}</span>` : '') },
    { key: 'missing', label: 'Which', cls: 'wrap', render: r => esc(missingText(r.missing)) + (r.absolute ? ' <span class="badge warn" title="episode numbers on disk exceed the season length; that season was skipped">absolute numbering</span>' : '') },
    { key: 'id', label: '', cls: 'rowacts', render: r => matchBtn(r.library_type, r.show_name) + ` <button class="small collectbtn" data-type="${esc(r.library_type)}" data-show="${esc(r.show_name)}" data-raw="${r.raw_missing_count || 0}">Collect…</button>` },
  ];
  const listed = onlyGaps ? rows.filter(r => r.expected > 0 && r.missing_count > 0) : rows;
  const t = makeTable(listed, cols, { search: r => `${r.show_name} ${r.matched_title || ''} ${r.source || ''}`, defaultSort: { key: 'missing_count', asc: false } });
  L.airing().then(a => {
    const day = (d) => { const diff = Math.round((Date.parse(d) - Date.parse(a.today)) / 86400000); return diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : diff < 7 ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' }) : d; };
    const up = a.upcoming.filter(inType), fin = a.finished.filter(inType);
    const box = el(`<div class="grid2" style="margin:12px 0"><div class="card"><h3>Airing next</h3><p class="muted tiny" style="margin:-6px 0 8px">From TVmaze / AniList. The "missing" count leaves out episodes that have not aired.</p>${up.length ? `<table>${up.slice(0, 25).map(u => `<tr class="${u.this_week ? '' : 'muted'}"><td class="nowrap"><b>${day(u.next_airing)}</b><span class="sub">${esc(u.next_airing)}</span></td><td class="wrap"><a href="#${u.library_type}/${encodeURIComponent(u.show_name)}">${esc(u.show_name)}</a> <span class="muted tiny">${esc(u.next_episode || '')}</span></td><td class="num">${u.missing_count ? `<span class="badge bad">${u.missing_count} missing</span>` : '<span class="badge ok">up to date</span>'}</td></tr>`).join('')}</table>${up.length > 25 ? `<p class="muted tiny">…and ${up.length - 25} more</p>` : ''}` : '<p class="muted">Nothing scheduled. Series show up here once their match reports a next episode.</p>'}</div>
      <div class="card"><h3>Finished airing, still incomplete</h3>${fin.length ? `<table>${fin.slice(0, 25).map(f => `<tr><td class="wrap"><a href="#${f.library_type}/${encodeURIComponent(f.show_name)}">${esc(f.show_name)}</a> <span class="muted tiny">${esc(f.status || '')}</span></td><td class="num"><span class="badge bad">${f.missing_count} of ${f.expected}</span></td></tr>`).join('')}</table>` : '<p class="muted">Every ended series you have is complete.</p>'}</div></div>`);
    view.insertBefore(box, view.querySelector('.toolbar'));
  }).catch(() => {});
  const tb = searchToolbar(t, listed.length, `<label class="inline small"><input type="checkbox" id="mGaps" ${onlyGaps ? 'checked' : ''}> Only series with gaps</label>`);
  const seg = el(`<div class="pickseg" id="mType" title="Show one library at a time">${[['', 'All libraries'], ...types.map(x => [x, typeName(x)])].map(([v, l]) => `<button data-t="${esc(v)}" class="${v === pickType ? 'on' : ''}">${esc(l)} <span class="muted tiny">${(v ? all.filter(r => r.library_type === v) : all).filter(r => r.expected > 0 && r.missing_count > 0).length}</span></button>`).join('')}</div>`);
  seg.style.marginBottom = '12px'; view.querySelector('.tiles').before(seg); // at the top: it changes everything below it
  const remember = (k, v) => { try { localStorage.setItem('medialedger.missing.' + k, v); } catch { /* private mode */ } route(); };
  seg.onclick = (e) => { const b = e.target.closest('button'); if (b) remember('type', b.dataset.t); };
  $('#mGaps', tb).onchange = (e) => remember('gaps', e.target.checked ? '1' : '0');
  view.append(tb, t.node);
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


// ---- Issues: problems and duplicates on one page ------------------------------------
views.issues = async (which = 'problems') => {
  if (which === 'duplicates') await views.duplicates(); else await views.problems();
  const bar = el(`<div class="toolbar" style="margin:-6px 0 12px"><button class="${which === 'problems' ? 'primary' : ''}" id="issTabP">Problems</button><button class="${which === 'duplicates' ? 'primary' : ''}" id="issTabD">Duplicates</button><span class="muted tiny">Problems: names, probe errors, missing files, fixes. Duplicates: episodes that exist as several files.</span></div>`);
  const h1 = view.querySelector('h1'); h1.textContent = 'Issues'; h1.after(bar);
  $('#issTabP').onclick = () => { location.hash = '#issues/problems'; };
  $('#issTabD').onclick = () => { location.hash = '#issues/duplicates'; };
  document.querySelectorAll('.sidebar a').forEach(a => a.classList.toggle('active', a.dataset.view === 'issues'));
};

// ---- Requests: ask for media to be added ---------------------------------------------
views.requests = async () => {
  const list = await L.requests.list();
  const isAdmin = me.role === 'admin';
  const KIND = { movie: 'Movie', tv: 'TV show', anime: 'Anime', other: 'Other' };
  const STATUS = { pending: ['warn', 'Pending'], approved: ['', 'Approved'], added: ['ok', 'Added'], rejected: ['bad', 'Declined'] };
  const pending = list.filter(r => r.status === 'pending').length;
  view.innerHTML = `<h1>Media requests</h1>
    <p class="lead">Ask for a movie or show to be added to the library. ${isAdmin ? 'You are an admin: set a status and leave a note on each request.' : 'The admin sees new requests and marks them approved, added or declined.'}</p>
    <div class="tiles compact">${tile(pending ? 'warnt' : 'okt', 'Pending', pending)}${tile('', 'Added', list.filter(r => r.status === 'added').length)}${tile('', 'All requests', list.length)}</div>
    ${L.isWeb ? `<p class="muted tiny">Phone-sized version of this form: <a href="request" target="_blank"><span class="mono">${esc(location.origin)}/request</span></a>. The guest QR code on the Security tab points there.</p>` : ''}
    <div class="card" style="margin-top:12px"><h3>New request</h3>
      <div class="inline"><input type="text" id="rqTitle" placeholder="Title" style="flex:2;min-width:180px"><input type="number" id="rqYear" placeholder="Year" style="width:90px"><select id="rqKind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>${me.guest ? '<input type="text" id="rqBy" placeholder="Your name" style="width:140px">' : ''}</div>
      <div class="inline" style="margin-top:8px"><input type="text" id="rqNote" placeholder="Anything that helps: which edition, dub or sub, where it streams…" style="flex:1"><button class="primary" id="rqAdd">Request</button></div>
    </div>
    <div class="card" style="margin-top:12px"><table><thead><tr><th>Title</th><th>Kind</th><th>Requested by</th><th>When</th><th>Status</th><th>Note</th>${isAdmin ? '<th></th>' : ''}</tr></thead><tbody>
      ${list.map(r => `<tr><td><b>${esc(r.title)}</b>${r.year ? ` <span class="muted">(${r.year})</span>` : ''}${r.note ? `<div class="muted tiny wrap">${esc(r.note)}</div>` : ''}</td><td>${KIND[r.kind] || r.kind}</td><td>${esc(r.requested_by || '')}</td><td class="muted">${fmtDate(r.created)}</td><td><span class="badge ${STATUS[r.status][0]}">${STATUS[r.status][1]}</span></td><td class="muted tiny wrap">${esc(r.admin_note || '')}</td>${isAdmin ? `<td class="nowrap"><select class="small rqStatus" data-id="${r.id}">${Object.keys(STATUS).map(s => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${STATUS[s][1]}</option>`).join('')}</select> <button class="small rqNote" data-id="${r.id}" title="Admin note">✎</button> <button class="small rqDel" data-id="${r.id}">✕</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="7" class="muted">No requests yet.</td></tr>`}
    </tbody></table></div>`;
  $('#rqAdd').onclick = async () => {
    try { await L.requests.add({ title: $('#rqTitle').value, year: $('#rqYear').value, kind: $('#rqKind').value, note: $('#rqNote').value, requested_by: $('#rqBy') ? $('#rqBy').value : undefined }); toast('Request filed'); views.requests(); refreshBadges(); } catch (e) { toast(e.message, true); }
  };
  document.querySelectorAll('.rqStatus').forEach(sel => { sel.onchange = async () => { await L.requests.update(sel.dataset.id, { status: sel.value }); views.requests(); refreshBadges(); }; });
  document.querySelectorAll('.rqNote').forEach(b => { b.onclick = async () => { const cur = list.find(r => String(r.id) === b.dataset.id); const n = prompt('Note for the requester', cur.admin_note || ''); if (n !== null) { await L.requests.update(b.dataset.id, { admin_note: n }); views.requests(); } }; });
  document.querySelectorAll('.rqDel').forEach(b => { b.onclick = async () => { if (confirm('Delete this request?')) { await L.requests.delete(b.dataset.id); views.requests(); refreshBadges(); } }; });
};
