'use strict';
// Every screen the manual shows: where it is, how to reach it, and (in controls/*.js) what is on it.
// The capture script, the annotator, the inventory and the manual are all generated from this list, so a
// callout number, its table row and its inventory entry cannot drift apart.
const path = require('path');
const fs = require('fs');
const REPO = path.resolve(__dirname, '..', '..', '..');
const DATA = path.resolve((process.argv.find(a => a.startsWith('--data=')) || '').slice(7) || path.join(__dirname, 'demo-data'));

// A few addresses depend on the generated titles.
let show = { tv: 'x', anime: 'x' }, multi = 'x';
try {
  const { Db } = require(path.join(REPO, 'src/main/db'));
  const db = new Db(path.join(DATA, 'medialedger.db'));
  const withGaps = (t) => (db.all(`SELECT f.show_name s, COUNT(*) n FROM files f JOIN posters p ON p.library_type = f.library_type AND p.title_key = f.show_name JOIN series_meta m ON m.library_type = f.library_type AND m.show_name = f.show_name WHERE f.library_type = ? AND f.missing = 0 GROUP BY f.show_name HAVING n < m.total_episodes ORDER BY n DESC LIMIT 1`, t)[0] || db.get('SELECT show_name s FROM files WHERE library_type = ? LIMIT 1', t)).s;
  show = { tv: withGaps('tv'), anime: withGaps('anime') };
  multi = db.get("SELECT f.group_key k FROM files f JOIN posters p ON p.library_type = 'movie' AND p.title_key = f.group_key WHERE f.library_type = 'movie' GROUP BY f.group_key HAVING COUNT(*) > 1 LIMIT 1").k;
  db.close();
} catch (e) { console.error('screens.js: demo data not readable: ' + e.message); }
const enc = encodeURIComponent;
const click = (sel, nth = 0) => `{ const e = document.querySelectorAll(${JSON.stringify(sel)})[${nth}]; if (e) e.click(); } await new Promise(r => setTimeout(r, 900));`;
const PHONE = [420, 900];
// Settings is grouped and tabbed since 2.3: a picture of some sections hides the others first.
const only = (titles) => `{ const keep = ${JSON.stringify(titles)}; document.querySelectorAll('.ssec').forEach(x => { x.hidden = !keep.some(k => x.dataset.title.startsWith(k)); }); document.querySelectorAll('.sgroup').forEach(g => { g.hidden = ![...g.querySelectorAll('.ssec')].some(x => !x.hidden); }); } await new Promise(r => setTimeout(r, 300));`;
const SEC = { from: '.ssec:not([hidden])', to: '#save' };
// The capture runs on Windows, where there is nothing to mount. These stand in for a Raspberry Pi with one share
// connected and a file server that offers three, so the share screens can be shown. Addresses are fictional.
const fakeShares = (mount) => `L.shares.status = async () => ({ available: true, platform: 'linux', canProbe: true, base: '/mnt/medialedger', why: null, shares: [{ source: '//192.168.1.50/Media', mount: ${JSON.stringify(mount)}, name: 'Media', managed: true, mounted: true, entries: 3 }] });
  L.shares.probe = async () => ({ host: '192.168.1.50', shares: [{ name: 'Media', comment: 'Films and series' }, { name: 'Backups', comment: '' }, { name: 'Photos', comment: 'Family photos' }] });`;
const PI_MOUNT = '/mnt/medialedger/Media';

const list = [
  // ---- the frame
  { id: '00_sign_in', name: 'Sign-in dialog (web server)', kind: 'dialog', parent: 'main_window', url: '#dashboard', login: true, fixedHeight: true, src: ['src/renderer/webbridge.js', 'webauth'] },
  { id: '01_main_window', name: 'Main window', kind: 'window', parent: null, url: '#dashboard', fixedHeight: true, size: [1440, 1300], src: ['src/renderer/index.html', '<nav class="sidebar">'] },
  // ---- library
  { id: '02_dashboard', name: 'Dashboard', kind: 'page', parent: 'main_window', url: '#dashboard', src: ['src/renderer/app.js', 'views.dashboard = async'] },
  { id: '03_dashboard_edit', name: 'Dashboard, edit mode', kind: 'mode', parent: '02_dashboard', url: '#dashboard', before: click('#dashEdit'), fixedHeight: true, after: click('#dashDone'), src: ['src/renderer/dash.js', 'function wire()'] },
  { id: '04_dashboard_add_card', name: 'Add a card dialog', kind: 'dialog', parent: '03_dashboard_edit', url: '#dashboard', size: [1440, 3600], before: click('#dashEdit') + click('#dashAdd'), cropModal: true, after: click('#caClose') + click('#dashDone'), src: ['src/renderer/dash.js', 'function openAdd()'] },
  { id: '05_dashboard_card_options', name: 'Card options dialog', kind: 'dialog', parent: '03_dashboard_edit', url: '#dashboard', before: `await fetch('/api/prefs:set', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ editorLevel: 'advanced' }]) }); location.hash = '#tv'; await new Promise(r => setTimeout(r, 1200)); location.hash = '#dashboard'; await new Promise(r => setTimeout(r, 2500));` + click('#dashEdit') + `{ const c = [...document.querySelectorAll('.dcard')].find(c => /health/i.test(c.querySelector('.dhandle b').innerText)); c.querySelector('[data-act=opts]').click(); } await new Promise(r => setTimeout(r, 700));`, cropModal: true, after: click('#coCancel') + click('#dashDone'), src: ['src/renderer/dash.js', 'function openOptions(item)'] },
  { id: '06_tv_shows', name: 'TV Shows', kind: 'page', parent: 'main_window', url: '#tv', fixedHeight: true, src: ['src/renderer/app.js', 'async function seriesView(type)'] },
  { id: '07_poster_wall', name: 'Poster wall view', kind: 'mode', parent: '06_tv_shows', url: '#anime', wall: true, fixedHeight: true, src: ['src/renderer/app.js', 'const wallify = (t)'] },
  { id: '08_series_page', name: 'Series page (episodes)', kind: 'page', parent: '06_tv_shows', url: `#tv/${enc(show.tv)}`, fixedHeight: true, src: ['src/renderer/app.js', 'async function episodesView(type, show)'] },
  { id: '09_movies', name: 'Movies', kind: 'page', parent: 'main_window', url: '#movies', fixedHeight: true, src: ['src/renderer/app.js', 'views.movies = async'] },
  { id: '10_movie_page', name: 'Movie page (versions)', kind: 'page', parent: '09_movies', url: `#movies/${enc(multi)}`, fixedHeight: true, src: ['src/renderer/app.js', 'async function movieFilesView(groupKey)'] },
  { id: '11_web_videos', name: 'Web videos', kind: 'page', parent: 'main_window', url: '#web', fixedHeight: true, src: ['src/renderer/app.js', 'views.web = async'] },
  { id: '12_adult', name: 'Adult library', kind: 'page', parent: 'main_window', url: '#adult', fixedHeight: true, src: ['src/renderer/app.js', 'views.adult = async'] },
  { id: '07b_poster_hover', name: 'Poster wall: details card', kind: 'mode', parent: '07_poster_wall', url: '#tv', wall: true, fixedHeight: true, before: `{ const t = document.querySelectorAll('.table-wrap.wall tbody tr')[1]; if (t) t.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); } await new Promise(r => setTimeout(r, 900));`, src: ['src/renderer/app.js', 'const hoverCard = (() =>'] },
  // ---- review
  { id: '13_missing', name: 'Missing episodes', kind: 'page', parent: 'main_window', url: '#missing', maxHeight: 2400, src: ['src/renderer/app.js', 'views.missing = async'] },
  { id: '14_match_dialog', name: 'Match dialog', kind: 'dialog', parent: '13_missing', url: '#missing', before: click('.matchbtn'), cropModal: true, after: `closeModal && 0;`, src: ['src/renderer/app.js', 'function openMatchModal('] },
  { id: '15_collect_dialog', name: 'Collect dialog', kind: 'dialog', parent: '13_missing', url: '#missing', before: click('.collectbtn'), cropModal: true, src: ['src/renderer/app.js', 'async function openCollectModal('] },
  { id: '16_issues_problems', name: 'Issues: Problems', kind: 'page', parent: 'main_window', url: '#issues/problems', fixedHeight: true, size: [1440, 1200], src: ['src/renderer/app.js', 'views.problems = async'] },
  { id: '17_fix_dialog', name: 'Fix dialog', kind: 'dialog', parent: '16_issues_problems', url: '#issues/problems', before: click('.fixbtn'), cropModal: true, src: ['src/renderer/app.js', 'function openFixModal('] },
  { id: '18_issues_duplicates', name: 'Issues: Duplicates', kind: 'page', parent: 'main_window', url: '#issues/duplicates', fixedHeight: true, src: ['src/renderer/app.js', 'views.duplicates = async'] },
  { id: '19_quality', name: 'Quality', kind: 'page', parent: 'main_window', url: '#quality', fixedHeight: true, size: [1440, 1200], src: ['src/renderer/app.js', 'views.quality = async'] },
  { id: '20_upgrades', name: 'Upgrade candidates', kind: 'page', parent: 'main_window', url: '#upgrades', fixedHeight: true, src: ['src/renderer/app.js', 'views.upgrades = async'] },
  { id: '21_reclaim', name: 'Reclaim space', kind: 'page', parent: 'main_window', url: '#reclaim', fixedHeight: true, src: ['src/renderer/app.js', 'views.reclaim = async'] },
  { id: '22_ratings', name: 'Ratings', kind: 'page', parent: 'main_window', url: '#ratings', fixedHeight: true, src: ['src/renderer/app.js', 'views.ratings = async'] },
  { id: '23_watch_tonight', name: 'Watch tonight', kind: 'page', parent: 'main_window', url: '#tonight', before: click('#tPick'), fixedHeight: true, size: [1440, 1100], src: ['src/renderer/app.js', 'views.tonight = async'] },
  { id: '24_watched', name: 'Watched', kind: 'page', parent: 'main_window', url: '#watched', maxHeight: 3600, src: ['src/renderer/app.js', 'views.watched = async'] },
  { id: '25_requests', name: 'Requests', kind: 'page', parent: 'main_window', url: '#requests', fixedHeight: true, src: ['src/renderer/app.js', 'views.requests = async'] },
  { id: '26_request_phone_page', name: 'Request page for phones', kind: 'page', parent: null, path: '/request', size: PHONE, fixedHeight: true, src: ['src/renderer/request.html', '<form'] },
  // ---- maintenance
  { id: '27_change_log', name: 'Change log', kind: 'page', parent: 'main_window', url: '#changes', fixedHeight: true, src: ['src/renderer/app.js', 'views.changes = async'] },
  { id: '28_movie_names', name: 'Movie names', kind: 'page', parent: 'main_window', url: '#movienames', maxHeight: 2600, src: ['src/renderer/app.js', 'views.movienames = async'] },
  { id: '29_rename_tv_anime', name: 'Rename TV / anime', kind: 'page', parent: 'main_window', url: '#rename', before: `{ const n = document.querySelector('#selN'); if (n) n.value = 5; } ` + click('#selNext'), fixedHeight: true, size: [1440, 1100], src: ['src/renderer/app.js', 'views.rename = async'] },
  { id: '30_rename_confirm', name: 'Rename confirmation dialog', kind: 'dialog', parent: '29_rename_tv_anime', url: '#rename', before: `{ const n = document.querySelector('#selN'); if (n) n.value = 5; } ` + click('#selNext') + click('#apply'), cropModal: true, after: click('#rc'), src: ['src/renderer/app.js', "$('#apply').onclick = async"] },
  { id: '31_csv_export', name: 'CSV export', kind: 'page', parent: 'main_window', url: '#export', fixedHeight: true, src: ['src/renderer/app.js', 'views.export = async'] },
  // ---- app
  { id: '32_system', name: 'System', kind: 'page', parent: 'main_window', url: '#system', wait: 1500, src: ['src/renderer/app.js', 'views.system = async'] },
  { id: '33_family_portal_admin', name: 'Family portal (administration)', kind: 'page', parent: 'main_window', url: '#family', src: ['src/renderer/app.js', 'views.family = async'] },
  { id: '34_family_invite_created', name: 'Invite created, with its QR code', kind: 'mode', parent: '33_family_portal_admin', url: '#family', before: `document.querySelector('#fvName').value = 'Jordan';` + click('#fvAdd'), afterWait: 1500, crop: { from: '#fvName', to: '#fvTable' }, src: ['src/renderer/app.js', 'const showLinks = (r, what)'] },
  { id: '35_log', name: 'Log', kind: 'page', parent: 'main_window', url: '#log', fixedHeight: true, src: ['src/renderer/app.js', 'views.log = async'] },
  { id: '36_security', name: 'Security', kind: 'page', parent: 'main_window', url: '#security', src: ['src/renderer/app.js', 'views.security = async'] },
  { id: '37_two_factor_setup', name: 'Two-factor setup', kind: 'mode', parent: '36_security', url: '#security', before: click('#totpStart'), afterWait: 1200, crop: { from: '#totpBox', to: '#totpBox' }, src: ['src/renderer/app.js', "$('#totpStart')"] },
  { id: '38_settings_appearance_roots', name: 'Settings: Appearance and Library roots', kind: 'section', parent: 'settings_page', url: '#settings', maxHeight: 12000, wait: 1500, before: only(["Appearance", "Library roots"]), crop: { from: '.stabs', to: '#save' }, src: ['src/renderer/app.js', '<h2>Appearance</h2>'] },
  { id: '39_settings_scanning', name: 'Settings: Scanning, ffprobe, lookups and folder watch', kind: 'section', parent: 'settings_page', url: '#settings', maxHeight: 12000, wait: 1500, before: only(["Scanning", "ffprobe", "Expected episodes", "Folder watch"]), crop: SEC, src: ['src/renderer/app.js', '<h2>Scanning</h2>'] },
  { id: '40_settings_schedules', name: 'Settings: Schedules', kind: 'section', parent: 'settings_page', url: '#settings', maxHeight: 12000, wait: 1500, before: only(["Schedules"]), crop: SEC, src: ['src/renderer/app.js', '<h2>Schedules</h2>'] },
  { id: '41_settings_data_posters', name: 'Settings: Data, backups and posters', kind: 'section', parent: 'settings_page', url: '#settings', maxHeight: 12000, wait: 1500, before: only(["Data", "Posters"]), crop: SEC, src: ['src/renderer/app.js', '<h2>Data</h2>'] },
  { id: '42_settings_updates_notifications', name: 'Settings: Updates and notifications', kind: 'section', parent: 'settings_page', url: '#settings', maxHeight: 12000, wait: 1500, before: only(["Updates", "Notifications"]), crop: SEC, src: ['src/renderer/app.js', '<h2>Updates</h2>'] },
  { id: '43_settings_plex', name: 'Settings: Plex', kind: 'section', parent: 'settings_page', url: '#settings', maxHeight: 12000, wait: 1500, before: only(["Plex"]), crop: SEC, src: ['src/renderer/app.js', '<h2>Plex</h2>'] },
  { id: '44_settings', name: 'Settings: Renaming, adult content, quality thresholds and CSV export', kind: 'section', parent: 'settings_page', url: '#settings', maxHeight: 12000, wait: 1500, before: only(["Renaming", "Adult content", "Quality thresholds", "CSV export"]), crop: SEC, src: ['src/renderer/app.js', '<h2>Renaming'] },
  { id: '45_restore_dialog', name: 'Restore from a backup dialog', kind: 'dialog', parent: '41_settings_data_posters', url: '#settings', maxHeight: 12000, before: click('#bkRestore'), afterWait: 1200, cropModal: true, after: click('#rsCancel'), src: ['src/renderer/app.js', "$('#bkRestore').onclick"] },
  { id: '46_folder_browser', name: 'Folder browser dialog (web server)', kind: 'dialog', parent: '41_settings_data_posters', url: '#settings', maxHeight: 12000, before: fakeShares(path.join(DATA, 'library').replace(/\\/g, '/')) + click('#pickBk'), afterWait: 1500, cropModal: true, after: click('#fbCancel'), src: ['src/renderer/app.js', 'fbPath'] },
  { id: '38b_settings_network_shares', name: 'Settings: Network shares (Raspberry Pi server)', kind: 'section', parent: 'settings_page', url: '#settings', maxHeight: 12000, wait: 1500, before: fakeShares(PI_MOUNT) + `await paintShares(document.querySelector('#sharesBox'));` + only(['Network shares']), crop: SEC, src: ['src/renderer/app.js', 'async function paintShares(box, after)'] },
  { id: '46b_connect_share', name: 'Connect a network share dialog', kind: 'dialog', parent: '38b_settings_network_shares', url: '#settings', maxHeight: 12000, wait: 1500, before: fakeShares(PI_MOUNT) + `connectShareDialog(); await new Promise(r => setTimeout(r, 700)); const m = document.querySelector('#modalCard'); m.querySelector('#csHost').value = '192.168.1.50'; m.querySelector('#csUser').value = 'media'; m.querySelector('#csPass').value = 'not-a-real-password'; m.querySelector('#csFind').click(); await new Promise(r => setTimeout(r, 700)); const box = m.querySelectorAll('#csOut input')[1]; if (box) box.checked = true;`, afterWait: 900, cropModal: true, after: click('#csCancel'), src: ['src/renderer/app.js', 'function connectShareDialog()'] },
  { id: '49_welcome_guide', name: 'Welcome guide', kind: 'page', parent: 'main_window', url: '#welcome', wait: 1500, maxHeight: 2600, before: fakeShares(PI_MOUNT) + `await views.welcome(); document.querySelectorAll('.wz-path').forEach(i => { i.value = '/mnt/medialedger/Media/' + ({ tv: 'TV Shows', anime: 'Anime', movie: 'Movies' })[i.dataset.t]; }); await new Promise(r => setTimeout(r, 600));`, src: ['src/renderer/app.js', 'views.welcome = async'] },
  { id: '47_about', name: 'About', kind: 'page', parent: 'main_window', url: '#about', fixedHeight: true, src: ['src/renderer/app.js', 'views.about = async'] },
  { id: '48_theme_example', name: 'A colour theme (Gunmetal)', kind: 'mode', parent: '38_settings_appearance_roots', url: '#movies', theme: 'gunmetal', wall: true, fixedHeight: true, src: ['src/renderer/theme.js', 'medialedger.theme'] },
  // ---- the family portal: a separate site
  { id: '50_portal_library', name: 'Family portal: Library', kind: 'page', parent: 'portal', portal: true, url: '#library', size: PHONE, fixedHeight: true, before: `{ const b = document.querySelector('#libSeg [data-t=tv]'); if (b) b.click(); } await new Promise(r => setTimeout(r, 1500));`, src: ['src/portal/portal.js', 'async function library()'] },
  { id: '51_portal_title', name: 'Family portal: a series', kind: 'page', parent: '50_portal_library', portal: true, url: `#title/tv/${enc(show.tv)}`, size: PHONE, fixedHeight: true, wait: 1500, src: ['src/portal/portal.js', 'async function title(type, key)'] },
  { id: '52_portal_tonight', name: 'Family portal: Tonight', kind: 'page', parent: 'portal', portal: true, url: '#tonight', size: PHONE, fixedHeight: true, wait: 1500, before: click('#tPick'), src: ['src/portal/portal.js', 'async function tonight()'] },
  { id: '53_portal_requests', name: 'Family portal: Requests', kind: 'page', parent: 'portal', portal: true, url: '#requests', size: PHONE, fixedHeight: true, wait: 1500, before: `document.querySelector('#rTitle').value = ${JSON.stringify('PLACEHOLDER')};`, src: ['src/portal/portal.js', 'async function requests()'] },
  { id: '54_portal_settings', name: 'Family portal: Settings', kind: 'page', parent: 'portal', portal: true, url: '#menu', size: PHONE, fixedHeight: true, src: ['src/portal/portal.js', 'function menu()'] },
  // ---- the owner's page on the family portal
  { id: '55_portal_admin_requests', name: 'Portal admin: Requests', kind: 'page', parent: 'portal', portalAdmin: true, url: '#requests', size: PHONE, fixedHeight: true, wait: 1500, src: ['src/portal/admin.js', 'async function requests()'] },
  { id: '56_portal_admin_invites', name: 'Portal admin: Invites', kind: 'page', parent: 'portal', portalAdmin: true, url: '#invites', size: PHONE, fixedHeight: true, wait: 1500, src: ['src/portal/admin.js', 'async function invites()'] },
  { id: '57_portal_admin_status', name: 'Portal admin: Status', kind: 'page', parent: 'portal', portalAdmin: true, url: '#status', size: [420, 2400], fixedHeight: true, wait: 2500, src: ['src/portal/admin.js', 'async function status()'] },
];

// crop ranges for the Settings sections are filled in from the controls files, which know the element ids
const controls = {};
const dir = path.join(__dirname, 'controls');
if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort()) Object.assign(controls, require(path.join(dir, f)));
for (const s of list) { const c = controls[s.id]; if (!c) continue; Object.assign(s, c); }
// controls that later versions added to screens that already existed
for (const s of list) { const more = (controls.__additions || {})[s.id]; if (more) s.controls = [...(s.controls || []), ...more]; }
// the request form on the portal is pre-filled with a title that is in the demo library, so the "already in the library" note shows
for (const s of list) if (s.id === '53_portal_requests') s.before = `document.querySelector('#rTitle').value = ${JSON.stringify(show.anime)}; document.querySelector('#rKind').value = 'anime';` + click('#rSend') + `await new Promise(r => setTimeout(r, 1200));`;

module.exports = { screens: list, REPO, DATA, show, multi };
