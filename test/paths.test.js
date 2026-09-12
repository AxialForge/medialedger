'use strict';
// rel_path keeps "\" separators in the database on every OS; absOf joins them for the local file system.
const assert = require('assert');
const path = require('path');
const { absOf } = require('../src/main/paths');

const rel = 'Show\\Season 01\\ep.mkv';
if (process.platform === 'win32') {
  assert.strictEqual(absOf('\\\\nas\\share\\Anime', rel), '\\\\nas\\share\\Anime\\Show\\Season 01\\ep.mkv');
  assert.strictEqual(absOf('D:\\Media', ''), 'D:\\Media');
}
// Regardless of host OS, the pieces are joined with path.join, i.e. the local separator
assert.strictEqual(absOf('/mnt/media/Anime', rel), path.join('/mnt/media/Anime', 'Show', 'Season 01', 'ep.mkv'));
assert.strictEqual(absOf('/mnt/media/Anime', 'loose.mkv'), path.join('/mnt/media/Anime', 'loose.mkv'));
console.log('paths tests passed');
