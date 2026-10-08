"""Generated posters for the demo data: a gradient, a shape and the title. No real artwork is used.

    python docs/_tools/release-docs/make-demo-posters.py <demo-data-dir>

Reads posters-wanted.json written by make-demo-data.js, writes the PNG files into <demo>/posters and the
matching rows into the posters table.
"""
import json, os, sqlite3, sys, hashlib, datetime
from PIL import Image, ImageDraw, ImageFont

demo = os.path.abspath(sys.argv[1])
want = json.load(open(os.path.join(demo, 'posters-wanted.json'), encoding='utf-8'))
out = os.path.join(demo, 'posters')
W, H = 300, 450


def font(size, bold=True):
    for name in (['segoeuib.ttf', 'arialbd.ttf'] if bold else ['segoeui.ttf', 'arial.ttf']):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def wrap(draw, text, fnt, width):
    lines, cur = [], ''
    for word in text.split():
        t = (cur + ' ' + word).strip()
        if draw.textlength(t, font=fnt) <= width:
            cur = t
        else:
            lines.append(cur)
            cur = word
    lines.append(cur)
    return [l for l in lines if l]


con = sqlite3.connect(os.path.join(demo, 'medialedger.db'))
now = datetime.datetime(2026, 9, 28, 6, 0, 0).isoformat() + '.000Z'
for t in want:
    h = hashlib.sha1(t['key'].encode('utf-8')).digest()
    a = (40 + h[0] % 120, 40 + h[1] % 120, 60 + h[2] % 140)
    b = (10 + h[3] % 60, 10 + h[4] % 60, 20 + h[5] % 70)
    img = Image.new('RGB', (W, H))
    px = img.load()
    for y in range(H):
        k = y / H
        row = tuple(int(a[i] * (1 - k) + b[i] * k) for i in range(3))
        for x in range(W):
            px[x, y] = row
    d = ImageDraw.Draw(img, 'RGBA')
    cx, cy, r = 60 + h[6] % 180, 110 + h[7] % 120, 50 + h[8] % 60
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255, 38))
    d.rectangle((0, H - 150, W, H), fill=(0, 0, 0, 120))
    f = font(30)
    lines = wrap(d, t['title'], f, W - 40)[:3]
    y = H - 135
    for line in lines:
        d.text((20, y), line, font=f, fill=(255, 255, 255, 255))
        y += 36
    d.text((20, 18), {'movie': 'MOVIE', 'tv': 'TV', 'anime': 'ANIME'}[t['type']], font=font(14), fill=(255, 255, 255, 190))
    path = os.path.join(out, t['file'])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'PNG', optimize=True)
    con.execute('INSERT OR REPLACE INTO posters (library_type, title_key, status, source, file, mime, bytes, fetched_at, tries) VALUES (?,?,?,?,?,?,?,?,1)',
                (t['type'], t['key'], 'ok', 'plex', t['file'], 'image/png', os.path.getsize(path), now))
con.commit()
con.close()
print(f'{len(want)} demo posters written to {out}')
