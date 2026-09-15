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

// notify: SMTP reply framing, and upgrade reasons
const { parseReplies } = require('../src/main/notify');
const { upgradeReasons, upgradeScore } = require('../src/main/upgrades');
{
  const r = parseReplies('220 hi\r\n250-a\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n354 go\r\n');
  assert.deepStrictEqual(r.replies.map(x => x.split('\n').length), [1, 3, 1]); assert.strictEqual(r.rest, '');
  assert.strictEqual(parseReplies('250-half').replies.length, 0, 'continuation line alone is not a reply');
  const t = { kind: 'movie', best: '720p', plays: 3, my_rating: 5, online_rating: 8.4, low_bitrate: 1, files: 1, hdr: false, gb: 1.2 };
  assert.deepStrictEqual(upgradeReasons(t), ['720p copy', '1 low-bitrate file', 'played 3×', 'you rate it 5★', 'rated 8.4 online']);
  assert.deepStrictEqual(upgradeReasons({ best: '1080p', plays: 0, my_rating: null, low_bitrate: 0 }), ['never played, unrated']);
  assert.strictEqual(typeof upgradeScore(t), 'number');
}
console.log('notify/upgrade tests passed');
