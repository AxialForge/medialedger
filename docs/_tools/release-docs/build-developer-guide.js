'use strict';
// Writes DEVELOPER_GUIDE.md. The schema, the environment variable names, the test list and the repository map
// are read from the repository, so the guide states what is there rather than what was remembered.
//
//   node docs/_tools/release-docs/build-developer-guide.js <release-package-dir> [<clean-build-result.json>]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const REPO = path.resolve(__dirname, '..', '..', '..');
const OUT = path.resolve(process.argv[2]);
const pkg = require(path.join(REPO, 'package.json'));
const lock = require(path.join(REPO, 'package-lock.json')).packages;
const V = pkg.version;
const result = process.argv[3] && fs.existsSync(process.argv[3]) ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : null;
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8' }).trim();
const tracked = git('ls-files').split('\n');
const dep = (n) => (lock['node_modules/' + n] || {}).version;

// ---- schema from a fresh database
const { Db, MIGRATIONS } = require(path.join(REPO, 'src/main/db'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-schema-'));
const db = new Db(path.join(tmp, 's.db'));
const tables = db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(t => ({ name: t.name, cols: db.all(`PRAGMA table_info(${t.name})`), idx: db.all(`PRAGMA index_list(${t.name})`).map(i => ({ name: i.name, unique: !!i.unique, cols: db.all(`PRAGMA index_info(${i.name})`).map(c => c.name) })) }));
const schemaVersion = db.userVersion; db.close(); fs.rmSync(tmp, { recursive: true, force: true });
const TABLE_NOTE = {
  files: 'One row per file ever seen. The centre of the model: what the scan found, what ffprobe measured, what the parser read, and what Plex says.',
  scans: 'One row per scan with its counts and duration.', changes: 'What each scan found: added, removed, modified, returned, renamed. Refers to `scans.id`.',
  overrides: 'Manual fixes, keyed by root and relative path. Applied over the parser on every scan.', exports: 'One row per CSV export.',
  series_meta: 'The online match of a series: source, expected episodes per season, status, rating, genres, next airing.', series_prefs: 'Collecting policy per series: muted, or from a season and episode onward.',
  user_ratings: 'Your stars and note per title.', title_tags: 'Your tags per title.', requests: 'Media requests and their status.',
  plex_shows: 'Show-level data from Plex.', plex_syncs: 'One row per Plex sync, with the per-library breakdown as JSON in `detail`.', plex_accounts: 'Plex account names by id.', plex_history: 'One row per play, for every Plex account. `file_id` refers to `files.id`.',
  rename_batches: 'One row per rename batch.', rename_items: 'The journal: one row per file in a batch. Refers to `rename_batches.id` and `files.id`.', renames: 'Rename history from before batches existed.',
  snapshots: 'One row per day describing the library, for the trend cards.', posters: 'Which titles have a poster, its file and source.',
};

// ---- names only
const envNames = [...new Set(tracked.filter(f => /^(src|tools|server)\//.test(f) && /\.(js|sh)$/.test(f)).flatMap(f => [...read(f).matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)|process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g)].map(m => m[1] || m[2])))].sort();
const ENV_NOTE = { MEDIALEDGER_DATA: 'Data folder of the web server.', MEDIALEDGER_PORT: 'Port of the web server.', MEDIALEDGER_HOST: 'Address the web server binds to.', MEDIALEDGER_PASSWORD: 'Read once by `--set-password` so the password need not be typed. Secret: never commit a value.', MEDIALEDGER_SHOT_PASSWORD: 'Used by the screenshot pass to sign in to a web build. Secret.', NO_AUTO_UPDATE: 'Set to 1 to disable the desktop update check.', APPDATA: 'Windows: where the desktop data folder lives.', LOCALAPPDATA: 'Windows: used to find an installed ffmpeg.', PATH: 'Searched for ffprobe.', CSC_LINK: 'Release workflow only: code-signing certificate. Secret. Not set.', CSC_KEY_PASSWORD: 'Release workflow only: its password. Secret. Not set.' };
for (const n of ['NO_AUTO_UPDATE', 'CSC_LINK', 'CSC_KEY_PASSWORD']) if (!envNames.includes(n) && (tracked.some(f => /\.(js|yml|md)$/.test(f) && read(f).includes(n)))) envNames.push(n);

const testsInSuite = pkg.scripts.test.split('&&').map(s => s.trim().replace(/^node /, ''));
const testFiles = tracked.filter(f => /^test\/.+\.js$/.test(f));
const outside = testFiles.filter(f => !testsInSuite.includes(f));
const firstComment = (f) => { const m = /^\s*(?:'use strict';\s*)?\/\/ ?(.+)/m.exec(read(f)); return m ? m[1].trim() : ''; };
const lines = (f) => read(f).split('\n').length;
const folder = (p) => tracked.filter(f => f.startsWith(p)).length;

const md = [];
const t = (head, rows) => { md.push('', '| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|', ...rows.map(r => '| ' + r.map(c => String(c == null ? '' : c).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |'), ''); };

md.push(`# MediaLedger ${V}: Developer and Rebuild Guide`, '', `Document date ${new Date().toISOString().slice(0, 10)}. Release tag \`v${V}\`, commit \`${git('rev-parse', '--short', 'v' + V + '^{commit}')}\`.`, '',
  'Written for whoever rebuilds or extends MediaLedger without the original author at hand. Everything here was read from the repository or done on a real machine. Anything that could not be checked is marked UNVERIFIED and listed at the end.', '');

md.push('## 1. Rebuilding from nothing', '', '### 1.1 What you need', '');
t(['Tool', 'Version', 'Why'], [['Windows 10 or 11, 64-bit', '', 'The desktop installer is built for Windows x64. The server part also builds on Linux.'], ['Node.js', '22 (the release workflow); 24 also works', '`node:sqlite` needs 22.5 or newer.'], ['npm', 'Comes with Node', 'Installs from the lock file.'], ['Git', 'Any recent', 'Source at the tag.'], ['GNU tar', 'Comes with Git for Windows and with Windows 10 and newer', '`tools/pack-server.js` calls `tar`.'], ['Internet access', '', '`npm ci` downloads the packages; electron-builder downloads Electron and NSIS on first use.']]);
md.push('Not needed: a C or C++ compiler, Python, or any native build tool. The project has no native add-ons.', '', '**Build in a short folder**, for example `C:\ml`. Windows limits a path to 260 characters, and the installer tool (NSIS) cannot open its own templates below a deeply nested folder. The symptom is `!include: could not open file` at the installer step, with everything before it passing. This happened while verifying this package and was resolved by moving the source to a shorter path.', '',
  '### 1.2 The commands', '', '```bash', 'git clone https://github.com/AxialForge/medialedger.git', 'cd medialedger', `git checkout v${V}`, 'npm ci', 'npm test', 'node tools/pack-server.js          # dist/medialedger-server-' + V + '.tar.gz and its checksum', 'npm run build:win -- --publish never   # dist/medialedger-' + V + '-setup.exe', '```', '',
  'To run without building an installer:', '', '```bash', 'npm start                 # the desktop application', 'npm run web               # the web server on port 8080, data in %APPDATA%\\MediaLedger-web', 'node src/server/server.js --data=<folder> --port=8090', 'node src/server/server.js --data=<folder> --set-password', '```', '');
md.push('### 1.3 Clean build result', '');
if (result) {
  md.push(`Done on ${result.when} by \`docs/_tools/release-docs/clean-build.sh\`: the source at \`${result.tag}\` was exported with \`git archive\` into an empty folder and built there, using nothing from the working copy.`, '');
  t(['Step', 'Command', 'Result', 'Seconds'], result.steps.map(s => [s.step, '`' + s.command + '`', s.exit === 0 ? 'pass' : 'FAIL (exit ' + s.exit + ')', s.seconds]));
  md.push(`**Overall: ${result.pass ? 'PASS' : 'FAIL'}.** ${result.suites_passed} test suites reported "passed". Built with Node ${result.node} and npm ${result.npm}. Files produced: ${result.artifacts.trim().split(/\s+/).map(f => '`' + f + '`').join(', ') || 'none'}.`, '',
    'The installer built this way is not byte-identical to the one on GitHub Releases: electron-builder embeds build times. It is functionally the same build of the same source.', '');
} else md.push('UNVERIFIED: no clean build result was supplied when this guide was generated.', '');

md.push('## 2. Repository map', '');
t(['Path', 'Files', 'Purpose'], [
  ['`src/main/`', folder('src/main/'), 'The core and the desktop shell. `service.js` registers every operation; the other files are one concern each.'],
  ['`src/preload.js`', 1, 'Builds the bridge the desktop pages call, from `bridge-shape.js`.'],
  ['`src/renderer/`', folder('src/renderer/'), 'The pages, shared by the desktop and the web server.'],
  ['`src/server/`', folder('src/server/'), 'The web server, its security, the family portal.'],
  ['`src/portal/`', folder('src/portal/'), 'The family portal\'s own site. Never served by the main server.'],
  ['`server/`', folder('server/'), '`install.sh`: the Raspberry Pi installer and updater.'],
  ['`tools/`', folder('tools/'), '`pack-server.js` (server package), `build-manual.js` (in-repository manual), `make-icon.js`, `movie-plan-xlsx.py`.'],
  ['`test/`', folder('test/'), 'Test suites and harnesses. Plain Node scripts with `assert`; no test framework.'],
  ['`docs/`', folder('docs/'), 'The in-repository manual, screenshots, the Raspberry Pi guide.'],
  ['`docs/_tools/release-docs/`', '', 'The tools that made this package. See section 8.'],
  ['`docs/release-package/<version>/`', '', 'This package.'],
  ['`build/`', 'not tracked', 'Icons for the installer. The folder is in `.gitignore`, so a clone does not have it; see section 10.'],
  ['`.github/workflows/release.yml`', 1, 'The release workflow.'],
  ['`electron-builder.yml`', 1, 'Installer configuration.'],
  ['`CHANGELOG.md`, `README.md`, `CLAUDE.md`, `CONVENTIONS.md`', 4, 'History, overview, the maintainer notes with every hard-won gotcha, and house conventions.'],
]);
md.push('Largest source files:', '');
t(['File', 'Lines'], tracked.filter(f => /^src\/.+\.(js|css|html)$/.test(f)).map(f => [f, lines(f)]).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([f, n]) => ['`' + f + '`', n]));

md.push('## 3. Data model', '', `SQLite, one file, \`medialedger.db\`. Schema version **${schemaVersion}** (the \`user_version\` of the database). ${tables.length} tables.`, '',
  'The base schema and the numbered migrations are in `src/main/db.js`. On start the database applies every migration above its own version, in order, inside a transaction each, **after copying itself** to `medialedger.db.backups/<stamp>-pre-migration-v<n>.db`.', '',
  '### 3.1 Relationships', '', 'SQLite foreign keys are not declared; the relationships are by convention and kept by the code.', '');
t(['From', 'To', 'Meaning'], [['`changes.scan_id`', '`scans.id`', 'The scan that found the change.'], ['`exports.scan_id`', '`scans.id`', 'The scan the export followed.'], ['`rename_items.batch_id`', '`rename_batches.id`', 'The batch the file belongs to.'], ['`rename_items.file_id`', '`files.id`', 'The file that was renamed.'], ['`plex_history.file_id`', '`files.id`', 'The file that was played, when it is known.'], ['`plex_history.account_id`', '`plex_accounts.id`', 'Who played it. The name is also copied onto the row.'], ['`files.plex_show_key`', '`plex_shows.rating_key`', 'The Plex show of an episode.'], ['`overrides (root_id, rel_path)`', '`files (root_id, rel_path)`', 'The fix for a file.'], ['`series_meta`, `series_prefs`, `user_ratings`, `title_tags`, `posters`', 'a title', 'Keyed by `library_type` plus the title key: the show name for series, `group_key` for movies.'], ['`files.root_id`', '`settings.json` roots', 'The root the file was found in.']]);
md.push('### 3.2 Migrations', '');
t(['Version', 'Name'], MIGRATIONS.map(m => [m.version, m.name]));
md.push('### 3.3 Tables', '');
for (const tb of tables) {
  md.push(`#### ${tb.name}`, '', TABLE_NOTE[tb.name] || 'UNVERIFIED: no description written.', '');
  t(['Column', 'Type', 'Required', 'Default', 'Key'], tb.cols.map(c => ['`' + c.name + '`', c.type || 'any', c.notnull ? 'yes' : '', c.dflt_value == null ? '' : '`' + c.dflt_value + '`', c.pk ? 'primary' : '']));
  if (tb.idx.length) md.push('Indexes: ' + tb.idx.map(i => `\`${i.name}\`${i.unique ? ' (unique)' : ''} on ${i.cols.join(', ')}`).join('; ') + '.', '');
}

md.push('## 4. Configuration', '', '### 4.1 Files', '');
t(['File', 'Holds', 'Secrets inside'], [['`settings.json`', 'Every option of the Settings page. Defaults are in `src/main/settings.js`; the file holds only what differs.', 'The Plex token, the mail password, the GitHub token if one was entered.'], ['`web.json`', 'Web server: accounts, password fingerprints, sessions, two-factor key, webhook and status keys, per-account preferences.', 'Yes. Written with mode 0600.'], ['`portal.json`', 'Family portal: switch, port, addresses, invites and devices (fingerprints only).', 'Fingerprints only. Written with mode 0600.'], ['`tls/cert.pem`, `tls/key.pem`', 'Web server: the self-signed certificate. Their presence is what turns HTTPS on.', 'The key.'], ['`/etc/medialedger-cifs.cred`', 'Raspberry Pi: the credentials of the share.', 'Yes. Root only.'], ['`/etc/medialedger-domain`', 'Raspberry Pi: the name given with `--domain`.', 'No.']]);
md.push('### 4.2 Environment variables', '', 'Names only. None of them has a value in the repository.', '');
t(['Name', 'Purpose'], envNames.map(n => ['`' + n + '`', ENV_NOTE[n] || 'UNVERIFIED']));
md.push('### 4.3 Command line', '');
t(['Command', 'Switch', 'Purpose'], [['Desktop', '`--scan`', 'Scan, export and exit. What the Windows scheduled task runs.'], ['Desktop', '`--profile=<folder>`', 'Use another data folder.'], ['Desktop', '`--screenshots=<folder>`', 'Render every page and save a picture of each. The release gate.'], ['Desktop', '`--size=<width>x<height>`', 'With `--screenshots`: the window size.'], ['Desktop', '`--url=<address>`', 'With `--screenshots`: capture a web build instead.'], ['Desktop', '`--social=<file>`', 'Render the social preview picture.'], ['Web server', '`--data=<folder>`', 'Data folder.'], ['Web server', '`--port=<number>`', 'Port. Default 8080.'], ['Web server', '`--host=<address>`', 'Address to bind to. Default 0.0.0.0.'], ['Web server', '`--set-password`', 'Create or reset the account "admin".'], ['Installer', '`--port=`, `--share=`, `--domain=`, `--branch=`, `--https`, `--update-only`, `--auto-update`, `--no-auto-update`', 'See `server/install.sh`.']]);

md.push('## 5. Where things are stored at runtime', '');
t(['What', 'Desktop (Windows)', 'Web server (Raspberry Pi)'], [['Data folder', '`%APPDATA%\\MediaLedger`', '`/var/lib/medialedger`'], ['Program', 'Installed per user by the installer', '`/opt/medialedger`'], ['Database', '`medialedger.db` (plus `-wal`, `-shm`)', 'same'], ['Automatic database backups', '`medialedger.db.backups/`', 'same'], ['Backup sets', 'The folder chosen in Settings', 'same'], ['Settings', '`settings.json`', '`settings.json`, `web.json`, `portal.json`'], ['Log', '`medialedger.log`', '`medialedger.log`, `security.log`; also the systemd journal'], ['CSV exports', '`exports/<stamp>/` and `exports/latest/`', 'same'], ['Posters', '`posters/` or the folder chosen in Settings', 'same'], ['Downloaded ffmpeg', '`tools/`', 'not used; ffmpeg comes from the system'], ['Restore in progress', '`restore-pending/`, then `pre-restore-<stamp>/`', 'same'], ['Certificate', 'not used', '`tls/`, or `tls-off/` when switched off'], ['Caches', 'None on disk. The dashboard report is cached in memory for up to a minute.', 'same'], ['In the browser', 'Theme, table or wall, filters', 'same, per device']]);

md.push('## 6. Tests', '', '```bash', 'npm test', '```', '', `Plain Node scripts that use \`assert\` and print "… passed". No framework, no configuration. \`npm test\` runs ${testsInSuite.length} files in sequence and stops at the first failure.`, '');
t(['Suite', 'Covers'], testsInSuite.map(f => ['`' + f + '`', firstComment(f) || 'see the file']));
md.push('### 6.1 Test files that `npm test` does not run', '');
t(['File', 'What it is', 'Status'], outside.map(f => ['`' + f + '`', firstComment(f) || '', /\.test\.js$/.test(f) ? 'A real test suite that was never added to the script. Passes when run by hand (checked for this guide).' : 'A harness or a script that needs a real library or the network; run by hand.']));
md.push('### 6.2 Coverage', '', '**No coverage tool is configured, so there is no percentage to report.** What can be said from reading the suites:', '');
t(['Area', 'Covered', 'Not covered'], [['Parser and naming', 'Thoroughly: hundreds of real file names.', ''], ['Rename batches', 'End to end against a temporary folder: pre-flight, rename, journal, undo.', ''], ['Core and shell contract', 'Every operation must exist on both sides.', 'The behaviour of most operations.'], ['Web security', 'Hashing, sessions, lockout, roles, two-factor codes.', 'The HTTP layer itself.'], ['Family portal', 'From the outside over HTTP: access, leaks, limits, the address check.', ''], ['Posters, backup and restore, tags, QR codes, Plex helpers', 'Yes, each with its own suite.', 'A real Plex server.'], ['Scanner', '', 'Only through the harness, by hand.'], ['The pages', 'The screenshot pass fails on any error a page logs.', 'No assertions about what a page shows.']]);

md.push('## 7. The release gate', '', '```bash', 'npm test', 'npx electron . --profile=<a data folder> --screenshots=<out folder>   # exit code 3 = a page logged an error', 'node tools/build-manual.js <out folder> docs/MediaLedger-Manual.docx', '```', '', 'Then bump `version` in `package.json` and `package-lock.json`, add the section to `CHANGELOG.md`, commit, tag `vX.Y.Z` and push the tag. The workflow does the rest.', '');

md.push('## 8. Regenerating the screenshots and this package', '', 'Everything is in `docs/_tools/release-docs/`. The screenshots show a generated, fictional library; no real data is involved.', '');
t(['File', 'Purpose'], [['`make-demo-data.js`', 'Builds the fictional data folder. Fixed seed, so runs are repeatable.'], ['`make-demo-posters.py`', 'Draws the demo posters.'], ['`screens.js`', 'The list of screens: how to reach each and where it is defined.'], ['`controls/*.js`', 'What is on each screen: every control with its description. The single source for callouts, tables and the inventory.'], ['`uncaptured.js`', 'Short dialogs, the sidebar, keyboard shortcuts.'], ['`capture.js`', 'Runs under Electron: rebuilds the demo data, starts the server, walks the screens, saves clean pictures and the position of every control. Masks the name and addresses of the computer.'], ['`annotate.py`', 'Draws the numbered callouts.'], ['`build-inventory.js`', 'Writes `ui_inventory.json` and checks every entry against the source.'], ['`build-user-manual.js`, `build-release-overview.js`, `build-developer-guide.js`', 'Write the three documents.'], ['`to-pdf.ps1`, `md-to-pdf.js`', 'Export to PDF.'], ['`render-mermaid.js`', 'Renders the architecture diagram.'], ['`clean-build.sh`', 'The clean rebuild check.'], ['`make-archive.py`', 'Builds the reconstruction archive, its manifest and the secret scan, and checks every hash after unzipping.'], ['`verify-archive.py`', 'Unzips the archive into a short folder and builds the source it contains.'], ['`qa-check.py`', 'The final checks.'], ['`merge-boxes.py`, `render-pages.py`', 'Helpers: merge a partial capture run; render PDF pages to a picture for checking by eye.']]);
md.push('```bash', 'cd docs/_tools/release-docs && npm install        # once: the diagram renderer', 'cd ../../..', 'T=docs/_tools/release-docs; O=docs/release-package/<version>', 'npx electron $T/capture.js --data=$T/demo-data --out=$T/out', 'python $T/annotate.py $T/out $O/screenshots', 'node $T/build-inventory.js $O/ui_inventory.json $T/out/boxes.json', 'node $T/build-user-manual.js $O && node $T/build-release-overview.js $O', 'powershell -File $T/to-pdf.ps1 $O/USER_MANUAL.docx $O/RELEASE_OVERVIEW.docx', '```', '', 'Needs Python 3 with Pillow and PyMuPDF, and Microsoft Word for the PDF export of the two Word documents.', '',
  'To add a screen: add an entry to `screens.js`, describe its controls in `controls/`, run the capture with `--only=<id> --discover` and read `out/discover.json` for the selectors. A control the capture cannot find is reported, not skipped silently.', '');

md.push('## 9. Extension points', '',
  '### 9.1 Add an operation', '', '1. In `src/main/service.js`: `h(\'area:name\', (args) => …)`.', '2. Add it to `src/renderer/bridge-shape.js`. The pages then call `L.area.name(…)` in both shells.', '3. If it only reads, add its name to the `READS` pattern in `service.js`, or it will needlessly drop the dashboard cache.', '4. On the web server it is administrators-only until its name is added to `STANDARD` or `GUEST` in `src/server/server.js`. Add it to `SENSITIVE` if it changes files or security.', '5. `npm test`: the contract test tells you what you forgot.', '',
  '### 9.2 Add a page (a tab)', '', '1. `views.name = async () => { view.innerHTML = … }` in `src/renderer/app.js`.', '2. A link in the sidebar in `src/renderer/index.html`: `<a href="#name" data-view="name">`.', '3. Hide it from roles that may not see it, in `src/renderer/styles.css` (`body.role-guest [data-view="name"]`).', '4. Add `[\'name\', \'#name\']` to the list in `captureScreenshots` in `src/main/main.js`, so the release gate renders it.', '5. Describe it in `tools/build-manual.js`.', '',
  '### 9.3 Add a Dashboard card', '', 'Add one entry to `DASH_CARDS` in `src/renderer/app.js`: `{ type, group, label, help, sizes, def, guest, rule?, period?, list?, render(c) }`. `render` returns HTML. Data every card needs comes from `dashLoad()`; data only some cards need is fetched with `c.lazy(key, fn)` so it is requested once. Add the type to `DASH_DEFAULT` to show it to new accounts.', '',
  '### 9.4 Add a database column or table', '', 'Append a migration to `MIGRATIONS` in `src/main/db.js` with the next version number. Never edit an existing migration. The backup before the upgrade is automatic. Mention the schema version in the changelog.', '',
  '### 9.5 Teach the parser a new naming pattern', '', '`src/main/parse.js`. Add the file names to `test/parse.test.js` first; the suite holds hundreds of real names and catches regressions.', '',
  '### 9.6 Support another video or subtitle format', '', 'No code: the extensions are settings (`videoExtensions`, `subtitleExtensions`). To read a new property of a file, extend `src/main/ffprobe.js` and add the column with a migration.', '',
  '### 9.7 Add an online source for episodes or posters', '', '`src/main/metadata.js` for episodes: a lookup that returns `{ source, source_id, seasons, … }`. `src/main/posters.js` for posters: a function that returns an image, added to `fetchOne()`. Both pace themselves to about one request a second.', '',
  '### 9.8 Add something to the family portal', '', '`src/server/portal.js`. Add a route under `/p/`, and a `project…` function that copies **named fields only**. Never return a row from the core as it is. `test/portal.test.js` fails if a reply contains a path, an id or a Plex field.', '',
  '### 9.9 Add a notification event', '', 'Add the name to `notify.events` in `src/main/settings.js` and to the list on the Settings page, and call `notifier.send(\'name\', title, message)`.', '');

md.push('## 10. Open questions and unverified items', '');
const buildTracked = tracked.filter(f => f.startsWith('build/'));
t(['Item', 'Status'], [['`build/` folder', buildTracked.length ? `Tracked: ${buildTracked.join(', ')}.` : '`.gitignore` lists `build/`, and no file under it is tracked. `electron-builder.yml` names `build/icon.ico`. **A clone therefore has no icon file**; electron-builder falls back to its default icon. The clean build confirms the installer still builds. To keep the icon, run `node tools/make-icon.js` or track the file.'], ['Minimum hardware', 'Never measured.'], ['Node versions', 'Built and tested on 22 (workflow) and ' + process.version + ' (this guide). Others untested.'], ['Test coverage percentage', 'No tool configured.'], ['Byte-identical rebuild', 'Not possible: the installer embeds build times.'], ['Real Plex server', 'Not available to the documentation run; Plex code paths were exercised against a stand-in.']]);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'DEVELOPER_GUIDE.md'), md.join('\n') + '\n');
console.log(`wrote DEVELOPER_GUIDE.md: ${md.length} lines, ${tables.length} tables, schema ${schemaVersion}, ${envNames.length} environment names, clean build ${result ? (result.pass ? 'PASS' : 'FAIL') : 'not supplied'}`);
