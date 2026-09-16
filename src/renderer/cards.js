'use strict';
// Card library for the dashboard and list pages: number tiles with colour rules, horizontal bars on a
// square-root scale with count and share labels, donuts, trend lines, hover details and drill-down links.
// Pure functions returning HTML strings (plus one global tooltip); no dependencies.
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = (n) => Number(n || 0).toLocaleString();
  const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0;
  const LIB_LABEL = { tv: 'TV', anime: 'Anime', movie: 'Movies' };
  const listHash = (lib) => lib === 'movie' ? '#movies' : lib === 'tv' || lib === 'anime' ? '#' + lib : null;

  // ---- colour rules: { higher: true|false, warn, bad } → 'okt' | 'warnt' | 'badt' | ''
  function colorFor(value, rule) {
    if (!rule || value == null || isNaN(value)) return '';
    const v = Number(value);
    if (rule.higher) { if (rule.bad != null && v <= rule.bad) return 'badt'; if (rule.warn != null && v <= rule.warn) return 'warnt'; return 'okt'; }
    if (rule.bad != null && v >= rule.bad) return 'badt'; if (rule.warn != null && v >= rule.warn) return 'warnt'; return 'okt';
  }

  // ---- number tile
  // opts: { id, cls, value (display), num (numeric for the rule), sub, rule, href, tip, gear }
  function number(label, opts = {}) {
    const cls = opts.cls != null ? opts.cls : colorFor(opts.num, opts.rule);
    const inner = `<div class="tile ${cls}" ${opts.id ? `data-card="${esc(opts.id)}"` : ''} ${opts.tip ? `data-tip="${esc(opts.tip)}"` : ''}><div class="label">${esc(label)}${opts.gear ? `<i class="card-gear" data-card="${esc(opts.id)}" title="Card settings">⚙</i>` : ''}</div><div class="value">${opts.value}</div><div class="sub">${opts.sub || ''}</div></div>`;
    return opts.href ? `<a href="${esc(opts.href)}" class="tilelink">${inner}</a>` : inner;
  }

  // ---- horizontal bars
  // rows: [{ k, n, library_type? }]; opts: { order, legend, max, keyLabel, scale: 'sqrt'|'linear', drill: bool, right (header html) }
  function bars(rows, title, opts = {}) {
    const { order, legend = true, max: maxLimit = 10, keyLabel = k => k, scale = 'sqrt', drill = true } = opts;
    const keys = [...new Set(rows.map(r => String(r.k ?? 'unknown')))];
    const sum = k => rows.filter(r => String(r.k ?? 'unknown') === k).reduce((x, r) => x + (r.n || 0), 0);
    const total = rows.reduce((a, r) => a + (r.n || 0), 0);
    if (order) keys.sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)));
    else keys.sort((a, b) => sum(b) - sum(a));
    const shown = keys.slice(0, maxLimit);
    const f = scale === 'sqrt' ? Math.sqrt : (x => x);
    const max = Math.max(1, ...shown.map(k => f(sum(k))));
    const libs = [...new Set(rows.map(r => r.library_type).filter(Boolean))];
    const body = shown.map(k => {
      const parts = rows.filter(r => String(r.k ?? 'unknown') === k); const n = sum(k);
      const width = Math.max(n ? 1.5 : 0, Math.round(f(n) / max * 1000) / 10);
      const segs = parts.map(p => { const h = drill && listHash(p.library_type); const tip = `${esc(keyLabel(k))}${p.library_type ? ' · ' + LIB_LABEL[p.library_type] : ''}: ${fmtN(p.n)} (${pct(p.n, n)}% of this bar, ${pct(p.n, total)}% of all)`; return `<${h ? 'a' : 'span'} ${h ? `href="${h}?q=${encodeURIComponent(k)}"` : ''} class="seg ${p.library_type || ''}" style="width:${p.n / n * 100}%" data-tip="${tip}"></${h ? 'a' : 'span'}>`; }).join('');
      return `<div class="row"><span data-tip="${esc(keyLabel(k))}">${esc(keyLabel(k))}</span><div class="track" style="width:${width}%">${segs}</div><span class="n"><b>${fmtN(n)}</b> <em>${pct(n, total)}%</em></span></div>`;
    }).join('') || '<div class="empty">—</div>';
    const rest = keys.length > shown.length ? `<div class="muted tiny" style="margin-top:4px">+${keys.length - shown.length} more · ${fmtN(keys.slice(maxLimit).reduce((a, k) => a + sum(k), 0))} files</div>` : '';
    const legendHtml = legend && libs.length ? `<div class="legend">${['tv', 'anime', 'movie'].filter(l => libs.includes(l)).map(l => `<span><i class="${l}"></i>${LIB_LABEL[l]}</span>`).join('')}<span class="muted" style="margin-left:auto" data-tip="Bar length uses a square-root scale so small values stay visible; the numbers are exact">√ scale</span></div>` : (scale === 'sqrt' ? '<div class="legend"><span class="muted" style="margin-left:auto" data-tip="Bar length uses a square-root scale so small values stay visible; the numbers are exact">√ scale</span></div>' : '');
    return `<div class="card chart" ${opts.id ? `data-card="${esc(opts.id)}"` : ''}><h3>${esc(title)}${opts.right || ''}</h3>${legendHtml}<div class="bars">${body}</div>${rest}</div>`;
  }

  // ---- donut: slices [{ k, n, cls? }], opts: { center: text, sub, size }
  function donut(slices, title, opts = {}) {
    const total = slices.reduce((a, s) => a + (s.n || 0), 0);
    const size = opts.size || 120, r = 46, c = 60, circ = 2 * Math.PI * r;
    const palette = ['var(--accent)', 'var(--anime)', 'var(--movie)', 'var(--accent2)', 'var(--warn)', 'var(--bad)', 'var(--muted)'];
    let offset = 0;
    const arcs = slices.filter(s => s.n > 0).map((s, i) => { const len = total ? s.n / total * circ : 0; const el = `<circle r="${r}" cx="${c}" cy="${c}" fill="none" stroke="${s.color || palette[i % palette.length]}" stroke-width="14" stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-offset}" data-tip="${esc(s.k)}: ${fmtN(s.n)} (${pct(s.n, total)}%)"${s.href ? ` class="seg-link" data-href="${esc(s.href)}"` : ''}></circle>`; offset += len; return el; }).join('');
    const legend = slices.filter(s => s.n > 0).map((s, i) => `<div class="dl-row"${s.href ? ` data-href="${esc(s.href)}"` : ''}><i style="background:${s.color || palette[i % palette.length]}"></i><span>${esc(s.k)}</span><b>${fmtN(s.n)}</b><em>${pct(s.n, total)}%</em></div>`).join('');
    return `<div class="card chart donutcard" ${opts.id ? `data-card="${esc(opts.id)}"` : ''}><h3>${esc(title)}${opts.right || ''}</h3><div class="donut"><svg viewBox="0 0 120 120" width="${size}" height="${size}" style="transform:rotate(-90deg)">${total ? arcs : `<circle r="${r}" cx="${c}" cy="${c}" fill="none" stroke="var(--line)" stroke-width="14"/>`}</svg><div class="dcenter"><b>${opts.center != null ? opts.center : fmtN(total)}</b><span>${esc(opts.sub || '')}</span></div><div class="dlegend">${legend || '<span class="muted">—</span>'}</div></div></div>`;
  }

  // ---- trend line: points [{ x: 'YYYY-MM-DD'|label, y }], opts: { fmt, right, note, area }
  function trend(points, title, opts = {}) {
    const fmt = opts.fmt || fmtN;
    const pts = points.filter(p => p.y != null);
    const w = 300, h = 80, pad = 4;
    let svg;
    if (pts.length >= 2) {
      const ys = pts.map(p => p.y), min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
      const X = i => pad + i / (pts.length - 1) * (w - 2 * pad), Y = v => h - pad - (v - min) / span * (h - 2 * pad);
      const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
      const dots = pts.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="6" fill="transparent" data-tip="${esc(p.x)}: ${esc(fmt(p.y))}"/>`).join('');
      svg = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="trend">${opts.area !== false ? `<path d="${path} L${X(pts.length - 1).toFixed(1)},${h} L${X(0).toFixed(1)},${h} Z" fill="var(--accent)" opacity=".12"/>` : ''}<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>${dots}</svg>`;
    } else svg = `<div class="empty">${esc(opts.note || (pts.length === 1 ? 'One point so far; the line starts with tomorrow\'s snapshot' : 'No history yet'))}</div>`;
    const first = pts[0], last = pts[pts.length - 1];
    const delta = pts.length >= 2 ? last.y - first.y : null;
    return `<div class="card chart" ${opts.id ? `data-card="${esc(opts.id)}"` : ''}><h3>${esc(title)}${opts.right || ''}</h3><div class="trendhead"><b>${last ? esc(fmt(last.y)) : '—'}</b>${delta != null ? `<span class="${delta > 0 ? (opts.upIsGood === false ? 'bad' : 'ok') : delta < 0 ? (opts.upIsGood === false ? 'ok' : 'bad') : 'muted'}">${delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} ${esc(fmt(Math.abs(delta)))} since ${esc(first.x)}</span>` : ''}</div>${svg}</div>`;
  }

  // ---- tooltip: one floating element for every [data-tip]
  let tipEl = null;
  function ensureTip() { if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tooltip'; tipEl.hidden = true; document.body.append(tipEl); } return tipEl; }
  document.addEventListener('mouseover', e => { const t = e.target.closest && e.target.closest('[data-tip]'); if (!t) return; const el = ensureTip(); el.textContent = t.dataset.tip; el.hidden = false; });
  document.addEventListener('mousemove', e => { if (!tipEl || tipEl.hidden) return; const x = Math.min(e.clientX + 14, window.innerWidth - tipEl.offsetWidth - 8), y = e.clientY + 16; tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px'; });
  document.addEventListener('mouseout', e => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t && tipEl) tipEl.hidden = true; });
  document.addEventListener('click', e => { const t = e.target.closest && e.target.closest('[data-href]'); if (t) location.hash = t.dataset.href; });

  window.Cards = { number, bars, donut, trend, colorFor, listHash };
})();
