# MediaLedger

Local Windows desktop app that inventories a Plex-style media share and keeps a
change history. It reads the files directly over SMB, runs `ffprobe` on each one,
and stores everything in a local SQLite database. No web server, no browser tab,
no accounts.

- **TV and Anime** – series → seasons → episodes, with runtime, resolution, fps,
  codec, bit depth / HDR, audio languages and channel layout, embedded subtitle
  tracks and sidecar subtitle files, and a per-file "has captions" flag.
- **Movies** – one row per file, grouped by title + year so titles with several
  files (`[720p]`, `[4k]`, Director's Cut, …) are called out as multiples.
- **Manual fixes** – a *Fix…* button on any file corrects what the parser got
  wrong (or ignores the file). Fixes live in the database and are re-applied on
  every rescan, so a corrected file never comes back as a problem.
- **CSV export** – eight files per export (episodes + series summary for TV and
  Anime, movies per file / per title / multiples only, and the change log),
  written to a timestamped folder plus a `latest\` copy.
- **Dashboard** – counts, size and runtime per library; resolution, codec,
  container, language, frame-rate and HDR breakdowns; movie multiples; library
  health; recently added; largest series and files; season gaps; scan history.
- **Change log** – every scan records added, removed, modified and returned
  files, ffprobe failures and unreachable roots, with a summary and 30-day chart.
- **Problems** – unparseable names, ffprobe errors, duplicate episodes, missing
  files, ignored files and saved fixes, each with a *Fix…* button.
- **Scheduling** – an in-app timer (while the app is open) and a Windows Task
  Scheduler job (runs even when it is closed).
- **Fast scans** – multi-threaded directory listing plus a pool of ffprobe
  processes. A 24k-file library rescans in seconds when nothing changed.
- **Self-contained** – downloads ffmpeg on first launch if none is installed,
  updates itself from GitHub Releases, and keeps its database and settings in
  your user profile so reinstalling or updating never loses data.

## Install

Download the latest `medialedger-<version>-setup.exe` from
[Releases](https://github.com/AxialForge/medialedger/releases) and run it. It is
a one-click per-user install (no admin prompt). The app checks for updates on
launch and installs them silently on the next restart.

## Run from source

```bash
npm install
npm start
```

Headless scan (what the scheduled task runs):

```bash
npm run scan
```

Tests and a local installer build:

```bash
npm test
npm run build:win
```

## Where things live

| Item | Location |
|------|----------|
| Database, settings, log, ffmpeg download | `%APPDATA%\MediaLedger\` (`medialedger.db`, `settings.json`, `medialedger.log`, `tools\`) |
| Database backups | `%APPDATA%\MediaLedger\medialedger.db.backups\` (automatic before schema upgrades, manual from Settings, newest 10 kept) |
| CSV exports | `%APPDATA%\MediaLedger\exports\<stamp>\` and `...\exports\latest\` (changeable in Settings) |
| Scheduled task | Task Scheduler → `MediaLedger Scan` |

## How a scan works

1. Each enabled root is listed. With multi-threading on, the root's top-level
   folders are dealt out to worker threads that `readdir`/`stat`/parse in
   parallel; loose files (the flat Movies folder) are split across them too.
2. Every video is parsed from its path (`src/main/parse.js`), merged with any
   saved fix, and upserted. A file whose size or modified time changed is marked
   *modified*; a file not seen this time is marked *missing* (never deleted). A
   root that is offline is skipped so a NAS outage never empties the library.
3. New, modified and never-probed files are queued for `ffprobe` (N at a time).
   Unchanged files are not re-read unless *Re-probe unchanged files* is on.
4. The change log is written, and if enabled the CSVs are exported.

## Naming conventions understood

| Layout | Parsed as |
|--------|-----------|
| `Show\Show S1\Show S01E01 - 720p WEB-DL.mp4` | S01E01, release tag ignored as a title |
| `Show\Show S1\12 Show S1.mp4`, `2Show S1.mp4` | episode 12 / 2, season from folder (or the `S1` suffix) |
| `Show\Show_S01E03_Episode Title_.mp4` | S01E03 with episode title |
| `Show\Group_Romaji_Title_-_01_720p_Group.mp4` | episode 1 |
| `Show\Season 02\Show - 2x05 - Title.mkv` | S02E05 |
| `Show S01E01E02.mkv`, `S01E01-02` | double episode |
| `Show\Show S0\…`, `Specials`, `Show - OVA.mp4`, `Special 01 - Title.mp4` | season 0 |
| `Title (Year) [720p].mp4` + `Title (Year) [4k].mkv` | one title, two versions |
| `Title (Year)\Title (Year) - Extended.mkv` | edition from the file name |

Anything the parser cannot place still gets indexed and probed; it shows up
under **Problems → Unparsed file names** with a *Fix…* button.

## Plex

Settings has a Plex URL/token and a connection test. Matching files to Plex
library items (Plex titles, watched state) is a planned later phase; the seam is
`src/main/plex.js`.

## License

MIT — see [LICENSE](LICENSE).
