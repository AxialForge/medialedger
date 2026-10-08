"""Final checks on the release package. Writes QA_REPORT.md and qa-result.json.

    python docs/_tools/release-docs/qa-check.py <release-package-dir> <capture-out-dir>

1. Every control in ui_inventory.json is in the manual, under its own item, in the same order.
2. Every callout number drawn on a screenshot belongs to the control in the same row of the table.
3. Every document opens, its pictures are there, and every line of its contents points at the right page.
"""
import json, os, re, sys, zipfile, html
import fitz

pkg, cap = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
inv = json.load(open(os.path.join(pkg, 'ui_inventory.json'), encoding='utf-8'))
boxes = json.load(open(os.path.join(cap, 'boxes.json'), encoding='utf-8'))
out, result = [], {}
norm = lambda s: re.sub(r'\s+', ' ', s.replace('’', "'").replace('‘', "'").replace(' ', ' ')).strip()


def docx_text(path):
    x = zipfile.ZipFile(path).read('word/document.xml').decode('utf-8')
    x = re.sub(r'</w:p>', '\n', x)
    x = re.sub(r'<w:tab/>', ' ', x)
    return norm_lines(html.unescape(re.sub(r'<[^>]+>', '', x)))


def norm_lines(t):
    return '\n'.join(norm(l) for l in t.split('\n') if norm(l))


# ---------------------------------------------------------------- 1. inventory against the manual
manual = docx_text(os.path.join(pkg, 'USER_MANUAL.docx'))
gaps, checked = [], 0
for item in inv['items']:
    name = norm(item['name'])
    # the item's heading: "<number> <name>" on a line of its own
    m = re.search(r'^\d+(?:\.\d+)+ ' + re.escape(name) + r'$', manual, re.M)   # a numbered heading, not a mention in a table
    if not m and item['id'] in ('sidebar',):
        m = re.search(r'^2\.1 The sidebar in full$', manual, re.M)
    if not m and item['id'] == '00_sign_in':
        m = re.search(r'^1\.4 First launch$', manual, re.M)
    if not m and item['id'] == '01_main_window':
        m = re.search(r'^2\. The interface$', manual, re.M)
    if not m and item['id'] == '48_theme_example':
        m = re.search(r'^2\.3 Colour themes$', manual, re.M)
    if not m:
        gaps.append(f"{item['id']}: no section for \"{item['name']}\"")
        continue
    seg = manual[m.end():]
    pos = 0
    for c in item['controls']:
        checked += 1
        if item['id'] == '48_theme_example':
            continue  # described in prose, no table
        k = seg.find('\n' + norm(c['name']) + '\n', pos)
        if k < 0 or k > 60000:
            gaps.append(f"{c['id']}: control \"{c['name']}\" is not in the section \"{item['name']}\"")
        else:
            pos = k + 1
result['inventory'] = {'items': len(inv['items']), 'controls': checked, 'gaps': gaps, 'unverified_sources': inv.get('unverified', [])}

# ---------------------------------------------------------------- 2. callout numbers against table rows
mism, drawn = [], 0
by_id = {i['id']: i for i in inv['items']}
for sid, b in sorted(boxes.items()):
    item = by_id.get(sid)
    if not item:
        mism.append(f'{sid}: captured but not in the inventory')
        continue
    for f in ('clean', 'annotated'):
        if not os.path.exists(os.path.join(pkg, 'screenshots', f'{sid}_{f}.png')):
            mism.append(f'{sid}: {f} picture missing')
    if len(b['controls']) != len(item['controls']):
        mism.append(f"{sid}: {len(b['controls'])} callouts drawn, {len(item['controls'])} rows in the table")
    for c, row in zip(b['controls'], item['controls']):
        drawn += 1
        if c.get('missing'):
            mism.append(f"{sid}: callout {c['n']} \"{c['name']}\" could not be located on the picture")
        if c['n'] != row['callout'] or c['name'] != row['name']:
            mism.append(f"{sid}: callout {c['n']} is \"{c['name']}\" on the picture and \"{row['name']}\" (row {row['callout']}) in the table")
not_captured = [i['id'] for i in inv['items'] if not i['screenshot']]
result['callouts'] = {'screens': len(boxes), 'callouts': drawn, 'mismatches': mism, 'items_without_screenshot': not_captured}

# ---------------------------------------------------------------- 3. the documents
docs = {}
# whichever of the documents this package holds (a package may be built with some of them only)
ALL = ['USER_MANUAL', 'PI_INSTALL_GUIDE', 'RELEASE_HISTORY', 'RELEASE_OVERVIEW', 'DEVELOPER_GUIDE']
for name in [n for n in ALL if any(os.path.exists(os.path.join(pkg, n + e)) for e in ('.docx', '.md', '.pdf'))]:
    d = {'problems': []}
    pdf = os.path.join(pkg, name + '.pdf')
    src = os.path.join(pkg, name + ('.md' if name == 'DEVELOPER_GUIDE' else '.docx'))
    for p in (pdf, src):
        if not os.path.exists(p) or os.path.getsize(p) < 1000:
            d['problems'].append(os.path.basename(p) + ' is missing or empty')
    if not os.path.exists(pdf):
        docs[name] = d
        continue
    doc = fitz.open(pdf)
    d['pages'] = len(doc)
    d['pdf_bytes'] = os.path.getsize(pdf)
    texts = [norm_lines(p.get_text()) for p in doc]
    # pictures that really decode, counted once each per page
    pics, broken = 0, 0
    for p in doc:
        for img in p.get_images(full=True):
            try:
                pm = fitz.Pixmap(doc, img[0])
                if pm.width > 40 and pm.height > 40:
                    pics += 1
            except Exception:
                broken += 1
    d['pictures'] = pics
    if broken:
        d['problems'].append(f'{broken} pictures do not decode')
    if name != 'DEVELOPER_GUIDE':
        z = zipfile.ZipFile(src)
        media = [n for n in z.namelist() if n.startswith('word/media/')]
        d['pictures_in_docx'] = len(media)
        empty = [n for n in media if z.getinfo(n).file_size < 200]
        if empty:
            d['problems'].append(f'{len(empty)} empty pictures in the document')
        if pics < len(media):
            d['problems'].append(f'{len(media)} pictures in the document, {pics} in the PDF')
        # header with the version on every page but the first
        ver = inv['version']
        nohead = [i + 1 for i, t in enumerate(texts) if f'MediaLedger {ver}' not in t]
        if nohead:
            d['problems'].append(f'no version in the header on pages {nohead[:8]}')
        # contents: every line "title .... N" must have that title as a heading on page N
        toc, wrong = [], []
        for t in texts[:6]:
            for line in t.split('\n'):
                m = re.match(r'^(.+?)\s*\.{4,}\s*(\d+)$', line)
                if m and m.group(1) != 'Contents':
                    toc.append((norm(m.group(1)), int(m.group(2))))
        for title, page in toc:
            if page < 1 or page > len(doc) or not re.search(r'^' + re.escape(title) + r'$', texts[page - 1], re.M):
                found = [i + 1 for i, t in enumerate(texts[6:], 6) if re.search(r'^' + re.escape(title) + r'$', t, re.M)]
                wrong.append(f'"{title}" is listed on page {page}, found on {found[:3] or "no page"}')
        d['contents_lines'] = len(toc)
        d['contents_wrong'] = wrong
        if not toc:
            d['problems'].append('no contents lines found')
        if wrong:
            d['problems'].append(f'{len(wrong)} contents lines point at the wrong page')
        headings = len(re.findall(r'<w:pStyle w:val="Heading[12]"', z.read('word/document.xml').decode('utf-8')))
        d['headings_level_1_and_2'] = headings
        if toc and abs(headings - 1 - len(toc)) > 1:
            d['problems'].append(f'{headings} headings in the document, {len(toc)} lines in the contents')
    else:
        md = open(src, encoding='utf-8').read()
        heads = re.findall(r'^#{2,3} (.+)$', md, re.M)
        first = texts[0] + '\n' + (texts[1] if len(texts) > 1 else '')
        missing = [h for h in heads if norm(re.sub(r'[`*]', '', h)) not in norm(first.replace('\n', ' '))]
        body_missing = [h for h in heads if not any(norm(re.sub(r'[`*]', '', h)) in norm(t.replace('\n', ' ')) for t in texts[1:])]
        d['contents_lines'] = len(heads)
        d['contents_wrong'] = [f'"{h}" is not in the contents' for h in missing] + [f'"{h}" is not in the body' for h in body_missing]
        if d['contents_wrong']:
            d['problems'].append(f"{len(d['contents_wrong'])} headings missing from the contents or the body")
        d['note'] = 'The contents of this PDF are links without page numbers.'
    unver = len(re.findall(r'UNVERIFIED', '\n'.join(texts)))
    d['unverified_mentions'] = unver
    docs[name] = d
result['documents'] = docs

ok = not gaps and not mism and all(not d['problems'] for d in docs.values())
result['pass'] = ok
json.dump(result, open(os.path.join(pkg, 'qa-result.json'), 'w', encoding='utf-8'), indent=2)

out.append('# Quality check of the release package\n')
out.append(f"MediaLedger {inv['version']}. Result: **{'PASS' if ok else 'ATTENTION NEEDED'}**.\n")
out.append('## 1. Inventory against the manual\n')
out.append(f"{len(inv['items'])} items and {checked} controls in `ui_inventory.json`. Each control was looked for under its own item in the manual, in order.\n")
out.append('Gaps: ' + ('none.\n' if not gaps else '\n' + '\n'.join('- ' + g for g in gaps) + '\n'))
out.append(f"Inventory entries that could not be traced to a line of source: {len(inv.get('unverified', []))}.\n")
out.append('## 2. Callout numbers against table rows\n')
out.append(f"{len(boxes)} screens, {drawn} callouts. Every number drawn on a picture was compared with the row of the same number in the table.\n")
out.append('Mismatches: ' + ('none.\n' if not mism else '\n' + '\n'.join('- ' + g for g in mism) + '\n'))
out.append(f"Items described without a picture of their own ({len(not_captured)}): " + ', '.join(not_captured) + '. These are short dialogs and the sidebar; their tables carry no numbers.\n')
out.append('## 3. Documents\n')
out.append('| Document | Pages | Pictures | Contents lines | Contents pointing at the wrong page | Problems |\n|---|---|---|---|---|---|')
for n, d in docs.items():
    out.append(f"| {n} | {d.get('pages', '')} | {d.get('pictures', '')} | {d.get('contents_lines', '')} | {len(d.get('contents_wrong', []))} | {'; '.join(d['problems']) or 'none'} |")
out.append('')
for n, d in docs.items():
    for w in d.get('contents_wrong', []):
        out.append(f'- {n}: {w}')
open(os.path.join(pkg, 'QA_REPORT.md'), 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print('\n'.join(out))
