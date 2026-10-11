'use strict';
// Screens added in 2.7 and 3.0: collections and their suggestions, the subtitle audit, the duplicate sweep, the
// portal's Sets tab and request lookup; and the controls those versions added to screens that already existed.
const c = (sel, name, type, does, inputs = '', def = '', notes = '', x = {}) => ({ sel, name, type, does, inputs, def, notes, ...x });

module.exports = {
  '58_collections': {
    purpose: 'Sets of titles that belong together across TV, anime and movies: a film series, a shared universe, a director\'s work. Each card shows what is in the library, what is missing, and how much there is to watch. Collections from Plex are read in on each sync and never written back.',
    workflow: ['Press New collection, give it a name, and add titles on its page.', 'Or press one of the Find sets buttons and create the sets it suggests.', 'Open a card to see the titles in order.'],
    features: ['A collection marked Plex follows Plex\'s list; titles you add to it yourself survive the next sync.', 'The strip of posters shows the first titles in the library; the line beneath counts titles, runtime, size, gaps and what is watched.', 'Find sets looks in the library\'s own names, AniList\'s links between anime, and Wikidata\'s film and show series. Nothing is made until Create is pressed.'],
    edge: ['A Plex collection with the same name as one of yours is called "Name (Plex)".', 'A standard user sees the collections and cannot change them.', 'The web lookups take a minute or two on a large library and are capped at 40 titles each per run.'],
    errors: [['There is already a collection called …', 'Names are unique, regardless of case.'], ['Give the collection a name', 'The name field is empty.'], ['Nothing found that is not already in a collection.', 'Every set the finder can see is made already.']],
    controls: [
      c('.tiles .tile', 'Summary tiles', 'Tile', 'How many collections, how many are complete, and how many titles are in sets.', '', '', ''),
      c('#colQ', 'Filter', 'Search field', 'Narrows the cards by name.', '', 'empty', ''),
      c('#colNew', 'New collection', 'Button', 'Opens the dialog for a name and a note.', '', '', 'Administrators only on the web server.'),
      c('.colcard', 'Collection card', 'Card', 'Opens the collection.', '', '', 'Shows a poster strip and the counts.'),
      c('#sugLocal', 'From names only', 'Button', 'Suggests sets from the titles in the library, at once.', '', '', ''),
      c('#sugWeb', 'Names, AniList and Wikidata', 'Button', 'Also asks AniList and Wikidata. Progress is shown beside the buttons.', '', '', 'Free sources, no key.'),
    ],
  },
  '59_collection': {
    purpose: 'One collection: its titles in order, what is on hand and what is not, and the tools to change it.',
    workflow: ['Type part of a title in the add box and click the match to add it.', 'Press Add a placeholder for a title you do not own, so the gap shows.', 'Move titles with the arrows, or press Order by release.', 'Keep a note on a title with the pencil.'],
    features: ['The tiles count what is in the library, the runtime and size on hand, what is watched, and the kinds mixed in.', 'A title that is not in the library shows a red "not in the library" badge; a placeholder gets one until a scan finds it.', 'Titles from a Plex collection carry a small Plex mark.'],
    edge: ['Deleting a Plex collection brings it back on the next sync; delete it in Plex to be rid of it.', 'Removing a title from the collection never touches the files.'],
    errors: [['Pick a title from the library or type one', 'The add box or placeholder dialog was empty.'], ['No such collection', 'It was deleted; the list is reloaded.']],
    controls: [
      c('#cRename', 'Rename / note', 'Button', 'Changes the name and the note.', '', '', ''),
      c('#cSort', 'Order by release', 'Button', 'Orders the titles by release date, then year, then name.', '', '', 'Placeholders with a year only come after dated titles of that year.'),
      c('#cDelete', 'Delete', 'Button', 'Deletes the collection. The titles stay in the library.', '', '', 'Asks first.'),
      c('.tiles .tile', 'Tiles', 'Tile', 'In the library, runtime, watched, kinds.', '', '', ''),
      c('#cAdd', 'Add a title', 'Search field', 'Searches the whole library as you type; a click adds the title.', 'Two letters or more.', 'empty', 'Titles already in the set are greyed.'),
      c('#cPlace', 'Add a placeholder', 'Button', 'Adds a title you do not own yet, by name, year and kind.', '', '', ''),
      c('.colitems [data-act=up]', 'Move up', 'Button', 'Moves the title one place up.', '', '', ''),
      c('.colitems [data-act=note]', 'Note', 'Button', 'Sets or clears the note on that title.', 'Up to 300 characters.', '', ''),
      c('.colitems [data-act=remove]', 'Remove', 'Button', 'Takes the title out of the collection.', '', '', 'Asks first.'),
    ],
  },
  '61_issues_subtitles': {
    purpose: 'Files that have no subtitles in the languages you want, as a track inside the file or as a sidecar beside it. Grouped by title, with where to look for subtitles.',
    workflow: ['Set the wanted languages under Settings, Episodes and quality, Subtitles.', 'Open Issues, Subtitles. Sort by Files without to see the worst first.', 'Press Find on a title to search OpenSubtitles; put the file beside the video as Show.S01E01.en.srt.', 'The next scan picks the sidecar up and the title drops off the list.'],
    features: ['A sidecar counts when its name carries a language tag (en, eng, ja…). One without a tag is counted separately as unknown.', 'The Audio column shows the audio languages, which is often why a subtitle is wanted.', 'The Subtitles dashboard card shows the same count.'],
    edge: ['Forced-only subtitle tracks count as subtitles; the probe does not tell them apart.', 'Files that were never probed are not listed, since nothing is known about them.'],
    errors: [],
    controls: [
      c('.tiles .tile', 'Tiles', 'Tile', 'Files without subtitles, titles affected, files covered, sidecars without a language.', '', '', ''),
      c('.toolbar input[type=search]', 'Filter', 'Search field', 'Narrows the table by title.', '', 'empty', ''),
      c('thead th', 'Column heading', 'Button', 'Sorts by that column.', '', 'Files without, most first', ''),
      c('a.ext', 'Find', 'Link', 'Opens an OpenSubtitles search for the title in the first wanted language.', '', '', 'Opens in the browser.'),
    ],
  },
  '65_portal_sets': {
    purpose: 'The family portal\'s Sets tab: the same collections, read-only, with how much of each is in the library.',
    workflow: ['Open Sets.', 'Tap a set to see its titles in order; tap a title to open it.'],
    features: ['A title not in the library is listed greyed, so family can see what is still to come.'],
    edge: ['Only invites that may browse see the tab.'],
    errors: [],
    controls: [
      c('#tabs a', 'Tabs', 'Navigation', 'Library, Sets, Tonight, Requests.', '', '', ''),
      c('#view .row', 'Set', 'Row', 'Opens the set.', '', '', 'Counts, length and a strip of posters.'),
    ],
  },
  '67_portal_request_lookup': {
    purpose: 'The request form finds the show as you type: matches from TVmaze (TV) or AniList (anime) with a poster and year, so the request names the right thing.',
    workflow: ['Choose the kind first: TV show or Anime.', 'Type three or more letters of the title.', 'Tap the right match; the title and year are filled in.', 'Send the request.'],
    features: ['Movies have no keyless free poster source, so a movie request stays as typed.', 'Searches are limited to thirty a minute per invite.'],
    edge: ['A match is only a help for typing; the request is still sent as the words in the fields.'],
    errors: [['Too many searches; wait a minute', 'More than thirty lookups in a minute from this invite.']],
    controls: [
      c('#rKind', 'Kind', 'Dropdown', 'Movie, TV show, Anime or Other. Lookups run for TV and Anime.', '', 'Movie', ''),
      c('#rTitle', 'Title', 'Text field', 'What should be added; typing here searches.', 'Up to 120 characters.', 'empty', ''),
      c('#rHits .hit', 'Match', 'Row', 'Fills the title and year from that match.', '', '', 'Poster from TVmaze or AniList.'),
      c('#rSend', 'Send request', 'Button', 'Sends the request.', '', '', ''),
    ],
  },
  __additions: {
    '18_issues_duplicates': [c('#dupBest', 'Keep the best copy everywhere', 'Button', 'Marks the keeper in every undecided group: highest resolution, then bitrate, then the smaller file.', '', '', 'Asks first. Choices can be changed afterwards.'), c('#dupMove', 'Move the discards aside', 'Button', 'Moves every discarded file into _duplicates at the top of its root, as an undoable batch. Nothing is deleted.', '', '', 'Needs the renaming switch and your password. Undo on the Movie names page.')],
    '44_settings': [c('#subWanted', 'Wanted subtitle languages', 'Text field', 'The languages a file should have subtitles in; the audit under Issues, Subtitles lists files without one.', 'Three-letter codes, comma separated.', 'eng', '')],
    '33_family_portal_admin': [],
  },
};
