'use strict';
// Parts of the interface that are in the inventory and the manual but have no screenshot of their own:
// short confirmation dialogs, the sidebar's own controls, and keyboard shortcuts. Same control shape as controls/*.js.
const c = (sel, name, type, does, inputs = '', def = '', notes = '') => ({ sel, name, type, does, inputs, def, notes });

const dialogs = [
  { id: 'd01_confirm_identity', name: 'Confirm it is you (password again)', kind: 'dialog', parent: 'main_window', src: ['src/renderer/webbridge.js', "title: 'Confirm it is you'"],
    purpose: 'Web server only. Before an action that changes files or security settings, the server asks for your password again unless you confirmed within the last five minutes.',
    controls: [c('.webauth input[name=password]', 'Password', 'Password field', 'Your password.', '', 'empty', ''), c('.webauth button[type=submit]', 'Confirm', 'Button', 'Confirms and carries on with the action.', '', '', '')] },
  { id: 'd02_one_at_a_time', name: 'One at a time', kind: 'dialog', parent: '29_rename_tv_anime', src: ['src/renderer/app.js', 'function stepThrough(items'],
    purpose: 'Walks through the ticked files, showing the current and the proposed name of each and asking before every rename. Used by both rename pages.',
    controls: [c('#stGo', 'Rename this file', 'Button', 'Renames the file shown and moves to the next.', '', '', ''), c('#stSkip', 'Skip', 'Button', 'Leaves this file as it is and moves to the next.', '', '', ''), c('#stStop', 'Stop', 'Button', 'Ends the walk; files already renamed stay renamed.', '', '', '')] },
  { id: 'd03_dry_run_result', name: 'Dry run result', kind: 'dialog', parent: '29_rename_tv_anime', src: ['src/renderer/app.js', '<h2>Dry run: ${okN}'],
    purpose: 'Lists what a rename would do to each ticked file, with a tick or a cross and the reason for a cross. Nothing on the share changes.',
    controls: [c('#dC', 'Close', 'Button', 'Closes the result.', '', '', '')] },
  { id: 'd04_batch_items', name: 'Batch items', kind: 'dialog', parent: '29_rename_tv_anime', src: ['src/renderer/app.js', '<h2>Batch #${b.dataset.id}'],
    purpose: 'Lists the files of one batch with the status of each: done, failed, aborted or undone.',
    controls: [c('#iC', 'Close', 'Button', 'Closes the list.', '', '', '')] },
  { id: 'd05_undo_batch', name: 'Undo batch', kind: 'dialog', parent: '28_movie_names', src: ['src/renderer/app.js', '<h2>Undo batch #${u.dataset.id}?'],
    purpose: 'Confirms renaming the files of a batch back. Each file is checked first: still present, same size, original name free.',
    controls: [c('#uC', 'Cancel', 'Button', 'Closes without undoing.', '', '', ''), c('#uGo', 'Undo now', 'Button', 'Renames the files back.', '', '', '')] },
  { id: 'd06_rename_movies_live', name: 'Rename movie files, live', kind: 'dialog', parent: '28_movie_names', src: ['src/renderer/app.js', 'on the share — live</h2>'],
    purpose: 'The confirmation before a live movie batch. It lists the files (the first sixty) and asks you to type RENAME, so a live run cannot be started by a stray click.',
    controls: [c('#mrConfirm', 'Type RENAME to confirm', 'Text field', 'Type the word RENAME.', 'Exactly RENAME', 'empty', 'The rename button stays disabled until it matches.'), c('#mrCancel', 'Cancel', 'Button', 'Closes without renaming.', '', '', ''), c('#mrGo', 'Rename now', 'Button', 'Runs the live batch.', '', 'disabled', 'Enabled once RENAME is typed.')] },
  { id: 'd07_movie_batch_result', name: 'Movie batch result', kind: 'dialog', parent: '28_movie_names', src: ['src/renderer/app.js', 'id="mrClose"'],
    purpose: 'Shows the outcome of a movie batch, dry or live: how many files were renamed, skipped and failed.',
    controls: [c('#mrClose', 'Close', 'Button', 'Closes the result.', '', '', '')] },
  { id: 'd08_set_source', name: 'Set source for selected', kind: 'dialog', parent: '28_movie_names', src: ['src/renderer/app.js', '<h2>Set source to'],
    purpose: 'Confirms recording where the ticked copies came from, which the Source part of the name uses.',
    controls: [c('#bsC', 'Cancel', 'Button', 'Closes without changing.', '', '', ''), c('#bsGo', 'Apply', 'Button', 'Saves the source as a fix on each ticked file.', '', '', '')] },
  { id: 'd09_ignore_collisions', name: 'Ignore the other files', kind: 'dialog', parent: '28_movie_names', src: ['src/renderer/app.js', '<h2>Ignore ${others.length}'],
    purpose: 'When several files would get the same name, keeps one and marks the others as ignored. The ignored files stay on disk.',
    controls: [c('#ckC', 'Cancel', 'Button', 'Closes without changing.', '', '', ''), c('#ckGo', 'Ignore them', 'Button', 'Marks the other files as ignored.', '', '', '')] },
  { id: 'd10_card_settings_legacy', name: 'Card settings (before version 2.0)', kind: 'dialog', parent: '02_dashboard', src: ['src/renderer/app.js', '<h2>Card settings'], unreachable: true,
    purpose: 'The colour-rule dialog of versions 1.9 to 1.12, opened by a gear on a tile. Version 2.0 replaced it with the card options dialog; the code remains but no gear opens it.',
    controls: [c('#csLevel', 'Editor level', 'Drop-down list', 'Simple, Standard or Advanced.', '', 'Standard', ''), c('#csRule', 'Colour rule', 'Group', 'Amber and red thresholds.', '', '', 'Advanced only.')] },
];

const sidebar = { id: 'sidebar', name: 'Sidebar', kind: 'navigation', parent: 'main_window', src: ['src/renderer/index.html', '<nav class="sidebar">'],
  purpose: 'The sidebar is the application\'s only menu. It is present on every page.',
  controls: [
    c('#navToggle', 'Menu button', 'Button', 'Shows and hides the sidebar on a narrow screen.', '', '', 'Phones and narrow windows only.'),
    ...[['dashboard', 'Dashboard'], ['tv', 'TV Shows'], ['anime', 'Anime'], ['movies', 'Movies'], ['web', 'Web videos'], ['adult', 'Adult'], ['missing', 'Missing'], ['issues', 'Issues'], ['quality', 'Quality'], ['upgrades', 'Upgrades'], ['reclaim', 'Reclaim space'], ['ratings', 'Ratings'], ['tonight', 'Watch tonight'], ['watched', 'Watched'], ['requests', 'Requests'], ['changes', 'Change log'], ['movienames', 'Movie names'], ['rename', 'Rename TV/anime'], ['export', 'CSV export'], ['system', 'System'], ['family', 'Family portal'], ['log', 'Log'], ['security', 'Security'], ['settings', 'Settings'], ['about', 'About']].map(([v, n]) => c(`.sidebar a[data-view=${v}]`, n, 'Navigation link', `Opens the ${n} page.`, '', '', v === 'adult' ? 'Hidden until adult content is switched on.' : '')),
    c('#accountLine', 'Account line', 'Label with link', 'Who is signed in, with a link to sign out; for a guest, a link to sign in.', '', '', 'Web server only.'),
    c('#showAdult', 'Show adult content', 'Check box', 'Shows adult titles for this session.', '', 'off', 'Not offered to guests.'),
    c('#btnScan', 'Scan now', 'Button', 'Starts a scan of every enabled root.', '', '', 'Administrators only on the web server.'),
    c('#btnCancel', 'Cancel scan', 'Button', 'Stops the running scan.', '', '', 'Shown only while a scan runs.'),
    c('#scanProgress', 'Scan progress', 'Progress bar', 'How far the scan is, and the file being read.', '', '', ''),
    c('#metaProgress', 'Lookup progress', 'Progress bar', 'How far the episode lookups are.', '', '', ''),
    c('#watchLine', 'Folder watch line', 'Label', 'Says that folders are being watched and when a change was last seen.', '', '', 'Shown when folder watch is on.'),
    c('#updatePill', 'Update pill', 'Indicator', 'Appears on About when a newer version is available or downloaded.', '', '', ''),
    c('#versionLine', 'Version', 'Label', 'The version that is running.', '', '', '"(dev)" when run from source.'),
    c('#toast', 'Message', 'Notice', 'Short confirmations and errors appear at the bottom of the window and fade.', '', '', 'Red for an error.'),
  ] };

const shortcuts = [
  { keys: 'Escape', where: 'Any dialog', does: 'Closes the dialog without saving.', src: ['src/renderer/app.js', "if (e.key === 'Escape') closeModal()"] },
  { keys: 'Enter', where: 'Tag field on a series or movie page', does: 'Adds the typed tag.', src: ['src/renderer/app.js', "closest('.tag-add'); if (!inp || e.key !== 'Enter')"] },
  { keys: 'Enter', where: 'Search words in the Match dialog', does: 'Starts the search.', src: ['src/renderer/app.js', "$('#mq', card).onkeydown"] },
  { keys: 'Enter', where: 'Path in the folder browser', does: 'Opens the typed path.', src: ['src/renderer/app.js', "$('#fbPath', card).onkeydown"] },
  { keys: 'Enter', where: 'Sign-in and confirmation dialogs', does: 'Submits the dialog.', src: ['src/renderer/webbridge.js', 'webauth'] },
  { keys: 'Alt', where: 'Desktop application', does: 'Shows the standard Electron menu bar, which is hidden by default. MediaLedger defines no menu of its own and no application-wide shortcuts.', src: ['src/main/main.js', 'autoHideMenuBar: true'] },
];

const absent = [
  { what: 'Context menus', note: 'None. No right-click menu is defined anywhere in the renderer.' },
  { what: 'Toolbars', note: 'No application toolbar. Pages carry their own filter row, listed with each page.' },
  { what: 'Application menu', note: 'None defined. The desktop window hides the default Electron menu bar.' },
  { what: 'Light theme', note: 'None. All eight colour themes are dark.' },
];

module.exports = { dialogs, sidebar, shortcuts, absent };
