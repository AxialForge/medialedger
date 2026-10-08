"""Draws the numbered callouts on the clean screenshots.

    python docs/_tools/release-docs/annotate.py <capture-out-dir> <screenshots-dir>

Reads boxes.json (written by capture.js) and, for every screen, writes
    <id>_clean.png       the untouched capture
    <id>_annotated.png   the same image with a thin outline round each control, a numbered circle beside it,
                         and a leader line from the circle to the control
One colour for every callout, so the numbers read the same on every page.
"""
import json, os, shutil, sys
from PIL import Image, ImageDraw, ImageFont

src, dst = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
os.makedirs(dst, exist_ok=True)
boxes = json.load(open(os.path.join(src, 'boxes.json'), encoding='utf-8'))

FILL = (255, 196, 0, 255)       # amber circle
INK = (20, 20, 20, 255)         # number
LINE = (255, 196, 0, 255)       # leader line and outline
HALO = (0, 0, 0, 200)


def font(size):
    for name in ('segoeuib.ttf', 'arialbd.ttf', 'DejaVuSans-Bold.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def place(b, W, H, r, taken):
    """A spot for the circle: outside the control if there is room, never on top of another circle."""
    x, y, w, h = b['x'], b['y'], b['w'], b['h']
    gap = r + 8
    spots = [(x - gap, y + min(h / 2, r)), (x + w + gap, y + min(h / 2, r)), (x + min(w / 2, r * 2), y - gap), (x + min(w / 2, r * 2), y + h + gap),
             (x - gap, y - gap), (x + w + gap, y - gap), (x - gap, y + h + gap), (x + w + gap, y + h + gap)]
    for step in range(0, 6):
        for sx, sy in spots:
            cx = min(max(sx, r + 3), W - r - 3)
            cy = min(max(sy + step * (2 * r + 4), r + 3), H - r - 3)
            inside = x - 2 < cx < x + w + 2 and y - 2 < cy < y + h + 2 and (w < 4 * r or h < 3 * r) is False and False
            if inside:
                continue
            if all((cx - tx) ** 2 + (cy - ty) ** 2 > (2 * r + 3) ** 2 for tx, ty in taken):
                return cx, cy
    return min(max(x, r + 3), W - r - 3), min(max(y, r + 3), H - r - 3)


def nearest(b, cx, cy):
    """The point on the outline of the control closest to the circle."""
    x, y, w, h = b['x'], b['y'], b['w'], b['h']
    return min(max(cx, x), x + w), min(max(cy, y), y + h)


count = 0
for sid, s in sorted(boxes.items()):
    clean = os.path.join(src, f'{sid}_clean.png')
    if not os.path.exists(clean):
        continue
    shutil.copyfile(clean, os.path.join(dst, f'{sid}_clean.png'))
    img = Image.open(clean).convert('RGBA')
    W, H = img.size
    over = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    r = 13 if W >= 900 else 12
    f = font(15 if W >= 900 else 14)
    taken = []
    marks = []
    for c in s['controls']:
        if c.get('missing'):
            continue
        b = {'x': max(0, c['x']), 'y': max(0, c['y']), 'w': min(c['w'], W - max(0, c['x'])), 'h': min(c['h'], H - max(0, c['y']))}
        cx, cy = place(b, W, H, r, taken)
        taken.append((cx, cy))
        marks.append((c['n'], b, cx, cy))
    for n, b, cx, cy in marks:
        d.rectangle((b['x'] - 2, b['y'] - 2, b['x'] + b['w'] + 1, b['y'] + b['h'] + 1), outline=LINE, width=2)
    for n, b, cx, cy in marks:
        px, py = nearest(b, cx, cy)
        d.line((cx, cy, px, py), fill=HALO, width=4)
        d.line((cx, cy, px, py), fill=LINE, width=2)
    for n, b, cx, cy in marks:
        d.ellipse((cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2), fill=HALO)
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=FILL)
        t = str(n)
        tw = d.textlength(t, font=f)
        d.text((cx - tw / 2, cy - (f.size * 0.62)), t, font=f, fill=INK)
    Image.alpha_composite(img, over).convert('RGB').save(os.path.join(dst, f'{sid}_annotated.png'), optimize=True)
    count += 1
print(f'{count} screens annotated into {dst}')
