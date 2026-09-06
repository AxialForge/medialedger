# MediaLedger — project notes for Claude

MediaLedger is an Electron desktop app (plain JS, no bundler, no framework) that
inventories the Plex media share at `\\192.168.1.204\Apocrypha_Media_Pool`
(`Movies`, `Anime`, `TV_Shows`), probes every video with ffprobe, stores the
result in SQLite, exports CSVs, keeps a change log, remembers manual fixes, and
can run on a schedule. Everything runs in the Electron main process; there is
**no HTTP server and no browser layer** by design — the owner asked for a purely
local app.

## Non-negotiables

- **No web layers.** No localhost server, no fetch to our own process, no CDN
  assets. The renderer talks to main only through `src/preload.js` IPC. The
  only outbound network calls are the update check (GitHub Releases), the
  optional ffmpeg download (GitHub), and the optional Plex connection test.
- **No native Node addons.** This machine runs Node 24 and Electron addon builds
  fail (ClangCL toolset missing). SQLite is `node:sqlite` (bundled with Electron
  38's Node 22). Do not add `better-sqlite3`, `sqlite3`, `sharp`, etc.
- **Never delete rows automatically.** Files that disappear are flagged
  `missing=1`; only the explicit "Forget missing files" button purges them. A
  root that is unreachable is skipped and logged as `root_offline`, never
  treated as empty.
- **Read-only against the share, with two gated exceptions.** The scanner only
  lists, stats and probes. `renamer.js` (TV/anime, gated by
  `settings.renaming.enabled`) and `movieRename.js` (movies, gated by
  `settings.movieRename.enabled` + typed confirmation) are the only write
  paths. Both never overwrite and journal every attempt. `movieRename` also
  pre-flights the whole batch, verifies size after each operation, holds
  `renameLock` so scans/watcher back off, and supports undo. Never add another
  write path without at least the same gate and journal.
- **Movie names come from proven data only.** `movieNamer.js` takes
  resolution/HDR/codec/audio from ffprobe columns and title/year from the
  parser + overrides. Unknowns become placeholder words, never guesses from the
  old file name. Keep `test/movieNamer.test.js` and
  `test/movieRename.harness.js` green.
- **No paid services.** No code-signing certificates, no paid API tiers. Free,
  keyless sources only (TVmaze, AniList, BtbN ffmpeg builds, GitHub Releases).
- **Schema changes go through `MIGRATIONS` in `db.js`.** Never edit an old
  migration; append a new one. `Db.migrate()` backs the file up first.
- **Manual fixes must survive everything.** `overrides` is keyed by
  `(root_id, rel_path)` and merged over the parser result on every scan
  (`applyOverride` in `scanner.js`). Any new parse field needs a matching
  override column and a line in `applyOverride`.
- Author/commit rules from the global `~/.claude/CLAUDE.md` apply (AxialForge
  identity, no Claude attribution, imperative commit messages).

## Commands

```bash
npm install            # if npm blocks Electron's postinstall: node node_modules/electron/install.js
npm start              # GUI
npm run scan           # headless: scan → export → exit (what Task Scheduler runs)
npm test               # parser + updater unit tests (plain Node)
node test/scan.harness.js    # end-to-end threaded scan of real roots into a temp DB
node test/metadata.live.js   # live TVmaze/AniList lookups for real series (network)
node test/movieNamer.report.js <db> <out.csv>   # dry report of proposed movie names (read-only)
npx electron . --profile=.devprofile   # run against a separate data folder (see Gotchas)
npm run build:win      # electron-builder → dist/ (NSIS one-click installer + latest.yml)
node tools/make-icon.js      # regenerate build/icon.ico + icon.png (no deps)
```

Release: bump `package.json` version + `CHANGELOG.md` in one commit, then
`git tag vX.Y.Z && git push origin main --tags`. CI (`.github/workflows/release.yml`)
builds the installer and attaches `.exe`, `latest.yml` and `.blockmap` to the
GitHub Release — all three are required for auto-update to see it.

Runtime data: `%APPDATA%\MediaLedger\` (`medialedger.db`, `settings.json`,
`medialedger.log`, `exports\`, `tools\ffprobe.exe`, `medialedger.db.backups\`).

## Architecture

| Path | Role |
|------|------|
| `src/main/main.js` | App lifecycle, single-instance lock, `--scan` headless mode, updater wiring, all IPC handlers and SQL queries for the UI |
| `src/main/settings.js` | JSON settings with defaults + deep merge |
| `src/main/db.js` | `node:sqlite` wrapper, base schema + `MIGRATIONS`, backups, overrides/exports helpers |
| `src/main/scanner.js` | Walk roots (single or threaded) → diff against DB → apply overrides → queue ffprobe → change log |
| `src/main/scanWorker.js` | Worker thread: readdir/stat/parse one top-level folder or a list of loose files |
| `src/main/parse.js` | Path/filename → show/season/episode or title/year/edition/group_key |
| `src/main/ffprobe.js` | Locate ffprobe.exe, run it, flatten streams into DB columns |
| `src/main/ffmpegdl.js` | Download BtbN ffmpeg zip, extract with PowerShell `Expand-Archive` |
| `src/main/exportCsv.js` | Eight CSVs per export, timestamped dir + `latest\` copy |
| `src/main/scheduler.js` | In-app interval timer + `schtasks.exe` create/query/delete |
| `src/main/watcher.js` | Optional `fs.watch` (recursive, UNC ok) per root; debounced scan trigger |
| `src/main/metadata.js` | TVmaze / AniList lookups → `{season: count}`; `missingEpisodes()` diff with absolute-numbering guard |
| `src/main/renamer.js` | TV/anime Plex-standard name proposals + gated in-place rename with logging |
| `src/main/movieNamer.js` | Pure movie naming engine: row → `{ ok, blocked, name, tokens, flags }`, collision detection |
| `src/main/movieRename.js` | Movie batch executor: pre-flight, dry/live, in-place or copy-verify-delete folders, journal, undo |
| `src/main/updater.js` | Template silent auto-updater (electron-updater), plus pure version helpers |
| `src/main/plex.js` | Placeholder: connection test only (later: match to Plex items) |
| `src/preload.js` | `window.ledger.*` API surface |
| `src/renderer/` | `index.html`, `styles.css`, `app.js` (hash router, sortable tables, fix modal) |
| `test/` | Parser + updater tests, scan harness |
| `tools/make-icon.js` | Icon generator |
| `electron-builder.yml` | NSIS one-click, per-user, `publish: github` (feeds the updater) |

### Extension points

- **New library type**: add a `type` to the roots select in `app.js`, a parser in
  `parse.js`, a branch in `scanner.js`/`scanWorker.js` where the parser is
  chosen, and an export function in `exportCsv.js`.
- **New probed field**: append a migration in `db.js`, populate it in
  `ffprobe.js normalise()`, add it to `TECH_COLS`/`techFields` in
  `exportCsv.js` and the table columns in `app.js`.
- **New fixable field**: override column (migration) + `applyOverride` list +
  the fix modal in `app.js` (`openFixModal`).
- **Plex phase**: `plex.js` gets a `matchLibrary(db, cfg)` that pulls
  `/library/sections/*/all` and joins on file path; store the Plex rating key
  and view count on `files`.

## Scheduling model

- In-app timer: `Scheduler.tick()` every minute; fires when
  `now - lastRun >= interval`. Only while the window is open.
- Task Scheduler: `schtasks /Create /SC DAILY /ST HH:MM /TR "<exe> --scan"`.
  Dev command is `"electron.exe" "<app dir>" --scan`; packaged is
  `"MediaLedger.exe" --scan`. Re-install the task after packaging so it points
  at the exe.
- `--scan` with the app already open: the second instance quits immediately
  and the open window runs the scan (`second-instance` event carries
  `{scan:true}`). `--scan` with nothing open: headless scan, export, quit —
  unless the user launches the GUI mid-scan, in which case the headless
  instance opens the window itself (`promotedToGui`) and keeps going.

## Gotchas

- **The installed app holds the single-instance lock.** If `MediaLedger.exe` is
  running, `npx electron .` quits instantly with no log line and no error (both
  use `%APPDATA%\MediaLedger`). Do not kill the user's app; run the dev build
  with `--profile=<dir>` (copy the DB in first if you need real data).
  `.devprofile/` is git-ignored for this.
- **Migration SQL is split on `;` after comments are stripped.** A `--` comment
  containing a semicolon or odd unicode broke v2 until the splitter stripped
  comments first. Keep comments out of statements if in doubt.
- **AniList models cours, not seasons.** "Attack on Titan" comes back as six TV
  entries; `isPart()` merges "Part 2 / Cour 2 / 2nd Half" titles into the
  previous season. Ongoing series have `episodes: null`; `aniCount()` uses
  `nextAiringEpisode.episode - 1`. TVmaze numbers anime by broadcast season, so
  the Match dialog lets the user switch source per series.
- **Absolute numbering.** Folders like `One Piece S1 East Blue (1-61)` continue
  numbering across seasons; `missingEpisodes()` skips a season whose max
  on-disk number is > 1.5× the expected count and flags `absolute`.
- **Duplicate "keep" marks live in `overrides.keep`**, so they follow the file
  through renames (renamer updates `overrides.rel_path`).

- **Bash heredocs / `node -e` strings on this box collapse `\\` to `\`.**
  Writing JS with UNC paths or `split('\\')` through Bash produced octal-escape
  syntax errors and garbage show names in ad-hoc tests. Use the Write tool for
  source files and forward slashes in test paths (`//192.168.1.204/...` works
  for Node fs on Windows).
- **`S01E01 - 720p`** used to parse `720` as the end of an episode range. The
  range alternative now requires an `E` or a dash directly followed by digits
  not followed by `p/x/k`. Keep `test/parse.test.js` green when touching the
  regex.
- **Anime naming** is `Show\Show S1\12 Show S1.mp4` or `2Show S1.mp4`: the
  leading number is the episode, season comes from the folder (`Attack on
  Titian S4` — a real typo in a folder name; the show name comes from the *top*
  folder, so it is still correct). Files directly under the show folder default
  to season 1. `Star Trek Picard S3\10600367.mp4` is unparseable on purpose —
  that's what the Fix button is for.
- **Threaded walk must never send `startRel: ''` to a worker without a `files`
  list** — the worker would recurse the whole root, once per chunk. Loose root
  files are passed as explicit `files` arrays (see `_walkThreaded`).
- **Sidecar subtitles** are matched by folder + base name with a language /
  `forced` / `sdh` suffix stripped. None exist on the share today.
- **ffprobe `format_name` for mp4 is `mov,mp4,m4a,3gp,3g2,mj2`**; mapped to a
  short label in `containerLabel()`. Do not show the raw string.
- **`node:sqlite` prints an ExperimentalWarning** on start. Harmless.
- **npm blocked Electron's postinstall** (`allow-scripts`) on first install;
  the binary was fetched with `node node_modules/electron/install.js`.
- **Private repo + electron-updater**: the feed needs a token until the repo is
  public. `settings.githubToken` is passed via `autoUpdater.setFeedURL(...,
  private: true, token)`. Making the repo public removes the need.
- **Timings on this network** (gigabit SMB to 192.168.1.204): first full scan
  of 24,628 files took 25 min at 4 probes/1 thread; the TV root alone
  (11,419 files) takes 2 min 40 s at 8 probes/4 threads, and a no-change rescan
  3 s. Probing, not listing, is the floor once threads are on.
