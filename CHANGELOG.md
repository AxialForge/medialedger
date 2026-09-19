# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [1.9.3] - 2026-09-18

### Changed

- The timed Plex sync defaults to every 6 hours (it only runs when a token is
  set); the Plex section shows the current interval and links to Schedules.

### Fixed

- Tables inside cards no longer overflow: on the Missing page the "N missing"
  badges were cut off by the neighbouring card on mid-width windows. Cards in
  two-column rows now stack below 1180 px instead of squeezing.

## [1.9.2] - 2026-09-17

### Added

- **Settings → Schedules**: every timed job in one table (scan, Plex sync,
  metadata, backup, snapshot, daily summary) with when it runs, last and next
  run, and a **Run now** button. The timing controls for backup, snapshot and
  summary moved here.
- **Timed Plex sync**: an hourly interval independent of scans, so the Watched
  tab and play counts stay current on days without a scan.

### Changed

- The daily snapshot time is configurable (was fixed at 03:05).

## [1.9.1] - 2026-09-16

### Added

- **Watched tab**: who watched what, from Plex's server-wide play history
  (every account, not just the token owner's). Period and person filters,
  plays / hours / titles / people tiles, charts by person, library, weekday,
  hour and device, plays-per-day trend, most watched series and movies with
  who watched them, binge sittings, and a searchable recent-plays list that
  opens the matched title. Each Plex sync pulls new history; scrobble
  webhooks add plays in between, with the account name. Schema v10.
- **Upgrade candidates are ranked**: shortfall from 1080p (plus low bitrate)
  weighted by plays, your stars and the online rating; 4K and HDR copies and
  never-played unrated titles score 0.

### Changed

- The dashboard "Watched" tile opens the Watched tab.

### Changed

### Fixed

## [1.9.0] - 2026-09-16

### Added

- **Readable charts**: bar charts on a square-root scale with exact counts and
  shares, hover details with the per-library split, and drill-down (click a bar
  to open the list filtered to it). Donut cards for anime sub / dub and Plex
  watched state. Trend cards (files, free space, missing episodes) fed by a
  new **daily snapshot** taken after each finished scan or at 03:05. Schema v9.
- **Colour rules on number tiles** with shipped defaults and a ⚙ per card;
  an **editor level** (Simple / Standard / Advanced) per account decides how
  much the card settings expose. Preferences live per account on the web
  server (guests see the admin's) and once on the desktop.
- **Phone layout for cards**: one column, number tiles two per row.
### Changed

### Fixed

## [1.8.0] - 2026-09-16

### Added

- **Dashboard and list tiles for the new data.** Dashboard: Pending requests,
  Airing this week (next episode named), Watched, Genres known, Your tags,
  Upgrade candidates, Ended but incomplete, plus Genres, Anime sub / dub and
  Your tags charts. TV, Anime and Movies lists: Watched, Complete, Sub / dub,
  Top genres and Your tags tiles. Tiles that summarise a page link to it.
### Changed

### Fixed

## [1.7.0] - 2026-09-15

### Added

- **TV and anime renames go through the movie batch engine**: pre-flight of
  the whole batch, verified renames, a journal in the Batches table on the
  Rename tab, and **Undo**. Dry run added. Name parts for episodes: the episode
  title (on by default) plus opt-in Resolution, Codec and Sub/Dub in square
  brackets, editable by clicking chips or the words in any proposed name.
### Changed

### Fixed

## [1.6.0] - 2026-09-15

### Added

- **Upgrades** page: every title ranked by how much it deserves a better copy,
  with plain-English reasons; the scoring function is `src/main/upgrades.js`.
- **Airing next** on the Missing page: the next episode date from TVmaze /
  AniList per series, this week highlighted, plus *Finished airing, still
  incomplete*. Unaired episodes no longer count as missing. Series are
  re-checked once their expected episode has aired. Schema v8.
- **Notifications** (Settings): a JSON webhook (Home Assistant, ntfy,
  Discord…) and/or e-mail through a dependency-free SMTP client, for new
  requests, a daily summary and failed backups, with *Send a test*.
- **Home Assistant status**: `GET /api/status?key=…` on the web server returns
  a small JSON summary for a RESTful sensor; key shown and rotated in Settings.
- **Phone request page** at `/request`; the guest QR code now points there.
### Changed

### Fixed

## [1.5.0] - 2026-09-15

### Added

- **Watch tonight** page: every series and movie on one list, narrowed by
  unwatched (Plex), complete series, length, your rating, genre, sub/dub and
  tag, with *Pick for me* choosing at random from what is left.
- **Filter dropdowns** on the TV, Anime and Movies lists: genre, sub/dub, your
  tag, and watched state from Plex.
- **Storage forecast**: a *Free on the share* tile and a per-month growth panel
  on the Dashboard, estimating when the share fills at the recent rate.
- **Nightly backup to a folder** (Settings → Data): a dated copy of the
  database to the NAS once a day, newest N kept, with *Back up there now*.
- **Sub/Dub name part** for the movie naming engine, off by default: `Sub`,
  `Dub` or `Dual` from the probed languages.
### Changed

### Fixed

## [1.4.0] - 2026-09-15

### Added

- **Tags** on every series and movie, three kinds: **genres** from the same
  TVmaze / AniList lookup that fetches episode counts (AniList's ranked tags
  such as Isekai too; movies take theirs from Plex), **sub / dub** worked out
  locally from the probed audio and subtitle languages (Subbed, Dubbed, Dual
  audio, Mixed), and **your own tags** typed on a title page (`kids`,
  `Christmas`…, suggestions from earlier tags, × to remove). Shown in a Tags
  column on the lists, matched by the filter box, exported in the series and
  movie title CSVs, guests read-only. Series matched before this version get
  their genres filled in once in the background. Schema v7.
### Changed

### Fixed

## [1.3.1] - 2026-09-15

### Added

- **Editable name pattern** for the movie naming engine: Batch settings →
  *Name parts* shows Source, Resolution, HDR/SDR, Codec, [Audio] and {edition}
  as chips; click one to leave it out of every name, use the arrows to reorder,
  and the list rebuilds. Every proposed name in the list is made of clickable
  words that do the same, so clicking `Source` in any row drops it everywhere.
  Stored as `movieRename.parts`; the `no_source` flag only appears while Source
  is in use.

### Fixed

- **Installer asked for a new web password on every rerun** since 1.1: it
  looked for the pre-accounts `passwordHash` key. It now checks for an admin
  account and leaves the password alone.
- The certificate download is named `.crt` instead of `.pem`, so Windows opens
  its certificate installer on double-click instead of asking for an app.
### Changed

### Fixed

## [1.3.0] - 2026-09-15

### Added

- **QR codes** for the two things people type by hand: the 2FA setup now shows
  a code to scan with Google Authenticator (or any TOTP app), and when guest
  access is on the Security tab shows a code for the site address to stick by
  the TV. Dependency-free encoder (`renderer/qr.js`, byte mode, level M,
  versions 1–15), verified against a reference decoder.
- **Turn on HTTPS** button on the Security tab: makes a self-signed
  certificate for every name and LAN address the Pi answers to (including a
  custom domain), restarts on TLS, keeps sessions, and then offers *Download
  certificate* with per-device steps (Windows, Android, iPhone, macOS) to
  remove the browser warning. A port-80 install moves to 443 with a redirect
  left on 80. `GET /tls/cert.pem` serves the public half to signed-in users.
- **Plex token from the XML address**: Settings → Plex gains a box to paste
  the *View XML* tab's address; the token (and the server URL when it is a LAN
  address) are pulled out and the pasted text is discarded.
- **Colour themes**: Settings → Appearance with eight palettes (Graphite,
  Midnight blue, Obsidian, Forest, Rose quartz, Lavender, Gunmetal, Crimson
  steel), applied at once and remembered per browser (`theme.js` applies it
  before the first paint).
- **Zip threshold** on the Export tab: *Zip the files as well, when at least N
  files* (default 4), so a single-CSV export does not get an archive.
- A **Save** button beside *Idle sign-out* (same as *Save options*).
- **One at a time renaming** in both rename tools: a *Rename* button on every
  ready row, and *One at a time (N)* that walks the ticked files through a
  Rename / Skip / Stop dialog. Each confirmed file is its own batch (same
  pre-flight, verification and journal), so every step is undoable alone.

### Changed

### Fixed

- **2FA setup vanished on click.** The *Set up 2FA* handler re-rendered the
  Security tab as soon as the secret arrived, wiping the secret before it could
  be entered. The box now stays until the code is confirmed.

## [1.2.2] - 2026-09-14

### Changed

- **User manual regenerated for 1.1 to 1.2.1**: new chapters for Issues
  (Problems, Fix dialog, Duplicates in one place) and Media requests, the
  CSV export chapter covers set selection, zip and browser downloads, Plex
  gains a webhook section, Security opens with accounts and roles (admin,
  standard, guest) and the Users control, and the Pi chapter covers the
  `admin` sign-in, `--port=80 --domain=` and the router-side DNS record.
  PDF refreshed. Screenshot mode now captures the Issues and Requests pages.

### Fixed

- The Problems view's *Duplicate episodes* tile showed "undefined" since the
  0.7.0 core split: the core returns a count while the page expected rows.
  The tile now shows the count and points at the Duplicates button; the
  redundant duplicate table under Problems is gone.

## [1.2.1] - 2026-09-14

### Added

- **Custom internal domain.** `install.sh --port=80 --domain=medialedger.home`
  serves the Pi on the default web port under your own LAN name; the systemd
  unit grants the unprivileged service only `CAP_NET_BIND_SERVICE`, the
  self-signed certificate (with `--https`) is issued for that name, and the
  domain is remembered for later reruns. The Pi guide (section 7a) explains
  the router side: UniFi Settings → Routing → DNS → A record, or the
  equivalent on other routers, Pi-hole or a hosts file, and which name suffix
  to pick.

## [1.2.0] - 2026-09-14

### Added

- **Selectable CSV exports.** The Export tab lists the five sets (TV, Anime,
  Movies, Web videos, Change log) with checkboxes; tick what you need, or save
  the selection as the default that automatic exports after scans also use.
- **Zip option.** Tick *Zip the files as well* and every export also produces
  `medialedger-<stamp>.zip` (plus `latest/medialedger-latest.zip`). No
  dependency: a small built-in zip writer.
- **Downloads in the browser.** On the web build the export history links each
  CSV and zip for download (admin session).
- **Plex webhook** (Plex Pass) on the web server. Settings → Plex → Webhook:
  enable, copy the URL into Plex Web → Settings → Webhooks. Additions to a
  Plex library queue a scan two minutes later; watched (scrobble) and rated
  events update the linked file at once. The key in the URL is the credential
  (rotate it with *New key*), LAN-only still applies, and the last events are
  shown in Settings. The desktop app reports that webhooks need the server.

## [1.1.0] - 2026-09-14

### Added

- **User accounts with roles** on the web server. Sign-in is now username +
  password. **admin** can do everything; **standard** sees every library and
  review page, rates titles, files requests and may show adult content for
  their own session, but gets no settings, system, security, scans, fixes or
  renames; **guest** (optional, no sign-in) sees library statistics and lists
  and can file requests, never adult content. The 1.0 password becomes the
  `admin` account automatically. Security tab → Users: add, change role, reset
  password, delete; Guest access switch under Options. Two-factor codes apply
  to admin sign-ins. Standard users see the Plex and GitHub tokens blanked.
  Every refusal is enforced by the server and written to the audit log.
- **Media requests** tab: anyone may ask for a title (kind, year, note); admins
  set Pending / Approved / Added / Declined and leave a note. Pending count on
  the sidebar for admins.
- **Issues** tab merges Problems and Duplicates behind two buttons; the old
  `#problems` and `#duplicates` links still work.
- Account line in the sidebar with Sign in / Sign out.

### Changed

- Adult visibility is per session on the web server instead of one switch for
  everyone.

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
