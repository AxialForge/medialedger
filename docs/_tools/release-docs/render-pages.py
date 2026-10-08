"""Renders pages of a PDF side by side into one image, for checking a document by eye.
    python render-pages.py <file.pdf> <out.jpg> <page> [<page> ...]      (pages count from 1)"""
import sys, fitz
from PIL import Image
doc = fitz.open(sys.argv[1]); pages = [int(p) for p in sys.argv[3:]]
ims = []
for n in pages:
    pix = doc[n - 1].get_pixmap(dpi=70)
    ims.append(Image.frombytes('RGB', (pix.width, pix.height), pix.samples))
W = sum(i.width for i in ims) + 10 * (len(ims) - 1); H = max(i.height for i in ims)
S = Image.new('RGB', (W, H), (90, 90, 90)); x = 0
for i in ims: S.paste(i, (x, 0)); x += i.width + 10
S.save(sys.argv[2], quality=80); print(len(doc), 'pages in the document;', S.size)
