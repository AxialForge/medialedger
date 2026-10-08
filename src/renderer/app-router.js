'use strict';
/* The hash router and start-up: wires the sidebar, signs in, and draws the first page. Loaded last.
   One of six plain scripts that make up the renderer; they share the page scope. See CLAUDE.md, "Renderer files". */

// ---------- router -----------------------------------------------------------
let currentView = 'dashboard';
// One page load at a time. A page that was still loading when another was asked for used to finish last and paint
// over it; now the later request waits, and only the newest address is drawn.
let routeRunning = null, routeQueued = false;
function route() {
  if (routeRunning) { routeQueued = true; return routeRunning; }
  routeRunning = routeNow().catch(() => {}).then(() => { routeRunning = null; if (routeQueued) { routeQueued = false; return route(); } });
  return routeRunning;
}
async function routeNow() {
  const hash = location.hash.slice(1) || 'dashboard';
  const qIdx = hash.indexOf('?'); const query = Object.fromEntries(new URLSearchParams(qIdx >= 0 ? hash.slice(qIdx + 1) : '')); const path = qIdx >= 0 ? hash.slice(0, qIdx) : hash;
  routeQuery = query;
  let [name, arg] = path.split('/');
  if (name === 'problems') { name = 'issues'; arg = arg || 'problems'; }
  if (name === 'duplicates') { name = 'issues'; arg = 'duplicates'; }
  currentView = name;
  document.querySelectorAll('.sidebar a').forEach(a => a.classList.toggle('active', a.dataset.view === name));
  view.innerHTML = '<div class="empty">Loading…</div>';
  try {
    if ((name === 'tv' || name === 'anime') && arg) await episodesView(name, decodeURIComponent(arg));
    else if (name === 'movies' && arg) await movieFilesView(decodeURIComponent(arg));
    else if (name === 'web' && arg) await webVideosView(decodeURIComponent(arg));
    else if (name === 'issues') await views.issues(arg);
    else if (views[name]) await views[name]();
    else await views.dashboard();
  } catch (e) { view.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', route);
// Phone layout: the sidebar slides in from the top bar's ☰ and closes on navigation or a tap outside.
const closeNav = () => document.body.classList.remove('nav-open');
$('#navToggle').onclick = () => document.body.classList.toggle('nav-open');
$('#navShade').onclick = closeNav;
// On a wide screen the sidebar folds to a strip of icons; each link's name becomes its tooltip.
const navMini = (on) => { document.body.classList.toggle('nav-mini', on); const b = $('#navMini'); b.textContent = on ? '»' : '«'; b.title = on ? 'Expand the sidebar' : 'Collapse the sidebar to icons'; };
document.querySelectorAll('.sidebar a[data-view]').forEach(a => { a.title = [...a.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim(); });
$('#navMini').onclick = () => { const on = !document.body.classList.contains('nav-mini'); navMini(on); try { localStorage.setItem('medialedger.navmini', on ? '1' : '0'); } catch { /* private mode */ } };
try { navMini(localStorage.getItem('medialedger.navmini') === '1'); } catch { navMini(false); }
document.querySelectorAll('.sidebar a').forEach(a => a.addEventListener('click', closeNav));
$('#topScan').onclick = () => $('#btnScan').hidden ? $('#btnCancel').click() : $('#btnScan').click();
loadMe().then(() => { if (currentView) route(); maybeWelcome(); });
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
