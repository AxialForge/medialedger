'use strict';
// Builds USER_MANUAL.docx. The per-page sections and their callout tables are generated from screens.js and
// uncaptured.js, the same lists the screenshots and ui_inventory.json come from.
//
//   node docs/_tools/release-docs/build-user-manual.js <release-package-dir>
const fs = require('fs');
const path = require('path');
const L = require('./docx-lib.js');
const { H1, H2, H3, P, note, warn, code, bullets, steps, table, picture, cover, toc, write } = L;
const { screens } = require('./screens.js');
const extra = require('./uncaptured.js');

const OUT = path.resolve(process.argv[2]);
const SHOTS = path.join(OUT, 'screenshots');
const pkg = require(path.join(L.REPO, 'package.json'));
const V = pkg.version;
const BUILD = process.env.BUILD_DATE || '2026-09-30';
const DOC = new Date().toISOString().slice(0, 10);
const byId = Object.fromEntries(screens.map(s => [s.id, s]));
const shot = (id, caption, annotated = true, o) => picture(path.join(SHOTS, `${id}_${annotated ? 'annotated' : 'clean'}.png`), caption, o);
const phone = { maxW: 300, maxH: 640 };

const CALLOUT_W = [500, 1750, 1250, 2700, 1500, 1100, 1560];
const calloutTable = (s, numbered = true) => table([numbered ? '#' : '', 'Control name', 'Type', 'What it does', 'Inputs and limits', 'Default', 'Notes'],
  (s.controls || []).map((c, i) => [numbered ? String(i + 1) : '–', `**${c.name}**`, c.type, c.does, c.inputs || '–', c.def || '–', c.notes || '–']), CALLOUT_W, { size: 16 });

let figure = 0;
function pageSection(id, num) {
  const s = byId[id]; if (!s) throw new Error('no screen ' + id);
  const isPhone = s.size && s.size[0] < 600;
  const out = [H2(`${num} ${s.name}`)];
  out.push(P(s.purpose || ''));
  out.push(...shot(id, `Figure ${++figure}. ${s.name}. The numbers match the table below.`, true, isPhone ? phone : undefined));
  out.push(H3('Controls'), calloutTable(s));
  if (s.workflow && s.workflow.length) out.push(H3('Typical workflow'), ...steps(s.workflow));
  if (s.features && s.features.length) out.push(H3('Features'), ...bullets(s.features));
  if (s.edge && s.edge.length) out.push(H3('Edge cases'), ...bullets(s.edge));
  if (s.errors && s.errors.length) out.push(H3('Messages and what they mean'), table(['Message', 'Meaning and what to do'], s.errors.map(([m, d]) => [`\`${m}\``, d]), [3600, 5760], { size: 17 }));
  return out;
}

const body = [];
// ---------------------------------------------------------------- 1 cover, contents
body.push(cover('User Manual', 'Every page, dialog and setting, with numbered screenshots', V, { build: BUILD, doc: DOC }, [
  'MediaLedger inventories the video files on a network share, tracks what changes between scans, finds what is missing or weak, and keeps your corrections. It runs as a Windows desktop application and as a web server on a Raspberry Pi; both show the same pages.',
  'The screenshots in this manual show a fictional library generated for the purpose. No title, person or address in them is real.',
]));
body.push(toc());

// ---------------------------------------------------------------- 2 install
body.push(H1('1. Installing and first launch'));
body.push(H2('1.1 System requirements'));
body.push(table(['', 'Desktop application', 'Web server'], [
  ['Computer', 'A 64-bit Windows computer. The installer is built for x64 only.', 'Raspberry Pi 4B or 5 recommended; a Pi 3 works on a 64-bit system but scans slowly. Any Linux computer with Node 22 also works.'],
  ['Operating system', 'Windows 10 or 11, 64-bit.', 'Raspberry Pi OS Lite (64-bit), Trixie or newer. 32-bit is not supported.'],
  ['Storage', 'About 300 MB for the application. The database for a library of 25,000 files is about 25 MB; posters about 100 MB.', '32 GB microSD (class A2) or a USB solid-state drive.'],
  ['Network', 'Access to the share that holds the media.', 'Ethernet on the same network as the file server. Port 8080 by default.'],
  ['Also needed', 'ffprobe (part of ffmpeg). The application offers to download it on first launch.', 'Installed by the installer: Node 22, ffmpeg, cifs-utils, smbclient, curl, openssl.'],
  ['Memory and processor', 'UNVERIFIED: no minimum has been measured. A scan uses one ffprobe process per parallel probe (8 by default).', 'UNVERIFIED: no minimum has been measured. Runs on a Pi 4 with 4 GB.'],
], [1700, 3830, 3830], { size: 17 }));
body.push(H2('1.2 Installing the desktop application'));
body.push(...steps(['Download `medialedger-' + V + '-setup.exe` from the Releases page of the project on GitHub.', 'Run it. The installer needs no questions answered and installs for the current user.', 'Windows may warn that the publisher is unknown, because the installer is not code-signed. Choose **More info**, then **Run anyway**.', 'MediaLedger starts when the installer finishes.']));
body.push(note('Data is kept apart from the program, in `%APPDATA%\\MediaLedger`. Updating, reinstalling or uninstalling never touches it.'));
body.push(H2('1.3 Installing the web server on a Raspberry Pi'));
body.push(...steps(['Flash Raspberry Pi OS Lite (64-bit) with SSH enabled and start the Pi.', 'Connect over SSH and run the installer:']));
body.push(...code('curl -fsSL https://raw.githubusercontent.com/AxialForge/medialedger/main/server/install.sh -o install.sh && sudo bash install.sh'));
body.push(...steps(['Type the address of the file server that holds the media, then a user name and password that may read it. The installer lists the shares that server offers.', 'Type the numbers of the shares to use (or `all`). Each is connected under `/mnt/medialedger/`.', 'Choose a web password of at least 8 characters.', 'Open `http://<address of the Pi>:8080` and sign in as `admin`. The welcome guide opens.']));
body.push(note('The separate document **Installing MediaLedger on a Raspberry Pi** goes through this step by step, with what the terminal shows at each question.'));
body.push(P('The installer is safe to run again. It creates a service that starts with the Pi, connects the shares, and installs these commands:'));
body.push(table(['Command', 'What it does'], [['`sudo medialedger-setup`', 'The questions again: connect more shares, set the password, show the addresses.'], ['`sudo medialedger-update`', 'Downloads the newest release, checks it, installs it and restarts. Data is untouched.'], ['`sudo medialedger --set-password`', 'Sets or resets the web password and signs everyone out.'], ['`sudo bash install.sh --update-only --port=8080`', 'Moves the service to another port.'], ['`sudo bash install.sh --auto-update`', 'Adds a nightly update at about 04:30. `--no-auto-update` removes it.']], [3900, 5460], { size: 17 }));
body.push(H2('1.4 First launch'));
body.push(P('A new installation opens the **welcome guide** instead of an empty Dashboard. It is one page with four steps:'));
body.push(...steps(['**Connect your storage.** On the Raspberry Pi server, sign in to the file server and tick its shares. On the desktop application there is nothing to connect.', '**Point at the folders.** Pick the folder for TV shows, for Anime and for Movies with **Browse**, or press **Find them for me**. Press **Save and check the folders**.', '**Check.** Every line should show a tick: ffprobe is installed, and each folder can be read.', '**First scan.** Press **Start the first scan**. It reads and measures every file, which takes a while; later scans only read what changed.', 'Press **Finish and open the dashboard**. Optional next: connect Plex, and set a backup folder, both under **Settings**.']));
body.push(...pageSection('49_welcome_guide', '1.4.1'));
body.push(...shot('00_sign_in', `Figure ${++figure}. The sign-in dialog of the web server.`, true));
body.push(calloutTable(byId['00_sign_in']));
body.push(H3('Messages and what they mean'), table(['Message', 'Meaning and what to do'], byId['00_sign_in'].errors.map(([m, d]) => [`\`${m}\``, d]), [3600, 5760], { size: 17 }));

// ---------------------------------------------------------------- 3 interface overview
body.push(H1('2. The interface'));
body.push(P(byId['01_main_window'].purpose));
body.push(...shot('01_main_window', `Figure ${++figure}. The main window. The numbers match the table below.`));
body.push(calloutTable(byId['01_main_window']));
body.push(H3('Finding your way'), ...steps(byId['01_main_window'].workflow));
body.push(...bullets(byId['01_main_window'].features), ...bullets(byId['01_main_window'].edge));
body.push(H2('2.1 The sidebar in full'));
body.push(P(extra.sidebar.purpose));
body.push(calloutTable(extra.sidebar, false));
body.push(H2('2.2 The three ways MediaLedger runs'));
body.push(table(['', 'What it is', 'Who uses it'], [['Desktop application', 'A window on your Windows computer. Reads and writes your own data folder.', 'You, at your desk.'], ['Web server', 'The same pages in a browser, served from a Raspberry Pi. Accounts, roles and a security log.', 'You and the people you give an account, on your network.'], ['Family portal', 'A separate, small, read-only site with its own address.', 'People you invite, anywhere.']], [2000, 4700, 2660], { size: 17 }));
body.push(H2('2.3 Colour themes'));
body.push(P(byId['48_theme_example'].purpose));
body.push(...shot('48_theme_example', `Figure ${++figure}. The Gunmetal theme.`, false));
body.push(...bullets(byId['48_theme_example'].features));

// ---------------------------------------------------------------- 4 one section per page
const chapters = [
  ['3. Library', ['02_dashboard', '03_dashboard_edit', '04_dashboard_add_card', '05_dashboard_card_options', '06_tv_shows', '07_poster_wall', '07b_poster_hover', '08_series_page', '09_movies', '10_movie_page', '11_web_videos', '12_adult']],
  ['4. Review', ['13_missing', '14_match_dialog', '15_collect_dialog', '16_issues_problems', '17_fix_dialog', '18_issues_duplicates', '19_quality', '20_upgrades', '21_reclaim', '22_ratings', '23_watch_tonight', '24_watched', '25_requests', '26_request_phone_page']],
  ['5. Maintenance', ['27_change_log', '28_movie_names', '29_rename_tv_anime', '30_rename_confirm', '31_csv_export']],
  ['6. Application', ['32_system', '33_family_portal_admin', '34_family_invite_created', '35_log', '36_security', '37_two_factor_setup', '47_about']],
  ['7. Settings', ['38_settings_appearance_roots', '38b_settings_network_shares', '46b_connect_share', '39_settings_scanning', '44_settings', '40_settings_schedules', '41_settings_data_posters', '45_restore_dialog', '46_folder_browser', '42_settings_updates_notifications', '43_settings_plex']],
  ['8. The family portal', ['50_portal_library', '51_portal_title', '52_portal_tonight', '53_portal_requests', '54_portal_settings', '55_portal_admin_requests', '56_portal_admin_invites', '57_portal_admin_status']],
];
const intro = {
  '3. Library': 'What you have. The Dashboard summarises it; the list pages show it title by title.',
  '4. Review': 'What needs attention, and what to do next.',
  '5. Maintenance': 'The tools that change things. The two rename pages are the only part of MediaLedger that writes to your share.',
  '6. Application': 'The application itself: the machine it runs on, who may use it, and what it has been doing.',
  '7. Settings': 'Everything on the Settings page, section by section. The page has a tab for each group of sections (Library, Episodes and quality, Automation, Connections, Renaming, Backup and data, Appearance), an **All** tab, and a **Find a setting** box; the pictures below each show a few sections with the rest hidden. Nothing on the page takes effect until **Save settings** at the bottom is pressed. The values are stored in `settings.json` in the data folder; section 10 lists every one.',
  '8. The family portal': 'A separate site for the people you invite. It is set up from the Family portal page (section 6) and reached at its own address. These are the pages a visitor sees, shown at the size of a phone, followed by the three pages of the owner\'s own sign-in at `/admin`.',
};
const placed = new Set(['00_sign_in', '01_main_window', '48_theme_example', '49_welcome_guide']);
for (const [title, ids] of chapters) {
  body.push(H1(title), P(intro[title]));
  const n = title.split('.')[0];
  ids.forEach((id, i) => { body.push(...pageSection(id, `${n}.${i + 1}`)); placed.add(id); });
}
const unplaced = screens.filter(s => !placed.has(s.id)).map(s => s.id);
if (unplaced.length) throw new Error('screens not in the manual: ' + unplaced.join(', '));

// ---------------------------------------------------------------- other dialogs
body.push(H1('9. Short dialogs'));
body.push(P('These dialogs have one or two buttons and appear in the middle of a task. They have no screenshot of their own.'));
extra.dialogs.forEach((d, i) => { body.push(H2(`9.${i + 1} ${d.name}`), P(d.purpose), d.unreachable ? warn('This dialog is not reachable from the interface in version ' + V + '.') : null, calloutTable(d, false)); });

// ---------------------------------------------------------------- 5 workflows
body.push(H1('10. Common tasks from start to finish'));
const flows = [
  ['10.1 Find and fill the gaps in a series', ['Open **Missing** and sort by Missing.', 'If the series is listed against the wrong title, press **Match**, search, and pick the right one.', 'If you joined the series late, press **Collect** and choose the first episode you want.', 'Open the series page to see exactly which episodes are red.', 'Add the files to the share, then press **Scan now**. The gaps close by themselves.'], '08_series_page', 'A series page: green is on hand, red is missing.'],
  ['10.2 Tidy the names of a group of episodes', ['Open **Settings**, **Renaming**, switch renaming on, and save.', 'Open **Rename TV/anime**. Choose the name parts with the chips.', 'Set the number beside **Select next** to a small group, for example 5, and press it.', 'Press **Dry run** and read the result.', 'Press **Rename**, read the list in the confirmation, and press **Rename now**.', 'Press **Select next** again for the following group.', 'If something went wrong, press **Undo** on the batch in the Batches table.'], '29_rename_tv_anime', 'Five files ticked with Select next.'],
  ['10.3 Arrange the Dashboard', ['Press **Edit dashboard**.', 'Remove the cards you never read with the cross on their handle.', 'Press **Add card** and add the ones you want.', 'Drag cards into order and set their width with S, M, L and XL.', 'Press the gear on a number tile to set when it turns amber and red (choose **Advanced** under "Options shown" first).', 'Press **Done**.'], '03_dashboard_edit', 'The Dashboard in edit mode.'],
  ['10.4 Give a family member access', ['Open **Family portal**. Set the public address and press **Save**.', 'Tick **on** and press **Save**.', 'Type the name, choose an expiry, press **Create invite**.', 'Have them scan the QR code with their phone, or send them the link.', 'Their requests appear under **Requests**, marked with their name.', 'To end their access, press **Revoke** on their row.'], '34_family_invite_created', 'The invite with its QR code, shown once.'],
  ['10.5 Back up, and restore', ['Open **Settings**, **Data**. Tick the daily backup, type the folder, press **Back up there now**.', 'Save the settings. A set is written every day at the time under **Schedules**.', 'To restore: press **Restore**, pick the set by date, choose whether settings and accounts should come back too.', 'Press **Restore and restart**. The application restarts on the restored data; the replaced files are kept in a pre-restore folder.'], '45_restore_dialog', 'The Restore dialog.'],
  ['10.6 Find out why something did not happen', ['Open **Settings**, **Schedules** and look for a red "overdue" badge and the result of the last run.', 'Open **Log**, type a word such as plex or backup, and switch to **problems only**.', 'Press **Run now** on the job and watch the log.'], '35_log', 'The Log page.'],
];
for (const [t, st, id, cap] of flows) body.push(H2(t), ...steps(st), ...shot(id, `Figure ${++figure}. ${cap}`, false, byId[id].size && byId[id].size[0] < 600 ? phone : { maxH: 520 }));

// ---------------------------------------------------------------- 6 settings reference
body.push(H1('11. Settings reference'));
body.push(P('Every option on the Settings page and the pages that keep their own settings. "Stored in" says which file holds the value; all of them are in the data folder (`%APPDATA%\\MediaLedger` on the desktop, `/var/lib/medialedger` on the Raspberry Pi) unless the browser is named.'));
const setRows = [];
const storeOf = (id, c) => /theme/i.test(c.name) && /Colour/.test(c.name) ? 'The browser (local storage)' : id.startsWith('33_') ? '`portal.json`' : id.startsWith('36_') ? '`web.json`' : id.startsWith('05_') ? (/Options shown|threshold|Title|Size/.test(c.name) ? 'Account preferences: `web.json` (web server) or `settings.json` (desktop)' : '') : '`settings.json`';
for (const id of ['38_settings_appearance_roots', '39_settings_scanning', '44_settings', '40_settings_schedules', '41_settings_data_posters', '42_settings_updates_notifications', '43_settings_plex', '33_family_portal_admin', '36_security', '05_dashboard_card_options']) {
  const s = byId[id];
  for (const c of s.controls) { if (/^Button|^Table|^Tile|^Status|^Card$/.test(c.type)) continue; setRows.push([s.name.replace(/^Settings: /, ''), `**${c.name}**`, c.does, c.def || '–', storeOf(id, c)]); }
}
body.push(table(['Section', 'Option', 'What it does', 'Default', 'Stored in'], setRows, [1900, 1900, 2900, 1300, 1360], { size: 16 }));
body.push(H2('11.1 What is remembered in the browser only'));
body.push(table(['What', 'Where it is set'], [['Colour theme', 'Settings, Appearance (and the portal\'s Settings page)'], ['Table or poster wall', 'The Posters button of any list'], ['Trend period of the Dashboard', 'The period list above the cards'], ['Filters of Watch tonight, Watched and Reclaim space', 'On those pages'], ['The number beside "Select next"', 'The rename pages']], [4000, 5360], { size: 17 }));

// ---------------------------------------------------------------- 7 keyboard
body.push(H1('12. Keyboard shortcuts'));
body.push(P('MediaLedger is operated with the mouse or by touch. It defines no application-wide shortcuts and no menu of its own; the keys below work inside fields and dialogs.'));
body.push(table(['Key', 'Where', 'What it does'], extra.shortcuts.map(k => [`**${k.keys}**`, k.where, k.does]), [1400, 3400, 4560], { size: 17 }));
body.push(P('Standard browser and Windows keys apply as usual: Tab moves between fields, Space ticks a box, and in the desktop application F11 and the window keys behave as in any window.'));
body.push(table(['Not present', 'Note'], extra.absent.map(a => [a.what, a.note]), [2400, 6960], { size: 17 }));

// ---------------------------------------------------------------- 8 troubleshooting
body.push(H1('13. Troubleshooting and frequently asked questions'));
const faq = [
  ['The roots show "Share not mounted" on the Raspberry Pi.', 'The file server answers but the share is not mounted, usually after a restart. From version 1.12.1 the application nudges the mount itself and a watchdog mounts it within a minute. If it stays red, run `sudo mount /mnt/media` on the Pi and read the message.'],
  ['The site cannot be reached by its name, but works by address.', 'The name is not being resolved. A virtual private network on your computer often sends lookups to its own servers, which do not know names on your network. Add the name to the hosts file of the computer, or point the network at your router for lookups.'],
  ['The Watched page is empty.', 'Play history is pulled during a Plex sync. Run one under Settings, Plex, and set the sync timer under Schedules.'],
  ['The Missing page is dominated by one very long series.', 'Press Collect on that series and choose "from an episode onward", or mute it.'],
  ['A movie shows up that is really an episode.', 'It is listed under Issues, Problems, "Episodes filed under Movies". Move the file to a TV or anime folder.'],
  ['Plex reports hundreds of unmatched files.', 'Read the table under the last sync. "File is not in a scanned root" means a Plex library MediaLedger does not scan; "no path mapping covers this folder" means a mapping is missing.'],
  ['Create invite is greyed out.', 'Set a public or home address on the Family portal page and save first.'],
  ['The invite link says the site cannot be found.', 'A new Tailscale address takes about fifteen minutes to appear on the internet. The tiles on the Family portal page tell you when it works.'],
  ['Windows warns about the installer.', 'The installer is not code-signed. Choose More info, then Run anyway.'],
  ['Editing the Dashboard is slow.', 'Update to version 2.1.1 or newer, which no longer reloads the data on every edit.'],
  ['I forgot the web password.', 'On the Raspberry Pi run `sudo medialedger --set-password`.'],
  ['How do I move to a new computer or a new card?', 'Install MediaLedger, then use Restore with your latest backup set and tick settings and accounts.'],
  ['Does MediaLedger ever delete or move my media?', 'No. It renames files only on the two rename pages, only when you switch renaming on, and every rename can be undone. It never deletes media.'],
  ['Does anything leave my network?', 'Episode lookups go to TVmaze and AniList, poster lookups to the same two, and the update check to GitHub. Nothing about your library is sent; the lookups contain only series names.'],
];
body.push(table(['Question or symptom', 'Answer'], faq, [3300, 6060], { size: 17 }));
body.push(H2('13.1 Every message in one place'));
const allErr = []; for (const s of screens) for (const [m, d] of (s.errors || [])) allErr.push([`\`${m}\``, s.name, d]);
body.push(table(['Message', 'Where', 'Meaning and what to do'], allErr, [3000, 2000, 4360], { size: 16 }));

// ---------------------------------------------------------------- 9 glossary
body.push(H1('14. Glossary'));
body.push(table(['Term', 'Meaning'], [
  ['Root', 'A folder MediaLedger scans, with a type: TV, Anime, Movies, Web videos or Adult.'],
  ['Scan', 'Walking the roots to find files, then measuring new and changed files with ffprobe.'],
  ['Probe', 'Reading the technical details of one file with ffprobe: length, resolution, codecs, languages.'],
  ['Match', 'The online listing a series is compared with.'],
  ['Locked match', 'A match you chose; automatic lookups leave it alone.'],
  ['Collecting policy', 'What counts as missing for one series: everything, from an episode onward, or nothing.'],
  ['Fix', 'A correction of how a file is read, stored in the database and applied on every scan.'],
  ['Batch', 'One run of the rename tool over a group of files, checked as a whole, recorded and undoable.'],
  ['Dry run', 'A batch that records what would happen and changes nothing.'],
  ['Snapshot', 'One row a day describing the library, from which the trend cards are drawn.'],
  ['Card', 'One element of the Dashboard.'],
  ['Backup set', 'The files of one backup, sharing a date stamp: database, settings, and on the web server the accounts and portal files.'],
  ['Invite', 'Permission for one person to use the family portal, given as a link.'],
  ['Family portal', 'The separate read-only site for invited people.'],
  ['Role', 'What an account on the web server may do: administrator, standard or guest.'],
  ['Two-factor codes', 'Six-digit codes from an authenticator application, asked for after the password.'],
  ['Webhook', 'An address another program calls when something happens.'],
  ['Reverse proxy', 'A program such as Caddy that receives requests for several names on one machine and hands each to the right service.'],
  ['Sub, dub, dual', 'Original audio with subtitles; audio in your language; both audio tracks present.'],
  ['Square-root scale', 'A chart scale on which a small value is still visible beside a large one. The printed numbers are exact.'],
], [2400, 6960], { size: 17 }));

write(path.join(OUT, 'USER_MANUAL.docx'), body, { title: `MediaLedger ${V} User Manual`, header: `MediaLedger ${V} · User Manual` })
  .then(() => fs.writeFileSync(path.join(OUT, '.manual-figures.json'), JSON.stringify({ figures: figure, screens: screens.length, dialogsWithoutScreenshot: extra.dialogs.length })));
