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
npx electron . "--profile=%CD%\.devprofile"   # separate data folder; the path must be absolute (see Gotchas)
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
| `src/main/main.js` | Electron shell only: window, single-instance lock, `--scan` headless mode, updater, dialogs/shell handlers, and `for (const [ch, fn] of svc.handlers) ipcMain.handle(ch, …)` |
| `src/main/service.js` | The shared core: `createService({ userData, log, send, host })` owns settings, db, scanner, scheduler, watcher, scan/metadata/Plex jobs and every data handler as a `Map` of channel → function. No Electron. The web shell for the Raspberry Pi mounts the same map as HTTP routes. `test/service.test.js` enforces both rules |
| `src/main/settings.js` | JSON settings with defaults + deep merge |
| `src/main/db.js` | `node:sqlite` wrapper, base schema + `MIGRATIONS`, backups, overrides/exports helpers |
| `src/main/scanner.js` | Walk roots (single or threaded) → diff against DB → apply overrides → queue ffprobe → change log |
| `src/main/scanWorker.js` | Worker thread: readdir/stat/parse one top-level folder or a list of loose files |
| `src/main/parse.js` | Path/filename → show/season/episode or title/year/edition/group_key; `parseWeb`, `classifyAdult`, single `parseFor(rootType, rel)` dispatch |
| `src/main/ffprobe.js` | Locate ffprobe.exe, run it, flatten streams into DB columns |
| `src/main/ffmpegdl.js` | Download BtbN ffmpeg zip, extract with PowerShell `Expand-Archive` |
| `src/main/exportCsv.js` | Nine CSVs per export (the ninth is `discs.csv`, one row per copy), timestamped dir + `latest\` copy |
| `src/main/discs.js` | Physical discs by barcode: `normalizeUpc`, `scan`, releases / copies / title links, `discs.csv` rows. Pure, shared by both shells |
| `src/main/discLookup.js` | What is this barcode: own releases, the lookup cache, UPCitemdb; `parseProduct` turns a shop listing into title / format / edition; rate-limit rest |
| `src/main/tmdb.js` | Optional TMDB search (movie / tv) and poster URL, used by the disc lookup and as a movie poster fallback |
| `src/main/scheduler.js` | In-app interval timer + `schtasks.exe` create/query/delete |
| `src/main/watcher.js` | Optional `fs.watch` (recursive, UNC ok) per root; debounced scan trigger |
| `src/main/metadata.js` | TVmaze / AniList lookups → `{season: count}`; `missingEpisodes()` diff with absolute-numbering guard |
| `src/main/renamer.js` | TV/anime Plex-standard name proposals + gated in-place rename with logging |
| `src/main/movieNamer.js` | Pure movie naming engine: row → `{ ok, blocked, name, tokens, flags }`, collision detection |
| `src/main/movieRename.js` | Movie batch executor: pre-flight, dry/live, in-place or copy-verify-delete folders, journal, undo |
| `src/main/updater.js` | Template silent auto-updater (electron-updater), plus pure version helpers |
| `src/main/plex.js` | Plex local API: test, list sections, `syncLibrary` (path-map join → files.plex_* + plex_shows); pure `mapPath`/`deriveMapping`/`matchItems` |
| `src/preload.js` | Desktop bridge: builds `window.ledger` from `bridge-shape.js` over IPC |
| `src/renderer/bridge-shape.js` | The one description of the `window.ledger` tree (leaf = channel, `!` prefix = event). Both bridges build from it; `test/service.test.js` checks it against the handlers |
| `src/renderer/webbridge.js` | Browser bridge: same tree over `POST /api/<channel>` + `EventSource /api/events`; shows the login form on 401. No-op inside Electron |
| `src/server/server.js` | Web shell (Pi): node:http(s), static renderer, SSE broadcast as `send`, web versions of the Electron-only handlers plus `security:*`; `SENSITIVE` set = channels that need password re-entry (`isSensitive` inspects `movie:run`'s `live` flag) |
| `src/server/security.js` | User accounts (`users{name:{hash,role}}`, roles admin/standard), sessions with per-session flags (`showAdult`), lockout, LAN-only guard, guest mode, TOTP for admins, re-auth, audit log; state in `<data>/web.json` (0600). `server.js` holds the `GUEST` / `STANDARD` channel allowlists and `redactSettings`. Tested in `test/security.test.js` |
| `src/server/totp.js` | RFC 6238 TOTP + base32, tested against the RFC vectors |
| `src/main/sysmon.js` | Host health sampler (15 s ring buffer, one hour): CPU, memory, disks via `fs.statfsSync`, `/proc/net/dev`, Pi thermal/`vcgencmd`. `healthOf()` holds the thresholds |
| `tools/pack-server.js` | Builds `dist/medialedger-server*.tar.gz` + `.sha256`; CI attaches them to the release; the installer downloads them |
| `docs/RASPBERRY-PI.md` | The Pi guide; also becomes the README inside the server package |
| `src/main/paths.js` | `absOf(rootPath, rel)`: stored `rel_path` uses `\` on every OS; join with the local separator only when touching disk |
| `server/install.sh` | Pi installer: Node 22, ffmpeg, CIFS fstab mount at `/mnt/media`, `medialedger` system user, systemd unit, `medialedger` / `medialedger-update` commands |
| `src/renderer/` | `index.html`, `styles.css`, and the renderer in eight plain scripts loaded in order (they share the page scope): `app-core.js` (bridge, helpers, tables, modals, posters), `views-library.js`, `views-collections.js`, `views-review.js`, `views-maintenance.js`, `views-app.js` (settings, security, shares, welcome), `app-router.js` (router and start-up) |
| `test/` | Parser + updater tests, scan harness |
| `tools/make-icon.js` | Icon generator |
| `electron-builder.yml` | NSIS one-click, per-user, `publish: github` (feeds the updater) |

### Extension points

- **New library type**: add a `type` to the roots select in `views-app.js`, a parser in
  `parse.js`, a branch in `scanner.js`/`scanWorker.js` where the parser is
  chosen, and an export function in `exportCsv.js`.
- **New probed field**: append a migration in `db.js`, populate it in
  `ffprobe.js normalise()`, add it to `TECH_COLS`/`techFields` in
  `exportCsv.js` and the table columns in `views-library.js`.
- **New fixable field**: override column (migration) + `applyOverride` list +
  the fix modal in `app-core.js` (`openFixModal`).
- **Plex**: `plex.syncLibrary` is the only Plex code path. Episodes are paged
  500 at a time (`X-Plex-Container-Start/Size`). Plex paths are the NAS's own
  (`/media/...`); never assume the UNC form. userRating is 0–10 in Plex; the
  UI shows it /5.

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

- **Adult filtering is a query-time string, not a view.** `AF(alias)` in
  `service.js` appends ` AND adult=0` to every library query unless the runtime
  `showAdult` flag is on. Any new query over `files` must include `${AF()}`
  (or `${AF('f.')}` when aliased) or adult rows leak into the main views. The
  flag is deliberately not persisted.
- **Root type vs library_type.** A root of type `adult` produces rows with
  `library_type` anime/tv/movie and `adult=1`; a root of type `web` produces
  `library_type='web'`. Code that maps root → parser must go through
  `parseFor`, and `reparseAll` needs the root's type from settings
  (`_rootType`), not the row's `library_type`.

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
- **`rel_path` is backslash-separated everywhere, including Linux.** The
  scanner builds it with a literal `'\\'` so a database is portable between the
  Windows desktop and the Pi server. Never `path.join(root, rel)` directly: on
  Linux that yields `/mnt/media/Show\S01\ep.mkv`. Use `paths.absOf()`.
- **Web shell: `EventSource` must not open before login.** It 401s and retries
  forever, flooding the log; `webbridge.js` opens it after the first successful
  call.
- **A sandboxed preload cannot `require` project files.** 0.7.0 made
  `preload.js` require `renderer/bridge-shape.js` while the window still had
  `sandbox: true`. The preload died silently, `window.ledger` was never
  defined, `webbridge.js` took over and every desktop screen said "Failed to
  fetch". Versions 0.7.0 to 0.8.2 shipped broken on the desktop while the web
  build worked. Fix: `sandbox: false` (contextIsolation stays on). Guarded by
  `test/service.test.js`. **Release gate: run the desktop screenshot pass and
  look at `dashboard.png` before every tag.** Web-only testing is not enough.
  The pass also collects renderer `console.error`s and uncaught exceptions and exits 3 when any page logged
  one (verified by injecting an error), so check the exit code, not just the PNG count.
- **Restore never touches a live database.** `restore.stageRestore()` validates a backup read-only and copies it to
  `<data>/restore-pending/`; the shell restarts; `applyPendingRestore()` runs before `createSecurity` /
  `createService` open anything and moves the old files to `pre-restore-<stamp>/`. Swapping a WAL database under
  an open handle corrupts it, which is why the obvious "copy the file over" is wrong. New shells must call
  `applyPendingRestore` first thing.
- **The family portal is a separate surface, not a role.** `src/server/portal.js` has its own listener, routes and
  static folder (`src/portal/`). Never add an admin channel to it and never return a core row directly: every reply
  goes through a `project*` function that copies named fields. `test/portal.test.js` fails if a reply contains a path,
  an id or a Plex field, and if any admin route answers there. It calls `svc.setShowAdult(false)` before every core call.
  The one admin surface it does have (2.2.0, `/admin` + `/a/…`, off by default) is a *second* allow-list of nine
  routes with its own cookie `mla` and sessions in `portal.json`; it checks credentials through `sec.verify()` and
  never creates a web session. Cookies ignore ports, so reusing `ml_session` would have made a portal sign-in on
  `medialedger.home:8090` a full web-app session on `:8080`. Job notes pass through `noPaths()`: the backup job's
  note names the backup file with its full path. Add a route there only if it cannot change settings or files.
- **Renderer files.** The renderer is eight classic scripts, not modules: a top-level `const` in one is visible to the
  others, so names must stay unique across them, and anything run at load time may only use what an earlier script
  defined (`app-router.js` is last for that reason). Split by page group so a feature lands in one file; helpers used
  by more than one page go in `app-core.js`.
- **Settings is grouped after it is drawn.** `groupSettings()` moves each `<h2>` and what follows it into a
  `.ssec` inside a `.sgroup`, so a new section is just a new `<h2>` in the template plus its title in
  `SETTINGS_GROUPS` (unlisted titles land in "Other"). Do not split the template into per-tab renders: Save reads
  every control by id and must find them all, hidden or not.
- **List sorts that are not columns** go in the `sorts` array passed to `makeTable` (`val` computes the key);
  nulls always sort last in both directions. The sort state object is shared with `sortControl` and survives the
  table being rebuilt by the filter bar, which is why it lives in the view and not in the table.
- **The web service cannot mount, and must not be given sudo.** The unit has `NoNewPrivileges=true`, which also
  blocks `sudo`, so "allow one sudo command" is not available. Shares are connected by `server/share-helper.js`,
  started as root by `medialedger-share.path` when `src/server/shares.js` drops `request-<id>.json` in
  `<data>/shares/`. The helper treats the request as hostile: owner and size checked, opened `O_NOFOLLOW`, every
  field matched against a pattern, mounts only at `/mnt/medialedger/<name>`, no shell, answer written `O_EXCL`.
  A failed mount restores fstab and deletes the credentials file, because a stale `cifs` line can hang a boot.
  `test/shares.test.js` covers it with a pretend system; the real mount only runs on the Pi.
- **`readdir` types are "unknown" on some CIFS mounts.** `d.isDirectory()` is then false for real folders and the
  picker said "No sub-folders". `rootcheck.listDirs` stats anything that is not plainly a file.
- **Routes are serialised.** `route()` queues behind the page still loading and then draws only the newest hash;
  before, a slow first page (the dashboard) finished last and painted over the welcome guide.
- **Connect-to-server is `--url` made permanent.** `client.json` in userData holds the server address; `main.js` then
  loads that URL with `src/preload-desktop.js` instead of `preload.js`. The page is the server's own, so it builds
  `window.ledger` over HTTP (`webbridge.js`), which notices `window.ledgerDesktop` and routes `showItem`/`openPath`
  and the client settings through it. Electron rejects Caddy's internal certificate, so `certificate-error` pins the
  fingerprint on first contact for that host only. `desktop:*` IPC is registered with `ipcMain.handle` directly, not
  `h()`: `test/service.test.js` requires every `h('x:y')` in main.js to have a web counterpart.
- **Handlers must not capture `db` at definition time.** `db` is assigned in `init()`; `createCollections(db)`
  written inline captured `undefined` and every call failed. Build such modules lazily (see the `collections` Proxy).
- **Moving duplicates aside is a rename batch** (`layout: 'duplicates'`), so `movieRename.undoBatch` reverses it and
  the Movie names page lists it. Moved files are marked `ignored=1`, not deleted; a scan treats `_duplicates/` as
  any other folder, which is why the mark matters.
- **Every core query that lists titles goes through `AF()` and `WATCHED()`.** `AF()` is no longer just the adult
  clause: it carries the caller's libraries and content-rating limit, set per request by `svc.setScope()` from the
  account's permissions (`sec.permsOf`). A new `FROM files` query that forgets `${AF()}` leaks hidden libraries to a
  limited account. `WATCHED()` swaps `plex_view_count>0` for one Plex account's history when the account is mapped.
  `remember()` keys its cache by the whole scope, not just adult, or one user's view would be served to another.
- **Ratings and tags carry a `user` column** ('' = the owner's set: the desktop and every admin). Any new
  `db.userRatings` / `db.tagsFor` call must pass `scope.user`, or it reads the owner's set for everyone.
- **Capabilities are enforced in `allowed()`**, not in the page. The CSS `cap-*` classes only hide buttons; the server
  decides. Adding a channel a capability should open means adding it to `CAP_CHANNELS` in server.js.
- **`X-Forwarded-For` is believed only from loopback** (`src/server/clientip.js`). Trusting it from any socket would let
  a LAN client pick its own address and walk around LAN-only and the lockout.
- **The dashboard editor must not reload data per edit.** `dash.js` re-renders on every move, resize and option
  save; with `cfg.load` called each time, editing took seconds per click on the Pi (`data:dashboard` is about
  550 ms on a desktop, several times that on a Pi). It now holds the loaded data while `editing` is true.
  Separately, `remember()` in `service.js` memoises `data:dashboard` against `dataVersion`, which every
  non-read handler bumps (the `READS` pattern lists the read-only ones). A new handler that changes data is
  covered automatically; a new **read-only** handler should be added to `READS` or it needlessly drops the cache.
- **Posters are files, the table is the index.** `src/main/posters.js` names each file by `sha1(title key)` and the
  `posters` table says which titles have one. Renderers ask for `posters:index` first and only request images that
  exist, so a list of 1,400 rows does not cause 1,400 404s. The web shell serves `/poster/<type>/<key>`; the desktop
  renderer is `file://` and gets a data URL over the bridge when the row scrolls into view. Plex resizes for us
  (`/photo/:/transcode`), which is why there is no image library. Adult titles are excluded in `titles()`, so
  nothing adult exists on disk to serve.
- **`dash.js` is vendored from the Bracket kit** with four marked `[ML]` changes (the `after` hook and the editor
  level). MediaLedger has no kit `ui.js`; `ui-shim.js` provides `window.UI` and forwards to `window.__ml`, which
  `app-core.js` fills in. Script order matters: `ui-shim.js`, `dash.js`, then the renderer scripts. To add a dashboard card, add an entry to
  `DASH_CARDS` in `views-library.js`; cards that need an extra call use `c.lazy(key, fn)` so it is fetched once per render.
- **"Added" for a title is not `first_seen`.** `first_seen` is when MediaLedger first saw the file, so on a young
  ledger every title looks new. `watched.reclaim()` uses the earlier of `first_seen` and the newest file's mtime.
- **Webhook history keys need more than a timestamp.** Several scrobbles can land in one millisecond; the key is
  `wh-<ms>-<account>-<ratingKey>-<random>`. The next history sync deletes `wh-` rows within 30 minutes of the
  matching Plex row, so plays are not double counted.
- **GNU tar on Windows treats `C:` as a remote host.** `tar -czf C:\path\out.tgz` fails with "Cannot connect to C". `pack-server.js` runs tar with `cwd` set and a relative output name, then copies the file.
- **RFC 6238 test vectors are 8 digits.** The 6-digit code is the last six: T=59 → 287082, T=1111111109 → 081804, T=2000000000 → 279037 (not 005924, which is T=1234567890).
- **Adult visibility is per session on the web, one flag in the core.** `server.js` calls `svc.setShowAdult(session.showAdult)` before every handler; handlers are effectively synchronous DB reads so the flag cannot leak between callers, but a new long-running handler that reads `AF()` after an `await` would need its own copy.
- **Security handlers take a context first.** `server.js` calls `security:*` as `fn({ session, ip }, ...args)`; every other handler gets the renderer's arguments only. The desktop shell answers `security:status` with `{ available: false }` so the tab explains itself there.
- **`node:sqlite` prints an ExperimentalWarning** on start. Harmless in the desktop app; the Pi service sets `NODE_OPTIONS=--disable-warning=ExperimentalWarning` because it printed over the password prompt.
- **npm blocked Electron's postinstall** (`allow-scripts`) on first install;
  the binary was fetched with `node node_modules/electron/install.js`.
- **electron-updater feed and private repos**: the repo went public on
  2026-09-12 so no token is needed. If it is ever private again,
  `applyUpdateFeed()` in main.js passes `settings.githubToken` via
  `setFeedURL({ private: true, token })`. It must run on every manual check,
  not just at launch: a token typed into Settings after start was otherwise
  ignored and the public `releases.atom` feed answered 404. Never surface
  electron-updater's raw error text; it includes GitHub's response cookies.
- **Timings on this network** (gigabit SMB to 192.168.1.204): first full scan
  of 24,628 files took 25 min at 4 probes/1 thread; the TV root alone
  (11,419 files) takes 2 min 40 s at 8 probes/4 threads, and a no-change rescan
  3 s. Probing, not listing, is the floor once threads are on.

### Root origin is derived, not stored (3.3.0)

- **Symptom:** you look for an `origin` column on `files` and there is none.
- **Cause:** where a file came from (disc rip / download / recorded) is a
  property of its *root* (`settings.roots[].origin`). `ORIGIN()` in
  service.js builds a `CASE root_id …` from settings at query time, and
  `scopeKey()` includes the roots' origins so `remember()` caches refresh
  when the setting changes.
- **Why not a column:** changing a root's origin would need a backfill
  over every file; the CASE applies instantly and survives rescans.

### Discs: releases, copies and title links (3.4.0, schema v19)

- **Three tables, three ideas.** `disc_releases` is a product (one barcode),
  `disc_copies` is one you own / want / lent / sold, `disc_titles` says which
  library titles a release contains. None has a user column: the shelf
  belongs to the house. All logic is in `src/main/discs.js` (pure, takes the
  Db), the page is `src/renderer/views-discs.js`.
- **v18 is a dead end that must stay.** v18 created a one-row-per-title
  `discs` table and ran on the desktop database before the design changed.
  v19 creates the real tables, carries v18's rows over and drops `discs`.
  Do not "tidy" v18 away: a database at 18 would then skip the new tables.
- **A scan never creates a release.** Unknown barcode -> `{ unknown }` and the
  page opens the form. A barcode already held -> `{ duplicate }` and nothing
  is added until the user confirms (`force`). A wishlist copy that gets
  scanned becomes owned instead of gaining a second row.
- **Nothing is deleted automatically.** Copies change status. Deleting a
  release is admin-only, explicit, and refused while copies exist unless
  forced. The scan log outlives the release.
- **`UNIQUE(..., season)` does not dedupe NULL seasons** in SQLite, so
  `linkTitle` looks before it inserts.
- **Roles:** reads are in STANDARD (not GUEST or KIDS, though the list badge
  rides on `data:movies` / `data:series` for everyone), writes ride the
  *metadata* capability, `disc:release:delete` is the admin's.
- **A lookup suggests, it never saves** (`src/main/discLookup.js`, 3.5.0).
  Order: your own release, the `disc_lookups` cache (v20), then UPCitemdb's
  keyless trial endpoint. Verified 2026-11-11: `items[0].title/brand/category`,
  `total: 0` for unknown, headers `X-RateLimit-Remaining/Limit/Reset` (Reset
  is a Unix time), and TWO limits: 100 a day and 6 a minute, the second
  answering `code: TOO_FAST`. On either, `pausedUntil` is set from Reset
  and no request is made until then. `lookup()` never throws.
- **UPCitemdb's `category` is unreliable** (a Blu-ray came back as "DVD &
  Blu-ray Players"), so `parseProduct` trusts format words in the title and
  uses the category only to decide whether a bare "4K" is a disc or a
  television. A year counts only inside brackets, so "Blade Runner 2049"
  keeps its name.
- **TMDB is optional** (`src/main/tmdb.js`, `settings.tmdb.key`, redacted
  for non-admins like the Plex token). It was built against the documented
  v3 API with a pretend server and has NOT been run against the real
  service: no key was available. The Settings *Test* button is the check.
- **Gaps are computed, not stored** (3.6.0). `disc:gaps` in service.js builds
  the library's titles with `ORIGIN()` and `AF()` and hands them to the pure
  `discs.gaps(db, titles)`. The rip lists are empty until some root has an
  `origin`; the page says so rather than showing zeros without a reason.
- **A shelf label is a scan that never reaches the server.** `ml:loc:<name>`
  is caught at the top of `discSubmit` and only changes the sticky location
  (localStorage). The keystroke-burst handler therefore buffers any printable
  key, not just digits, and treats Shift as part of typing.
- **Printing** uses one `#printSheet` element and `body.print-labels` with
  an `@media print` rule that hides everything else. Do not use
  `href="javascript:..."` for clickable tiles: the CSP blocks it.
- **The loan date follows the status** (3.7.0, v21 `loaned_on`). `copyRow()`
  sets it the day a copy becomes `loaned`, keeps it while it stays out and
  clears it on any other status. Do not write `loaned_on` anywhere else.
- **The `imax ratio` tag is add-only.** `tagImax()` in service.js runs after
  a release is saved or linked and adds the tag (owner's set, user `''`) to
  the titles of releases with `imax_var=1`. It never removes one: a tag the
  user typed, or one for a disc since sold, is theirs. Other accounts have
  their own tag sets and do not see it.
- **Portal `/p/discs` projects through `projectDisc`**: id, title, year,
  kind, format, edition, copies, lent, linked. No location, price, store,
  barcode, notes or borrower. `test/portal.test.js` pins the exact fields.
  `state.showDiscs` (default on) hides the tab and makes the route 404.
- Keep the two facts apart: "ripped from disc" = the root's `origin`;
  "still have the disc" = a held copy linked through `disc_titles`.
- **The screenshot gate must use `--profile=<absolute path>\.devprofile`.**
  Without it the pass opens (and migrates) the real `%APPDATA%\MediaLedger`
  database. A *relative* profile path is refused by Electron at start-up:
  an error dialog opens, nothing is logged and the run hangs.
