'use strict';
// Plex webhook: multipart parsing and applying events to linked files, on a throwaway database.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Db } = require('../src/main/db');
const { parseWebhookBody, applyWebhookEvent } = require('../src/main/plex');

// multipart body the way Plex sends it (payload part + a thumb part)
const payload = { event: 'media.scrobble', Account: { title: 'joe' }, Player: { title: 'Living room' }, Metadata: { type: 'episode', ratingKey: '4242', grandparentTitle: 'One Piece', title: 'Romance Dawn' } };
const b = 'ABC123boundary';
const body = Buffer.concat([
  Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="payload"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n`),
  Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="thumb"; filename="thumb.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a]), Buffer.from(`\r\n--${b}--\r\n`),
]);
assert.deepStrictEqual(parseWebhookBody(`multipart/form-data; boundary=${b}`, body), payload);
assert.deepStrictEqual(parseWebhookBody('application/json', Buffer.from(JSON.stringify(payload))), payload, 'plain JSON also accepted');
assert.strictEqual(parseWebhookBody(`multipart/form-data; boundary=${b}`, Buffer.from('garbage')), null);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-hook-'));
const db = new Db(path.join(dir, 't.db'), { log: () => {} });
db.run("INSERT INTO files (root_id, library_type, rel_path, abs_path, file_name, plex_rating_key, plex_view_count) VALUES ('anime','anime','One Piece E01.mkv','x','E01.mkv','4242',3)");
const r1 = applyWebhookEvent(db, payload);
assert.ok(r1.matched && r1.updated === 'watched' && r1.title === 'One Piece – Romance Dawn');
assert.strictEqual(db.get('SELECT plex_view_count n, plex_last_viewed lv FROM files').n, 4);
const r2 = applyWebhookEvent(db, { event: 'media.rate', rating: 8, Metadata: { type: 'episode', ratingKey: '4242', title: 'x' } });
assert.ok(r2.matched && r2.updated === 'rating' && db.get('SELECT plex_user_rating r FROM files').r === 8);
const r3 = applyWebhookEvent(db, { event: 'library.new', Metadata: { type: 'movie', ratingKey: '9', title: 'New Movie' } });
assert.ok(r3.scan && !r3.matched);
const r4 = applyWebhookEvent(db, { event: 'media.scrobble', Metadata: { ratingKey: '404', title: 'unknown' } });
assert.ok(!r4.matched && !r4.scan, 'unknown item is ignored quietly');
db.close();
console.log('webhook tests passed');
