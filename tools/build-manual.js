'use strict';
// Builds the MediaLedger user manual (.docx) from a folder of screenshots.
// Usage: node tools/build-manual.js <screenshot-dir> <out.docx>
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, Table, TableRow, TableCell, WidthType, AlignmentType, TableOfContents, PageBreak, LevelFormat, BorderStyle, ShadingType, Footer, Header, PageNumber } = require('docx');

const shots = process.argv[2];
const out = process.argv[3];
const version = require('../package.json').version;

const F = 'Calibri';
const img = (name, caption) => {
  const p = path.join(shots, name + '.png');
  if (!fs.existsSync(p)) return [new Paragraph({ children: [new TextRun({ text: `[screenshot ${name} missing]`, italics: true, color: '999999' })] })];
  const w = 624, h = Math.round(624 * 1203 / 1926);
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, children: [new ImageRun({ type: 'png', data: fs.readFileSync(p), transformation: { width: w, height: h } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: caption, italics: true, size: 18, color: '555555' })] }),
  ];
};
const H1 = t => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)], pageBreakBefore: true });
const H2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = t => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const P = (t, o = {}) => new Paragraph({ spacing: { after: 120 }, children: rich(t, o) });
const note = t => new Paragraph({ spacing: { before: 60, after: 160 }, indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: '5AA9FF', space: 8 } }, children: rich(t) });
const warn = t => new Paragraph({ spacing: { before: 60, after: 160 }, indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'F0B429', space: 8 } }, children: rich(t) });
const bullets = arr => arr.map(t => new Paragraph({ numbering: { reference: 'bul', level: 0 }, spacing: { after: 60 }, children: rich(t) }));
let stepInstance = 0;
const steps = arr => { const inst = ++stepInstance; return arr.map(t => new Paragraph({ numbering: { reference: 'num', level: 0, instance: inst }, spacing: { after: 60 }, children: rich(t) })); };
// **bold** and `code` inline
function rich(t, o = {}) {
  const parts = String(t).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map(x => x.startsWith('**') ? new TextRun({ text: x.slice(2, -2), bold: true, ...o }) : x.startsWith('`') ? new TextRun({ text: x.slice(1, -1), font: 'Consolas', size: 19, shading: { type: ShadingType.CLEAR, fill: 'EEF1F5' }, ...o }) : new TextRun({ text: x, ...o }));
}
function table(header, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (t, bold, fill) => new TableCell({ width: { size: 0, type: WidthType.DXA }, shading: fill ? { type: ShadingType.CLEAR, fill } : undefined, margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new Paragraph({ children: rich(t, { bold, size: 19 }) })] });
  const mk = (cells, bold, fill) => new TableRow({ children: cells.map((c, i) => { const tc = cell(c, bold, fill); tc.options.width = { size: widths[i], type: WidthType.DXA }; return tc; }) });
  return new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: widths, rows: [mk(header, true, 'DDE6F2'), ...rows.map(r => mk(r, false))] });
}
const numbering = { config: [
  { reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
  { reference: 'num', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
] };

const TOC_ENTRIES = [
  '1. What MediaLedger is', '1.1 What it never does', '1.2 Core concepts',
  '2. Installing and first run', '2.1 Install', '2.2 First launch', '2.3 Where your data lives', '2.4 Updates',
  '3. The window',
  '4. Dashboard', '4.1 Top tiles', '4.2 Charts', '4.3 Panels', '4.4 What the new data adds', '4.5 Charts, colours and drill-down', '4.6 Storage forecast',
  '5. TV Shows and Anime', '5.1 Episode detail', '5.2 Tags: genres, sub/dub and your own',
  '6. Movies', '7. Web videos', '8. Adult library',
  '9. Missing episodes', '9.1 The Match dialog', '9.2 Airing next',
  '10. Issues', '10.1 Problems', '10.2 The Fix dialog', '10.3 Duplicates',
  '11. Quality', '11.1 Upgrade candidates', '12. Ratings', '12.1 Watch tonight', '12.2 Watched: who watched what',
  '13. Media requests', '13.1 The phone page and notifications',
  '14. Change log',
  '15. Movie names (the naming engine)', '15.1 The pattern', '15.2 Ready, flagged, blocked', '15.3 Batch settings', '15.4 Running a batch', '15.5 Undo', '15.6 Bulk source, collisions, placeholders',
  '16. Rename TV / anime', '17. CSV export', '17.1 Choosing what to export', '17.2 The files', '18. Settings reference', '18.1 Appearance',
  '19. Plex integration', '19.1 Setup', '19.2 What a sync stores', '19.3 Plex webhook',
  '20. System (health and hardware)',
  '21. Security', '21.1 Accounts and roles', '21.2 Always on', '21.3 Controls', '21.4 Two-factor codes with a phone', '21.5 HTTPS',
  '22. Running MediaLedger on a Raspberry Pi', '22.1 Requirements', '22.2 Install, step by step', '22.3 First run on the Pi', '22.3a Your own name for the Pi', '22.4 Command reference', '22.5 Security on the Pi', '22.6 Moving the desktop database to the Pi', '22.7 File locations', '22.8 Pi troubleshooting',
  '23. Troubleshooting', '24. Glossary',
];
const body = [];
const add = (...x) => body.push(...x.flat());

// ---------------- Title ----------------
add(
  new Paragraph({ spacing: { before: 3000 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'MediaLedger', bold: true, size: 72, color: '1F3864' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'User Manual', size: 40, color: '444444' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400 }, children: [new TextRun({ text: `Version ${version}`, size: 24, color: '666666' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'A ledger for your Plex media share — Windows desktop app and Raspberry Pi web server', size: 24, color: '666666' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 2400 }, children: [new TextRun({ text: 'AxialForge · github.com/AxialForge/medialedger', size: 20, color: '888888' })] }),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Contents')] }),
  ...TOC_ENTRIES.map(t => new Paragraph({ spacing: { after: 40 }, indent: { left: /^\d+\.\d/.test(t) ? 540 : 0 }, children: [new TextRun({ text: t, size: /^\d+\.\d/.test(t) ? 20 : 22, bold: !/^\d+\.\d/.test(t) })] })),
);

// ---------------- 1 Welcome ----------------
add(H1('1. What MediaLedger is'),
  P('MediaLedger is a desktop application for Windows that keeps a **ledger** of everything on your media share: every TV episode, anime episode, movie file and web video, what each file is technically made of, what changed since the last look, and what is missing. It reads the files directly over the network with the ffprobe tool, stores the results in a local database on your PC, and shows the picture in a set of tabs.'),
  P('It is not a player, a downloader or a replacement for Plex. It sits beside Plex and answers the questions Plex is bad at: which series are missing episodes, which movies exist in two resolutions, which shows have no subtitles, what arrived on the NAS last week, and which files carry names that Plex will struggle with.'),
  H2('1.1 What it never does'),
  bullets([
    'It never deletes a file. Files that disappear from the share are flagged **missing** in the ledger until you press a button to forget them.',
    'It never writes to the share unless you turn on one of the two rename tools, tick specific files, and confirm. Everything else is read-only.',
    'It never sends your library anywhere. The only network calls are: the update check against GitHub, the optional ffmpeg download, episode-count lookups to TVmaze and AniList (series titles only), and your own Plex server on the LAN.',
    'The desktop app has no web server and no browser tab; it is a plain window. The optional Raspberry Pi build (chapter 22) is the same program served to your LAN behind a password.',
    'It never needs an online account, a subscription or an API key. The web server has its own local accounts (chapter 21); the desktop app has none.',
  ]),
  H2('1.2 Core concepts'),
  table(['Term', 'Meaning'], [
    ['Root', 'A folder MediaLedger watches, with a type: TV, Anime, Movies, Web videos or Adult. Usually a UNC path such as `\\\\192.168.1.204\\Apocrypha_Media_Pool\\Anime`.'],
    ['Scan', 'One pass over every enabled root: list files, compare with the ledger, parse names, probe new or changed files, write the change log, export CSVs.'],
    ['Parse', 'Working out series, season, episode, title and year from the folder and file name. Fast and offline.'],
    ['Probe', 'Running ffprobe on a file to read its real resolution, length, codecs, languages and subtitle tracks. This is the slow part; it only happens for new or changed files.'],
    ['Fix', 'A manual correction you make to a parsed result. Fixes live in the database and are re-applied on every scan, so a corrected file stays corrected.'],
    ['Change log', 'The record of what each scan found: added, removed, modified and returned files, plus errors.'],
    ['Expected episodes', 'Per-season episode counts fetched from TVmaze (TV) or AniList (anime), used to say exactly which episodes you lack.'],
    ['Placeholder', 'A literal word such as `Year` or `Source` that the movie naming engine writes into a name when it cannot prove the value. Deliberately visible so you can fill it in later.'],
  ], [1800, 7560]),
);

// ---------------- 2 Install ----------------
add(H1('2. Installing and first run'),
  H2('2.1 Install'),
  steps([
    'Download `medialedger-<version>-setup.exe` from the Releases page of the repository.',
    'Run it. It is a one-click, per-user install with no administrator prompt. The build is not code-signed, so Windows SmartScreen will show a blue box the first time: click **More info**, then **Run anyway**.',
    'The app opens automatically when the installer finishes and is added to the Start menu.',
  ]),
  H2('2.2 First launch'),
  P('On the first launch MediaLedger checks for ffprobe. If an ffmpeg install exists under `C:\\ffmpeg`, via winget or scoop, or on your PATH, it is used. If nothing is found, the app downloads the latest static Windows build of ffmpeg from the BtbN project into its own data folder and points itself at it. A toast in the corner shows progress; it is about 100 MB.'),
  P('Next, open **Settings → Library roots** and point each root at your shares. The defaults match the AxialForge NAS layout; change the paths if yours differ. Press **Save settings**, then **Scan now** in the bottom-left corner.'),
  note('The first scan probes every file and takes a while: about 25 minutes for 24,000 files over gigabit SMB. Every later scan only probes new or changed files and finishes in seconds. You can close the window during a scan started by the scheduler, but a manual scan is cancelled if you quit.'),
  H2('2.3 Where your data lives'),
  table(['Item', 'Location'], [
    ['Database, settings, log, downloaded ffmpeg', '`%APPDATA%\\MediaLedger\\`'],
    ['Automatic database backups', '`%APPDATA%\\MediaLedger\\medialedger.db.backups\\` (taken before every schema upgrade; newest 10 kept)'],
    ['CSV exports', '`%APPDATA%\\MediaLedger\\exports\\<timestamp>\\` plus a `latest\\` copy'],
    ['The program itself', '`%LOCALAPPDATA%\\Programs\\MediaLedger\\`'],
  ], [3600, 5760]),
  P('Because the data sits in your user profile and not in the program folder, reinstalling or updating never loses the ledger, your fixes or your ratings.'),
  H2('2.4 Updates'),
  P('The installed app checks GitHub Releases on launch and every six hours, downloads a newer version silently and installs it the next time you close the app. The About page has a **Check for updates** button and shows the current state. No account or token is needed.'),
);

// ---------------- 3 The window ----------------
add(H1('3. The window'),
  P('The left sidebar is the only navigation. It is grouped into **Library** (what you have), **Review** (what needs attention), **Maintenance** (tools that change or export things) and **App**. Orange counters on Missing, Issues (problems, then duplicates), Requests and Movie names show how many items wait for you.'),
  bullets([
    '**Scan now** starts a manual scan. While a scan runs the button becomes **Cancel scan** and a progress bar shows the phase (listing, indexing, probing), the rate and an estimate of the time left.',
    'A second thin progress bar appears while expected-episode lookups or a Plex sync run in the background.',
    'The **Show adult content** switch appears only when an Adult root is configured. It is off on every launch.',
    'The version in the bottom-left corner shows "(dev)" when the app is run from source rather than installed.',
    'On the web server an account line at the bottom of the sidebar shows who is signed in, with **Sign in** / **Sign out**.',
  ]),
  P('Every table in the app can be sorted by clicking a column heading (click again to reverse) and filtered with the search box above it. Many rows are clickable: a series opens its episodes, a movie title opens its files, an episode or movie file reveals itself in Windows Explorer.'),
);

// ---------------- 4 Dashboard ----------------
add(H1('4. Dashboard'), ...img('dashboard', 'The Dashboard after a full scan.'),
  P('The Dashboard is a summary of the whole ledger. Everything on it is computed live from the database.'),
  H2('4.1 Top tiles'),
  table(['Tile', 'What it shows'], [
    ['Library', 'Total files, total size and total hours of video across every non-adult root.'],
    ['TV Shows / Anime / Movies', 'Number of series or titles, number of files, size, and the share of files that have captions (embedded or sidecar subtitles).'],
    ['Movie multiples', 'Titles that exist as more than one file, how many extra files that is, and their combined size.'],
    ['Library health', '100% minus the share of files that are unparsed, failed to probe, or are missing.'],
    ['Captions', 'Files with any subtitle track or sidecar.'],
    ['Below 720p', 'Files whose probed resolution is 576p, 480p or SD.'],
    ['Avg bitrate', 'Average video bitrate, overall and per library.'],
    ['Last scan', 'When it ran, how long it took, and its added / removed / modified counts.'],
    ['Manual fixes', 'How many corrections you have saved.'],
    ['Last export', 'When CSVs were last written and how many files.'],
    ['Missing episodes', 'Episodes you lack according to TVmaze / AniList, how many series have gaps, and how many series are matched, unmatched or still pending.'],
    ['Duplicate episodes', 'Season/episode combinations that exist as several files.'],
    ['Mixed-quality series', 'Series with more than one resolution.'],
    ['Low-bitrate files', 'Files under the bitrate threshold for their resolution (thresholds are in Settings).'],
    ['Undefined audio language', 'Files whose audio track carries no language tag.'],
    ['Folder watch', 'Whether the optional folder watcher is on and when it last saw a change.'],
  ], [2600, 6760]),
  H2('4.2 Charts'),
  P('Eight stacked bar charts break the probed files down by resolution, video codec, audio codec, container, audio language, subtitle language, frame rate and dynamic range. Each bar is split by library (blue TV, purple Anime, orange Movies); hover a segment for the exact count.'),
  H2('4.3 Panels'),
  bullets([
    '**Recently added** – the newest files by first-seen time, with a link to the change log.',
    '**Largest series** and **Largest movie files** – by size on disk.',
    '**Most missing episodes** – the series with the biggest gaps, with the exact episodes listed; whole missing seasons collapse into ranges such as "S6–S12 entirely".',
    '**Scan history** – the last eight scans with status, trigger, thread count, duration and counts.',
  ]),
);

// ---------------- 5 TV & Anime ----------------
  H2('4.4 What the new data adds'),
  P('A third row of tiles covers what arrived with tags and lookups: **Pending requests**, **Airing this week** with the next episode named, **Watched** (Plex play counts across linked files, a click away from Watch tonight), **Genres known**, **Your tags**, **Upgrade candidates** and **Ended but incomplete**. Below the codec charts, three panels chart **Genres** by library, **Anime sub / dub**, and **Your tags**. The TV, Anime and Movies lists open with the same idea: Watched, Complete, Sub / dub, Top genres and Your tags tiles next to the size and runtime.'),
  H2('4.5 Charts, colours and drill-down'),
  P('Bar charts use a **square-root scale**, so a codec with 25,000 files no longer flattens the ones with 40; the exact count and the share of the total sit beside every bar, and hovering a bar shows the per-library split. Clicking a bar segment opens that library\'s list already filtered to the value (`#anime?q=720p`). Donuts show shares with the value in the centre, and the trend cards draw a line from the **daily snapshot** the server takes after each finished scan (or at 03:05): files, free space and missing episodes over time.'),
  P('Number tiles carry a **colour rule**: green, amber or red from thresholds. Every rule ships with a default (missing episodes turn amber at one and red at a hundred, library health turns amber under 97 %). Hover a tile and press the ⚙ to change it. The dialog has an **editor level** for your account: Simple hides every knob, Standard keeps the shipped defaults, Advanced lets you set the thresholds and the direction. Preferences are stored per account on the web server, and once for the desktop app.'),
  H2('4.6 Storage forecast'),
  P('The **Free on the share** tile and the Storage panel at the bottom use the date each file was first seen to work out how much the library grows per month, average the last three complete months, and divide the free space on your roots by it. The tile turns amber under a year and red under three months. It is an estimate from your own history, so a one-off bulk import skews it for a quarter.'),

add(H1('5. TV Shows and Anime'), ...img('anime', 'The Anime list. TV Shows looks the same.'),
  P('One row per series. The summary strip counts series, episodes, size, runtime, how many series have full captions and how many have parse issues.'),
  table(['Column', 'Meaning'], [
    ['Seasons', 'Distinct season numbers on disk, with the range when it is not 1..N.'],
    ['Episodes', 'Files that belong to the series.'],
    ['Runtime / Size', 'Totals from the probe.'],
    ['Resolution / Codec', 'Every resolution and codec present.'],
    ['Audio / Subs', 'Union of audio and subtitle languages across the series.'],
    ['Rating', 'The online average (TVmaze or AniList) once the series has been matched.'],
    ['Mine', 'Your own 0–5 stars. Click a star to set it; click the same star again to clear. A small "P4.5" beside it is your Plex rating when Plex is synced.'],
    ['Watched', 'Share of episodes Plex has marked played (needs a Plex sync).'],
    ['Captions', 'Share of episodes with subtitles: green 100%, amber partial, red none.'],
    ['Missing', 'Episodes you lack out of the expected total, or "complete", or "no match" when the online lookup could not find the series.'],
    ['Issues', 'Unparsed or unprobed files in the series.'],
  ], [1800, 7560]),
  H2('5.1 Episode detail'), ...img('episodes', 'A series opened from the Anime list, with the expected-episode grid at the top.'),
  H2('5.2 Tags: genres, sub/dub and your own'),
  P('Every series and movie carries three kinds of tag, shown in a **Tags** column on the lists and as a strip under the title on its own page. The filter box matches them, so typing `comedy`, `dub` or `kids` narrows the list, and the dropdown row under it filters by one genre, sub/dub state, tag, or watched state (from Plex) at a time.'),
  table(['Kind', 'Where it comes from', 'Examples'], [
    ['Genres (grey)', 'The same TVmaze / AniList lookup that fetches episode counts also returns genres, and AniList adds its crowd-ranked tags. Fetched automatically with the next lookup; series matched before this version are filled in once in the background. Movies take their genres from Plex when synced.', '`Action`, `Slice of Life`, `Isekai`, `Documentary`'],
    ['Sub / dub (coloured)', 'Worked out on this machine from the audio and subtitle languages ffprobe recorded: Japanese audio with English subtitles is **Subbed**, English audio on anime is **Dubbed**, both audio tracks is **Dual audio**, and a series whose episodes disagree is **Mixed**. Nothing is fetched.', '`Subbed`, `Dubbed`, `Dual audio`'],
    ['Your tags (blue)', 'Anything you type into the **+ tag** box on a title page, Enter to add, × to remove. Earlier tags are suggested as you type. Stored with the title like your star rating, so they survive scans and renames.', '`kids`, `Christmas`, `watch with Sarah`, `rewatch`'],
  ], [1900, 5460, 2000]),
  P('All three are exported in the series and movie title CSVs (`genres`, `audio_type`, `tags`). Guests see tags but cannot edit them; standard users and admins can.'),
  P('Click a series to open it. The header shows the totals and a **Match…** button (see chapter 10). When expected counts exist, a grid shows every season with each episode number as a green (present) or red (missing) cell.'),
  P('The table lists every file with its parsed episode number, title, file name, probed length, resolution and pixel size, fps, video codec with bit depth and HDR badge, audio languages and codecs, subtitle tracks, captions flag, bitrate and size. Badges mark files that are **missing** from disk or have a manual **fixed** override. Click a row to reveal the file in Explorer; click **Fix…** to correct its details (chapter 14.2).'),
);

// ---------------- 6 Movies ----------------
add(H1('6. Movies'), ...img('movies', 'The Movies list; a ×2 badge marks titles with two files.'),
  P('One row per title. Files are grouped by a normalised title plus year, so `Pacific Rim (2013).mp4` and `Pacific Rim (2013) [4k].mkv` become one title with two versions. The **Only titles with multiple files** checkbox narrows the list to those.'),
  ...img('movie-versions', 'The files behind one title.'),
  P('Click a title to see its files side by side: edition tag, length, resolution, fps, video codec and profile, audio, subtitles, captions, bitrate, size and container. Each row has **Fix…** for corrections and reveals the file in Explorer when clicked.'),
);

// ---------------- 7 Web ----------------
add(H1('7. Web videos'), ...img('web', 'Web videos grouped by channel folder.'),
  P('A root of type **Web videos** is for downloaded web content, typically from yt-dlp. The top-level folder is treated as the channel; loose files at the root fall under "(no channel)". The file name becomes the title after stripping a trailing `[videoId]` and any `YYYYMMDD` date. When an id is present the video list links to it on YouTube.'),
  P('The channel list shows video count, runtime, size, resolutions, the upload-date range and when the last file arrived. Open a channel to see its videos with every probed field. A channel can be rated with stars from its header.'),
);

// ---------------- 8 Adult ----------------
add(H1('8. Adult library'),
  P('A root of type **Adult** holds content you want kept apart. MediaLedger classifies each file under it as anime, TV or movie from its folder and name, so the ordinary series and movie views and tools all work on it. What differs is visibility:'),
  bullets([
    'Adult files are excluded from every list, count, chart and query until the **Show adult content** switch at the bottom of the sidebar is on.',
    'The switch is **off on every launch**. Nothing remembers it.',
    'While it is on, an **Adult** tab appears under Library with its own summary, resolution chart, recently added, series list, movie list and unparsed list. Series open in the normal episode view.',
    'Adult files are left out of CSV exports unless **Settings → Adult content → Include in CSV exports** is ticked.',
    'Screenshots and the README never include adult content.',
  ]),
  P('Under Settings → Adult content you can also choose whether files that match none of the classification patterns are treated as anime or TV.'),
);

// ---------------- 9 Missing ----------------
add(H1('9. Missing episodes'), ...img('missing', 'Series ranked by how many episodes are missing.'),
  P('After each scan MediaLedger looks up every series it has not seen before on TVmaze (TV) or AniList (anime) and stores the number of episodes in each season. Both services are free and need no key; lookups run at about one series per second in the background, and airing series are re-checked every two weeks. Comparing those counts with what is on disk, per season, gives an exact list of what you lack.'),
  table(['Column', 'Meaning'], [
    ['Source', 'tvmaze, anilist, manual or none. A lock badge means you chose the match or entered counts yourself; automatic re-checks never overwrite a locked series.'],
    ['Status', 'Running / Ended (TVmaze) or RELEASING / FINISHED (AniList).'],
    ['Expected / Have / Missing', 'Regular-season episodes only; specials (season 0) are not counted.'],
    ['Which', 'The missing episodes per season. Whole missing seasons collapse into ranges.'],
    ['absolute numbering', 'A badge shown when a season on disk is numbered far beyond its expected length (for example One Piece folders numbered 62–77). That season is skipped rather than reported as missing.'],
  ], [2200, 7160]),
  H2('9.2 Airing next'),
  P('Two panels above the table use the same online match. **Airing next** lists every series whose match reports an upcoming episode, soonest first, with the date and the episode label and whether your copy is otherwise up to date; the next seven days are highlighted. Episodes that have not aired yet are never counted as missing. **Finished airing, still incomplete** lists series the source marks as ended while you still lack episodes: those gaps will not fill themselves. Both feed the daily summary (13.1) and the Home Assistant status.'),
  H2('9.1 The Match dialog'),
  P('Press **Match…** on any series (here, on the series page, or in the lists) when a series was matched to the wrong entry, was not found, or you know the counts yourself. The dialog shows the current match, lets you search either TVmaze or AniList regardless of library type, and lists candidates with year, format and episode count; click one to use it. Below that you can type counts per season by hand, declare that the series has no expected counts, or return a locked series to automatic.'),
  note('AniList numbers anime by cour, so a split season shows up as separate "Part 2" entries. MediaLedger merges those into the same season automatically. If a series still lines up better with broadcast seasons, switch its source to TVmaze in the Match dialog.'),
  P('The two buttons above the list start a background pass: **Look up new series** for anything not yet looked up, **Re-check all unlocked series** to refresh everything that you have not locked.'),
);

// ---------------- 10 Issues ----------------
add(H1('10. Issues'), ...img('issues', 'The Issues tab with Problems selected; the Duplicates button switches to the second view.'),
  P('Issues gathers everything a scan could not settle by itself behind two buttons at the top of the page: **Problems** (file names the parser could not place, ffprobe errors, missing files and your saved fixes) and **Duplicates** (episodes that exist as more than one file). The sidebar shows two counters, problems first and duplicates second. The old `#problems` and `#duplicates` links still open the matching view.'),
  H2('10.1 Problems'),
  P('The summary strip counts open problems. Sections below list unparsed file names with the parser\'s best guess, ffprobe errors, missing files, and your saved manual fixes (including ignored files). The duplicate tile only counts; the list itself is under the Duplicates button.'),
  bullets([
    '**Forget missing files** removes the records of files that have vanished. Until you press it they stay flagged, which protects you from a NAS outage being mistaken for a deletion.',
    'A root that cannot be reached during a scan is logged as `root_offline` and skipped entirely; its files are never marked missing.',
  ]),
  H2('10.2 The Fix dialog'), ...img('fix-modal', 'Correcting an episode that the parser could not place.'),
  P('**Fix…** appears on every file row in the app. The dialog states what the parser currently thinks, then lets you set the correct values:'),
  bullets([
    'Episodes: series (with suggestions), season, episode and an optional end episode for double episodes, episode title.',
    'Movies: title, year, edition tag, and **Source** (Web or Rip) for the naming engine.',
    '**Ignore this file** hides a file from every list, CSV and rename plan without touching it on disk.',
    'A free-text note.',
  ]),
  P('Saved fixes are stored by root and relative path, re-applied on every future scan, and follow the file through the app\'s own rename tools. **Remove fix** returns a file to what the parser says.'),
  H2('10.3 Duplicates'), ...img('duplicates', 'Two files for the same episode, side by side.'),
  P('Every season/episode that exists as more than one file is shown as a group, each file as a card with size, length, resolution, bitrate, codec, HDR, audio, subtitles and container. The card with the highest resolution and bitrate is marked **best quality**.'),
  P('Press **Keep this** on the file you want. It is marked keep, the others are marked discard candidates and drawn faded, and the group moves to the decided state. Nothing is deleted: use **Reveal** to open a file in Explorer and delete it there if you wish. Decisions are stored with the file and survive scans and renames; **Clear decision** undoes them. **Hide decided** narrows the list to groups still waiting.'),
);

// ---------------- 11 Quality ----------------
add(H1('11. Quality'), ...img('quality', 'The Quality report.'),
  P('Lists files and series whose technical quality looks off:'),
  bullets([
    '**Mixed-resolution series** and **Mixed seasons** – a series, or a single season, that holds more than one resolution.',
    '**Low-bitrate files** – files whose video bitrate is below the threshold for their resolution. Thresholds are editable under Settings → Quality thresholds; the defaults are 6000 kbps for 4K, 1500 for 1080p and 700 for 720p.',
    '**No audio track**, **Undefined audio language** and **Under 2 minutes** – usually samples, trailers, or damaged files. Use **Fix…** to ignore a file that is not real media.',
  ]),
);

  H2('11.1 Upgrade candidates'),
  P('The **Upgrades** page ranks every title by how much it deserves a better copy: how low the current copy is (resolution, low-bitrate files) against how much it matters (Plex plays, your stars, the online rating). Each row shows the score and plain-English reasons; titles that are already 4K or HDR, and low copies nobody has played or rated, sit at the bottom. The scoring function is a few lines in `src/main/upgrades.js`, meant to be tuned to taste.'),

// ---------------- 12 Ratings ----------------
add(H1('12. Ratings'), ...img('ratings', 'Online averages beside your own stars.'),
  table(['Column', 'Meaning'], [
    ['Online', 'The average score from TVmaze or AniList, out of 10, stored when the series was matched. Movies have no online score.'],
    ['Plex', 'The audience score Plex shows for the title, once Plex is synced.'],
    ['Plex mine', 'The rating you gave the title inside Plex, shown out of 5.'],
    ['Watched', 'From Plex play counts: a percentage for series, yes/no for movies.'],
    ['Mine', 'Your MediaLedger rating, 0–5 stars. Click to set, click the same star to clear.'],
    ['Note', 'Free text saved when you leave the field.'],
  ], [1800, 7560]),
  P('Filters narrow the list to one library, to titles you have rated, to titles you have not, or to titles with a Plex rating of yours. Your stars and notes are exported in the series and movie CSVs.'),
  H2('12.1 Watch tonight'),
  P('One list across every series and movie, made for the "what shall we watch" moment. Narrow it by kind, **unwatched only** (from Plex play counts; titles Plex does not have stay in), **complete series only** (no missing episodes), a length limit in minutes (episode length for series), your minimum star rating, and the genre, sub/dub and tag dropdowns. **Pick for me** chooses one at random from what is left and shows it in a card with an Open button; **Pick another** rerolls. Your last settings are remembered in the browser.'),
  H2('12.2 Watched: who watched what'), ...img('watched', 'The Watched tab: plays by person, library, weekday, hour and device, most watched titles, and the recent plays list.'),
  P('**Watched** is the play history of the whole Plex server, one row per play for every account, not just yours. Each Plex sync pulls Plex\'s own history (Plex keeps it as long as its settings allow), and the scrobble webhook adds plays as they finish, so the list is current between syncs. Pick a period (7 days to all time) and a person at the top; the tiles count plays, hours (from the files\' lengths), distinct titles and people.'),
  P('The charts break plays down **by person**, **by library**, **by weekday**, **by hour of day** and **by device**, with **plays per day** as a trend. **Most watched series** and **movies** list who watched each and when it was last played. **Binges** picks out sittings of three or more episodes of one show by one person. **Recent plays** is searchable and sortable; a row opens the series or movie when MediaLedger has matched it.'),
  note('Plays are attributed by Plex account. Shared accounts show as one person. Adult titles follow the same visibility rule as everywhere else.'),
);

// ---------------- 13 Media requests ----------------
add(H1('13. Media requests'), ...img('requests', 'The Requests tab as an admin sees it.'),
  P('Requests is a wish list for the library. Anyone who can open the app may ask for a title: enter the name, the year if you know it, the kind (Movie, TV show, Anime, Other) and a note that helps whoever fulfils it, such as the edition, dub or sub, or where it streams. Guests on the web server also type their name, since they are not signed in.'),
  P('Every request has a status: **Pending** when filed, then **Approved**, **Added** or **Declined**. Only an admin changes the status, and only an admin sees the extra column with the status dropdown, the ✎ button for a note back to the requester, and ✕ to delete the request. The tiles at the top count pending, added and all requests; on the web server the sidebar shows the pending count to admins so new requests are noticed.'),
  note('Requests do not download anything and do not talk to Plex. They are a shared list between the people who use the library and the person who maintains it.'),
  H2('13.1 The phone page and notifications'),
  P('`http://<pi>/request` is a phone-sized version of the form with nothing else on it; the guest QR code on the Security tab points there, so a visitor scans, types a title and is done. Guests give their name once and the phone remembers it.'),
  P('Settings → **Notifications** tells you when something happens without opening the app. A **webhook URL** receives a small JSON body per event (Home Assistant webhook trigger, ntfy, Discord…); **e-mail** goes through any ordinary mailbox with a dependency-free SMTP client (for Gmail use an app password). Events: a new request, a **daily summary** at the time you choose (files and free space, pending requests, missing episodes, what airs this week, series that finished airing but are incomplete), and a failed nightly backup. **Send a test** saves the settings and sends one of each.'),
  P('**Home Assistant status** is a read-only JSON summary at a URL with its own key (New key rotates it). Add it as a RESTful sensor and pick values with a template such as `{{ value_json.pending_requests }}`; fields include files, bytes, free space, months left, pending requests, missing episodes, airing this week, the next airing episode, whether a scan is running and the last scan result.'),
  H2('13.2 Schedules'),
  P('Settings → **Schedules** lists every job MediaLedger runs on its own, in one table: the library scan, the Plex sync, episode counts and airing dates, the backup, the daily snapshot and the daily summary. Each row shows when it runs, the last run and its result, the next run, and a **Run now** button. The timing controls sit underneath: the **Plex sync** interval (a timer keeps the Watched tab and play counts current on days without a scan; 0 means only after scans), the backup time and how many copies to keep, the snapshot time and the summary time. The scan timers and the Windows scheduled task follow.'),

);

// ---------------- 14 Change log ----------------
add(H1('14. Change log'), ...img('changes', 'The change log with its 30-day activity chart.'),
  P('Every scan writes one entry per event: **added**, **removed**, **modified** (size or date changed), **returned** (a missing file came back), **probe_error**, **root_offline** and **warning**. The strip at the top counts totals and the last seven days; the chart shows activity per day for the last 30. Pick a scan in the dropdown to see only its events with its duration, files seen and thread count, or filter by kind.'),
);

// ---------------- 15 Movie names ----------------
add(H1('15. Movie names (the naming engine)'), ...img('movienames', 'Proposed names with flags; every batch is a dry run until the live switch is armed.'),
  P('This tab renames movie files to a consistent pattern built from facts the app can prove. It is the most carefully guarded part of MediaLedger, because it is one of only two places that write to the share.'),
  H2('15.1 The pattern'),
  P('`Title (Year) - Source Resolution HDR Codec [Audio] [{edition-Name}].ext`'),
  P('A seventh part, **Sub/Dub**, is off unless you switch it on: it writes `Sub`, `Dub` or `Dual` from the probed languages and nothing for a plain English film. Only `Title (Year)` is fixed, because Plex matches on it. Everything after the dash is a **name part** you can leave out or reorder under Batch settings → **Name parts**: click a chip to switch it off (it shows struck through) or on, use the ◂ ▸ arrows to move it, and watch the preview. The whole list rebuilds at once. The same thing works from the list itself: every word in a proposed name is clickable, so clicking `Source` in any row removes Source from every name, the way editing one dimension in a CAD sketch updates the whole part. If you do not like `Web` / `Rip` in your names, click it once and it is gone; the `no_source` flag disappears with it.'),
  P('Examples: `A Breed Apart (2025) - Web 1080p SDR H264.mp4` and `Avatar (2009) - Rip 4K HDR HEVC {edition-Extended Collector\'s Edition}.mkv`.'),
  table(['Token', 'Where it comes from', 'When unknown'], [
    ['Title, Year', 'The parser and your manual fixes, or the Plex match when the truth source is set to Plex.', 'Year becomes the word `Year`; the file is flagged.'],
    ['Source', '`Web` when the old name carries a LiLTV or WEB marker; `Rip` for BRrip, BluRay, BDRip, Remux or DVD; or whatever you set in the Fix dialog or with bulk source.', 'The word `Source`; the file is flagged.'],
    ['Resolution', 'ffprobe pixel size: 4K, 1440p, 1080p, 720p, 576p, 480p or SD.', 'Blocked.'],
    ['HDR / SDR', 'ffprobe colour transfer: HDR10, Dolby Vision and HLG all become `HDR`.', '`SDR`.'],
    ['Codec', 'ffprobe video codec: H264, HEVC, AV1, MPEG4, VC1…', 'Blocked.'],
    ['Audio', 'ffprobe audio languages, only when they are not plain English, e.g. `ENG+JPN`.', 'Omitted; flagged if undefined.'],
    ['Edition', 'Edition words found in the old name, in Plex\'s `{edition-…}` form.', 'Omitted.'],
  ], [1500, 5200, 2660]),
  P('The title keeps your existing words. Colons and question marks are dropped, slashes become dashes, other characters Windows forbids are removed, and trailing dots and spaces are trimmed. Nothing is re-capitalised.'),
  H2('15.2 Ready, flagged, blocked'),
  bullets([
    '**Ready** – the proposed name differs from the current one and every check passes.',
    '**Flagged** – ready, but worth a look. Flags include `no_source`, `no_year`, `res_mismatch` (the old name claimed a resolution the probe disagrees with; the probe wins), `hdr_claimed_but_sdr`, `audio_und`, `plex_title_differs` and `plex_unlinked`. The tab explains each flag under "What the flags mean".',
    '**Blocked** – never renamed: no successful probe, no title, or a **collision** where two or more files would receive the identical name.',
  ]),
  H2('15.3 Batch settings'),
  table(['Setting', 'Effect'], [
    ['Layout', '**Rename in place** changes only the file name (an atomic rename). **Move into "Title (Year)" folders** creates Plex\'s preferred folder layout by copying the file, verifying its size and a head-and-tail hash, then deleting the original.'],
    ['Batch limit', 'The most files one live batch may contain. Forces review in chunks.'],
    ['Title & year from', '**File name + my fixes** (default) or **Plex match**. With Plex, unlinked files fall back to the file name and are flagged.'],
    ['Allow live renames', 'The arming switch. Until it is on, only dry runs are possible.'],
  ], [2200, 7160]),
  H2('15.4 Running a batch'),
  steps([
    'Filter and tick the files you want. **Select shown** ticks every ready file currently listed.',
    'Press **Dry run N**. Nothing is touched; the result window lists exactly what would happen and the batch is recorded as a dry run in the Batches table.',
    'When satisfied, tick **Allow live renames**, press **Save**, then **Rename N live**.',
    'A confirmation lists the renames and asks you to type `RENAME`.',
    '**Pre-flight** then checks every file: it still exists, its size matches the last scan, the target name is free, the root is writable, the path is under 255 characters and no two files share a target. If any check fails, the whole batch is aborted and nothing is renamed.',
    'Each rename is followed by a re-check of the file\'s size before the database is updated. A failure stops the batch; earlier renames stand and are journaled.',
  ]),
  P('While a live batch runs, scans and the folder watcher wait.'),
  H3('One at a time'),
  P('If a big batch feels like too much trust, do not use it. Every ready row has a **Rename** button that renames just that file, and **One at a time (N)** walks through the ticked files in a dialog that shows the current and proposed name and asks **Rename this file**, **Skip** or **Stop** for each. Every confirmed file runs as its own one-file batch through the same pre-flight, verification and journal, so it appears in the Batches table and can be undone on its own. The live switch must still be on.'),
  H2('15.5 Undo'),
  P('Every live batch is listed under **Batches** with an **Undo** button. Undo walks the journal in reverse; for each file it confirms the renamed file still exists with the recorded size and that the original name is free, then renames it back. Files that fail the check are left alone and reported, and the batch shows as "partially undone". **Items** shows the per-file journal of any batch.'),
  H2('15.6 Bulk source, collisions, placeholders'),
  bullets([
    '**Set source for selected…** applies Web, Rip or "clear" to every ticked file (or to everything shown when nothing is ticked). It only records a fix; nothing is renamed.',
    '**Name collisions** groups the blocked pairs with their sizes. **Keep this, ignore others** marks the rest ignored (still on disk) so the kept file can be renamed; alternatively give one file a distinguishing edition via Fix….',
    '**Placeholders on disk** lists files already renamed with `(Year)` or `Source` in their name. Plex will not match a `(Year)` file, so fill the value with Fix… and rename again.',
  ]),
  warn('Before the first large live batch, run one small batch of 20 or 30 files in place, check the result in Explorer and in Plex, then undo it. That proves the whole path on your NAS before you trust it with the full library.'),
);

// ---------------- 16 Rename TV/anime ----------------
add(H1('16. Rename TV / anime'), ...img('rename', 'The episode rename tool, shown here while disabled.'),
  P('Episodes use the same engine as movies: every run is a batch that is pre-flighted as a whole (file still there, size unchanged, target free, root writable), each rename verified, journaled in the **Batches** table and undoable from it. **Dry run N** records what would happen without touching anything. Name parts work as on the movie tab: `Show - S01E02` is fixed, the **Episode title** is on by default, and **Resolution**, **Codec** and **Sub/Dub** are opt-in, written in square brackets. The same one-at-a-time scheme applies: a **Rename** button per row and **One at a time** for the ticked files, each confirmed separately. It is **off** until you enable it under Settings → Renaming. When on, it lists every episode file whose name differs from `Show - S01E02 - Title.ext`, built from the parsed details and your fixes. Tick files, press **Rename**, confirm. Files are renamed in place, never moved or overwritten, and every attempt is logged in the History table. Fix anything wrong under Problems first, because the proposal is only as good as the parse.'),
);

// ---------------- 17 CSV ----------------
add(H1('17. CSV export'), ...img('export', 'The export tab: pick the sets, optionally zip them, export, and browse the history.'),
  P('Every export writes a set of CSV files into `exports\\<timestamp>\\` and refreshes the `latest\\` copy, so a spreadsheet can always point at the same file names. Exports run automatically after each scan (Settings → CSV export) or on demand with **Export now**. The history table lists past exports with the trigger, the scan, row counts and the files produced.'),
  H2('17.1 Choosing what to export'),
  bullets([
    '**What to export** lists the five sets: TV shows, Anime, Movies, Web videos and Change log. Tick the ones you need; the file names each set produces are shown beside it.',
    '**Zip the files as well** adds `medialedger-<timestamp>.zip` next to the CSVs and refreshes `latest\\medialedger-latest.zip`. The archive is written by MediaLedger itself; no extra software is needed. The **when at least N files** box beside it skips the zip for small exports: with the default of 4, ticking only the change log gives a bare CSV, ticking everything gives the zip too.',
    '**Remember as default** saves the current ticks. The default is also what the automatic export after a scan uses.',
    'On the web server the history table links every CSV and zip for download in the browser (admin session). On the desktop the **Open latest folder** and **Open exports folder** buttons open the files in Explorer.',
  ]),
  H2('17.2 The files'),
  table(['File', 'Contents'], [
    ['tv_episodes.csv / anime_episodes.csv', 'One row per episode file with every parsed and probed field.'],
    ['tv_series.csv / anime_series.csv', 'One row per series: seasons, episodes, runtime, size, resolutions, codecs, languages, captions %, episode gaps, metadata source, expected and missing episodes with the exact list, online rating, your rating and note, genres, sub/dub, your tags, mixed-resolution and low-bitrate flags.'],
    ['movies.csv', 'One row per movie file, with the number of versions of that title.'],
    ['movies_titles.csv', 'One row per title: file count, versions, best resolution, size, languages, captions, your rating and note, genres (from Plex), sub/dub, your tags.'],
    ['movies_multiples.csv', 'Only titles with more than one file.'],
    ['web_videos.csv', 'One row per web video: channel, title, upload date, video id and every probed field.'],
    ['changes.csv', 'The change log for the scan that triggered the export.'],
  ], [3000, 6360]),
  P('Adult roots are excluded unless allowed in Settings. Ignored files are always excluded.'),
);

// ---------------- 18 Settings ----------------
add(H1('18. Settings reference'), ...img('settings', 'The top of the Settings page.'),
  H2('18.1 Appearance'), P('**Colour theme** switches the whole app between a few palettes and applies at once. The choice is remembered in the browser (or the desktop app) you set it in, not on the server, so every device and every person can have their own.'),
  H2('Library roots'), P('One row per folder: on/off, label, path (UNC or local; the … button browses), and type: TV, Anime, Movies, Web videos, or Adult (auto-detect anime / TV / movie). Roots with the same type may repeat. Press **Save settings** after editing.'),
  H2('Scanning'), bullets([
    '**Multi-threaded listing** deals show folders out to worker threads so directory listing over SMB overlaps. 0 threads means automatic (CPU count minus one). Turn off if the NAS struggles.',
    '**Parallel ffprobe processes** – how many files are probed at once; 8 suits gigabit SMB.',
    '**Re-probe unchanged files** – force ffprobe on everything next scan.',
    '**Video extensions**, **Subtitle sidecar extensions**, **Ignore patterns** – what counts as media, what counts as a caption sidecar, and glob patterns to skip.',
  ]),
  H2('ffprobe (ffmpeg)'), P('Shows where ffprobe was found and its version. A path override and a **Download** button fetch the latest static build into the data folder.'),
  H2('Expected episodes'), P('Turn the TVmaze / AniList lookups on or off and set how often airing series are re-checked.'),
  H2('Folder watch'), P('Uses Windows change notifications on each root and starts a scan once the folder has been quiet for the settle time. A copy in progress keeps pushing the timer back.'),
  H2('Renaming'), P('Enables the TV / anime rename tool. Off by default.'),
  H2('Adult content'), P('Whether adult roots appear in CSVs, and the fallback subtype for files that match no pattern.'),
  H2('Quality thresholds'), P('Minimum video bitrate per resolution for the Quality report.'),
  H2('CSV export'), P('Output folder and whether to export after every scan.'),
  H2('Schedule'), bullets([
    '**In-app timer** – scans every N hours while the window is open.',
    '**Windows Task Scheduler** – installs a daily task that launches MediaLedger with `--scan`, which scans, exports and exits even when the app is closed. If the app is already open, the open window runs the scan instead. Re-install the task after upgrading so it points at the current program.',
  ]),
  H2('Data'), P('Database path and size, schema version, counts, and buttons to back up now, open the backups folder, the data folder and the log. **Nightly backup to a folder** copies the database to a folder of your choice once a day at the time you set, dated, keeping the newest N. Point it at the NAS: the database holds every fix, rating, tag, match and the whole change log, and this is the only copy that survives a dead SD card or PC. **Back up there now** tests the folder.'),
  H2('Updates'), P('Automatic updates on/off, and the GitHub token needed only while the repository is private.'),
  H2('Plex'), P('Server, token, path mapping and sync options: see chapter 19. The **Webhook** row belongs to the web server (19.3); on the desktop it explains that webhooks need the always-on server.'),
);

// ---------------- 19 Plex ----------------
add(H1('19. Plex integration'),
  P('MediaLedger talks to your own Plex Media Server over its local HTTP API. It never writes to Plex and needs no Plex account: only the server\'s address and a token.'),
  H2('19.1 Setup'),
  steps([
    'In Plex Web, open any movie or episode, click the ⋯ menu, choose **Get Info**, then **View XML**.',
    'A new tab opens showing XML. Copy its whole address from the browser\'s address bar; it ends in `X-Plex-Token=…`. Do not share it; it grants access to your server.',
    'In MediaLedger, Settings → Plex, paste that address into **Paste the XML address**. The token is pulled out into the token field, the server URL is filled in when the address came from your LAN (for Plex on the NAS, `http://192.168.1.204:32400`), and the pasted text is discarded. Press **Test**. It reports the server version and lists the libraries it can see.',
    'Press **Sync now**. The first sync derives the path mapping from the first file it recognises, for example `/media` → `\\\\192.168.1.204\\Apocrypha_Media_Pool`, and shows it for editing.',
    'Tick **Sync after every scan** to keep it current.',
  ]),
  H2('19.2 What a sync stores'),
  table(['Per file', 'Per show'], [
    ['Plex title and year, rating key, IMDb / TMDB / TVDB ids, your Plex rating, audience rating, play count, last viewed, resume offset, library section', 'Plex\'s title and year, ids, your rating, audience rating, episode and watched counts, content rating'],
  ], [4680, 4680]),
  P('These appear on the Ratings tab (Plex, Plex mine, Watched), on the series lists (Watched %, your Plex rating beside your stars), and as the optional truth source for the movie naming engine. The status line under the Sync button reports how many Plex items matched a file and lists examples of files Plex does not have.'),
  H2('19.3 Plex webhook'),
  P('A sync pulls from Plex on a schedule; a webhook lets Plex push to MediaLedger the moment something happens. Webhooks are a Plex Pass feature and need a server that is always listening, so they work on the Raspberry Pi web server only. The desktop app shows a note instead.'),
  steps([
    'On the Pi, Settings → Plex → **Webhook (Plex Pass)**: switch it on. A URL of the form `http://<pi>:8080/api/plex/webhook?key=…` appears with a copy button.',
    'In Plex Web: Settings → **Webhooks** → Add webhook, paste the URL, save.',
    'Play or rate something in Plex. The last events received are listed under the switch, so you can confirm the link works.',
  ]),
  table(['Plex event', 'What MediaLedger does'], [
    ['Item added to a library', 'Queues a scan two minutes later, so a batch of new files arrives in one scan rather than one scan per file.'],
    ['Watched (scrobble)', 'Updates the play count and last-viewed time of the linked file at once.'],
    ['Rated', 'Stores the new rating on the linked file at once.'],
  ], [3000, 6360]),
  warn('The key in the URL is the credential: anyone who has it can post events. **New key** generates another and invalidates the old one; update the URL in Plex afterwards. LAN-only still applies, so a Plex server on the internet cannot reach the webhook unless you turn that rule off.'),
);

// ---------------- 20 System ----------------
add(H1('20. System (health and hardware)'),
  P('The System tab watches the machine MediaLedger runs on. On the desktop that is your PC; on the Raspberry Pi it is the board itself, where temperature and power matter. It samples every 5 seconds and keeps one hour of history in memory (nothing is written to the database or the SD card).'),
  ...img('system', 'System tab on the desktop: health, CPU per core, memory, data disk, network, and free space on every root.'),
  table(['Panel', 'What it shows'], [
    ['Health', 'One verdict, **All good**, **Attention** or **Problem**, with every triggered rule listed under it. Rules: SoC over 70 °C (attention) or 80 °C (problem); throttling or under-voltage now (problem) or since boot (attention); memory over 85 / 95 %; swapping; a disk over 90 % or under 5 GB free (attention), over 97 % or under 1 GB (problem); a root that cannot be reached while no scan is running. The System entry in the sidebar shows a dot whenever the verdict is not green.'],
    ['SoC temperature (Pi only)', 'Current chip temperature, clock speed and core voltage. The Pi firmware soft-limits at 80 °C and throttles at 85 °C; a scan on a caseless Pi 4 usually sits in the 50s to 60s.'],
    ['Power & throttling (Pi only)', 'The firmware\'s throttling flags. **Healthy** means no under-voltage or frequency capping since boot. "Under-voltage has occurred" means the power supply or cable is weak; fix that before trusting long scans.'],
    ['CPU', 'Overall percentage, per-core bars and the 1 / 5 / 15 minute load averages.'],
    ['Memory', 'Used against total, swap if any, and the size of the MediaLedger process itself.'],
    ['Data disk', 'Free space where the database, log and exports live, and the database size.'],
    ['Network', 'Download and upload rate. During a scan the download line is the share being read.'],
    ['Storage', 'Free space and fill percentage of the data folder and of every enabled root, measured through the share.'],
  ], [2600, 6760]),
  note('The thresholds live at the top of `healthOf()` in `src/main/sysmon.js` if you want to tune them for a different case or fan.'),
);

// ---------------- 21 Security ----------------
add(H1('21. Security'),
  P('The Security tab manages access to the **web server**. The desktop app has no login: it runs as you, on your PC, and only your PC can reach it, so on the desktop the tab simply says so. On the Raspberry Pi anyone on the LAN could otherwise open the page, and this tab is where you control that.'),
  ...img('web-security', 'Security tab on the Pi: posture checks, password, options, users, two-factor codes, sessions and the audit log.'),
  H2('21.1 Accounts and roles'),
  P('Sign-in is a **username and password**. The first account is always `admin`: the installer asks for its password, and an installation upgraded from 1.0 keeps its old password under that name. Admins add further accounts under Security → Users, each with one of three roles:'),
  table(['Role', 'Can', 'Cannot'], [
    ['**admin**', 'Everything: scans, fixes, renames, settings, security, exports and downloads, request statuses.', ''],
    ['**standard**', 'See every library and review page, rate titles, file requests, change their own password, and show adult content for their own session.', 'Settings, System, Security, scans, fixes, renames, exports. The Plex and GitHub tokens are blanked in what they see.'],
    ['**guest**', 'Open the page without signing in (only when **Guest access** is on): library statistics and lists, and file requests.', 'Adult content, Issues and every other review page, any control.'],
  ], [1400, 4000, 3960]),
  P('Every refusal is enforced by the server, not just hidden in the page, and is written to the audit log. Adult visibility is per session: one person switching it on does not show it to anyone else. Two-factor codes, when enabled, apply to admin sign-ins.'),
  H2('21.2 Always on'),
  bullets([
    'Passwords are hashed with scrypt and stored in `web.json` with owner-only permissions. Minimum 8 characters.',
    'Sessions are HttpOnly, SameSite=Strict cookies that last 30 days. Scripts cannot read them and other sites cannot use them.',
    'The API accepts JSON only, refuses cross-origin requests, and every page carries a strict Content-Security-Policy plus `X-Frame-Options: DENY`, `nosniff` and `no-referrer` headers.',
    'After 8 failed sign-ins in 15 minutes from one address, that address is locked out for 15 minutes.',
    '**LAN only**: connections from outside private address ranges are refused. Do not port-forward the Pi; use a VPN into your LAN if you need remote access.',
    '**Re-authentication**: a live movie rename, an undo, a TV/anime rename, purging missing files and every change on this tab ask for the password again unless you entered it within the last 5 minutes. A small dialog appears in place; the action continues once you confirm.',
    'Every sign-in, failure, lockout, re-authentication, sensitive action and setting change is written to `security.log` and listed at the bottom of the tab.',
  ]),
  H2('21.3 Controls'),
  table(['Control', 'What it does'], [
    ['Posture checks', 'Coloured tiles at the top: admin account, two-factor, LAN-only, guest access, HTTPS, not running as root, secrets file permissions, share credentials permissions, idle sign-out, renaming switched off. Green is good; amber is an optional improvement; red needs attention.'],
    ['Change password', 'Changes the password of the signed-in account; needs the current one. Signs out every other session. Standard users get this control alone.'],
    ['LAN only', 'On by default. Turn off only if you know exactly which non-private network should reach the Pi.'],
    ['Idle sign-out', 'Ends a session after N minutes without activity. 0 keeps the 30-day limit only. The **Save** beside the field and **Save options** below do the same thing.'],
    ['Guest access', 'Lets anyone on the LAN open the page without signing in, as a guest (21.1). Off by default.'],
    ['Users', 'Add an account (name, password, role), change a role, reset a password, delete an account. Admins only; every change asks for your password again.'],
    ['Two-factor codes', 'Press **Set up 2FA**, scan the QR code with an authenticator app and enter the 6-digit code it shows (21.4). From then on admin sign-in needs password + code. Turning it off needs the password. If you lose the device, see the Pi troubleshooting table.'],
    ['HTTPS', 'Creates a self-signed certificate and restarts the server on it (21.5). Once on, a **Download certificate** button and per-device instructions replace the switch.'],
    ['Guest link', 'Shown once Guest access is on: a QR code of the site address that anyone on the Wi-Fi can scan to open MediaLedger as a guest.'],
    ['Sessions', 'Every signed-in browser with its address, browser and last activity. **Sign out** ends one; **Sign out other sessions** keeps only this one; **Sign out here** ends yours.'],
    ['Audit log', 'The last 100 events with time, kind, address and detail. The full log is `security.log` in the data folder.'],
  ], [2600, 6760]),
  ...img('web-login', 'Signing in to the web server with a username and password. The code field is only needed once two-factor is on.'),
  H2('21.4 Two-factor codes with a phone'),
  steps([
    'Install **Google Authenticator** (or Aegis, Bitwarden, 1Password, Microsoft Authenticator: any app that does time-based codes) on your phone.',
    'On the Pi, Security → Two-factor codes → **Set up 2FA**. A QR code appears.',
    'In the app tap **+** → **Scan a QR code** and point the camera at the screen. The app adds an entry named MediaLedger and starts showing a 6-digit code that changes every 30 seconds. No camera? Tap **Enter a setup key** and type the secret shown under the code.',
    'Type the current 6-digit code into the box under the QR and press **Turn on 2FA**. The server checks it before switching on, so a mistyped secret cannot lock you out.',
    'From now on the sign-in dialog asks for the code after the password, for admin accounts. Standard users and guests are unaffected.',
  ]),
  note('The secret lives in `web.json` on the Pi and in the app on your phone; nothing is sent to Google or anyone else. The Pi clock must be roughly right (`timedatectl`), since the codes are computed from the time.'),
  H2('21.5 HTTPS'),
  P('On a home LAN plain HTTP is normal, and MediaLedger refuses connections from outside the LAN anyway. HTTPS adds encryption between each browser and the Pi, which matters if you do not fully trust every device on the Wi-Fi, and it lets phones add the site as a proper app without warnings. There is no certificate authority for a private LAN name, so MediaLedger makes its own **self-signed** certificate; browsers trust it once you install it on each device.'),
  steps([
    'Security → HTTPS → **Turn on HTTPS**, then confirm. The server writes a certificate valid for ten years covering every name it answers to (`medialedger.local`, the hostname, your custom domain if the installer was given one, and every LAN address), audits the change, and restarts. Sign-in sessions survive the restart.',
    'The page reopens on `https://`. If the Pi was installed with `--port=80`, the site moves to port 443 (no port in the address) and port 80 redirects there, so `http://medialedger.home` keeps working.',
    'The browser warns that the certificate is not trusted. Either accept the warning for this site, or remove it for good: press **Download certificate** (a `.crt` file Windows opens with its own installer on double-click) and follow the per-device steps under *Removing the browser warning* (Windows: Trusted Root Certification Authorities; Android: install a CA certificate; iPhone: install the profile, then Certificate Trust Settings; macOS: Keychain, Always Trust).',
  ]),
  warn('Adding a new name for the Pi later (a custom domain, a rename) needs a new certificate: delete `/var/lib/medialedger/tls/` on the Pi, restart the service, and turn HTTPS on again. Installing the certificate on a device is per device; the file itself is public, only `key.pem` on the Pi is secret.'),
);

// ---------------- 22 Raspberry Pi ----------------
add(H1('22. Running MediaLedger on a Raspberry Pi'),
  P('The same program runs as a small always-on website on a Raspberry Pi. Every tab in this manual works there, in any browser on your LAN. The Pi keeps its own database and settings; the format is identical to the desktop, so a database can be copied between the two.'),
  P('Differences from the desktop: folder paths are typed instead of picked, "open folder" buttons do nothing in a browser, updates are one command on the Pi instead of the silent installer, the Windows Task Scheduler section of Settings does nothing (the in-app schedule runs because the Pi is always on), and the Security tab is live.'),
  ...img('web-dashboard', 'The dashboard served from the Pi, in a browser.'),
  H2('22.1 Requirements'),
  table(['Item', 'Minimum', 'Recommended'], [
    ['Board', 'Raspberry Pi 3 (64-bit OS)', '**Raspberry Pi 4B or 5**, any RAM size (2 GB is plenty)'],
    ['Storage', '16 GB microSD, A1 class', '32 GB A2 microSD or a USB SSD; the card wears under log and database writes'],
    ['Network', 'Wi-Fi', '**Ethernet**. Scan speed is network-bound: a Pi 4 scans at near-PC speed, a Pi 3 (100 Mbit) takes hours for the first full scan'],
    ['Power', 'Official supply', 'Same; under-voltage shows on the System tab'],
    ['Operating system', 'Raspberry Pi OS Lite (64-bit), Trixie or newer', 'Same. 64-bit is required: Node 22\'s built-in SQLite only has arm64 builds'],
    ['Software', 'Installed by the script: Node 22, ffmpeg, cifs-utils, curl, openssl', ''],
    ['Access', 'SSH to the Pi; the NAS share username and password; a browser on the LAN', ''],
  ], [1800, 3200, 4360]),
  H2('22.2 Install, step by step'),
  steps([
    'Flash **Raspberry Pi OS Lite (64-bit)** with Raspberry Pi Imager: Choose OS → Raspberry Pi OS (other) → Raspberry Pi OS Lite (64-bit). In the customisation step set hostname `medialedger`, your user and password, time zone, and enable SSH.',
    'Boot the Pi on Ethernet, then from your PC: `ssh medialedger.local`. Confirm `uname -m` prints `aarch64`.',
    'Run the installer on the Pi:',
  ]),
  new Paragraph({ indent: { left: 540 }, spacing: { after: 120 }, children: [new TextRun({ text: 'curl -fsSL https://raw.githubusercontent.com/AxialForge/medialedger/main/server/install.sh -o install.sh && sudo bash install.sh', font: 'Consolas', size: 18, shading: { type: ShadingType.CLEAR, fill: 'EEF1F5' } })] }),
  P('The installer is safe to rerun. It installs Node 22, ffmpeg, cifs-utils, curl and openssl; creates the `medialedger` system user (no shell, member of `video` for the hardware readings) and `/var/lib/medialedger`; downloads the **server-only release package** `medialedger-server.tar.gz` from GitHub Releases, verifies its SHA-256 and unpacks it to `/opt/medialedger`; asks once for the **NAS share username and password** and mounts `//192.168.1.204/Apocrypha_Media_Pool` at `/mnt/media` through fstab with the credentials in a root-only file; installs a hardened systemd service on port 8080 and the `medialedger` and `medialedger-update` commands; and asks for the **admin password** (8+ characters) if none is set. At the end it prints the address.'),
  table(['Installer option', 'Effect'], [
    ['`--share=//host/share`', 'Use a different share than the default.'],
    ['`--port=9000`', 'Serve on a different port. `--port=80` is allowed: the unprivileged service is granted only the capability to bind low ports.'],
    ['`--domain=medialedger.home`', 'Remember a LAN name for the Pi; the HTTPS certificate is issued for it and the final address uses it. See 22.3a for the router side.'],
    ['`--https`', 'Also create a self-signed certificate; the server then serves HTTPS.'],
    ['`--branch=main`', 'Run from the git branch instead of the release package (development).'],
  ], [3000, 6360]),
  H2('22.3 First run on the Pi'),
  steps([
    'Open `http://medialedger.local:8080` (or `http://<pi-address>:8080`) and sign in as `admin` with the password you gave the installer.',
    'Open **Settings**. The roots default to `/mnt/media/Movies`, `/mnt/media/Anime` and `/mnt/media/TV_Shows`. Add `/mnt/media/Web_Shos` and `/mnt/media/Plex_Media/Adult Anime` if you use them. Save.',
    'Press **Scan now**. The Pi starts with an empty ledger, so this first scan probes every file; you can close the browser and come back. Or copy the desktop database over first (22.6) and skip it.',
    'Open **System** during the scan to see temperature and network load, and **Security** afterwards to add accounts for the other people in the house, decide on guest access, and set up two-factor codes if you want them.',
  ]),
  H2('22.3a Your own name for the Pi'),
  P('`medialedger.local` works on most PCs and phones through mDNS, but not everywhere, and `:8080` is easy to forget. Rerun the installer with `--port=80 --domain=medialedger.home` (any name you like; a suffix such as `.home`, `.lan` or `.internal` avoids clashing with real internet names) and then tell your router that the name means the Pi\'s address: on a UniFi gateway, Settings → Routing → DNS → add an A record; on other routers look for "local DNS" or "DNS host names"; Pi-hole has Local DNS records; or add a line to the hosts file of each PC. From then on `http://medialedger.home` opens the site. The Pi guide in the repository (`docs/RASPBERRY-PI.md`, section 7a) goes through each router type.'),
  H2('22.4 Command reference'),
  table(['Command (run on the Pi)', 'Does'], [
    ['`sudo medialedger-update`', 'Download the newest release package, verify it, install it and restart. Data is untouched.'],
    ['`sudo medialedger --set-password`', 'Set or reset the **admin** account\'s password. Signs everyone out. Other accounts are reset from Security → Users.'],
    ['`systemctl status medialedger`', 'Is the service running, since when, last log lines.'],
    ['`journalctl -u medialedger -f`', 'Follow the application log live.'],
    ['`journalctl -u medialedger -n 50 --no-pager`', 'The last 50 log lines.'],
    ['`sudo systemctl restart medialedger`', 'Restart the service (also `stop` / `start`).'],
    ['`ls /mnt/media`', 'Is the share mounted? Should list Movies, Anime, TV_Shows and the rest.'],
    ['`sudo mount /mnt/media`', 'Re-mount the share after a NAS reboot if the automount did not.'],
    ['`sudo rm /etc/medialedger-cifs.cred` then rerun the installer', 'Change the share credentials.'],
    ['`sudo bash install.sh`', 'Rerun the installer: repairs the service, mount and commands without touching data.'],
    ['`vcgencmd measure_temp`', 'Chip temperature from the shell (the System tab shows the same).'],
  ], [4200, 5160]),
  H2('22.5 Security on the Pi'),
  P('Chapter 21 describes every control. The short version: keep **LAN only** on, never port-forward the Pi, turn on **two-factor codes** if other people use your network, and let the posture tiles guide you. For HTTPS, press **Turn on HTTPS** on the Security tab (21.5); `--https` on the installer does the same at install time.'),
  P('The service runs as a user with no shell, with `NoNewPrivileges`, `ProtectSystem=full`, `ProtectHome` and a private `/tmp`; it can write only its data folder and the share. The share credentials are root-only in `/etc/medialedger-cifs.cred`; the account password hashes, sessions, 2FA secret and webhook key are owner-only in `/var/lib/medialedger/web.json`.'),
  H2('22.6 Moving the desktop database to the Pi'),
  P('This carries every fix, keep decision, series match, rating and the whole change log across, and skips the first full scan. On the PC, close MediaLedger and copy the database to the Pi:'),
  new Paragraph({ indent: { left: 540 }, spacing: { after: 120 }, children: [new TextRun({ text: 'scp "%APPDATA%\\MediaLedger\\medialedger.db" joe@medialedger.local:/tmp/medialedger.db', font: 'Consolas', size: 18, shading: { type: ShadingType.CLEAR, fill: 'EEF1F5' } })] }),
  P('On the Pi:'),
  new Paragraph({ indent: { left: 540 }, spacing: { after: 120 }, children: [new TextRun({ text: 'sudo systemctl stop medialedger && sudo mv /tmp/medialedger.db /var/lib/medialedger/medialedger.db && sudo chown medialedger:medialedger /var/lib/medialedger/medialedger.db && sudo systemctl start medialedger', font: 'Consolas', size: 18, shading: { type: ShadingType.CLEAR, fill: 'EEF1F5' } })] }),
  P('Then set the roots in Settings with the same ids as on the desktop (movies, anime, tv and any you added) and the `/mnt/media/...` paths, and run a scan. Every file is recognised by its relative path and nothing is re-probed. Do not copy `settings.json`: it holds Windows paths.'),
  H2('22.7 File locations'),
  table(['Path on the Pi', 'Contents'], [
    ['`/opt/medialedger`', 'The application (replaced on update)'],
    ['`/var/lib/medialedger/medialedger.db`', 'The database'],
    ['`/var/lib/medialedger/settings.json`', 'Settings (roots, schedule, Plex, …)'],
    ['`/var/lib/medialedger/web.json`', 'Accounts and password hashes, sessions, 2FA, options, webhook key (owner-only)'],
    ['`/var/lib/medialedger/security.log`', 'Audit log'],
    ['`/var/lib/medialedger/medialedger.log`', 'Application log'],
    ['`/var/lib/medialedger/exports/`', 'CSV exports'],
    ['`/var/lib/medialedger/backups/`', 'Pre-migration database backups'],
    ['`/var/lib/medialedger/tls/`', 'Optional cert.pem and key.pem'],
    ['`/etc/medialedger-cifs.cred`', 'NAS share credentials (root-only)'],
    ['`/etc/systemd/system/medialedger.service`', 'The service definition'],
    ['`/mnt/media`', 'The share'],
  ], [4200, 5160]),
  H2('22.8 Pi troubleshooting'),
  table(['Symptom', 'Check'], [
    ['Page does not load', '`systemctl status medialedger`; `journalctl -u medialedger -n 50`. Same LAN? LAN-only refuses other ranges.'],
    ['Sign-in loops', 'Cookies blocked for the site, or the Pi clock is far off (`timedatectl`).'],
    ['"Too many failed attempts"', '15-minute lockout for that address; wait or restart the service.'],
    ['Roots "not reachable"', '`ls /mnt/media`. Empty → `sudo mount /mnt/media`; wrong credentials → delete the cred file and rerun the installer.'],
    ['Scan is slow', 'Ethernet, not Wi-Fi. Watch System → Network during a scan.'],
    ['Renames fail: root not writable', 'The mount is owned by `medialedger` with write modes; check the NAS user has write permission on the share.'],
    ['Forgot the admin password', '`sudo medialedger --set-password`. A standard user\'s password is reset by an admin under Security → Users.'],
    ['A user sees no Settings, System or Issues', 'They have the standard or guest role. Only admins see those pages; change the role under Security → Users.'],
    ['Plex webhook shows no events', 'Check the URL in Plex Web → Settings → Webhooks matches the one in Settings → Plex, that Plex Pass is active, and that the Plex server is on the LAN (LAN-only refuses others).'],
    ['Lost the 2FA device', 'Stop the service, set `"totp": {"enabled": false}` in `/var/lib/medialedger/web.json`, start again.'],
    ['Power & throttling tile missing', 'The service user must be in the `video` group: `sudo usermod -aG video medialedger && sudo systemctl restart medialedger` (the installer does this).'],
    ['Above 80 °C during scans', 'Add a heatsink or fan, or lower Probe concurrency in Settings.'],
  ], [3000, 6360]),
);

// ---------------- 23 Troubleshooting ----------------
add(H1('23. Troubleshooting'),
  table(['Symptom', 'Cause and fix'], [
    ['Scan finishes instantly and the change log says root_offline', 'The path in Settings is wrong or the NAS is off. Fix the path; the files are untouched and never marked missing.'],
    ['Files show but resolution and length are empty', 'ffprobe was not found when they were scanned. Check Settings → ffprobe, download it if needed, then scan again (unprobed files are probed automatically).'],
    ['A series is missing episodes it clearly has', 'Either the parser could not place some files (see Issues → Problems → Unparsed, use Fix…) or the online match is wrong (use Match… and pick the right entry or enter counts).'],
    ['Missing shows "absolute numbering"', 'Episode numbers on disk continue across seasons. That season is skipped; enter per-season counts by hand or fix the episode numbers with Fix….'],
    ['Movie name blocked as collision', 'Two files would get the same name. Keep one and ignore the other under Name collisions, or give one an edition with Fix….'],
    ['Rename batch aborted in pre-flight', 'Something changed since the last scan (size differs, target exists, share read-only). The report names each problem; fix or deselect those files and run again. Nothing was renamed.'],
    ['Plex sync matched 0 items', 'The path mapping is wrong. Compare a Plex file path (from View XML) with the same file\'s path in MediaLedger and set the mapping under Settings → Plex.'],
    ['Adult tab is not there', 'Either no Adult root is enabled, or the Show adult content switch is off (it resets on every launch).'],
    ['The app will not start a second copy', 'Only one instance runs; launching again focuses the open window. A scheduled --scan hands its request to the open window.'],
  ], [3000, 6360]),
  P('The log at `%APPDATA%\\MediaLedger\\medialedger.log` records every scan, sync, rename and error with timestamps; Settings → Data → Open log opens it.'),
);

// ---------------- Glossary ----------------
add(H1('24. Glossary'),
  table(['Word', 'Meaning'], [
    ['ffprobe', 'Part of ffmpeg; reads a media file\'s streams and reports resolution, codecs, languages and more without playing it.'],
    ['Sidecar', 'A subtitle, poster or metadata file that sits next to a video with the same base name.'],
    ['Override / fix', 'A manual correction stored in the ledger and re-applied on every scan.'],
    ['Placeholder', 'A literal word written into a movie name where the engine could not prove a value.'],
    ['Pre-flight', 'The set of checks run over an entire rename batch before any file is touched.'],
    ['Journal', 'The per-file record of a rename batch that makes undo possible.'],
    ['Truth source', 'Where the naming engine takes title and year from: file name plus fixes, or the Plex match.'],
    ['Root', 'A watched folder with a library type.'],
    ['Rating key', 'Plex\'s internal id for an item.'],
    ['TOTP', 'Time-based one-time password: the 6-digit codes an authenticator app shows, used for two-factor sign-in on the web server.'],
    ['LAN only', 'The web server rule that refuses connections from public address ranges.'],
    ['Re-authentication', 'Entering the password again before an action that changes files or security settings.'],
    ['Role', 'What an account on the web server may do: admin, standard or guest.'],
    ['Guest', 'Someone using the web server without signing in, allowed only when Guest access is on.'],
    ['Webhook', 'A URL Plex calls when something happens on the Plex server, so MediaLedger reacts at once instead of on the next sync.'],
  ], [1800, 7560]),
);

const doc = new Document({
  creator: 'AxialForge', title: 'MediaLedger User Manual', description: `MediaLedger ${version} manual`,
  styles: { default: { document: { run: { font: F, size: 22 } } }, paragraphStyles: [
    { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 34, bold: true, color: '1F3864', font: F }, paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 } },
    { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: '2E5597', font: F }, paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1 } },
    { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 23, bold: true, color: '444444', font: F }, paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 } },
  ] },
  numbering,
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1300, bottom: 1300, left: 1440, right: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `MediaLedger ${version} · User Manual`, size: 16, color: '888888' })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Page ', size: 16, color: '888888' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '888888' })] })] }) },
    children: body,
  }],
});
Packer.toBuffer(doc).then(buf => { fs.writeFileSync(out, buf); console.log('wrote', out, Math.round(buf.length / 1024) + ' KB'); });
