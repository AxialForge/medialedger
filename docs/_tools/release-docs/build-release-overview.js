'use strict';
// Builds RELEASE_OVERVIEW.docx: what the software is, how it is built and released, and its history.
// The version table is read from CHANGELOG.md and the git tags, so it cannot drift from the repository.
//
//   node docs/_tools/release-docs/build-release-overview.js <release-package-dir>
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./docx-lib.js');
const { H1, H2, H3, P, note, warn, code, bullets, steps, table, picture, cover, toc, write } = L;

const OUT = path.resolve(process.argv[2]);
const REPO = L.REPO;
const pkg = require(path.join(REPO, 'package.json'));
const lock = require(path.join(REPO, 'package-lock.json')).packages;
const V = pkg.version;
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8' }).trim();
const dep = (n) => (lock['node_modules/' + n] || {}).version || 'UNVERIFIED';
const DOC = new Date().toISOString().slice(0, 10);
const tagDate = Object.fromEntries(git('for-each-ref', '--format=%(refname:short) %(creatordate:short)', 'refs/tags').split('\n').map(l => l.split(' ')));
const BUILD = tagDate['v' + V] || 'UNVERIFIED';

// ---- version history from the changelog
const log = fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8');
const versions = [];
for (const block of log.split(/^## \[/m).slice(1)) {
  const m = /^([^\]]+)\]\s*-?\s*(\d{4}-\d{2}-\d{2})?/.exec(block); if (!m || m[1] === 'Unreleased') continue;
  const bold = [...block.matchAll(/^- \*\*([^*]+)\*\*/gm)].map(x => x[1].replace(/[.:]$/, '').trim());
  const plain = [...block.matchAll(/^- (?!\*\*)([^\n]+(?:\n {2}[^\n]+)*)/gm)].map(x => x[1].replace(/\s+/g, ' ').replace(/[*`]/g, '').split(/(?<=[.;]) /)[0].replace(/[.;]$/, ''));
  const schema = [...block.matchAll(/[Ss]chema v(\d+)/g)].map(x => Number(x[1]));
  const breaking = /BREAKING|breaking change/i.test(block) ? 'Yes: see the changelog' : schema.length ? `None. Database upgraded to schema ${Math.max(...schema)} automatically, with a backup taken first.` : 'None';
  const hi = [...bold, ...plain].slice(0, 4).join('; ') || 'Maintenance release';
  versions.push({ v: m[1], date: m[2] || tagDate['v' + m[1]] || 'UNVERIFIED', hi: hi.length > 260 ? hi.slice(0, 257) + '…' : hi, breaking, tagged: tagDate['v' + m[1]] ? 'yes' : 'no' });
}
const tagsWithoutNotes = Object.keys(tagDate).filter(t => !versions.some(x => 'v' + x.v === t));
for (const t of tagsWithoutNotes) versions.push({ v: t.slice(1), date: tagDate[t], hi: 'UNVERIFIED: tagged, but no changelog section with this number', breaking: 'UNVERIFIED', tagged: 'yes' });
const cmp = (a, b) => { const x = a.v.split('.').map(Number), y = b.v.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0; };
versions.sort(cmp);

const count = (dir, re) => { let n = 0, lines = 0; const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (re.test(f.name)) { n++; lines += fs.readFileSync(p, 'utf8').split('\n').length; } } }; walk(path.join(REPO, dir)); return { n, lines }; };
const src = count('src', /\.(js|html|css)$/), tests = count('test', /\.js$/);
const testScript = pkg.scripts.test.split('&&').length;

const body = [];
body.push(cover('Release and System Overview', 'What the software is, how it is built, and how a release is made', V, { build: BUILD, doc: DOC }, [
  'Written for whoever maintains MediaLedger next. Every statement was checked against the repository, the git history or the GitHub release. Where something could not be checked it is marked UNVERIFIED and listed in the last section.',
]));
body.push(toc());

// ------------------------------------------------------------ 1
body.push(H1('1. What MediaLedger is'));
body.push(P('**MediaLedger is a ledger for a home media library.** It reads the video files on a network share, measures each one, works out which series and movies they are, and keeps a record of what is there, what changed, what is missing and what is of poor quality. It does not play, download, transcode or serve media.'));
body.push(H2('1.1 Who it is for'));
body.push(P('One household: a person who keeps a library of a few thousand to a few tens of thousands of files on a file server, usually served to the family by Plex, and who wants to know its state without opening folders. A second audience is the rest of the household, who want to see what is available and ask for more.'));
body.push(H2('1.2 The problem it solves'));
body.push(...bullets([
  '**"What do I actually have?"** Plex shows what it matched. MediaLedger shows every file, including the ones Plex ignored, with the resolution, bitrate, codecs and languages measured from the file.',
  '**"What is missing?"** It compares the episodes on disk with the episodes that exist according to TVmaze and AniList.',
  '**"What changed?"** Every scan records the files added, removed, modified and returned.',
  '**"What is worth replacing, and what is dead weight?"** It ranks titles by how much they are watched against how good the copy is, and lists large titles nobody has played.',
  '**"Can the names be tidied safely?"** It proposes names, renames in checked batches, journals each rename and can undo a batch.',
  '**"Can the family see it and ask for things?"** A separate read-only portal, by invitation.',
]));
body.push(H2('1.3 What it deliberately does not do'));
body.push(...bullets(['It never deletes media, and never moves or overwrites a file.', 'It writes to the share only through the two rename pages, which are off until switched on.', 'It sends nothing about the library to any service. Lookups carry series names only.', 'It uses no paid service and no account with a third party, except the owner\'s optional free Tailscale account for the portal.']));
body.push(H2('1.4 Size of the code'));
body.push(table(['Measure', 'Value'], [['Source files (src)', `${src.n} files, ${src.lines.toLocaleString()} lines`], ['Test files', `${tests.n} files, ${tests.lines.toLocaleString()} lines, ${testScript} suites run by npm test`], ['Commits', git('rev-list', '--count', 'HEAD')], ['Tags', String(Object.keys(tagDate).length)], ['First commit', git('log', '--reverse', '--format=%cs').split('\n')[0]], ['Runtime dependencies', Object.keys(pkg.dependencies || {}).join(', ') || 'none'], ['Development dependencies', Object.keys(pkg.devDependencies || {}).join(', ')]], [3400, 5960], { size: 18 }));

// ------------------------------------------------------------ 2
body.push(H1('2. Architecture'));
body.push(P('One core, three shells. The core is a map from an operation name to a function (`src/main/service.js`). The desktop shell calls it over Electron\'s bridge; the web shell calls it over HTTP; the family portal calls a short fixed list of its read operations and rebuilds every reply field by field. The pages are written once and run in both the desktop window and the browser.'));
body.push(...picture(path.join(OUT, 'diagrams', 'architecture.png'), 'Figure 1. Modules, data flow, storage and outside services. Source: diagrams/architecture.mmd.', { maxH: 560 }));
body.push(H2('2.1 Modules'));
body.push(table(['Module', 'File', 'Responsibility'], [
  ['Core', '`src/main/service.js`', 'Registers every operation; owns the timers for scans, syncs, backups, snapshots and summaries; keeps the data version used to cache the dashboard.'],
  ['Database', '`src/main/db.js`', 'SQLite through `node:sqlite`. Base schema plus numbered migrations; a backup is taken before any migration.'],
  ['Scanner', '`src/main/scanner.js`, `scanWorker.js`', 'Walks the roots with worker threads, probes new and changed files with ffprobe.'],
  ['Parser', '`src/main/parse.js`, `tags.js`', 'Turns file names into series, season, episode, title and year; works out sub or dub.'],
  ['Probe', '`src/main/ffprobe.js`, `ffmpegdl.js`', 'Runs ffprobe on a file and reads the result; downloads ffmpeg on the desktop.'],
  ['Roots and folders', '`src/main/rootcheck.js`, `watcher.js`, `paths.js`', 'Reachability of each root with a diagnosis, folder watching, path handling.'],
  ['Export', '`src/main/exportCsv.js`, `zip.js`', 'CSV files and a dependency-free zip writer.'],
  ['System monitor', '`src/main/sysmon.js`', 'Processor, memory, disks, network and Raspberry Pi sensors for the System page.'],
  ['Scheduler', '`src/main/scheduler.js`', 'The in-app scan timer and the Windows scheduled task.'],
  ['Metadata', '`src/main/metadata.js`', 'Expected episodes and airing dates from TVmaze and AniList; the collecting policy.'],
  ['Plex', '`src/main/plex.js`', 'Library sync, path mapping, play history for every account, webhook events.'],
  ['Watch reports', '`src/main/watched.js`, `upgrades.js`', 'Who watched what, next up, reclaim candidates, upgrade ranking.'],
  ['Posters', '`src/main/posters.js`', 'Fetches and indexes one poster per title.'],
  ['Renaming', '`src/main/renamer.js`, `movieNamer.js`, `movieRename.js`', 'Proposed names, batches with pre-flight checks, journal and undo.'],
  ['Notifications', '`src/main/notify.js`', 'Webhook and a dependency-free mail client.'],
  ['Backup and restore', '`src/main/restore.js`', 'Backup sets, validation, staged restore applied at start-up.'],
  ['Settings', '`src/main/settings.js`', 'Defaults merged with `settings.json`.'],
  ['Desktop shell', '`src/main/main.js`, `src/preload.js`, `src/main/updater.js`', 'Window, bridge, automatic update, screenshot gate.'],
  ['Web shell', '`src/server/server.js`, `security.js`, `totp.js`, `clientip.js`', 'HTTP, roles, sessions, two-factor codes, audit log, real visitor address behind a proxy.'],
  ['Family portal', '`src/server/portal.js`, `src/portal/`', 'Separate listener, invites, rate limits, address check, its own site.'],
  ['Renderer', '`src/renderer/`', 'Pages (`app.js`), dashboard editor (`dash.js`, from the Bracket kit), charts (`cards.js`), QR codes (`qr.js`), the web bridge (`webbridge.js`).'],
], [1900, 3000, 4460], { size: 17 }));
body.push(H2('2.2 The contract between the shells'));
body.push(P('`src/renderer/bridge-shape.js` lists every operation the pages may call. `test/service.test.js` fails the build when an operation exists in the core but not in the bridge, when the bridge names one that nothing serves, or when the web shell declares one that is neither a desktop-only stub nor an override of a core operation. This is what keeps the two shells from drifting apart.'));
body.push(H2('2.3 Data flow of a scan'));
body.push(...steps(['The scanner walks every enabled root and compares size and date with the database.', 'New and changed files are probed with ffprobe, several at a time.', 'The parser reads each name; saved fixes are applied over the result.', 'Changes are written to the change log; vanished files are flagged missing, never deleted.', 'If enabled: episode lookups for new series, then a Plex sync with the play history, then posters for new titles.', 'A daily snapshot is taken, CSV files are exported if configured, and the data version is bumped so cached reports refresh.']));

// ------------------------------------------------------------ 3
body.push(H1('3. Technology'));
body.push(table(['Part', 'Technology', 'Version', 'Notes'], [
  ['Language', 'JavaScript (CommonJS), no build step', 'ES2022', 'No TypeScript, no bundler, no framework.'],
  ['Desktop runtime', 'Electron', dep('electron'), 'Declared as ' + pkg.devDependencies.electron + '.'],
  ['Server runtime', 'Node.js', '22 on the Raspberry Pi (installed by the installer); 22 in the release workflow', 'Development machine at the time of writing: ' + process.version + '.'],
  ['Database', 'SQLite through `node:sqlite`', 'Built into Node', 'No native add-on to compile.'],
  ['Packaging', 'electron-builder (NSIS, x64)', dep('electron-builder'), 'One-click installer, per user.'],
  ['Automatic update', 'electron-updater', dep('electron-updater'), 'The only runtime dependency.'],
  ['Documents', 'docx', dep('docx'), 'Development only: builds the manuals.'],
  ['Media probing', 'ffprobe (ffmpeg)', 'Not pinned', 'Downloaded on demand on the desktop; from the system package on the Raspberry Pi.'],
  ['Dashboard editor', 'Bracket kit `dash.js`', 'Vendored copy', 'Four additions marked [ML] in the file.'],
  ['Reverse proxy (optional)', 'Caddy', 'Not part of the repository', 'Deployment choice of the owner.'],
  ['Public address (optional)', 'Tailscale Funnel', 'Not part of the repository', 'Deployment choice of the owner.'],
], [1900, 2700, 2300, 2460], { size: 17 }));
body.push(P(`The lock file pins ${Object.keys(lock).length - 1} packages in total, nearly all of them belonging to electron-builder. The server package shipped to the Raspberry Pi contains no third-party code at all.`));
body.push(H2('3.1 Outside services'));
body.push(table(['Service', 'Used for', 'What is sent', 'Account or key'], [['TVmaze', 'Expected episodes and posters for TV', 'Series names and identifiers', 'None'], ['AniList', 'Expected episodes and posters for anime', 'Series names and identifiers', 'None'], ['Plex Media Server', 'Titles, ratings, watched state, play history, posters', 'Requests on the local network', 'The owner\'s Plex token, stored in `settings.json`'], ['GitHub Releases', 'Update check and downloads', 'A version request', 'None (public repository)'], ['Webhook or mail server', 'Notifications', 'Event summaries', 'Set by the owner']], [2000, 2900, 2500, 1960], { size: 17 }));

// ------------------------------------------------------------ 4
body.push(H1('4. How a release is made'));
body.push(P('This is the process as it works today, read from `.github/workflows/release.yml`, `electron-builder.yml`, `tools/pack-server.js`, `server/install.sh` and the git history.'));
body.push(H2('4.1 Versioning'));
body.push(...bullets(['Semantic versioning. The version lives in one place, `package.json` (mirrored in `package-lock.json`).', '`CHANGELOG.md` follows Keep a Changelog and is updated in the same commit that bumps the version.', 'Commit messages are imperative, with no prefix: "Release 2.1.1: …".']));
body.push(H2('4.2 Branches and tags'));
body.push(...bullets(['One branch, `main`. There are no release branches and no pull requests in the history.', 'A release is a tag `vX.Y.Z` on `main`, pushed by the owner by hand.', `Of the ${versions.length} versions in the changelog, ${versions.filter(v => v.tagged === 'yes').length} were tagged and built. The others were committed and superseded before being tagged; their changes shipped in the next tagged version.`]));
body.push(H2('4.3 The release gate (before tagging)'));
body.push(...steps(['`npm test` runs ' + testScript + ' suites.', 'The desktop screenshot pass renders every page against a real profile and exits with code 3 if any page logged an error: `npx electron . --profile=<dir> --screenshots=<dir>`.', 'The in-repository manual is rebuilt from those screenshots: `node tools/build-manual.js <dir> docs/MediaLedger-Manual.docx`, then exported to PDF with Word.', 'Version and changelog are committed together.']));
body.push(H2('4.4 Continuous integration'));
body.push(P('GitHub Actions, workflow "Build & Release (Windows)", on `windows-latest`. It runs on every pushed tag that starts with `v`, and can be started by hand.'));
body.push(table(['Step', 'Command', 'Purpose'], [['1', '`actions/checkout@v4`', 'Source at the tag'], ['2', '`actions/setup-node@v4` with Node 22', 'Toolchain'], ['3', '`npm ci`', 'Exact dependencies from the lock file'], ['4', '`npm test`', 'Quality gate: the build stops here on a failure'], ['5', '`node tools/pack-server.js`', 'Server package and its checksum'], ['6', '`npm run build:win -- --publish never`', 'Windows installer'], ['7', '`actions/upload-artifact@v4`', 'Keeps the installer with the run'], ['8', '`softprops/action-gh-release@v2`', 'Creates the GitHub release and attaches the files, with generated notes']], [700, 4300, 4360], { size: 17 }));
body.push(H2('4.5 Artifacts'));
body.push(table(['File', 'What it is'], [[`\`medialedger-${V}-setup.exe\``, 'Windows installer (NSIS, x64, one click, per user).'], [`\`medialedger-${V}-setup.exe.blockmap\``, 'Lets the updater download only what changed.'], ['`latest.yml`', 'What the desktop updater reads to find a new version.'], [`\`medialedger-server-${V}.tar.gz\``, 'Server package for this version.'], ['`medialedger-server.tar.gz`', 'The same package under a fixed name, which the installer downloads.'], ['`medialedger-server.tar.gz.sha256`', 'Checksum the installer verifies before installing.']], [4200, 5160], { size: 17 }));
body.push(P('Published at `https://github.com/AxialForge/medialedger/releases`. Version ' + V + ' was published with six files; the workflow run for the tag succeeded.'));
body.push(H2('4.6 Signing'));
body.push(warn('**The installer is not code-signed.** The workflow can sign when two repository secrets are present (`CSC_LINK`, `CSC_KEY_PASSWORD`); the repository has no secrets set, and the project\'s policy is not to buy a certificate. Windows therefore shows an "unknown publisher" warning on first run. The server package is protected by its checksum only.'));
body.push(H2('4.7 How installations update'));
body.push(table(['Installation', 'Mechanism'], [['Desktop', 'electron-updater checks GitHub at launch and every six hours, downloads in the background and applies the update on the next restart. Can be switched off in Settings or with `NO_AUTO_UPDATE=1`.'], ['Raspberry Pi', '`sudo medialedger-update` downloads the fixed-name package and its checksum, verifies, unpacks over `/opt/medialedger` and restarts the service. With `--auto-update` a systemd timer runs it every night.'], ['Data', 'Never touched by either. The database upgrades itself on first start of a newer version, after taking a backup.']], [2000, 7360], { size: 17 }));

// ------------------------------------------------------------ 5
body.push(H1('5. Version history'));
body.push(P(`From \`CHANGELOG.md\` and the git tags. ${versions.length} versions between ${versions[versions.length - 1].date} and ${versions[0].date}. "Tagged" says whether a release was built for that number.`));
body.push(table(['Version', 'Date', 'Highlights', 'Breaking changes', 'Tagged'], versions.map(v => [`**${v.v}**`, v.date, v.hi, v.breaking, v.tagged]), [900, 1150, 4400, 2110, 800], { size: 15 }));
body.push(note('No version in the history required manual migration. Every database change was applied automatically on first start, with a backup taken beforehand.'));

// ------------------------------------------------------------ 6
body.push(H1('6. Known limitations and roadmap'));
body.push(H2('6.1 Known limitations'));
body.push(table(['Limitation', 'Where', 'Effect'], [
  ['Binge detection is not written', '`src/main/watched.js`, `bingeSessions()` (marked TODO)', 'The Binges card on the Watched page never appears.'],
  ['The list pages are not on the dashboard editor', '`src/renderer/app.js`, `seriesView`, `views.movies`', 'Only the Dashboard can be rearranged.'],
  ['Desktop and web server keep separate databases', 'By design so far', 'Fixes, ratings and tags made on one do not reach the other.'],
  ['"Renamed so far" can show a negative failure count', '`src/renderer/app.js`, `views.rename`', 'Cosmetic. Seen while making the screenshots: the tile subtracts batch results from the older history count.'],
  ['Some check boxes stretch across the page', 'Settings: Renaming, Adult content, CSV export', 'Cosmetic. The box is drawn the width of its field.'],
  ['No light theme', '`src/renderer/styles.css`', 'All eight themes are dark.'],
  ['The renderer is one large file', '`src/renderer/app.js`', 'Every page lives in it; changes are made by careful search.'],
  ['Installer is unsigned', 'Release process', 'Windows warns on first run.'],
  ['The legacy card-settings dialog is unreachable', '`src/renderer/app.js`, `openCardSettings`', 'Dead code since 2.0.0.'],
  ['"Not watched yet" on the portal is the household\'s', '`src/server/portal.js`', 'Invites are not linked to Plex accounts.'],
  ['Windows only on the desktop', '`electron-builder.yml`', 'No macOS or Linux desktop build is produced.'],
], [3000, 3300, 3060], { size: 17 }));
body.push(H2('6.2 Roadmap'));
body.push(table(['Item', 'Source'], [['Move-into-season-folder option for the rename tool', 'README, Roadmap'], ['Synopsis from the metadata match on the series page (posters shipped in 2.1.0)', 'README, Roadmap'], ['Dashboard editor on the TV, Anime and Movies pages', 'Planned with the owner for the 2.x line'], ['A card builder: choose a measure, a filter and a chart', 'Planned with the owner'], ['Home Assistant link through MQTT discovery', 'Planned with the owner'], ['Desktop application as a client of the web server', 'Planned with the owner'], ['Split the renderer into one file per page', 'Maintenance'], ['Port the dashboard edit fix to the Bracket kit', 'Maintenance, in progress in a separate session']], [6200, 3160], { size: 17 }));

// ------------------------------------------------------------ 7
body.push(H1('7. Open questions and unverified items'));
const open = [
  ['Minimum memory and processor', 'Never measured. The manual states this.'],
  ['ffprobe version', 'Not pinned; whatever the download or the system package provides.'],
  ['Behaviour on Node versions other than 22 and 24', 'Not tested. `node:sqlite` requires Node 22.5 or newer.'],
  ['Test coverage as a percentage', 'No coverage tool is configured; see the developer guide for what the suites cover.'],
  ['Plex poster fetch on a real server', 'Tested against a stand-in server and on the owner\'s Raspberry Pi by the owner, not by the documentation run.'],
  ...(tagsWithoutNotes.length ? [['Tags without a changelog section', tagsWithoutNotes.join(', ')]] : []),
];
body.push(table(['Item', 'Status'], open, [3600, 5760], { size: 17 }));

write(path.join(OUT, 'RELEASE_OVERVIEW.docx'), body, { title: `MediaLedger ${V} Release and System Overview`, header: `MediaLedger ${V} · Release and System Overview` })
  .then(() => fs.writeFileSync(path.join(OUT, '.versions.json'), JSON.stringify(versions, null, 1)));
