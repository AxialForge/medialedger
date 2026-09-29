'use strict';
// Posters against a stand-in Plex server: what is fetched, where it lands, what is skipped, and what is served.
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');
const { Db } = require('../src/main/db');
const { createPosters, sniff, hashOf, plexUrl } = require('../src/main/posters');

const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(200, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64, 1)]);
assert.deepStrictEqual(sniff(JPEG), { ext: 'jpg', mime: 'image/jpeg' });
assert.strictEqual(sniff(PNG).ext, 'png');
assert.strictEqual(sniff(Buffer.from('<html>not an image</html>')), null, 'an error page is not a poster');
assert.strictEqual(hashOf('a/b\\..\\c').length, 40);
assert.ok(plexUrl({ baseUrl: 'http://plex:32400/' }, '77', 300).includes('width=300&height=450') && plexUrl({ baseUrl: 'http://plex:32400/' }, '77', 300).includes(encodeURIComponent('/library/metadata/77/thumb')));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-posters-'));
const db = new Db(path.join(tmp, 'p.db'));
const add = (id, type, o) => db.run(`INSERT INTO files (id, root_id, rel_path, abs_path, file_name, library_type, show_name, movie_title, group_key, plex_rating_key, plex_show_key, adult) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, id, 'r', id + '.mkv', id + '.mkv', id + '.mkv', type, o.show || null, o.movie || null, o.group || null, o.rk || null, o.sk || null, o.adult || 0);
add(1, 'movie', { movie: 'Alien', group: 'alien|1979', rk: '101' });
add(2, 'movie', { movie: 'No Art', group: 'noart|2000', rk: '404' });
add(3, 'movie', { movie: 'Broken', group: 'broken|2001', rk: '500' });
add(4, 'movie', { movie: 'Not In Plex', group: 'nip|2002' });
add(5, 'anime', { show: 'Frieren', sk: '201' }); add(6, 'anime', { show: 'Frieren', sk: '201' });
add(7, 'movie', { movie: 'Grown Ups Only', group: 'adult|1', rk: '900', adult: 1 });
add(8, 'movie', { movie: 'Html', group: 'html|1', rk: '600' });

const asked = [];
const plex = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const key = /metadata\/(\d+)\/thumb/.exec(decodeURIComponent(u.searchParams.get('url') || ''));
  asked.push({ key: key && key[1], token: req.headers['x-plex-token'], width: u.searchParams.get('width') });
  if (req.headers['x-plex-token'] !== 'tok') { res.writeHead(401); return res.end(); }
  const k = key && key[1];
  if (k === '404') { res.writeHead(404); return res.end(); }
  if (k === '500') { res.writeHead(500); return res.end('boom'); }
  if (k === '600') { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end('<html>login page</html>'); }
  res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(k === '201' ? PNG : JPEG);
});

(async () => {
  await new Promise(r => plex.listen(0, '127.0.0.1', r));
  const dir = path.join(tmp, 'nas', 'Posters');
  let cfg = { posters: { enabled: true, dir, width: 300, online: false }, plex: { baseUrl: `http://127.0.0.1:${plex.address().port}`, token: 'tok' } };
  const settings = { get: () => cfg, set: (p) => { cfg = { ...cfg, ...p }; } };
  const events = [];
  const P = createPosters({ db, settings, userData: tmp, log: () => {}, send: (ch, x) => events.push([ch, x]) });

  assert.strictEqual(P.titles().length, 6, 'the adult title is not on the list');
  const r = await P.run({});
  assert.deepStrictEqual({ ok: r.ok, none: r.none, error: r.error }, { ok: 2, none: 2, error: 2 });
  assert.ok(!asked.some(a => a.key === '900'), 'Plex is never asked for an adult poster');
  assert.ok(asked.every(a => a.token === 'tok' && a.width === '300'));
  const st = P.status();
  assert.strictEqual(st.have, 2); assert.strictEqual(st.titles, 6); assert.strictEqual(st.writable, true); assert.strictEqual(st.bytes, JPEG.length + PNG.length);
  assert.deepStrictEqual(Object.keys(P.index()).sort(), ['anime|Frieren', 'movie|alien|1979']);
  const f = P.fileOf('movie', 'alien|1979');
  assert.ok(f.abs.startsWith(dir) && f.abs.endsWith(hashOf('alien|1979') + '.jpg') && f.mime === 'image/jpeg');
  assert.ok(P.fileOf('anime', 'Frieren').abs.endsWith('.png'), 'the extension follows the bytes');
  assert.ok(P.dataUrl('movie', 'alien|1979').startsWith('data:image/jpeg;base64,/9j/'));
  assert.strictEqual(P.fileOf('movie', 'noart|2000'), null); assert.strictEqual(P.fileOf('movie', 'adult|1'), null);
  assert.strictEqual(P.fileOf('movie', '../../etc/passwd'), null);
  db.run("UPDATE posters SET file='../../outside.jpg' WHERE title_key='alien|1979'");
  assert.strictEqual(P.fileOf('movie', 'alien|1979'), null, 'a stored path cannot leave the posters folder');
  db.run("UPDATE posters SET file=? WHERE title_key='alien|1979'", 'movie/' + hashOf('alien|1979') + '.jpg');
  assert.ok(db.get("SELECT note FROM posters WHERE title_key='html|1'").note.includes('not an image'));
  assert.ok(events.some(e => e[0] === 'posters:progress' && e[1].running === false));

  // second run: nothing new to ask for; a deleted file is fetched again; a title that left the library loses its poster
  asked.length = 0; const r2 = await P.run({});
  assert.strictEqual(r2.wanted, 0, 'titles without art are not asked for again until the retry window passes');
  fs.unlinkSync(f.abs); db.run('DELETE FROM files WHERE id IN (5,6)');
  const r3 = await P.run({});
  assert.strictEqual(r3.ok, 1); assert.strictEqual(r3.removed, 1); assert.ok(fs.existsSync(f.abs));
  assert.strictEqual(P.fileOf('anime', 'Frieren'), null);
  const r4 = await P.run({ retry: true }); assert.strictEqual(r4.wanted, 4, 'retry asks again for the ones without art');

  // an unwritable folder stops the run with a plain message
  cfg.posters.dir = path.join(f.abs, 'cannot-be-a-folder');
  await assert.rejects(P.run({}), /not writable/);
  cfg.posters.dir = dir; cfg.posters.enabled = false;
  assert.deepStrictEqual(await P.run({}), { skipped: true, reason: 'posters are switched off' });
  assert.ok(P.clear() >= 1); assert.strictEqual(P.status().have, 0); assert.ok(!fs.existsSync(f.abs));

  plex.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log('posters tests passed');
})().catch(e => { console.error(e); process.exit(1); });
