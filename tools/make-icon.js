'use strict';
// Generates build/icon.ico (256px PNG-in-ICO) and build/icon.png with no
// dependencies: a rounded dark tile, a blue "ledger" bracket and three rows.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 256;
const px = new Uint8Array(S * S * 4);
const set = (x, y, r, g, b, a = 255) => { if (x < 0 || y < 0 || x >= S || y >= S) return; const i = (y * S + x) * 4; const ia = a / 255; px[i] = px[i] * (1 - ia) + r * ia; px[i + 1] = px[i + 1] * (1 - ia) + g * ia; px[i + 2] = px[i + 2] * (1 - ia) + b * ia; px[i + 3] = Math.min(255, px[i + 3] + a); };
const rect = (x0, y0, x1, y1, c, radius = 0) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { if (radius) { const dx = Math.max(x0 + radius - x, 0, x - (x1 - 1 - radius)), dy = Math.max(y0 + radius - y, 0, y - (y1 - 1 - radius)); if (dx * dx + dy * dy > radius * radius) continue; } set(x, y, ...c); } };

rect(8, 8, 248, 248, [23, 26, 33], 48);            // tile
rect(8, 8, 248, 248, [42, 47, 58, 0], 48);
// bracket ▣ motif: outer square outline in accent blue
const blue = [90, 169, 255];
rect(56, 56, 200, 72, blue); rect(56, 184, 200, 200, blue); rect(56, 56, 72, 200, blue); rect(184, 56, 200, 200, blue);
// three ledger rows inside
rect(88, 92, 168, 104, [230, 232, 238]);
rect(88, 122, 152, 134, [126, 231, 135]);
rect(88, 152, 168, 164, [230, 232, 238]);

// ---- PNG encode ----
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);

// ---- ICO wrap (single 256x256 PNG entry) ----
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16); entry[0] = 0; entry[1] = 0; entry[2] = 0; entry[3] = 0; entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(22, 12);
const out = path.join(__dirname, '..', 'build');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), png);
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, entry, png]));
console.log('wrote build/icon.png and build/icon.ico');
