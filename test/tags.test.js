'use strict';
const assert = require('assert');
const { fileAudioType, titleAudioType, onlineTags, normalizeTag } = require('../src/main/tags');

assert.strictEqual(fileAudioType('jpn', 'eng', { anime: true }), 'sub');
assert.strictEqual(fileAudioType('jpn,eng', '', { anime: true }), 'dual');
assert.strictEqual(fileAudioType('eng', 'eng', { anime: true }), 'dub');
assert.strictEqual(fileAudioType('eng', 'eng', { anime: false }), null, 'an English film is not a dub');
assert.strictEqual(fileAudioType('jpn', '', { anime: true }), 'raw');
assert.strictEqual(fileAudioType('ja', 'en'), 'sub', 'two-letter codes');
assert.strictEqual(fileAudioType(null, null), null);

assert.strictEqual(titleAudioType({ files: 12, jpn: 12, eng: 0 }, { anime: true }), 'sub');
assert.strictEqual(titleAudioType({ files: 12, jpn: 0, eng: 12 }, { anime: true }), 'dub');
assert.strictEqual(titleAudioType({ files: 12, jpn: 0, eng: 12 }, { anime: false }), null);
assert.strictEqual(titleAudioType({ files: 12, jpn: 12, eng: 12, dual: 12 }), 'dual');
assert.strictEqual(titleAudioType({ files: 12, jpn: 5, eng: 7 }, { anime: true }), 'mixed');
assert.strictEqual(titleAudioType({ files: 0, jpn: 0, eng: 0 }), null);

assert.deepStrictEqual(onlineTags({ genres: '["Action","Comedy"]', online_tags: '["comedy","Isekai"]' }), ['Action', 'Comedy', 'Isekai']);
assert.deepStrictEqual(onlineTags({ genres: ['Drama'], online_tags: 'not json' }), ['Drama']);
assert.deepStrictEqual(onlineTags(null), []);
assert.strictEqual(normalizeTag('  watch   with sarah '), 'watch with sarah');
assert.strictEqual(normalizeTag('x'.repeat(60)).length, 40);
console.log('tags tests passed');
