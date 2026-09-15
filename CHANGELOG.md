# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [1.0.4] - 2026-09-14

### Fixed

- Phone layout: table headers and rows stayed aligned only by luck in 1.0.3; wide tables now scroll as one unit. Key-value tables (System, About) stack cleanly instead of scrolling sideways. Green status dots on the Security tab were invisible (undefined colour variable).

### Changed

- Screenshot mode accepts `--size=WxH` (phone captures), waits for each web page to finish rendering, and keeps the window painting while occluded so captures are never stale.

## [1.0.3] - 2026-09-14

### Added

- **Phone layout for the web build.** Below 820 px wide the sidebar becomes a slide-in menu behind a top bar with a Scan button, tiles and panels stack, forms go single-column, wide tables scroll sideways inside their card, and buttons grow to finger size. Nothing changes at desktop width, so the Windows app and the PC browser view are untouched. Also adds the missing viewport meta tag, without which phones rendered the page zoomed out.

## [1.0.2] - 2026-09-14

### Added

- **Library root status.** Settings → Library roots shows Reachable / Share
  not mounted / NAS not answering / Not reachable per root, with entry count
  and writability, a *Check reachability* button, and diagnostics: is the NAS
  answering on the SMB port, is the share in fstab, is it mounted, and the
  exact command to run.
- **Background root check** (Settings → *Check roots every N minutes*,
  default 5): a red counter on Settings and a message the moment a root drops
  out, and again when it is back.
- **Folder browser on the web build.** The "…" button next to a path now opens
  a server-side folder picker instead of doing nothing.
- **Pi mount watchdog.** The installer adds a root-owned timer that re-mounts
  the share within a minute if it dropped and the NAS answers (NAS reboot, Pi
  moved, network blip). Rerun the installer to get it.

## [1.0.1] - 2026-09-14

### Added

- Favicon in the browser tab, an Apple touch icon and a web-app manifest, so the Pi site shows the MediaLedger icon and can be added to a phone home screen as a standalone app.

## [1.0.0] - 2026-09-12

The first stable release. Both shells, the Windows desktop app and the
Raspberry Pi web server, share one core, one database format and one manual.

### Added

- **User manual** regenerated for 1.0 with new chapters: System, Security, and
  *Running MediaLedger on a Raspberry Pi* (requirements, step-by-step install,
  first run, command reference, security, moving the desktop database, file
  locations, troubleshooting). Screenshots of the web build included.
- `docs/README.md` index; README gains a Documentation section, System and
  Raspberry Pi rows in Highlights.
- Pi guide opens with a requirements table, the four commands that do
  everything, and a command reference.
- Screenshot mode can capture the web build (`--url=http://<pi>:8080`).

### Fixed

- **Desktop app did not load in 0.7.0 through 0.8.2**: every screen showed
  "Failed to fetch". The preload script could not load the shared bridge shape
  inside Electron's sandbox, so the browser bridge took over. The window now
  runs the preload unsandboxed (context isolation stays on), a test guards it,
  and the desktop screenshot pass is a release gate. The web server was not
  affected.

## [0.8.2] - 2026-09-12

### Changed

- System tab samples and refreshes every 5 s instead of 15 s (history still one hour).

### Fixed

- Pi throttling / voltage tile was missing: the installer now adds the service user to the `video` group so `vcgencmd` works. Rerun the installer or `sudo usermod -aG video medialedger && sudo systemctl restart medialedger`.

## [0.8.1] - 2026-09-12

### Fixed

- Web server: the About page's Check for updates button was greyed out. It now
  asks GitHub for the latest release and says whether `sudo medialedger-update`
  has anything to install.

## [0.8.0] - 2026-09-12

### Added

- **System tab** (both shells): health verdict with reasons, Raspberry Pi SoC
  temperature / clock / core voltage / firmware throttling flags, CPU per core,
  memory and swap, data-disk and per-root free space, network throughput, an
  hour of in-memory history as sparklines, refreshed every 15 s.
- **Security tab and hardening for the web server**: posture checklist,
  password change, LAN-only switch (on by default; non-private addresses are
  refused), idle sign-out, TOTP two-factor codes with in-page setup, session
  list with revoke, per-address lockout (8 failures / 15 min), password
  re-entry within 5 minutes for live renames, undo, TV/anime renames, purge and
  every security change, strict CSP + security headers, audit log
  (`security.log`), optional HTTPS from `<data>/tls`.
- **Server-only release package** `medialedger-server.tar.gz` (+ `.sha256`),
  built by CI on every tag: core, renderer, server and installer only, no
  Electron, no dependencies. `server/install.sh` downloads and verifies it;
  `medialedger-update` upgrades from it. `--branch=<git branch>` remains for
  development, `--https` creates a self-signed certificate.
- `docs/RASPBERRY-PI.md`: the complete Pi guide (hardware, OS, install, first
  run, daily use, updating, security, moving the desktop database, System tab,
  troubleshooting, file locations, uninstall).

### Changed

- Sign-in dialog has an authenticator-code field (used only when 2FA is on) and
  a separate re-authentication dialog for sensitive actions.
- The installer silences Node's SQLite experimental warning that used to print
  over the password prompt.

### Fixed

- Pre-0.8 web sessions without an activity timestamp are dropped on upgrade.

## [0.7.0] - 2026-09-12

### Added

- **Web server for the Raspberry Pi (and any Linux box).** `npm run web` /
  `src/server/server.js` serves the complete app in a browser: same renderer,
  same tabs, same database format. Zero extra dependencies (node:http), one
  shared password (scrypt hash, HttpOnly SameSite cookie, login rate limit),
  same-origin API, server-sent events for scan / metadata / Plex / rename
  progress. `server/install.sh` sets up Node 22, ffmpeg, the CIFS mount of the
  share at `/mnt/media`, a hardened systemd service on port 8080 and the
  `medialedger` / `medialedger-update` commands.
- `renderer/bridge-shape.js` is now the single description of the
  `window.ledger` API; `preload.js` (IPC) and `renderer/webbridge.js` (HTTP)
  both build from it.

### Changed

- The application core moved out of the Electron entry point into
  `src/main/service.js`; the desktop shell is now 175 lines. No behaviour
  change; `test/service.test.js` guards the split and the bridge contract.
- Stored `rel_path` values keep `\` separators on every OS; `paths.absOf()`
  joins them for the local file system, so a database moves between Windows and
  the Pi unchanged.
- Default roots on Linux are `/mnt/media/{Movies,Anime,TV_Shows}`.
- ffprobe is found on `PATH` / `/usr/bin` on Linux and macOS.

### Fixed

- Series from the adult root are no longer sent to AniList / TVmaze for
  expected-episode lookups (AniList answered 403 to every one).

### Changed

### Fixed

## [0.6.2] - 2026-09-12

### Fixed

- About page no longer flickers while an update downloads: progress updates
  the status line in place instead of rebuilding the page.
- Long values on the About page (ffprobe path, version banner) wrap inside
  their card instead of running off the right edge.

## [0.6.1] - 2026-09-12

### Changed

- The GitHub repository is now public, so the in-app updater works with no
  token. The token field in Settings → Updates stays as a fallback.

### Fixed

- **Check for updates** now re-reads the GitHub token from Settings on every
  click; before, a token pasted after launch was ignored until a restart.
- Update errors are shown as a short explanation instead of the raw HTTP
  response (which dumped GitHub's headers and cookies into the panel).

## [0.6.0] - 2026-09-12

### Added

- **Plex integration (phase 2).** Settings → Plex takes the server URL and
  token, tests the connection, and syncs every movie and show section over the
  local Plex API (read-only, no Plex account). Each Plex item is linked to a
  MediaLedger file by path; the path mapping (`/media` → `\nas\share`) is
  derived automatically from the first match and editable. Stored per file:
  Plex title, year, rating key, IMDb/TMDB/TVDB ids, your Plex rating, the
  audience rating, play count, last viewed and resume offset; per show: Plex's
  own ratings and watched counts. Optional sync after every scan.
- Ratings tab gains Plex audience score, your Plex rating (shown out of 5) and
  a watched column; series lists show watched percentage and your Plex rating.
- Movie naming engine gets a per-batch truth source: title and year from the
  file name plus fixes (default) or from the Plex match, with flags when Plex
  disagrees or a file is not linked.
## [0.5.0] - 2026-09-11

### Added

- **Adult library.** New root type *Adult*: each file under it is classified as
  anime, TV or movie from its folder and name and carries an `adult` flag.
  Hidden from every view, count and query until the "Show adult content"
  switch in the sidebar is on (it resets on every launch); an *Adult* tab with
  its own dashboard, series and movie lists appears while it is on. Left out of
  CSV exports unless allowed in Settings. All the usual tools (Fix…, Match…,
  ratings, quality, duplicates) work on adult files.
- **Web videos.** New root type *Web videos* for yt-dlp style downloads:
  channel from the folder, title from the file name with `[videoId]` and dates
  stripped. *Web videos* tab grouped by channel with a per-channel video list,
  YouTube links where an id exists, and a `web_videos.csv` export.
- **Ratings.** Online averages from TVmaze and AniList are stored during the
  episode-count lookup (no extra requests). A local 0–5 star rating and note per
  title for TV, anime, movies and web channels. New *Ratings* tab, rating
  columns on the series lists, and `online_rating` / `my_rating` / `my_note`
  columns in the series and movie CSVs. Plex user ratings are queued for the
  Plex integration.
- **Movie names:** bulk "Set source for selected" (Web / Rip / clear) so the
  800-odd `Source` placeholders can be cleared in a few passes; a *Name
  collisions* section that shows the files behind each collision with "Keep
  this, ignore others"; a pinned *Placeholders on disk* section listing files
  already renamed with `(Year)` or `Source` that still need a value.

### Changed

- Parser version 3: the whole database is re-parsed on first launch so existing
  rows gain the adult flag and web fields.
- Sidebar regrouped: Web videos and Adult under Library, Ratings under Review.
## [0.4.0] - 2026-09-06

### Added

- **Movie naming engine** (new *Movie names* tab). Builds
  `Title (Year) - Source Resolution HDR Codec [Audio] [{edition-…}].ext` from
  the parsed title/year and manual fixes plus **probed** resolution, colour
  range, codec and audio language. Source is Web for LiLTV / WEB markers, Rip
  for BRrip / BluRay / Remux / DVD markers, or a manual fix. Anything the probe
  cannot prove becomes a placeholder word (`Year`, `Source`) for the owner to
  fill in; files without a probe, without a title, or whose proposed name would
  collide are blocked and never renamed.
- Batch executor with the full safety model: dry run by default, a per-tab
  "Allow live renames" switch plus a typed RENAME confirmation, whole-batch
  pre-flight (source exists, size unchanged since scan, target free, root
  writable, path length) that aborts everything on one failure, post-rename
  size verification before the database is updated, a journal of every item,
  and per-batch Undo that re-checks each file before restoring it.
- Two layouts per batch: rename in place (atomic) or move into `Title (Year)`
  folders using copy → verify size and head/tail hash → delete.
- Exclusive lock while a live batch runs: scans and the folder watcher back off.
- Batch size limit as a tab setting; Fix dialog gains a Source field for movies.
- `test/movieNamer.report.js` dry report over a whole database (CSV).

### Changed

- The generic rename tool now covers TV and anime only; movies use the engine.
- Missing-episode lists collapse whole missing seasons into ranges
  ("S6–S38 entirely") instead of listing every number.

### Fixed

- Duplicate "keep" marks and manual Source choices are preserved when a file
  is re-fixed through the Fix dialog.
## [0.3.0] - 2026-09-05

### Added

- **Missing episodes.** Expected episode counts per season are fetched from
  TVmaze (TV) and AniList (anime) — both free, no key — in the background after
  each scan. New *Missing episodes* page, a *Missing* column on the series
  lists, a per-season episode grid on the series page, dashboard tiles, and
  `expected_episodes` / `missing_episodes` / `missing_list` columns in the
  series CSVs. A *Match…* dialog lets you search either source, pick the right
  entry, enter counts by hand, or mark a series as having none; those choices
  are locked and never overwritten. AniList split-cour "Part 2" entries are
  merged into their season; ongoing series count aired episodes; absolute
  numbering on disk is detected and skipped rather than reported as missing.
- **Duplicate review.** New *Duplicates* page shows every season/episode that
  exists as several files side by side (size, length, resolution, bitrate,
  codec, HDR, audio, subtitles) with the best-quality candidate flagged. Mark
  one as *Keep*; the decision is remembered across scans. Nothing is deleted.
- **Quality report.** New *Quality* page: series and seasons that mix
  resolutions, files below a per-resolution bitrate threshold (editable in
  Settings), files with no audio track, undefined audio language, and files
  under two minutes. `mixed_resolution` and `low_bitrate_files` columns in the
  series CSVs.
- **Rename tool (opt-in, off by default).** New *Rename files* page proposes
  Plex-standard names (`Show - S01E02 - Title.ext`, `Title (Year) - Edition.ext`)
  from the parsed details and manual fixes. Tick the files, confirm, and they
  are renamed in place — never moved, never overwritten — with every attempt
  logged. The only feature that writes to the share; gated by a setting.
- **Folder watch (setting).** Windows change notifications on each root start a
  scan once the folder has been quiet for a configurable number of seconds.
- Automatic re-parse of the whole database when parser rules change (26 → 4
  unparsed files on the reference library without a rescan).
- `--screenshots=<dir>` and `--social=WxH` modes for README images;
  `--profile=<dir>` to run a second copy against a separate data folder.
- README: badges, screenshot gallery, scan timings, CSV reference, privacy
  notes, FAQ and roadmap.

### Changed

- Dashboard: "Season gaps" panel replaced by "Most missing episodes"; new tiles
  for missing episodes, duplicates, mixed quality, low bitrate, undefined audio
  language and folder watch. Audio-language chart labels `und` as "undefined".
- Sidebar regrouped into Library / Review / Maintenance / App with counters on
  Missing episodes, Duplicates and Problems.

### Fixed

- Scan-history average duration no longer counts scans from before the column
  existed.
- Database migrations strip SQL comments before splitting statements (a comment
  containing a semicolon broke the v2 upgrade).
## [0.2.0] - 2026-09-05

### Added

- Manual fixes: a **Fix…** button on every episode, movie file and Problems row
  opens a form to correct series, season, episode, title, year or edition, or to
  ignore a file. Fixes are stored in the database and re-applied on every scan.
- Multi-threaded directory listing (worker threads, on by default, toggle and
  thread count in Settings). Full TV root: 2 min 40 s instead of ~12 min;
  rescan with nothing changed: 3 s.
- Problems view now also lists duplicate episodes, ignored files and saved fixes,
  with a summary strip at the top; the sidebar shows an open-problem count.
- Change log summary strip and a 30-day activity chart above the list.
- Dashboard: audio/subtitle language, frame rate, dynamic range and audio codec
  breakdowns, library health, below-720p count, average bitrate, recently added,
  largest movie files, season gaps and scan history panels.
- CSV export moved to its own tab with history, row counts and open-folder buttons.
- About page with version, runtime, ffprobe, data folder, credits and a
  **Check for updates** button; silent auto-update from GitHub Releases for the
  installed app (electron-updater).
- ffmpeg auto-download: when no ffprobe is found the app fetches the latest
  static Windows build from BtbN's FFmpeg-Builds into its data folder on first
  launch; a manual download button lives in Settings.
- Database schema versioning with automatic pre-migration backups, a manual
  backup button, and a Data section in Settings explaining where everything lives.
- Scan duration and thread count recorded per scan; probe rate and ETA shown
  while scanning.
- Windows installer (NSIS one-click, per-user) built by CI on tag push.

### Changed

- Default ffprobe concurrency raised from 4 to 8.
- Quieter scrollbars, tighter table spacing, uppercase column headers, wrapping
  path cells.
- Parser understands `2Show S3.mp4` (number glued to the title),
  `Title_-_01_720p_Group.mp4`, `Show - OVA.mp4` and `Special 01 - Title.mp4`
  (season 0).

## [0.1.0] - 2026-09-05

### Added

- Initial release: Electron desktop app that walks the TV, Anime and Movies
  shares, probes files with ffprobe, stores results in SQLite, exports CSVs,
  keeps a change log, and schedules scans via an in-app timer or Windows Task
  Scheduler.
