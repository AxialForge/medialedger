# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

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
