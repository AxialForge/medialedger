"""Merges partial capture runs (--only=...) into the main output folder.
    python merge-boxes.py <main-out> <partial-out> [<partial-out> ...]"""
import json, shutil, glob, os, sys
main_dir = sys.argv[1]
main = json.load(open(os.path.join(main_dir, 'boxes.json'), encoding='utf-8'))
for d in sys.argv[2:]:
    main.update(json.load(open(os.path.join(d, 'boxes.json'), encoding='utf-8')))
    for f in glob.glob(os.path.join(d, '*_clean.png')):
        shutil.copyfile(f, os.path.join(main_dir, os.path.basename(f)))
json.dump(main, open(os.path.join(main_dir, 'boxes.json'), 'w', encoding='utf-8'), indent=1)
miss = [(k, c['name']) for k, v in main.items() for c in v['controls'] if c.get('missing')]
print(len(main), 'screens,', sum(len(v['controls']) for v in main.values()), 'controls; missing:', miss)
