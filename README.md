<p align="center">
  <img src="build/icon.png" width="96" alt="MediaLedger icon">
</p>

<h1 align="center">MediaLedger</h1>

<p align="center">
  A local Windows desktop ledger for your Plex media share.<br>
  Knows every TV episode, anime episode and movie file on the NAS, what each one is made of, and what changed since last time.
</p>

<p align="center">
  <a href="https://github.com/AxialForge/medialedger/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/AxialForge/medialedger?display_name=tag&sort=semver"></a>
  <a href="https://github.com/AxialForge/medialedger/actions/workflows/release.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/AxialForge/medialedger/release.yml?label=build"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-38-47848f">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-green"></a>
</p>

![Dashboard](docs/screenshots/dashboard.png)

---

## Why

Plex is great at playing a library and poor at answering questions about it.
*Which anime series are missing episodes? How many movies do I have in two
resolutions? Which TV shows have no subtitles at all? What got added to the NAS
last week?* MediaLedger answers those by reading the files themselves with
`ffprobe`, keeping the results in a local SQLite database, and diffing every
scan against the last one.

It runs entirely on your PC. There is no web server, no browser tab, no account,
and nothing leaves the machine except an update check against this repository.

## Highlights

| | |
|---|---|
| **Five library types** | TV, Anime and Movies roots parsed with rules that match Plex-style folders and the messy real-world variants (`2Show S3.mp4`, `Title_-_01_720p_Group.mp4`, `Show - OVA.mp4`); *Web videos* roots for yt-dlp downloads grouped by channel; *Adult* roots whose files are auto-classified as anime, TV or movie and hidden until a sidebar switch is on. |
| **Ratings** | Online averages from TVmaze / AniList plus your own 0–5 stars and a note per title, on a Ratings tab and in the CSVs. |
| **Per-file detail** | Runtime, resolution, fps, video codec and profile, bit depth, HDR / Dolby Vision, bitrate, container, audio codecs, languages and channel layouts, embedded subtitle tracks and languages, sidecar subtitle files, and a single *has captions* flag. |
| **Movie multiples** | Files are grouped by title + year, so `Pacific Rim (2013).mp4` and `Pacific Rim (2013) [4k].mkv` show up as one title with two versions and land in a dedicated CSV. |
| **Missing episodes** | Expected counts per season from TVmaze (TV) and AniList (anime), free and keyless, fetched in the background. Shows exactly which episodes you lack, per series and per season, with a *Match…* dialog to correct a wrong match or enter counts by hand. |
| **Duplicate review** | Every episode that exists as several files, side by side, best-quality candidate flagged. Mark one to keep; the decision is remembered. Nothing is ever deleted. |
| **Quality report** | Series that mix resolutions, files with unusually low bitrate for their resolution, no audio track, undefined audio language, or a suspiciously short runtime. |
| **Manual fixes that stick** | A *Fix…* button on any file corrects series, season, episode, title, year or edition, or ignores the file. Fixes are stored in the database and re-applied on every scan, so a corrected file never comes back as a problem. |
| **Change log** | Every scan records added, removed, modified and returned files, ffprobe failures and unreachable roots, with a 30-day activity chart. |
| **Problems view** | Unparseable names, ffprobe errors, duplicate episodes, missing files, ignored files and saved fixes in one place. |
| **CSV export** | Eight files per export into a timestamped folder plus a `latest\` copy, so a spreadsheet can always point at the same file names. |
| **Fast scans** | Directory listing runs on worker threads; probing runs as a pool of ffprobe processes. A 24,000-file library rescans in seconds when nothing changed. |
| **Scheduling** | An in-app timer while the app is open, a Windows Task Scheduler job that runs even when it is closed, and an optional folder watch that scans as soon as the share goes quiet after a change. |
| **Movie naming engine** | Builds `Title (Year) - Source Resolution HDR Codec` names from parsed title/year plus *probed* facts only. Placeholders for anything unproven, blocking for anything unsafe, dry run by default, whole-batch pre-flight, per-file verification, journal and undo. |
| **Rename tool for TV/anime (opt-in)** | Proposes Plex-standard episode names from what the app already knows, renames only what you tick, in place, never overwriting, with a full log. Off by default. |
| **Self-contained** | Downloads ffmpeg on first launch if none is installed, updates itself silently from GitHub Releases, and keeps its database and settings in your user profile so reinstalling or updating never loses data. |

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/anime.png" alt="Anime series list"><br><sub><b>Series list</b> — seasons, episodes, runtime, size, resolutions, languages, captions coverage and parse issues per series. Sortable and filterable.</sub></td>
    <td width="50%"><img src="docs/screenshots/episodes.png" alt="Episode detail"><br><sub><b>Episode detail</b> — every probed field per file. Click a row to reveal the file in Explorer; <i>Fix…</i> corrects the parsed details.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/movies.png" alt="Movies"><br><sub><b>Movies</b> — one row per title with a ×N badge where several files exist, and a filter for only those.</sub></td>
    <td><img src="docs/screenshots/movie-versions.png" alt="Movie versions"><br><sub><b>Movie versions</b> — the files behind one title side by side: resolution, codec, HDR, audio, subtitles, size.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/missing.png" alt="Missing episodes"><br><sub><b>Missing episodes</b> — expected vs on-disk counts per series from TVmaze / AniList, with exactly which episodes are absent.</sub></td>
    <td><img src="docs/screenshots/duplicates.png" alt="Duplicate review"><br><sub><b>Duplicates</b> — files for the same episode side by side; mark the one to keep.</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/screenshots/movienames.png" alt="Movie naming engine"><br><sub><b>Movie names</b> — proposed names from probed data with placeholders and flags; dry run, live switch, batch limit, layout, journal and undo.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/web.png" alt="Web videos"><br><sub><b>Web videos</b> — yt-dlp downloads grouped by channel folder, with per-channel video lists and YouTube links.</sub></td>
    <td><img src="docs/screenshots/ratings.png" alt="Ratings"><br><sub><b>Ratings</b> — online averages from TVmaze / AniList beside your own stars and notes.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/quality.png" alt="Quality report"><br><sub><b>Quality</b> — mixed-resolution series, low-bitrate files, missing audio, short files.</sub></td>
    <td><img src="docs/screenshots/rename.png" alt="Rename tool"><br><sub><b>Rename files</b> (opt-in) — Plex-standard names proposed from parsed details and fixes; tick, confirm, done.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/changes.png" alt="Change log"><br><sub><b>Change log</b> — totals, a 30-day chart, and the full list filterable by scan and kind.</sub></td>
    <td><img src="docs/screenshots/problems.png" alt="Problems"><br><sub><b>Problems</b> — everything the scanner could not resolve, each with a <i>Fix…</i> button.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/fix-modal.png" alt="Fix dialog"><br><sub><b>Fix dialog</b> — shows what the parser guessed and lets you set the right values or ignore the file. Applied instantly and on every future scan.</sub></td>
    <td><img src="docs/screenshots/export.png" alt="CSV export"><br><sub><b>CSV export</b> — run an export, open the folders, see what each file contains and the export history.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/settings.png" alt="Settings"><br><sub><b>Settings</b> — roots, threading, ffprobe download, export folder, schedules, data and backups, updates, Plex.</sub></td>
    <td><img src="docs/screenshots/about.png" alt="About"><br><sub><b>About</b> — version, runtime, ffprobe, data folder, update status and a manual check.</sub></td>
  </tr>
</table>

## Install

1. Download `medialedger-<version>-setup.exe` from the
   [latest release](https://github.com/AxialForge/medialedger/releases/latest).
2. Run it. It is a one-click, per-user install with no admin prompt. The build is
   not code-signed, so SmartScreen shows *More info → Run anyway* the first time.
3. On first launch, point **Settings → Library roots** at your shares (UNC paths
   such as `\\nas\Media\TV` work directly) and press **Scan now**.

If no `ffprobe.exe` is found on the machine, MediaLedger downloads the latest
static ffmpeg build from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)
into its data folder automatically. An existing install under `C:\ffmpeg`,
winget, scoop or `PATH` is picked up instead.

Updates are checked on launch and every six hours and installed silently on the
next restart. No account or token is needed; the token field under
Settings → Updates is only a fallback for a private fork.

## Run it on a Raspberry Pi

The same app runs as a website on any Linux box with Node 22, built for a
Raspberry Pi 4 on Raspberry Pi OS Lite (64-bit). One script installs everything:

```bash
curl -fsSL https://raw.githubusercontent.com/AxialForge/medialedger/main/server/install.sh -o install.sh
sudo bash install.sh
```

It installs Node 22 and ffmpeg, downloads the verified **server-only package**
(`medialedger-server.tar.gz` from Releases, no Electron, no dependencies),
mounts the share at `/mnt/media` (asks once for the share login, stored
root-only in `/etc/medialedger-cifs.cred`), creates a `medialedger` system user
and hardened service on port 8080, and asks for the web password. Then open
`http://medialedger.local:8080` from any device on the LAN.

The complete guide, from flashing the card to security hardening, moving your
desktop database over and troubleshooting, is
**[docs/RASPBERRY-PI.md](docs/RASPBERRY-PI.md)**.

Security on the web server: scrypt password, HttpOnly SameSite cookies,
per-address lockout, LAN-only by default, optional two-factor codes (TOTP),
password re-entry for actions that touch the share, strict CSP, an audit log
and a **Security** tab to manage all of it. A **System** tab shows Pi
temperature, throttling, CPU, memory, disks and network.

| Command | Does |
|---|---|
| `sudo medialedger-update` | pull the latest release and restart |
| `sudo medialedger --set-password` | change the web password (signs everyone out) |
| `journalctl -u medialedger -f` | follow the log |

Every tab works in the browser. Differences from the desktop app: folder paths
are typed rather than picked, "open folder" buttons do nothing, and updates come
from `medialedger-update` instead of the in-app updater. The database format is
identical, so `medialedger.db` can be copied between the PC and the Pi.

## What a scan does

1. **List.** Each enabled root is walked. With multi-threading on (the default),
   the root's top-level folders are dealt out to worker threads that
   `readdir` / `stat` / parse in parallel; loose files at the root, such as a
   flat Movies folder, are split across them too.
2. **Diff.** Every video is compared with the database. New files are added,
   files whose size or modified time changed are marked *modified*, files not
   seen this time are marked *missing*. Nothing is ever deleted automatically.
   A root that is offline is skipped entirely, so a NAS outage never empties the
   library.
3. **Fix.** Saved manual fixes are merged over the parser result.
4. **Probe.** New, modified and never-probed files go through `ffprobe`, N at a
   time. Unchanged files are not re-read unless you turn on *Re-probe unchanged
   files*.
5. **Log and export.** The change log is written and, if enabled, the CSVs.
6. **Expected counts.** Series not yet looked up are matched on TVmaze or
   AniList in the background (about one per second, to respect their limits);
   airing series are re-checked every two weeks.

Timings on a gigabit SMB link to a consumer NAS, 24,628 files:

| Scan | Threads / probes | Time |
|------|------------------|------|
| First full scan, everything probed | 1 / 4 | 25 min |
| TV root only (11,419 files), first scan | 4 / 8 | 2 min 40 s |
| Rescan, nothing changed | 4 / 8 | 3 s |

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

Anything the parser cannot place is still indexed and probed; it appears under
**Problems → Unparsed file names** with a *Fix…* button. When the parser rules
improve in a new version, the whole database is re-parsed on the next launch, so
you get the improvement without a rescan.

## Movie naming engine

The *Movie names* tab renames movie files to

```
Title (Year) - Source Resolution HDR Codec [Audio] [{edition-Name}].ext
A Breed Apart (2025) - Web 1080p SDR H264.mp4
Avatar (2009) - Rip 4K HDR HEVC {edition-Extended Collector's Edition}.mkv
```

| Token | Comes from | If unknown |
|-------|-----------|------------|
| Title, Year | parser + your manual fixes | `Year` placeholder, file flagged |
| Source | `(LiLTV)` / WEB markers → `Web`; BRrip, BluRay, Remux, DVD → `Rip`; or the Fix dialog | `Source` placeholder, file flagged |
| Resolution | ffprobe pixel size | blocked |
| HDR / SDR | ffprobe colour transfer (HDR10, Dolby Vision, HLG → `HDR`) | `SDR` |
| Codec | ffprobe video codec | blocked |
| Audio | ffprobe languages, only when not plain English (`ENG+JPN`) | omitted, flagged |
| Edition | edition words in the old name (`{edition-Director's Cut}`) | omitted |

Blocked (never renamed): no successful probe, no title, or two files that would
receive the same name. Flagged (renamed, but listed): placeholders, a resolution
in the old name that disagrees with the probe, HDR claimed but not found,
undefined audio language.

Every batch is a **dry run** unless "Allow live renames" is on and you type
RENAME. Pre-flight checks every file before anything moves; one failure aborts
the whole batch. Each rename is verified by size before the database is
updated. Every item is journaled and a batch can be undone, file by file, with
the same checks in reverse. Scans and the folder watcher pause while a live
batch runs.

## CSV files

| File | Contents |
|------|----------|
| `tv_episodes.csv`, `anime_episodes.csv` | One row per episode file with every probed field |
| `tv_series.csv`, `anime_series.csv` | One row per series: seasons, episodes, runtime, size, resolutions, codecs, languages, captions %, episode gaps, expected and missing episodes with the exact list, mixed-resolution and low-bitrate flags |
| `movies.csv` | One row per movie file, with the number of versions of that title |
| `movies_titles.csv` | One row per title: file count, versions, best resolution, size, languages |
| `movies_multiples.csv` | Only titles with more than one file |
| `web_videos.csv` | One row per web video: channel, title, upload date, video id and every probed field |
| `changes.csv` | The change log for the scan that triggered the export |

## Where things live

| Item | Location |
|------|----------|
| Database, settings, log, downloaded ffmpeg | `%APPDATA%\MediaLedger\` |
| Database backups | `%APPDATA%\MediaLedger\medialedger.db.backups\` (automatic before schema upgrades, manual from Settings, newest 10 kept) |
| CSV exports | `%APPDATA%\MediaLedger\exports\<stamp>\` and `...\exports\latest\` (changeable) |
| Scheduled task | Task Scheduler → `MediaLedger Scan` |

## Privacy and safety

- By default the share is only ever read. The one exception is the rename
  tool, which is off until you enable it, renames only files you tick, and
  never moves, overwrites or deletes anything.
- Rows are never deleted automatically; a vanished file is flagged *missing*
  until you press *Forget missing files*.
- Adult roots are hidden from every view and count until the sidebar switch is
  on, which resets on every launch, and are excluded from CSVs by default.
- Network access is limited to the GitHub update check, the optional ffmpeg
  download from GitHub, the episode-count lookups on TVmaze and AniList (only
  series titles are sent; can be disabled in Settings), and the optional Plex
  connection test. Set
  `NO_AUTO_UPDATE=1` in the environment to disable the update check entirely.

## Run from source

```bash
npm install
npm start
```

```bash
npm run scan        # headless: scan → export → exit (what Task Scheduler runs)
npm test            # parser + updater unit tests
npm run build:win   # local installer into dist/
```

Requires Node 20+ for development. Electron ships its own Node at runtime, and
the app has no native addons, so there is nothing to compile.

## FAQ

**Does it need Plex?** No. It reads the files directly. A Plex URL and token can
be entered in Settings, but today only the connection test uses them.

**Will it change my files?** Not unless you turn on the rename tool in
Settings and tick files on the Rename page. Everything else it learns goes into
its own database.

**Where do the expected episode counts come from?** TVmaze for TV, AniList for
anime. Both are free and need no account. AniList counts by cour, so a split
season shows up as "Part 2"; MediaLedger merges those, and the *Match…* dialog
lets you switch a series to TVmaze if its season numbering fits the folders
better.

**What happens to my data on update or reinstall?** Nothing. The database and
settings live in your user profile, not the install folder. Schema upgrades
take a backup first.

**Can I run it on a second PC?** Yes, install it there and point it at the same
shares. Each install keeps its own database and fixes.

**The NAS was off during a scheduled scan. Did everything get marked missing?**
No. An unreachable root is logged as `root_offline` and skipped.

## Roadmap

- Move-into-season-folder option for the rename tool.
- Poster and synopsis from the metadata match on the series page.

## License

MIT — see [LICENSE](LICENSE). ffmpeg is downloaded separately and is licensed
under the LGPL/GPL by its authors.
