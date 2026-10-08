'use strict';
/* The library pages: Dashboard and its card catalog, the TV / Anime / Movies lists, title pages, Web videos, Adult, Watch tonight and Ratings.
   One of six plain scripts that make up the renderer; they share the page scope. See CLAUDE.md, "Renderer files". */

// ---- Dashboard: every element is a card from this catalog; dash.js arranges them per account ----
const SNAP_NOTE = 'Daily snapshots start tonight; the line appears after the second one.';
async function dashLoad() {
  const [d, snapsAll] = await Promise.all([L.data.dashboard(), L.snapshots(3650).catch(() => [])]); await loadPrefs();
  const t = Object.fromEntries(d.byType.map(r => [r.library_type, r]));
  const tot = d.byType.reduce((a, r) => ({ files: a.files + r.files, bytes: a.bytes + (r.bytes || 0), seconds: a.seconds + (r.seconds || 0), probed: a.probed + r.probed, captioned: a.captioned + r.captioned }), { files: 0, bytes: 0, seconds: 0, probed: 0, captioned: 0 });
  const health = tot.files ? Math.max(0, 100 - pct(d.byType.reduce((a, r) => a + r.unparsed + r.probe_errors, 0) + d.missingFiles, tot.files)) : 0;
  // Things only some cards need are fetched once, the first time a card asks.
  const memo = new Map();
  const lazy = (key, fn) => { if (!memo.has(key)) memo.set(key, Promise.resolve().then(fn)); return memo.get(key); };
  const snaps = (range) => { const days = (window.UI.RANGE_DAYS[range] || 90); const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); return snapsAll.filter(x => x.day >= from); };
  let notices = '';
  if (me.role === 'admin' || !L.isWeb) {
    try { const od = await L.jobs.overdue(); if (od.length) notices += `<div class="warnbox">${od.map(j => j.id === 'portal' ? `<b>Family portal:</b> ${esc(j.why)}. <a href="#family">Open Family portal</a>` : `<b>${esc(j.label)}</b> is overdue: ${esc(j.why)}.`).join('<br>')} <a href="#settings">Open Settings → Schedules</a> · <a href="#log">Log</a></div>`; } catch { /* older server */ }
    if (L.isWeb) { try { const u = await webUpdateInfo(); if (u && u.state === 'available') notices += `<div class="warnbox">MediaLedger <b>${esc(u.version)}</b> is available (this server runs ${esc((await L.appInfo()).version)}). On the Pi run <span class="mono">sudo medialedger-update</span>, or install with <span class="mono">--auto-update</span> to have it update itself every night.</div>`; } catch { /* offline */ } }
  }
  return { d, t, tot, health, snaps, lazy, notices, last: d.lastScans[0], lowRes: d.lowRes.reduce((a, r) => a + r.n, 0), capPct: r => r && r.probed ? pct(r.captioned, r.files) + '% captioned' : 'not probed yet' };
}
const canSee = (role) => !L.isWeb || me.role === 'admin' || (role === 'standard' && me.role === 'standard');
const nc = (c, id, label, num, value, sub, opts = {}) => ncard(id, label, num, value, sub, { ...opts, rule: c.rule, gear: false });
const langKey = k => k.replace(/;/g, '+');
const SZ_TILE = ['s', 'm', 'l'], SZ_CHART = ['m', 'l', 'xl'], SZ_TABLE = ['m', 'l', 'xl'];
const rows = (c, dflt) => Math.max(3, Math.min(40, Number(c.o.limit) || dflt));
const DASH_CARDS = [
  // ---- Library
  { type: 'lib_all', group: 'Library', label: 'Library', help: 'Files, size and hours of video across every library.', sizes: SZ_TILE, def: 'm', guest: true, render: c => tile('', 'Library', `${c.tot.files.toLocaleString()} files`, `${fmtBytes(c.tot.bytes)} · ${fmtHours(c.tot.seconds)} of video`) },
  { type: 'lib_tv', group: 'Library', label: 'TV Shows', help: 'Series, episodes, size and caption share.', sizes: SZ_TILE, def: 'm', guest: true, render: c => linkTile('#tv', tile('tv', 'TV Shows', `${c.d.titles.tv} series`, `${(c.t.tv?.files || 0).toLocaleString()} episodes · ${fmtBytes(c.t.tv?.bytes)} · ${c.capPct(c.t.tv)}`)) },
  { type: 'lib_anime', group: 'Library', label: 'Anime', help: 'Series, episodes, size and caption share.', sizes: SZ_TILE, def: 'm', guest: true, render: c => linkTile('#anime', tile('anime', 'Anime', `${c.d.titles.anime} series`, `${(c.t.anime?.files || 0).toLocaleString()} episodes · ${fmtBytes(c.t.anime?.bytes)} · ${c.capPct(c.t.anime)}`)) },
  { type: 'lib_movie', group: 'Library', label: 'Movies', help: 'Titles, files, size and caption share.', sizes: SZ_TILE, def: 'm', guest: true, render: c => linkTile('#movies', tile('movie', 'Movies', `${c.d.titles.movie} titles`, `${(c.t.movie?.files || 0).toLocaleString()} files · ${fmtBytes(c.t.movie?.bytes)} · ${c.capPct(c.t.movie)}`)) },
  { type: 'multiples', group: 'Library', label: 'Movie multiples', help: 'Movies you hold in more than one file.', sizes: SZ_TILE, def: 's', guest: true, render: c => tile(c.d.multiples.n ? 'warnt' : '', 'Movie multiples', `${c.d.multiples.n} titles`, `${c.d.multiples.extra} extra file(s) · ${fmtBytes(c.d.multiples.bytes)}`) },
  { type: 'genres_known', group: 'Library', label: 'Genres known', help: 'Titles that carry genres from TVmaze, AniList or Plex.', sizes: SZ_TILE, def: 's', guest: true, render: c => tile('', 'Genres known', c.d.genresTitles, c.d.genres.length ? `${c.d.genres.reduce((a, r) => a + r.n, 0).toLocaleString()} genre tags across the library` : 'from TVmaze / AniList / Plex') },
  { type: 'my_tags', group: 'Library', label: 'Your tags', help: 'How many titles carry a tag of yours, and the most used.', sizes: SZ_TILE, def: 's', guest: true, render: c => tile('', 'Your tags', c.d.tagged ? `${c.d.tagged} titles` : '—', c.d.tags.slice(0, 4).map(t => `${esc(t.tag)} ${t.n}`).join(' · ') || 'type one on any title page') },
  // ---- Health
  { type: 'health', group: 'Health', label: 'Library health', help: 'Share of files that parsed, probed and are still on the share.', sizes: SZ_TILE, def: 's', guest: true, rule: DEFAULT_RULES.health, render: c => nc(c, 'health', 'Library health', c.health, `${c.health}%`, `${c.d.byType.reduce((a, r) => a + r.unparsed, 0)} unparsed · ${c.d.byType.reduce((a, r) => a + r.probe_errors, 0)} probe errors · ${c.d.missingFiles} missing`, { href: '#issues/problems' }) },
  { type: 'missing', group: 'Health', label: 'Missing episodes', help: 'Episodes the online listings say exist and you do not have, after your collecting choices.', sizes: SZ_TILE, def: 's', guest: true, rule: DEFAULT_RULES.missing, render: c => nc(c, 'missing', 'Missing episodes', c.d.missingEpisodes.episodes, c.d.missingEpisodes.episodes.toLocaleString(), `${c.d.missingEpisodes.series} series · ${c.d.missingEpisodes.matched} matched · ${c.d.missingEpisodes.unmatched} unmatched${c.d.missingEpisodes.pending ? ` · ${c.d.missingEpisodes.pending} pending` : ''}`, { href: '#missing' }) },
  { type: 'ended', group: 'Health', label: 'Ended but incomplete', help: 'Series that finished airing and still have gaps.', sizes: SZ_TILE, def: 's', guest: true, rule: DEFAULT_RULES.ended, render: c => nc(c, 'ended', 'Ended but incomplete', c.d.finishedIncomplete, c.d.finishedIncomplete, 'finished airing, still have gaps', { href: '#missing' }) },
  { type: 'dups', group: 'Health', label: 'Duplicate episodes', help: 'The same season and episode in several files.', sizes: SZ_TILE, def: 's', guest: true, rule: DEFAULT_RULES.dups, render: c => nc(c, 'dups', 'Duplicate episodes', c.d.duplicates, c.d.duplicates, 'same season/episode, several files', { href: '#issues/duplicates' }) },
  { type: 'fixes', group: 'Health', label: 'Manual fixes', help: 'Corrections you saved; they apply on every scan.', sizes: SZ_TILE, def: 's', guest: true, render: c => tile('', 'Manual fixes', c.d.overrides, c.d.overrides ? 'applied on every scan' : 'none needed yet') },
  { type: 'overdue', group: 'Health', label: 'Overdue jobs', help: 'Scheduled jobs that have not run when they should have.', sizes: SZ_TILE, def: 's', render: async c => { if (!canSee('admin')) return null; const od = await c.lazy('overdue', () => L.jobs.overdue()); return linkTile('#settings', tile(od.length ? 'badt' : 'okt', 'Scheduled jobs', od.length ? `${od.length} overdue` : 'on time', od.map(j => esc(j.label)).join(' · ') || 'scan, Plex sync, backup, snapshot, summary')); } },
  // ---- Quality
  { type: 'lowres', group: 'Quality', label: 'Below 720p', help: 'Files in standard definition.', sizes: SZ_TILE, def: 's', guest: true, rule: DEFAULT_RULES.lowres, render: c => nc(c, 'lowres', 'Below 720p', c.lowRes, c.lowRes.toLocaleString(), c.d.lowRes.map(r => `${typeName(r.library_type)} ${r.n}`).join(' · ') || 'nothing SD', { href: '#quality' }) },
  { type: 'lowbit', group: 'Quality', label: 'Low-bitrate files', help: 'Files under the bitrate threshold for their resolution.', sizes: SZ_TILE, def: 's', guest: true, rule: DEFAULT_RULES.lowbit, render: c => nc(c, 'lowbit', 'Low-bitrate files', c.d.quality.lowBitrate, c.d.quality.lowBitrate.toLocaleString(), 'below the threshold for their resolution', { href: '#quality' }) },
  { type: 'upgrades', group: 'Quality', label: 'Upgrade candidates', help: 'Titles worth a better copy, ranked by how much you watch and rate them.', sizes: SZ_TILE, def: 's', guest: true, rule: DEFAULT_RULES.upgrades, render: c => nc(c, 'upgrades', 'Upgrade candidates', c.d.upgrades, c.d.upgrades || '—', c.d.upgrades ? 'worth a better copy' : 'nothing to upgrade', { href: '#upgrades' }) },
  { type: 'mixed', group: 'Quality', label: 'Mixed-quality series', help: 'Series held in more than one resolution.', sizes: SZ_TILE, def: 's', guest: true, render: c => linkTile('#quality', tile(c.d.quality.mixedSeries ? 'warnt' : 'okt', 'Mixed-quality series', c.d.quality.mixedSeries, 'more than one resolution')) },
  { type: 'captions', group: 'Quality', label: 'Captions', help: 'Share of files with subtitles.', sizes: SZ_TILE, def: 's', guest: true, render: c => tile('', 'Captions', `${pct(c.tot.captioned, c.tot.files)}%`, `${c.tot.captioned.toLocaleString()} of ${c.tot.files.toLocaleString()} files have subtitles`) },
  { type: 'bitrate', group: 'Quality', label: 'Average bitrate', help: 'Average bitrate overall and per library.', sizes: SZ_TILE, def: 's', guest: true, render: c => tile('', 'Avg bitrate', c.t.tv || c.t.movie ? `${Math.round(c.d.byType.reduce((a, r) => a + (r.avg_kbps || 0) * r.files, 0) / Math.max(1, c.tot.files)).toLocaleString()} kbps` : '—', c.d.byType.map(r => `${typeName(r.library_type)} ${Math.round(r.avg_kbps || 0).toLocaleString()}`).join(' · ')) },
  { type: 'undaudio', group: 'Quality', label: 'Undefined audio language', help: 'Files whose audio track carries no language tag.', sizes: SZ_TILE, def: 's', guest: true, render: c => tile('', 'Undefined audio language', c.d.quality.undAudio.toLocaleString(), 'no language tag on the audio track') },
  // ---- Activity
  { type: 'lastscan', group: 'Activity', label: 'Last scan', help: 'When the library was last scanned and what changed.', sizes: SZ_TILE, def: 's', guest: true, render: c => tile('', 'Last scan', c.last ? fmtAgo(c.last.started) : 'never', c.last ? `${c.last.status} in ${fmtMs(c.last.duration_ms)} · +${c.last.added} −${c.last.removed} ~${c.last.modified}` : 'Run a scan to populate the library') },
  { type: 'lastexport', group: 'Activity', label: 'Last export', help: 'When the CSVs were last written.', sizes: SZ_TILE, def: 's', guest: true, render: c => tile('', 'Last export', c.d.lastExport ? fmtAgo(c.d.lastExport.ts) : 'never', c.d.lastExport ? `${JSON.parse(c.d.lastExport.files || '[]').length} CSV files` : '') },
  { type: 'watchfolders', group: 'Activity', label: 'Folder watch', help: 'Whether the roots are watched for changes.', sizes: SZ_TILE, def: 's', guest: true, render: c => tile(c.d.watch.enabled ? 'okt' : '', 'Folder watch', c.d.watch.enabled ? `${c.d.watch.roots.length} roots` : 'off', c.d.watch.enabled ? (c.d.watch.lastEvent ? `last change ${fmtAgo(c.d.watch.lastEvent.ts)}` : 'no changes seen yet') : 'enable in Settings') },
  { type: 'pending', group: 'Activity', label: 'Pending requests', help: 'Media requests waiting for your decision.', sizes: SZ_TILE, def: 's', guest: true, rule: DEFAULT_RULES.pending, render: c => nc(c, 'pending', 'Pending requests', c.d.pending, c.d.pending, c.d.pending ? 'waiting for a decision' : 'nothing asked for', { href: '#requests' }) },
  { type: 'airing', group: 'Activity', label: 'Airing this week', help: 'Episodes of your series that air in the next seven days.', sizes: SZ_TILE, def: 's', guest: true, render: c => linkTile('#missing', tile(c.d.airingWeek ? 'okt' : '', 'Airing this week', c.d.airingWeek, c.d.nextAiring ? `next: ${esc(c.d.nextAiring.show_name)} ${esc(c.d.nextAiring.next_episode || '')} on ${esc(c.d.nextAiring.next_airing)}` : 'no dates from the lookups yet')) },
  { type: 'scanhist', group: 'Activity', label: 'Scan history', help: 'The most recent scans.', sizes: SZ_TABLE, def: 'l', guest: true, list: true, render: c => { const d = c.d, n = rows(c, 8); return `<div class="card"><h3>Scan history</h3><table>${d.lastScans.slice(0, n).map(s => `<tr><td class="muted tiny">${fmtDate(s.started)}</td><td><span class="badge ${s.status === 'done' ? 'ok' : s.status === 'running' ? '' : 'bad'}">${s.status}</span></td><td class="muted">${s.trigger}${s.threads > 1 ? ` · ${s.threads}t` : ''}</td><td class="num">${fmtMs(s.duration_ms)}</td><td class="num"><span class="kind-added">+${s.added}</span> <span class="kind-removed">−${s.removed}</span> <span class="kind-modified">~${s.modified}</span></td><td class="num muted">${s.probed} probed</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div>`; } },
  { type: 'recent', group: 'Activity', label: 'Recently added', help: 'The newest files in the library.', sizes: SZ_TABLE, def: 'm', guest: true, list: true, render: c => { const d = c.d, n = rows(c, 10); return `<div class="card"><h3>Recently added <a class="right" href="#changes">change log →</a></h3>${d.recentlyAdded.length ? `<table>${d.recentlyAdded.slice(0, n).map(r => `<tr><td><span class="badge ${r.library_type}">${typeName(r.library_type)}</span></td><td class="wrap">${esc(r.library_type === 'movie' ? `${r.movie_title} (${r.movie_year || '?'})` : `${r.show_name} ${sxe(r)}`)}<span class="sub">${esc(r.file_name)}</span></td><td class="num muted tiny">${fmtAgo(r.first_seen)}</td></tr>`).join('')}</table>` : '<div class="empty">Nothing yet</div>'}</div>`; } },
  // ---- Storage
  { type: 'storage', group: 'Storage', label: 'Free on the share', help: 'Free space and when the share fills at the current rate.', sizes: SZ_TILE, def: 's', guest: true, render: async c => storageTile(await c.lazy('storage', () => L.storage())) },
  { type: 'storage_months', group: 'Storage', label: 'Storage added per month', help: 'How much was added each month and the space left on each disk.', sizes: SZ_CHART, def: 'xl', guest: true, render: async c => storagePanel(await c.lazy('storage', () => L.storage())).replace(' style="margin-top:12px"', '') },
  { type: 'reclaim', group: 'Storage', label: 'Reclaimable space', help: 'Space held by large titles nobody has played in a year.', sizes: SZ_TILE, def: 's', render: async c => { if (!canSee('standard')) return null; const r = await c.lazy('reclaim', () => L.reclaim({ months: 12, minGb: 2 })); return linkTile('#reclaim', tile(r.candidates.length ? 'warnt' : 'okt', 'Could free', fmtBytes(r.totalBytes), `${r.candidates.length.toLocaleString()} titles not played in a year`)); } },
  { type: 'biggest', group: 'Storage', label: 'Largest series', help: 'The series that take the most space.', sizes: SZ_TABLE, def: 'm', guest: true, list: true, render: c => { const d = c.d, n = rows(c, 10); return `<div class="card"><h3>Largest series</h3><table>${d.biggestShows.slice(0, n).map(s => `<tr><td><span class="badge ${s.library_type}">${typeName(s.library_type)}</span></td><td class="wrap">${esc(s.show_name)}</td><td class="num">${s.episodes} eps</td><td class="num">${fmtBytes(s.bytes)}</td><td class="num muted">${fmtHours(s.seconds)}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div>`; } },
  { type: 'biggest_movies', group: 'Storage', label: 'Largest movie files', help: 'The biggest single movie files.', sizes: SZ_TABLE, def: 'm', guest: true, list: true, render: c => { const d = c.d, n = rows(c, 10); return `<div class="card"><h3>Largest movie files</h3><table>${d.biggestMovies.slice(0, n).map(m => `<tr><td class="wrap">${esc(m.movie_title)} <span class="muted">(${m.movie_year || '?'})</span></td><td>${esc(m.resolution || '')}</td><td class="muted">${esc(m.video_codec || '')}</td><td class="num">${fmtBytes(m.size)}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</table></div>`; } },
  // ---- Watching
  { type: 'watched', group: 'Watching', label: 'Watched', help: 'Share of Plex-linked files that have been played.', sizes: SZ_TILE, def: 's', guest: true, render: c => linkTile(canSee('standard') ? '#watched' : '#tonight', tile('', 'Watched', c.d.watched.linked ? `${pct(c.d.watched.watched, c.d.watched.linked)}%` : '—', c.d.watched.linked ? `${c.d.watched.watched.toLocaleString()} of ${c.d.watched.linked.toLocaleString()} Plex-linked files` : 'sync Plex to see play counts')) },
  { type: 'watched_donut', group: 'Watching', label: 'Watched (chart)', help: 'Watched against not yet, from Plex.', sizes: SZ_CHART, def: 'm', guest: true, render: c => window.Cards.donut([{ k: 'Watched', n: c.d.watched.watched, color: 'var(--accent2)' }, { k: 'Not yet', n: Math.max(0, c.d.watched.linked - c.d.watched.watched), color: 'var(--line)' }], 'Watched (Plex)', { center: c.d.watched.linked ? pct(c.d.watched.watched, c.d.watched.linked) + '%' : '—', sub: c.d.watched.linked ? 'of linked files' : 'sync Plex' }) },
  { type: 'plays', group: 'Watching', label: 'Plays per day', help: 'Plays by everyone on the Plex server.', sizes: SZ_CHART, def: 'm', period: true, render: async c => { if (!canSee('standard')) return null; const days = window.UI.RANGE_DAYS[c.range] || 90; const w = await c.lazy('watched' + days, () => L.watched({ days: days > 3650 ? 'all' : days })); return window.Cards.trend(w.perDay.map(x => ({ x: x.day, y: x.plays })), 'Plays per day', { note: 'Appears once there are plays on two different days.' }); } },
  { type: 'by_person', group: 'Watching', label: 'Plays by person', help: 'Who watched how much, split by library.', sizes: SZ_CHART, def: 'm', period: true, render: async c => { if (!canSee('standard')) return null; const days = window.UI.RANGE_DAYS[c.range] || 90; const w = await c.lazy('watched' + days, () => L.watched({ days: days > 3650 ? 'all' : days })); return bars(w.byPerson, 'Plays by person', { max: 12, drill: false }); } },
  { type: 'nextup', group: 'Watching', label: 'Next up', help: 'The episode after the furthest one each person watched lately.', sizes: SZ_TABLE, def: 'l', list: true, render: async c => { if (!canSee('standard')) return null; const nu = await c.lazy('nextup', () => L.nextUp({ days: 60 })); const n = rows(c, 8); return `<div class="card"><h3>Next up <a class="right" href="#watched">watched →</a></h3>${nu.length ? `<table>${nu.slice(0, n).map(x => `<tr><td class="nowrap"><b>${esc(x.who)}</b></td><td class="wrap"><a href="#${x.library_type}/${encodeURIComponent(x.show)}">${esc(x.show)}</a></td><td class="num nowrap">${x.next ? `S${String(x.next.season).padStart(2, '0')}E${String(x.next.episode).padStart(2, '0')}` : '<span class="badge ok">caught up</span>'}</td><td class="num muted tiny nowrap">${x.left ? x.left + ' left' : ''}</td></tr>`).join('')}</table>` : '<div class="empty">No plays in the last 60 days</div>'}</div>`; } },
  { type: 'anime_audio', group: 'Watching', label: 'Anime sub / dub', help: 'Anime series by how they are voiced.', sizes: SZ_CHART, def: 'm', guest: true, render: c => window.Cards.donut([{ k: 'Subbed', n: c.d.anime_audio.sub, color: 'var(--anime)', href: '#anime?q=sub' }, { k: 'Dubbed', n: c.d.anime_audio.dub, color: 'var(--movie)', href: '#anime?q=dub' }, { k: 'Dual audio', n: c.d.anime_audio.dual, color: 'var(--accent2)', href: '#anime?q=dual' }, { k: 'Mixed', n: c.d.anime_audio.mixed, color: 'var(--warn)', href: '#anime?q=mixed' }, { k: 'Raw', n: c.d.anime_audio.raw, color: 'var(--muted)' }], 'Anime sub / dub', { sub: 'series' }) },
  { type: 'gaps', group: 'Watching', label: 'Most missing episodes', help: 'The series with the most gaps.', sizes: SZ_TABLE, def: 'l', guest: true, list: true, render: c => { const d = c.d, n = rows(c, 8); return `<div class="card"><h3>Most missing episodes <a class="right" href="#missing">all series →</a></h3>${d.missingEpisodes.top.length ? `<table>${d.missingEpisodes.top.slice(0, n).map(g => `<tr><td><span class="badge ${g.library_type}">${typeName(g.library_type)}</span></td><td class="wrap"><a href="#${g.library_type}/${encodeURIComponent(g.show_name)}">${esc(g.show_name)}</a>${g.matched_title && g.matched_title !== g.show_name ? `<span class="sub">${esc(g.matched_title)}</span>` : ''}</td><td class="num">${g.have} of ${g.expected}</td><td class="num bad">${g.missing_count} missing</td><td class="muted tiny wrap">${esc(missingText(g.missing, 6))}</td></tr>`).join('')}</table>` : `<div class="empty">${d.missingEpisodes.matched ? 'Every matched series is complete' : 'No expected counts yet; they are fetched in the background after a scan'}</div>`}</div>`; } },
  // ---- Charts
  { type: 'ch_resolution', group: 'Charts', label: 'Resolution', help: 'Files by resolution. Click a bar to open that list.', sizes: SZ_CHART, def: 'm', guest: true, render: c => bars(c.d.resolution, 'Resolution', { order: ['4K', '1440p', '1080p', '720p', '576p', '480p', 'SD', 'unknown'] }) },
  { type: 'ch_vcodec', group: 'Charts', label: 'Video codec', help: 'Files by video codec.', sizes: SZ_CHART, def: 'm', guest: true, render: c => bars(c.d.videoCodec, 'Video codec') },
  { type: 'ch_acodec', group: 'Charts', label: 'Audio codec', help: 'Files by audio codec.', sizes: SZ_CHART, def: 'm', guest: true, render: c => bars(c.d.audioCodec, 'Audio codec', { keyLabel: langKey }) },
  { type: 'ch_container', group: 'Charts', label: 'Container', help: 'Files by container format.', sizes: SZ_CHART, def: 'm', guest: true, render: c => bars(c.d.container, 'Container') },
  { type: 'ch_alang', group: 'Charts', label: 'Audio languages', help: 'Files by audio language.', sizes: SZ_CHART, def: 'm', guest: true, render: c => bars(c.d.audioLang, 'Audio languages', { keyLabel: langKey }) },
  { type: 'ch_slang', group: 'Charts', label: 'Subtitle languages', help: 'Files by subtitle language.', sizes: SZ_CHART, def: 'm', guest: true, render: c => bars(c.d.subLang, 'Subtitle languages', { keyLabel: langKey }) },
  { type: 'ch_fps', group: 'Charts', label: 'Frame rate', help: 'Files by frame rate.', sizes: SZ_CHART, def: 'm', guest: true, render: c => bars(c.d.fps, 'Frame rate', { keyLabel: k => k === 'unknown' ? k : k + ' fps' }) },
  { type: 'ch_hdr', group: 'Charts', label: 'Dynamic range', help: 'SDR, HDR10, Dolby Vision and the rest.', sizes: SZ_CHART, def: 'm', guest: true, render: c => bars(c.d.hdr, 'Dynamic range') },
  { type: 'ch_genres', group: 'Charts', label: 'Genres', help: 'The most common genres.', sizes: SZ_CHART, def: 'm', guest: true, list: true, render: c => bars(c.d.genres, 'Genres', { max: rows(c, 12), legend: true }) },
  { type: 'ch_tags', group: 'Charts', label: 'Your tags (chart)', help: 'Your own tags by how many titles carry them.', sizes: SZ_CHART, def: 'm', guest: true, list: true, render: c => bars(c.d.tags.map(t => ({ k: t.tag, n: t.n, library_type: '' })), 'Your tags', { legend: false, max: rows(c, 12), drill: false }) },
  // ---- Trends
  { type: 'tr_files', group: 'Trends', label: 'Files over time', help: 'How the library grew, from the daily snapshots.', sizes: SZ_CHART, def: 'm', guest: true, period: true, render: c => window.Cards.trend(c.snaps(c.range).map(x => ({ x: x.day, y: x.files })), 'Files over time', { note: SNAP_NOTE }) },
  { type: 'tr_free', group: 'Trends', label: 'Free space over time', help: 'Free space on the share, from the daily snapshots.', sizes: SZ_CHART, def: 'm', guest: true, period: true, render: c => window.Cards.trend(c.snaps(c.range).map(x => ({ x: x.day, y: x.free_bytes })), 'Free space over time', { fmt: fmtBytes, upIsGood: true, note: SNAP_NOTE }) },
  { type: 'tr_missing', group: 'Trends', label: 'Missing episodes over time', help: 'Whether the gaps are closing.', sizes: SZ_CHART, def: 'm', guest: true, period: true, render: c => window.Cards.trend(c.snaps(c.range).map(x => ({ x: x.day, y: x.missing_episodes })), 'Missing episodes over time', { upIsGood: false, note: SNAP_NOTE }) },
  { type: 'tr_pending', group: 'Trends', label: 'Pending requests over time', help: 'Whether requests are piling up.', sizes: SZ_CHART, def: 'm', guest: true, period: true, render: c => window.Cards.trend(c.snaps(c.range).map(x => ({ x: x.day, y: x.pending_requests })), 'Pending requests over time', { upIsGood: false, note: SNAP_NOTE }) },
];
// The layout a new account starts with: today's dashboard, in today's order.
const DASH_DEFAULT = ['lib_all', 'lib_tv', 'lib_anime', 'lib_movie', 'storage', 'health',
  'missing', 'pending', 'airing', 'upgrades', 'watched', 'lastscan', 'ended', 'dups', 'lowbit', 'lowres', 'overdue', 'reclaim',
  'ch_resolution', 'ch_vcodec', 'ch_acodec', 'ch_genres', 'anime_audio', 'watched_donut',
  'tr_files', 'tr_free', 'tr_missing', 'recent', 'biggest', 'biggest_movies', 'gaps', 'scanhist', 'storage_months'];
const DASH_CFG = { catalog: DASH_CARDS, defaults: DASH_DEFAULT, load: dashLoad, header: (c) => c.notices || '', title: 'Dashboard', prefKey: 'dashboard' };
views.dashboard = async () => {
  // Thresholds set with the old per-tile gear carry over into the default layout the first time.
  await loadPrefs();
  const old = prefs.cards || {};
  const defaults = DASH_DEFAULT.map(t => (old[t] && old[t].rule ? { type: t, o: { warn: old[t].rule.warn, bad: old[t].rule.bad } } : t));
  window.Dash.mount({ ...DASH_CFG, defaults, after: null });
  return window.Dash.render();
};


async function seriesView(type) {
  const [rows] = await Promise.all([L.data.series(type), loadPosterIndex()]);
  const cols = [
    { key: 'show_name', label: 'Series', cls: 'wrap ptitle', render: r => `${posterTag(type, r.show_name, r.show_name)}<span class="pname">${esc(r.show_name)}</span><span class="pmeta">${r.seasons} season${r.seasons === 1 ? '' : 's'} · ${r.episodes} episode${r.episodes === 1 ? '' : 's'}</span>` },
    { key: 'tags', label: 'Tags', cls: 'wrap tagcell', sortVal: r => (r.tags || []).length * 100 + (r.genres || []).length, render: tagCell },
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
  rows.forEach(r => { r.unwatched = r.plex_linked ? r.episodes - r.watched : null; });
  const sorts = [
    { key: 'show_name', label: 'Title' }, { key: 'year', label: 'Year', desc: true }, { key: 'online_rating', label: 'Online rating', desc: true },
    { key: 'audience_rating', label: 'Audience rating (Plex)', desc: true }, { key: 'critic_rating', label: 'Critic rating (Plex)', desc: true }, { key: 'my_rating', label: 'My rating', desc: true },
    { key: 'unwatched', label: 'Unwatched episodes', desc: true }, { key: 'last_added', label: 'Last episode added', desc: true }, { key: 'added', label: 'Date added', desc: true }, { key: 'last_viewed', label: 'Date viewed', desc: true },
    { key: 'plays', label: 'Plays', desc: true }, { key: 'episodes', label: 'Episodes', desc: true }, { key: 'seasons', label: 'Seasons', desc: true }, { key: 'seconds', label: 'Duration', desc: true }, { key: 'bytes', label: 'Size', desc: true },
    { key: 'height', label: 'Resolution', desc: true }, { key: 'bitrate', label: 'Bitrate', desc: true }, { key: 'missing_count', label: 'Missing episodes', desc: true },
    { key: 'random', label: 'Randomly', val: r => r._rnd, pick: () => rows.forEach(r => { r._rnd = Math.random(); }) },
  ];
  const sortState = loadSort(type, { key: 'show_name', asc: true }); let sc = null;
  const hover = (r) => `<b>${esc(r.show_name)}</b><div class="muted tiny">${[r.year, r.meta_status, AUDIO_LABEL[r.audio_type]].filter(Boolean).map(esc).join(' · ')}</div>
    ${hcRow('On hand', `${r.seasons} season${r.seasons === 1 ? '' : 's'} · ${r.episodes} episodes`)}${hcRow('Runtime', `${fmtHours(r.seconds)} · ${fmtBytes(r.bytes)}`)}${hcRow('Quality', esc((r.resolutions || '').split(',').filter(Boolean).join(', ')))}
    ${hcRow('Missing', r.expected ? (r.missing_count ? `${r.missing_count} of ${r.expected}` : 'complete') : '')}${hcRow('Watched', r.plex_linked ? `${pct(r.watched, r.episodes)}%${r.last_viewed ? ' · last ' + dayOf(r.last_viewed) : ''}` : '')}
    ${hcRow('Rating', [r.online_rating != null ? `${Number(r.online_rating).toFixed(1)} online` : '', r.my_rating ? `${r.my_rating}★ mine` : ''].filter(Boolean).join(' · '))}${hcRow('Next episode', r.next_airing ? dayOf(r.next_airing) : '')}${hcRow('Added', r.added ? `${dayOf(r.added)}${r.last_added && dayOf(r.last_added) !== dayOf(r.added) ? ' · newest ' + dayOf(r.last_added) : ''}` : '')}
    ${(r.genres || []).length || (r.tags || []).length ? `<div class="hc-tags">${chips(r.genres || [], 'tag-genre', 5)}${(r.tags || []).map(t => `<span class="badge">#${esc(t)}</span>`).join('')}</div>` : ''}`;
  const build = (list) => { const t = wallify(makeTable(list, cols, { search: r => `${r.show_name} ${tagText(r)} ${r.resolutions || ''} ${r.codecs || ''} ${r.audio_langs || ''}`, defaultSort: sortState, sorts, hover, onRow: r => { location.hash = `#${type}/${encodeURIComponent(r.show_name)}`; } })); t.node.addEventListener('sort', e => { Object.assign(sortState, e.detail); if (sc) sc.paint(); }); return t; };
  let table = build(rows);
  sc = sortControl(type, sorts, sortState, () => table.setSort(sortState.key, sortState.asc)); table.setSort(sortState.key, sortState.asc);
  const eps = rows.reduce((a, r) => a + r.episodes, 0), bytes = rows.reduce((a, r) => a + (r.bytes || 0), 0), secs = rows.reduce((a, r) => a + (r.seconds || 0), 0);
    const linked = rows.filter(r => r.plex_linked), watchedEps = linked.reduce((a, r) => a + r.watched, 0), linkedEps = linked.reduce((a, r) => a + r.episodes, 0);
  const matched = rows.filter(r => r.expected > 0), complete = matched.filter(r => !r.missing_count);
  const topG = topOf(rows, r => r.genres), topT = topOf(rows, r => r.tags), tagged = rows.filter(r => r.tags && r.tags.length).length;
  const au = { sub: 0, dub: 0, dual: 0, mixed: 0 }; rows.forEach(r => { if (au[r.audio_type] != null) au[r.audio_type]++; });
  view.innerHTML = `<h1>${typeName(type)}</h1><div class="tiles compact"><div class="tile ${type}"><div class="label">Series</div><div class="value">${rows.length}</div><div class="sub">${eps.toLocaleString()} episodes · ${fmtBytes(bytes)} · ${fmtHours(secs)}</div></div>
    ${tile(linked.length ? (watchedEps === linkedEps ? 'okt' : '') : '', 'Watched', linked.length ? `${pct(watchedEps, linkedEps)}%` : '—', linked.length ? `${linked.filter(r => r.watched === r.episodes).length} series finished · ${linked.filter(r => !r.watched).length} untouched` : 'sync Plex to see play counts')}
    ${linkTile('#missing', tile(matched.length ? (complete.length === matched.length ? 'okt' : 'warnt') : '', 'Complete', matched.length ? `${complete.length} of ${matched.length}` : '—', matched.length ? `${matched.length - complete.length} with gaps` : 'episode lookups off or pending'))}
    ${type === 'anime' || au.sub + au.dub + au.dual + au.mixed ? tile('', 'Sub / dub', `${au.sub} subbed`, `${au.dub} dubbed · ${au.dual} dual · ${au.mixed} mixed`) : ''}
    ${tile('', 'Top genres', chips(topG.map(x => x[0])), topG.slice(3, 7).map(x => `${x[0]} ${x[1]}`).join(' · ') || (topG.length ? '' : 'from TVmaze / AniList / Plex'))}
    ${tile('', 'Your tags', tagged ? `${tagged} series` : '—', topT.slice(0, 4).map(x => `${x[0]} ${x[1]}`).join(' · ') || 'type one on any series page')}
    ${tile('', 'Full captions', rows.filter(r => r.probed && r.captioned === r.episodes).length + ' series')}${linkTile('#issues', tile(rows.filter(r => r.unparsed).length ? 'warnt' : '', 'With issues', rows.filter(r => r.unparsed).length + ' series'))}</div>`;
  const tb = searchToolbar(table, rows.length, wallToggle() + '<span class="muted tiny">Filter also matches genres, sub/dub and your tags</span>'); wireWall(tb); $('.grow', tb).before(sc.node);
  const fb = filterBar(rows, (list) => { const q = $('input[type=search]', tb).value; const nt = build(list); table.node.replaceWith(nt.node); table = nt; nt.node.addEventListener('count', ev => $('.count', tb).textContent = `${ev.detail} of ${rows.length}`); nt.setQuery(q); if (!q) $('.count', tb).textContent = `${list.length} of ${rows.length}`; });
  view.append(tb, fb, table.node); applyQuery(tb, table);
}
views.tv = () => seriesView('tv');


// ---- Watch tonight: one list across series and movies, filtered by what you have not seen, how long you have, and your tags ----
views.tonight = async () => {
  const [all] = await Promise.all([L.tonight(), loadPosterIndex()]);
  const pref = (() => { try { return JSON.parse(localStorage.getItem('medialedger.tonight') || '{}'); } catch { return {}; } })();
  view.innerHTML = `<h1>Watch tonight</h1>
    <p class="lead">Everything in the library on one list, narrowed by what Plex says you have not watched, how long you have, and your own ratings and tags. <b>Pick for me</b> chooses one at random from whatever is left.</p>
    <div class="toolbar" style="flex-wrap:wrap;gap:8px">
      <select id="tKind" class="small"><option value="">series and movies</option><option value="series">series only</option><option value="movie">movies only</option></select>
      <label class="inline small"><input type="checkbox" id="tUnwatched" ${pref.unwatched !== false ? 'checked' : ''}> unwatched only</label>
      <label class="inline small"><input type="checkbox" id="tComplete" ${pref.complete ? 'checked' : ''}> complete series only</label>
      <label class="inline small">up to <input type="number" id="tMinutes" min="0" step="5" value="${pref.minutes || ''}" style="width:70px" placeholder="any"> min</label>
      <label class="inline small">my rating ≥ <select id="tStars" class="small"><option value="">any</option><option value="1">★</option><option value="2">★★</option><option value="3">★★★</option><option value="4">★★★★</option><option value="5">★★★★★</option></select></label>
      <span class="grow"></span><button class="primary" id="tPick">Pick for me</button>
    </div>
    <div id="tFilters"></div><div id="tPickBox"></div><div id="tTable"></div>`;
  const cols = [
    { key: 'title', label: 'Title', cls: 'wrap', render: r => `<span class="badge ${r.type}">${r.kind === 'movie' ? 'Movie' : typeName(r.type)}</span> ${esc(r.title)}${r.year ? ` <span class="muted">(${r.year})</span>` : ''}` },
    { key: 'tags', label: 'Tags', cls: 'wrap tagcell', render: tagCell },
    { key: 'minutes', label: 'Length', num: true, render: r => r.kind === 'movie' ? fmtDur(r.minutes * 60) : `${r.minutes} min × ${r.episodes}` },
    { key: 'unwatched', label: 'Unwatched', num: true, sortVal: r => r.unwatched == null ? -1 : r.unwatched, render: r => r.unwatched == null ? '<span class="muted">not in Plex</span>' : r.kind === 'movie' ? (r.unwatched ? 'yes' : '<span class="muted">seen</span>') : `${r.unwatched} of ${r.episodes}` },
    { key: 'complete', label: 'Complete', render: r => r.kind === 'movie' ? '' : r.complete == null ? '<span class="muted">unknown</span>' : r.complete ? '<span class="badge ok">yes</span>' : '<span class="badge warn">gaps</span>' },
    { key: 'my_rating', label: 'Mine', sortVal: r => r.my_rating || 0, render: r => starsHtml(r.my_rating, r.type, r.key, r.title) },
    { key: 'online_rating', label: 'Rating', num: true, render: r => r.online_rating != null ? Number(r.online_rating).toFixed(1) : '<span class="muted">—</span>' },
    { key: 'resolution', label: 'Best', render: r => r.resolution ? `<span class="badge">${esc(r.resolution)}</span>` : '' },
    { key: 'last_added', label: 'Added', render: r => fmtAgo(r.last_added) },
  ];
  let current = all;
  const build = (list) => makeTable(list, cols, { search: r => `${r.title} ${tagText(r)}`, defaultSort: { key: 'last_added', asc: false }, onRow: r => { location.hash = r.kind === 'movie' ? '#movies/' + encodeURIComponent(r.key) : `#${r.type}/${encodeURIComponent(r.key)}`; } });
  let table = build(all); $('#tTable').append(table.node);
  const base = () => {
    const kind = $('#tKind').value, unw = $('#tUnwatched').checked, comp = $('#tComplete').checked, mins = Number($('#tMinutes').value) || 0, stars = Number($('#tStars').value) || 0;
    try { localStorage.setItem('medialedger.tonight', JSON.stringify({ unwatched: unw, complete: comp, minutes: mins || '' })); } catch { /* ignore */ }
    return all.filter(r => (!kind || r.kind === kind) && (!unw || r.unwatched == null || r.unwatched > 0) && (!comp || r.kind === 'movie' || r.complete) && (!mins || (r.kind === 'movie' ? r.minutes <= mins : r.minutes <= mins)) && (!stars || (r.my_rating || 0) >= stars));
  };
  const fb = filterBar(all, (list) => { const keys = new Set(list.map(r => r.type + '|' + r.key)); current = base().filter(r => keys.has(r.type + '|' + r.key)); const nt = build(current); table.node.replaceWith(nt.node); table = nt; }, { watched: false });
  $('#tFilters').append(fb);
  const refresh = () => { const f = { genre: $('#fGenre', fb).value, audio: $('#fAudio', fb).value, tag: $('#fTag', fb).value }; current = base().filter(r => (!f.genre || (r.genres || []).includes(f.genre)) && (!f.audio || r.audio_type === f.audio) && (!f.tag || (r.tags || []).includes(f.tag))); const nt = build(current); table.node.replaceWith(nt.node); table = nt; };
  ['#tKind', '#tUnwatched', '#tComplete', '#tMinutes', '#tStars'].forEach(id => { $(id).onchange = refresh; $(id).oninput = refresh; });
  refresh();
  $('#tPick').onclick = () => {
    if (!current.length) return toast('Nothing matches; loosen the filters', true);
    const r = current[Math.floor(Math.random() * current.length)];
    $('#tPickBox').innerHTML = `<div class="card" style="margin:10px 0;border-color:var(--accent);overflow:hidden">${posterTag(r.type, r.key, r.title, 'pbig')}<h3>Tonight: <span class="badge ${r.type}">${r.kind === 'movie' ? 'Movie' : typeName(r.type)}</span> ${esc(r.title)}${r.year ? ` (${r.year})` : ''}</h3><div class="tagcell">${tagCell(r)}</div><p class="muted">${r.kind === 'movie' ? fmtDur(r.minutes * 60) : `${r.episodes} episodes of about ${r.minutes} min${r.unwatched != null ? `, ${r.unwatched} unwatched` : ''}`}${r.online_rating != null ? ` · rated ${Number(r.online_rating).toFixed(1)}` : ''}</p><div class="inline"><button class="small" id="tOpen">Open</button><button class="small" id="tAgain">Pick another</button></div></div>`;
    $('#tOpen').onclick = () => { location.hash = r.kind === 'movie' ? '#movies/' + encodeURIComponent(r.key) : `#${r.type}/${encodeURIComponent(r.key)}`; };
    $('#tAgain').onclick = () => $('#tPick').click();
  };
};
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
  await loadPosterIndex();
  view.innerHTML = `${posterTag(type, show, show, 'pbig')}<div class="detail-head"><span class="back" id="back">← ${typeName(type)}</span><h1>${esc(show)}</h1><span class="muted">${live.length} episodes · ${fmtBytes(bytes)} · ${fmtHours(secs)}</span>${miss && miss.expected ? (miss.missing_count ? `<span class="badge bad">${miss.missing_count} missing of ${miss.expected}</span>` : '<span class="badge ok">complete</span>') : ''}<span class="grow"></span>${matchBtn(type, show)}</div>`;
  $('#back').onclick = () => { location.hash = '#' + type; };
  view.insertAdjacentHTML('beforeend', tagStrip(type, show, { genres: data.genres || [], audio: live.length ? (rows.some(r => /jpn|\bja\b/i.test(r.audio_langs || '')) ? (live.every(r => /jpn|\bja\b/i.test(r.audio_langs || '') && /eng|\ben\b/i.test(r.audio_langs || '')) ? 'dual' : live.every(r => /jpn|\bja\b/i.test(r.audio_langs || '')) ? 'sub' : 'mixed') : (type === 'anime' && live.some(r => /eng|\ben\b/i.test(r.audio_langs || '')) ? 'dub' : null)) : null, tags: data.tags || [] })); refreshTagSuggestions();
  if (miss && miss.expected) view.insertAdjacentHTML('beforeend', missingGrid(miss));
  view.append(searchToolbar(table, rows.length, '<span class="muted tiny">Click a row to reveal the file in Explorer · Fix… corrects the parsed details</span>'), table.node);
}

views.movies = async () => {
  const [rows] = await Promise.all([L.data.movies(), loadPosterIndex()]);
  const cols = [
    { key: 'title', label: 'Title', cls: 'wrap ptitle', render: r => `${posterTag('movie', r.group_key, r.title)}<span class="pname">${esc(r.title)}${r.year ? `<span class="pyear muted"> (${r.year})</span>` : ''}</span><span class="pmeta">${[fmtDur(r.seconds), (r.resolutions || '').split(',').filter(Boolean).join(' '), r.hdr && r.hdr !== 'SDR' ? r.hdr : ''].filter(Boolean).map(esc).join(' · ')}</span>${r.files > 1 ? ` <span class="badge warn">×${r.files}</span>` : ''}` },
    { key: 'year', label: 'Year', num: true },
    { key: 'tags', label: 'Tags', cls: 'wrap tagcell', sortVal: r => (r.tags || []).length * 100 + (r.genres || []).length, render: tagCell },
    { key: 'files', label: 'Files', num: true },
    { key: 'resolutions', label: 'Versions', render: r => (r.resolutions || '').split(',').filter(Boolean).map(x => `<span class="badge">${esc(x)}</span>`).join('') + (r.editions ? ` <span class="muted tiny">${esc(r.editions)}</span>` : '') },
    { key: 'seconds', label: 'Length', num: true, render: r => fmtDur(r.seconds) },
    { key: 'codecs', label: 'Codec', render: r => esc((r.codecs || '').replace(/,/g, ' ')) },
    { key: 'audio_langs', label: 'Audio', render: r => esc(uniqList(r.audio_langs)) },
    { key: 'sub_langs', label: 'Subs', render: r => esc(uniqList(r.sub_langs)) },
    { key: 'has_captions', label: 'Captions', render: r => r.probed ? yn(r.has_captions) : '<span class="muted">—</span>' },
    { key: 'bytes', label: 'Size', num: true, render: r => fmtBytes(r.bytes) },
  ];
  rows.forEach(r => { r.watched = r.watched_count > 0 ? 1 : 0; r.unwatched = r.plex_linked ? (r.watched_count > 0 ? 0 : 1) : null; });
  let onlyMulti = false, filtered = rows;
  const sorts = [
    { key: 'title', label: 'Title' }, { key: 'year', label: 'Year', desc: true }, { key: 'audience_rating', label: 'Audience rating (Plex)', desc: true }, { key: 'my_rating', label: 'My rating', desc: true },
    { key: 'seconds', label: 'Duration', desc: true }, { key: 'progress', label: 'Progress', desc: true, val: r => r.offset_ms && r.seconds ? r.offset_ms / 1000 / r.seconds : (r.watched_count > 0 ? 1 : null) }, { key: 'watched_count', label: 'Plays', desc: true },
    { key: 'added', label: 'Date added', desc: true }, { key: 'last_viewed', label: 'Date viewed', desc: true }, { key: 'height', label: 'Resolution', desc: true }, { key: 'bitrate', label: 'Bitrate', desc: true }, { key: 'bytes', label: 'Size', desc: true }, { key: 'files', label: 'Versions', desc: true },
    { key: 'random', label: 'Randomly', val: r => r._rnd, pick: () => rows.forEach(r => { r._rnd = Math.random(); }) },
  ];
  const sortState = loadSort('movie', { key: 'title', asc: true }); let sc = null;
  const hover = (r) => `<b>${esc(r.title)}${r.year ? ` <span class="muted">(${r.year})</span>` : ''}</b><div class="muted tiny">${[fmtDur(r.seconds), AUDIO_LABEL[r.audio_type]].filter(Boolean).map(esc).join(' · ')}</div>
    ${hcRow('Versions', `${r.files} file${r.files === 1 ? '' : 's'} · ${fmtBytes(r.bytes)}`)}${hcRow('Quality', esc([(r.resolutions || '').split(',').filter(Boolean).join(', '), r.hdr && r.hdr !== 'SDR' ? r.hdr : '', r.bitrate ? (r.bitrate / 1000).toFixed(1) + ' Mbps' : ''].filter(Boolean).join(' · ')))}${hcRow('Editions', esc(r.editions || ''))}
    ${hcRow('Watched', r.plex_linked ? (r.watched_count > 0 ? `${r.watched_count} play${r.watched_count === 1 ? '' : 's'}${r.last_viewed ? ' · last ' + dayOf(r.last_viewed) : ''}` : 'not yet') : '')}${hcRow('Rating', [r.audience_rating != null ? `${Number(r.audience_rating).toFixed(1)} audience` : '', r.my_rating ? `${r.my_rating}★ mine` : ''].filter(Boolean).join(' · '))}
    ${hcRow('Audio', esc(uniqList(r.audio_langs)))}${hcRow('Subtitles', esc(uniqList(r.sub_langs)))}${hcRow('Added', dayOf(r.added))}
    ${(r.genres || []).length || (r.tags || []).length ? `<div class="hc-tags">${chips(r.genres || [], 'tag-genre', 5)}${(r.tags || []).map(t => `<span class="badge">#${esc(t)}</span>`).join('')}</div>` : ''}`;
  const build = () => { const t = wallify(makeTable((onlyMulti ? filtered.filter(r => r.files > 1) : filtered), cols, { search: r => `${r.title} ${r.year || ''} ${tagText(r)} ${r.resolutions || ''} ${r.codecs || ''} ${r.hdr || ''}`, defaultSort: sortState, sorts, hover, onRow: r => { location.hash = '#movies/' + encodeURIComponent(r.group_key); } })); t.node.addEventListener('sort', e => { Object.assign(sortState, e.detail); if (sc) sc.paint(); }); return t; };
  let table = build();
  sc = sortControl('movie', sorts, sortState, () => table.setSort(sortState.key, sortState.asc)); table.setSort(sortState.key, sortState.asc);
  const multi = rows.filter(r => r.files > 1);
    const mLinked = rows.filter(r => r.plex_linked), mWatched = mLinked.filter(r => r.watched_count > 0);
  const mTopG = topOf(rows, r => r.genres), mTopT = topOf(rows, r => r.tags), mTagged = rows.filter(r => r.tags && r.tags.length).length;
  const mAu = { sub: 0, dub: 0, dual: 0, mixed: 0 }; rows.forEach(r => { if (mAu[r.audio_type] != null) mAu[r.audio_type]++; });
  view.innerHTML = `<h1>Movies</h1><div class="tiles compact"><div class="tile movie"><div class="label">Titles</div><div class="value">${rows.length}</div><div class="sub">${rows.reduce((a, r) => a + r.files, 0).toLocaleString()} files · ${fmtBytes(rows.reduce((a, r) => a + (r.bytes || 0), 0))}</div></div>
    ${tile(mLinked.length && mWatched.length === mLinked.length ? 'okt' : '', 'Watched', mLinked.length ? `${pct(mWatched.length, mLinked.length)}%` : '—', mLinked.length ? `${mWatched.length} seen · ${mLinked.length - mWatched.length} not yet` : 'sync Plex to see play counts')}
    ${tile('', 'Top genres', chips(mTopG.map(x => x[0])), mTopG.slice(3, 7).map(x => `${x[0]} ${x[1]}`).join(' · ') || (mTopG.length ? '' : 'from Plex once synced'))}
    ${tile('', 'Your tags', mTagged ? `${mTagged} titles` : '—', mTopT.slice(0, 4).map(x => `${x[0]} ${x[1]}`).join(' · ') || 'type one on any movie page')}
    ${mAu.sub + mAu.dub + mAu.dual + mAu.mixed ? tile('', 'Sub / dub', `${mAu.sub} subbed`, `${mAu.dual} dual · ${mAu.mixed} mixed`) : ''}
    ${linkTile('#issues/duplicates', tile(multi.length ? 'warnt' : '', 'Multiples', multi.length + ' titles', fmtBytes(multi.reduce((a, r) => a + (r.bytes || 0), 0))))}${tile('', 'With captions', rows.filter(r => r.has_captions === 1).length)}</div>`;
  const tb = searchToolbar(table, rows.length, wallToggle() + '<label class="inline small"><input type="checkbox" id="multi"> Only titles with multiple files</label>'); wireWall(tb); $('.grow', tb).before(sc.node);
  const swap = () => { const q = $('input[type=search]', tb).value; const nt = build(); table.node.replaceWith(nt.node); table = nt; nt.node.addEventListener('count', ev => $('.count', tb).textContent = `${ev.detail} of ${rows.length}`); nt.setQuery(q); };
  const fb = filterBar(rows, (list) => { filtered = list; swap(); });
  view.append(tb, fb, table.node); applyQuery(tb, table);
  $('#multi', tb).onchange = e => { onlyMulti = e.target.checked; swap(); };
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
  await loadPosterIndex();
  view.innerHTML = `${posterTag('movie', groupKey, r0.movie_title || groupKey, 'pbig')}<div class="detail-head"><span class="back" id="back">← Movies</span><h1>${esc(r0.movie_title || groupKey)}${r0.movie_year ? ` <span class="muted">(${r0.movie_year})</span>` : ''}</h1><span class="muted">${rows.length} file(s)</span></div>`;
  $('#back').onclick = () => { location.hash = '#movies'; };
  const mg = (() => { try { const g = JSON.parse(rows.map(r => r.plex_genres).find(Boolean) || '[]'); return Array.isArray(g) ? g : []; } catch { return []; } })();
  const live = rows.filter(r => !r.missing); const jp = r => /jpn|\bja\b/i.test(r.audio_langs || ''), en = r => /eng|\ben\b/i.test(r.audio_langs || '');
  const audio = live.some(jp) ? (live.every(r => jp(r) && en(r)) ? 'dual' : live.every(jp) ? 'sub' : 'mixed') : null;
  L.tags.get('movie', groupKey).then(tags => { view.insertAdjacentHTML('beforeend', tagStrip('movie', groupKey, { genres: mg, audio, tags })); view.append(table.node); refreshTagSuggestions(); });
}

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

// Settings is one long form. This splits it at its headings into named groups with a tab per group and a filter,
// after the form is drawn, so every control keeps its id and the Save button still reads the whole form.
