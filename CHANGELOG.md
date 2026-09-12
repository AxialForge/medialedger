# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

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
