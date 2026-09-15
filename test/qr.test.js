'use strict';
// QR encoder checks. The full output was verified once against a reference decoder (OpenCV) for every
// version 1–15 and all eight masks; these tests pin the pieces that broke during that verification.
const assert = require('assert');
const { rsEncode, encode, makeMatrix, matrix, qrSvg } = require('../src/renderer/qr.js');

// Reed–Solomon: the "HELLO WORLD" 1-M vector from the QR tutorial literature.
const ec = rsEncode([0x10, 0x20, 0x0C, 0x56, 0x61, 0x80, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11], 10);
assert.deepStrictEqual(ec, [0xA5, 0x24, 0xD4, 0xC1, 0xED, 0x36, 0xC7, 0x87, 0x2C, 0x55]);

// Function patterns must leave exactly the specified number of data modules (ISO 18004 table 1; remainder bits excluded).
const dataBits = { 1: 208, 2: 359, 3: 567, 4: 807, 5: 1079, 6: 1383, 7: 1568, 8: 1936, 9: 2336, 10: 2768, 11: 3232, 12: 3728, 13: 4256, 14: 4651, 15: 5243 };
for (const [ver, bits] of Object.entries(dataBits)) {
  const { reserved } = makeMatrix(Number(ver), []);
  let free = 0; for (const row of reserved) for (const v of row) if (!v) free++;
  assert.strictEqual(free, bits, `version ${ver} free modules`);
}

// Version selection and total codeword count (data + EC) per version.
const total = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172, 7: 196, 8: 242, 9: 292, 10: 346, 11: 404, 12: 466, 13: 532, 14: 581, 15: 655 };
const caps = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412];
for (let v = 1; v <= 15; v++) {
  const hdr = v < 10 ? 2 : 3;
  const r = encode('x'.repeat(caps[v] - hdr));
  assert.strictEqual(r.ver, v, `full text picks version ${v}`);
  assert.strictEqual(r.codewords.length, total[v], `version ${v} codeword count`);
}
assert.throws(() => encode('x'.repeat(500)), /too long/);

// Finder patterns, timing pattern and the dark module are where the spec puts them, for every version.
for (let v = 1; v <= 15; v++) {
  const m = matrix('MediaLedger'.repeat(40).slice(0, caps[v] - 4)); const n = m.length;
  assert.strictEqual(n, v * 4 + 17);
  for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) { assert.strictEqual(m[r][c], 1); assert.strictEqual(m[r + 1][c + 1], 0); assert.strictEqual(m[r + 3][c + 3], 1); }
  for (let i = 8; i < n - 8; i++) { assert.strictEqual(m[6][i], i % 2 === 0 ? 1 : 0); assert.strictEqual(m[i][6], i % 2 === 0 ? 1 : 0); }
  assert.strictEqual(m[n - 8][8], 1, 'dark module');
}

// Format information for mask 0, level M is the well-known 101010000010010.
const m0 = matrix('a', 0);
assert.strictEqual([0, 1, 2, 3, 4, 5, 7, 8].map(c => m0[8][c]).join('') + [7, 5, 4, 3, 2, 1, 0].map(r => m0[r][8]).join(''), '101010000010010');

// Alignment pattern centres (the version 10–13 entries were wrong once).
const centre = (v, r, c) => { const m = matrix('MediaLedger'.repeat(40).slice(0, caps[v] - 4)); return m[r][c] === 1 && m[r - 1][c] === 0 && m[r - 2][c] === 1 && m[r][c - 2] === 1 && m[r + 2][c + 2] === 1; };
assert.ok(centre(10, 28, 50) && centre(10, 50, 28) && centre(10, 50, 50), 'v10 alignment at 28/50');
assert.ok(centre(13, 34, 62) && centre(13, 62, 34), 'v13 alignment at 34/62');
assert.ok(centre(7, 22, 38) && centre(7, 38, 22) && centre(7, 22, 22), 'v7 alignment including the timing-row ones');

// SVG output
const svg = qrSvg('http://medialedger.home', { size: 120, label: 'Guest "link"' });
assert.ok(svg.startsWith('<svg') && svg.includes('width="120"') && svg.includes('aria-label="Guest &quot;link&quot;"') && svg.includes('<path'));
console.log('qr tests passed');
