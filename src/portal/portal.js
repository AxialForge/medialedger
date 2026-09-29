'use strict';
/* The family portal's whole client: three tabs (Library, Tonight, Requests) over the small /p/ API.
   No admin code is loaded here and nothing on this page can change the library. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const view = $('#view');
  const THEMES = [['', 'Graphite'], ['midnight', 'Midnight'], ['obsidian', 'Obsidian'], ['forest', 'Forest'], ['rose', 'Rose'], ['lavender', 'Lavender'], ['gunmetal', 'Gunmetal'], ['crimson', 'Crimson']];
  const TYPE = { tv: 'TV', anime: 'Anime', movie: 'Movie' };
  const store = { get: (k, d) => { try { const v = localStorage.getItem('mlp.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('mlp.' + k, JSON.stringify(v)); } catch { /* private mode */ } } };
  let me = null;
  const cache = new Map();

  async function api(path, body) {
    const r = await fetch('/p/' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { headers: { accept: 'application/json' } });
    let j = null; try { j = await r.json(); } catch { /* not json */ }
    if (r.status === 401) { noInvite(); throw new Error('invite'); }
    if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || `The server answered ${r.status}`);
    return j.result;
  }
  const cached = async (path) => { const hit = cache.get(path); if (hit && Date.now() - hit.t < 5 * 60000) return hit.v; const v = await api(path); cache.set(path, { t: Date.now(), v }); return v; };

  let toastTimer = null;
  function toast(msg, bad) { let t = $('.toast'); if (!t) { t = document.createElement('div'); document.body.append(t); } t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 3500); }
  function noInvite() { $('#tabs').innerHTML = ''; $('#who').textContent = ''; view.innerHTML = '<div class="empty"><h1>Invite needed</h1><p>Open your invite link on this device, or scan the QR code you were sent.<br>If the link stopped working, ask for a new one.</p></div>'; }

  const stars = (n) => n ? `<span class="stars" title="${n} of 5">${'★'.repeat(Math.round(n))}</span>` : '';
  const rating = (n) => n != null ? `<span>★ ${Number(n).toFixed(1)}</span>` : '';
  const mins = (m) => m ? (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`) : '';
  const tagRow = (r) => { const t = [...(r.genres || []).slice(0, 4), ...(r.tags || []).map(x => '#' + x)]; return t.length ? `<div class="tags">${t.map(x => `<span class="badge">${esc(x)}</span>`).join('')}</div>` : ''; };
  const audioBadge = (a) => a ? `<span class="badge">${esc({ sub: 'Sub', dub: 'Dub', dual: 'Sub + Dub', mixed: 'Mixed', raw: 'Raw' }[a] || a)}</span>` : '';
  // Posters: the index says which titles have one, so no request is made for the rest.
  let posters = {};
  const loadPosters = async () => { try { posters = await cached('posters'); } catch { posters = {}; } };
  const poster = (r, cls = 'pthumb') => { const v = posters[r.type + '|' + r.key]; return v ? `<img class="${cls}" loading="lazy" alt="" src="/p/poster?type=${encodeURIComponent(r.type)}&key=${encodeURIComponent(r.key)}&v=${v}">` : `<span class="${cls} none">${esc((r.title || '?').trim().slice(0, 1).toUpperCase())}</span>`; };
  const hrefOf = (r) => `#title/${r.type}/${encodeURIComponent(r.key)}`;

  // ---- Library ------------------------------------------------------------------------------------
  async function library() {
    let type = store.get('lib', 'movie');
    view.innerHTML = `<div class="seg" id="libSeg">${['movie', 'tv', 'anime'].map(t => `<button data-t="${t}" class="${t === type ? 'on' : ''}">${t === 'movie' ? 'Movies' : TYPE[t]}</button>`).join('')}</div>
      <div class="bar"><input type="search" id="q" placeholder="Search…" autocomplete="off"><select id="fGenre"><option value="">any genre</option></select><select id="fBest"><option value="">any quality</option><option>4K</option><option>1080p</option><option>720p</option></select><select id="fAudio" hidden><option value="">sub or dub</option><option value="sub">Sub</option><option value="dub">Dub</option><option value="dual">Sub + Dub</option></select><select id="sort"><option value="title">A to Z</option><option value="rating">best rated</option><option value="year">newest first</option></select></div>
      <div class="muted tiny" id="count"></div><div class="list" id="list"><div class="empty">Loading…</div></div><div class="more" id="more"></div>`;
    let rows = [], shown = 60;
    const draw = () => {
      const q = $('#q').value.trim().toLowerCase(), g = $('#fGenre').value, b = $('#fBest').value, a = $('#fAudio').value, s = $('#sort').value;
      let list = rows.filter(r => (!q || r.title.toLowerCase().includes(q) || (r.tags || []).some(t => t.toLowerCase().includes(q))) && (!g || (r.genres || []).includes(g)) && (!b || r.best === b) && (!a || r.audio_type === a));
      list = list.slice().sort(s === 'rating' ? (x, y) => (y.online_rating || 0) - (x.online_rating || 0) : s === 'year' ? (x, y) => (y.year || 0) - (x.year || 0) : (x, y) => x.title.localeCompare(y.title));
      $('#count').textContent = `${list.length.toLocaleString()} of ${rows.length.toLocaleString()}`;
      $('#list').innerHTML = list.slice(0, shown).map(r => `<a class="row has-poster" href="${hrefOf(r)}">${poster(r)}<div class="t">${esc(r.title)}${r.year ? ` <span class="muted">(${r.year})</span>` : ''}</div><div class="s">${r.best ? `<span class="badge">${esc(r.best)}${r.hdr ? ' ' + esc(r.hdr) : ''}</span>` : ''}${audioBadge(r.audio_type)}${r.type === 'movie' ? `<span>${mins(r.minutes)}</span>${r.versions > 1 ? `<span>${r.versions} versions</span>` : ''}` : `<span>${r.episodes} episodes</span>${r.missing ? `<span class="badge warn">${r.missing} missing</span>` : r.expected ? '<span class="badge ok">complete</span>' : ''}`}${rating(r.online_rating)}${stars(r.my_rating)}</div>${tagRow(r)}</a>`).join('') || '<div class="empty">Nothing matches.</div>';
      $('#more').innerHTML = list.length > shown ? `<button class="btn" id="moreBtn">Show more (${(list.length - shown).toLocaleString()} left)</button>` : '';
      if ($('#moreBtn')) $('#moreBtn').onclick = () => { shown += 120; draw(); };
    };
    const load = async () => {
      $('#list').innerHTML = '<div class="empty">Loading…</div>'; $('#fAudio').hidden = type !== 'anime';
      try { await loadPosters(); rows = await cached('library?type=' + type); } catch (e) { if (e.message !== 'invite') $('#list').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
      const genres = [...new Set(rows.flatMap(r => r.genres || []))].sort();
      $('#fGenre').innerHTML = '<option value="">any genre</option>' + genres.map(g => `<option>${esc(g)}</option>`).join('');
      $('#sort').querySelector('[value=year]').hidden = type !== 'movie';
      shown = 60; draw();
    };
    $('#libSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; type = b.dataset.t; store.set('lib', type); [...$('#libSeg').children].forEach(x => x.classList.toggle('on', x === b)); $('#q').value = ''; load(); };
    let deb = null; $('#q').oninput = () => { clearTimeout(deb); deb = setTimeout(() => { shown = 60; draw(); }, 150); };
    ['#fGenre', '#fBest', '#fAudio', '#sort'].forEach(id => { $(id).onchange = () => { shown = 60; draw(); }; });
    await load();
  }

  // ---- One title ------------------------------------------------------------------------------------
  async function title(type, key) {
    view.innerHTML = '<div class="empty">Loading…</div>';
    let t; try { t = await api(`title?type=${encodeURIComponent(type)}&key=${encodeURIComponent(key)}`); } catch (e) { if (e.message !== 'invite') view.innerHTML = `<p><a href="#library">‹ Library</a></p><div class="empty">${esc(e.message)}</div>`; return; }
    await loadPosters();
    const head = `<p><a href="#library">‹ Library</a></p>${poster({ type, key, title: t.title }, 'pbig')}<h1><span class="badge ${type}">${TYPE[type]}</span> ${esc(t.title)}${t.year ? ` <span class="muted">(${t.year})</span>` : ''}</h1>${tagRow(t)}`;
    if (type === 'movie') {
      view.innerHTML = head + `<h2>${t.versions.length > 1 ? 'Versions on hand' : 'On hand'}</h2>` + t.versions.map(v => `<div class="card"><div class="row-s"><span class="badge">${esc(v.resolution || '?')}${v.hdr ? ' ' + esc(v.hdr) : ''}</span> ${v.edition ? `<span class="badge">${esc(v.edition)}</span>` : ''} <span class="muted">${mins(v.minutes)}${v.gb ? ' · ' + v.gb + ' GB' : ''}</span></div><div class="muted tiny" style="margin-top:6px">Audio: ${esc(v.audio.join(', ') || 'unknown')} · Subtitles: ${esc(v.subs.join(', ') || 'none')}</div></div>`).join('');
      return;
    }
    const seasons = new Map();
    for (const e of t.episodes) { if (!seasons.has(e.season)) seasons.set(e.season, { have: [], gone: [] }); seasons.get(e.season).have.push(e); }
    for (const m of t.missing) { if (!seasons.has(m.season)) seasons.set(m.season, { have: [], gone: [] }); seasons.get(m.season).gone = m.episodes; }
    const totalGone = t.missing.reduce((a, m) => a + m.episodes.length, 0);
    view.innerHTML = head + `<p class="muted">${t.episodes.length} episodes on hand${totalGone ? ` · <span class="badge warn">${totalGone} missing</span>` : ''}</p>` +
      [...seasons.entries()].sort((a, b) => a[0] - b[0]).map(([s, v]) => {
        // A long gap list becomes ranges ("1-60, 62") under the episodes on hand; a short one is shown in place.
        const many = v.gone.length > 24;
        const ranges = (nums) => { const out = []; let a = null, b = null; for (const n of nums.slice().sort((x, y) => x - y)) { if (a == null) { a = b = n; } else if (n === b + 1) { b = n; } else { out.push(a === b ? String(a) : `${a}–${b}`); a = b = n; } } if (a != null) out.push(a === b ? String(a) : `${a}–${b}`); return out.join(', '); };
        const all = [...v.have.map(e => ({ n: e.episode, e })), ...(many ? [] : v.gone.map(n => ({ n, gone: true })))].sort((a, b) => a.n - b.n);
        return `<details class="season"${seasons.size === 1 ? ' open' : ''}><summary><b>${s === 0 ? 'Specials' : 'Season ' + s}</b><span class="muted">${v.have.length} episode${v.have.length === 1 ? '' : 's'}</span>${v.gone.length ? `<span class="badge warn right">${v.gone.length} missing</span>` : '<span class="badge ok right">complete</span>'}</summary><div class="eps">${all.map(x => x.gone ? `<div class="ep gone"><span class="n">${x.n}</span><span>not in the library</span></div>` : `<div class="ep"><span class="n">${x.n}${x.e.episode_end ? '–' + x.e.episode_end : ''}</span><span>${esc(x.e.title || 'Episode ' + x.n)}</span><span class="muted right">${esc(x.e.resolution || '')}</span></div>`).join('')}${many ? `<div class="ep gone"><span class="n">–</span><span>Not in the library: ${esc(ranges(v.gone))}</span></div>` : ''}</div></details>`;
      }).join('') + (me.perms.request && totalGone ? `<p class="muted tiny">Something missing you want? <a href="#requests">Send a request</a>.</p>` : '');
  }

  // ---- Tonight ------------------------------------------------------------------------------------
  async function tonight() {
    const pref = store.get('tonight', { kind: '', unwatched: true, complete: false, minutes: '', genre: '' });
    view.innerHTML = `<h1>What to watch tonight</h1>
      <div class="bar"><select id="tKind"><option value="">series and movies</option><option value="series">series only</option><option value="movie">movies only</option></select><select id="tGenre"><option value="">any genre</option></select><select id="tMin"><option value="">any length</option><option value="30">up to 30 min</option><option value="60">up to 1 hour</option><option value="100">up to 100 min</option><option value="130">up to 2h 10m</option></select></div>
      <label class="chk"><input type="checkbox" id="tUnw"> Not watched yet</label><label class="chk"><input type="checkbox" id="tComp"> Complete series only</label>
      <p><button class="btn primary" id="tPick">Pick for me</button> <span class="muted tiny" id="tCount"></span></p><div id="tBox"></div><div class="list" id="tList"></div><div class="more" id="tMore"></div>
      <p class="muted tiny">"Not watched yet" follows the household's Plex account, not yours.</p>`;
    let rows; try { await loadPosters(); rows = await cached('tonight'); } catch (e) { if (e.message !== 'invite') $('#tList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    $('#tGenre').innerHTML = '<option value="">any genre</option>' + [...new Set(rows.flatMap(r => r.genres || []))].sort().map(g => `<option>${esc(g)}</option>`).join('');
    $('#tKind').value = pref.kind || ''; $('#tGenre').value = pref.genre || ''; $('#tMin').value = pref.minutes || ''; $('#tUnw').checked = pref.unwatched !== false; $('#tComp').checked = !!pref.complete;
    let current = [], shown = 40;
    const draw = () => {
      const kind = $('#tKind').value, g = $('#tGenre').value, m = Number($('#tMin').value) || 0, unw = $('#tUnw').checked, comp = $('#tComp').checked;
      store.set('tonight', { kind, genre: g, minutes: m || '', unwatched: unw, complete: comp });
      current = rows.filter(r => (!kind || r.kind === kind) && (!g || (r.genres || []).includes(g)) && (!m || (r.minutes && r.minutes <= m)) && (!unw || r.unwatched == null || r.unwatched > 0) && (!comp || r.kind === 'movie' || r.complete));
      current.sort((a, b) => (b.online_rating || 0) - (a.online_rating || 0));
      $('#tCount').textContent = `${current.length.toLocaleString()} to choose from`;
      $('#tList').innerHTML = current.slice(0, shown).map(item).join('') || '<div class="empty">Nothing matches; loosen the filters.</div>';
      $('#tMore').innerHTML = current.length > shown ? '<button class="btn" id="tMoreBtn">Show more</button>' : '';
      if ($('#tMoreBtn')) $('#tMoreBtn').onclick = () => { shown += 80; draw(); };
    };
    const item = (r) => `<a class="row has-poster" href="${hrefOf(r)}">${poster(r)}<div class="t"><span class="badge ${r.type}">${r.kind === 'movie' ? 'Movie' : TYPE[r.type]}</span> ${esc(r.title)}${r.year ? ` <span class="muted">(${r.year})</span>` : ''}</div><div class="s">${r.kind === 'movie' ? `<span>${mins(r.minutes)}</span>` : `<span>${r.episodes} × ${r.minutes || '?'} min</span>${r.unwatched != null ? `<span>${r.unwatched} unwatched</span>` : ''}`}${r.best ? `<span class="badge">${esc(r.best)}</span>` : ''}${audioBadge(r.audio_type)}${rating(r.online_rating)}${stars(r.my_rating)}</div>${tagRow(r)}</a>`;
    ['#tKind', '#tGenre', '#tMin', '#tUnw', '#tComp'].forEach(id => { $(id).onchange = () => { shown = 40; $('#tBox').innerHTML = ''; draw(); }; });
    $('#tPick').onclick = () => { if (!current.length) return toast('Nothing matches; loosen the filters', true); const r = current[Math.floor(Math.random() * current.length)]; $('#tBox').innerHTML = `<div class="card pick"><div class="muted tiny">Tonight</div>${item(r).replace('class="row"', 'class="row" style="border:0;padding:6px 0 0;background:none"')}</div>`; window.scrollTo({ top: 0, behavior: 'smooth' }); };
    draw();
  }

  // ---- Requests -----------------------------------------------------------------------------------
  async function requests() {
    const STATUS = { pending: ['waiting', ''], approved: ['approved', 'ok'], added: ['added', 'ok'], rejected: ['declined', 'bad'] };
    view.innerHTML = `<h1>Ask for something</h1>
      <div class="card"><div class="field"><span>Title</span><input type="text" id="rTitle" maxlength="120" autocomplete="off" placeholder="What should be added?"></div>
      <div class="two"><div class="field"><span>Kind</span><select id="rKind"><option value="movie">Movie</option><option value="tv">TV show</option><option value="anime">Anime</option><option value="other">Other</option></select></div><div class="field"><span>Year (optional)</span><input type="number" id="rYear" min="1900" max="2100" inputmode="numeric"></div></div>
      <div class="field"><span>Note (optional)</span><textarea id="rNote" maxlength="400" placeholder="Edition, dub or sub, where it streams…"></textarea></div>
      <div id="rExists"></div><button class="btn primary" id="rSend">Send request</button></div>
      <h2>Your requests</h2><div class="list" id="rList"><div class="empty">Loading…</div></div>`;
    const list = async () => {
      let rows; try { rows = await api('requests'); } catch (e) { if (e.message !== 'invite') $('#rList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
      $('#rList').innerHTML = rows.map(r => { const [label, cls] = STATUS[r.status] || [r.status, '']; return `<div class="row" style="cursor:default"><div class="t">${esc(r.title)}${r.year ? ` <span class="muted">(${r.year})</span>` : ''} <span class="badge ${cls}">${label}</span></div><div class="s"><span>${esc({ movie: 'Movie', tv: 'TV show', anime: 'Anime', other: 'Other' }[r.kind] || r.kind)}</span><span>${new Date(r.created).toLocaleDateString()}</span></div>${r.note ? `<div class="muted tiny" style="margin-top:4px">${esc(r.note)}</div>` : ''}${r.reply ? `<div class="note tiny">${esc(r.reply)}</div>` : ''}</div>`; }).join('') || '<div class="empty">Nothing asked for yet.</div>';
    };
    const send = async (force) => {
      const body = { title: $('#rTitle').value, kind: $('#rKind').value, year: $('#rYear').value, note: $('#rNote').value, force: !!force };
      if (body.title.trim().length < 2) return toast('Type the title', true);
      $('#rSend').disabled = true;
      try {
        const r = await api('requests', body);
        if (r.exists) { $('#rExists').innerHTML = `<div class="note"><b>Already in the library:</b><br>${r.exists.map(x => `<a href="${hrefOf(x)}">${esc(x.title)}${x.year ? ` (${x.year})` : ''}</a> <span class="badge ${x.type}">${TYPE[x.type]}</span>`).join('<br>')}<br><button class="btn" id="rForce" style="margin-top:8px">Ask anyway (another edition, better quality…)</button></div>`; $('#rForce').onclick = () => send(true); return; }
        $('#rExists').innerHTML = ''; $('#rTitle').value = ''; $('#rYear').value = ''; $('#rNote').value = ''; toast('Request sent'); list();
      } catch (e) { if (e.message !== 'invite') toast(e.message, true); }
      finally { $('#rSend').disabled = false; }
    };
    $('#rSend').onclick = () => send(false);
    list();
  }

  // ---- shell ----------------------------------------------------------------------------------------
  function menu() {
    const cur = document.documentElement.dataset.theme || '';
    view.innerHTML = `<p><a href="#${store.get('tab', 'library')}">‹ Back</a></p><h1>Settings</h1><div class="card"><div class="field"><span>Colour theme (this device only)</span><select id="mTheme">${THEMES.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="card"><p class="muted">Signed in as <b>${esc(me.name)}</b> on this device.</p><button class="btn" id="mLeave">Forget this device</button><p class="muted tiny">You will need your invite link to come back.</p></div><p class="muted tiny">${esc(me.app)} ${esc(me.version || '')} · family portal</p>`;
    $('#mTheme').onchange = () => { const v = $('#mTheme').value; if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme; try { v ? localStorage.setItem('medialedger.theme', v) : localStorage.removeItem('medialedger.theme'); } catch { /* ignore */ } };
    $('#mLeave').onclick = async () => { if (!confirm('Forget this device?')) return; try { await api('leave', {}); } catch { /* gone either way */ } noInvite(); };
  }
  const TABS = [['library', '▤', 'Library', 'browse'], ['tonight', '▷', 'Tonight', 'tonight'], ['requests', '✚', 'Requests', 'request']];
  function route() {
    if (!me) return;
    const parts = location.hash.replace(/^#/, '').split('/');
    const tabs = TABS.filter(t => me.perms[t[3]]);
    let tab = parts[0] || store.get('tab', tabs[0] ? tabs[0][0] : 'library');
    if (tab === 'title' && me.perms.browse) { drawTabs(tabs, 'library'); return title(parts[1], decodeURIComponent(parts.slice(2).join('/'))); }
    if (tab === 'menu') { drawTabs(tabs, ''); return menu(); }
    if (!tabs.some(t => t[0] === tab)) tab = tabs[0] ? tabs[0][0] : '';
    drawTabs(tabs, tab); if (tab) store.set('tab', tab);
    window.scrollTo(0, 0);
    if (tab === 'library') return library(); if (tab === 'tonight') return tonight(); if (tab === 'requests') return requests();
    view.innerHTML = '<div class="empty">Your invite does not include anything yet.</div>';
  }
  const drawTabs = (tabs, on) => { $('#tabs').innerHTML = tabs.map(([id, icon, label]) => `<a href="#${id}" class="${id === on ? 'on' : ''}"><i>${icon}</i>${label}</a>`).join(''); };

  window.addEventListener('hashchange', route);
  $('#menu').onclick = () => { if (me) location.hash = '#menu'; };
  (async () => { try { me = await api('me'); $('#who').textContent = me.name; route(); } catch (e) { if (e.message !== 'invite') view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; } })();
})();
