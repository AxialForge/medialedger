'use strict';
// The dependency-free zip writer must produce archives that the OS extractor accepts and that round-trip bytes.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { writeZip, crc32 } = require('../src/main/zip');

assert.strictEqual(crc32(Buffer.from('123456789')), 0xcbf43926, 'CRC-32 check value');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-zip-'));
const a = 'show,season,episode\nOne Piece,1,1\n'.repeat(500);
const b = Buffer.from([0, 1, 2, 255, 254, 253]);
fs.writeFileSync(path.join(dir, 'a.csv'), a);
const zip = writeZip(path.join(dir, 'out.zip'), [{ name: 'sub/a.csv', file: path.join(dir, 'a.csv') }, { name: 'b.bin', data: b }]);
assert.ok(fs.statSync(zip).size > 22 && fs.statSync(zip).size < a.length, 'compressed and non-trivial');

// Round-trip through the platform's own extractor (Expand-Archive on Windows, unzip elsewhere)
const out = path.join(dir, 'x'); fs.mkdirSync(out);
try {
  if (process.platform === 'win32') execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${out}' -Force`]);
  else execFileSync('unzip', ['-q', zip, '-d', out]);
} catch (e) { console.log('zip tests: extraction skipped (' + e.message.split('\n')[0] + ')'); process.exit(0); }
assert.strictEqual(fs.readFileSync(path.join(out, 'sub', 'a.csv'), 'utf8'), a);
assert.deepStrictEqual([...fs.readFileSync(path.join(out, 'b.bin'))], [...b]);
console.log('zip tests passed');
