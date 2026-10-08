"""Verifies a reconstruction archive the way a stranger would use it: unzip, compare every file with the
manifest, then build the source it contains.

    python verify-archive.py <archive.zip> <short-work-dir> <archive-report.json> [--installer]

Use a SHORT work folder. Windows limits a path to 260 characters and the installer tool (NSIS) cannot open its
own templates below a deeply nested folder; the build then fails at the installer step although the source is fine.
"""
import hashlib, json, os, shutil, subprocess, sys, time, zipfile

archive, work, report_path = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2]), os.path.abspath(sys.argv[3])
installer = '--installer' in sys.argv
shutil.rmtree(work, ignore_errors=True)
os.makedirs(work)
with zipfile.ZipFile(archive) as z:
    z.extractall(os.path.join(work, 'x'))
    top = z.namelist()[0].split('/')[0]
base = os.path.join(work, 'x', top)
n = bad = 0
for l in open(os.path.join(base, 'MANIFEST.txt'), encoding='utf-8'):
    if l.startswith('#') or not l.strip():
        continue
    h, size, rel = l.rstrip('\n').split(None, 2)
    n += 1
    p = os.path.join(base, rel)
    if not os.path.exists(p) or hashlib.sha256(open(p, 'rb').read()).hexdigest() != h or os.path.getsize(p) != int(size):
        bad += 1
src = os.path.join(work, 's')
shutil.copytree(os.path.join(base, 'source'), src)
steps, ok = [], True
cmds = [('npm ci', 'npm ci --no-audit --no-fund'), ('npm test', 'npm test'), ('server package', 'node tools/pack-server.js')] + ([('installer', 'npm run build:win -- --publish never')] if installer else [])
for name, cmd in cmds:
    if not ok:
        steps.append({'step': name, 'command': cmd, 'exit': None, 'skipped': True})
        continue
    t0 = time.time()
    r = subprocess.run(cmd, cwd=src, shell=True, capture_output=True, text=True, errors='replace')
    open(os.path.join(work, name.replace(' ', '-') + '.log'), 'w', encoding='utf-8').write(r.stdout + r.stderr)
    s = {'step': name, 'command': cmd, 'exit': r.returncode, 'seconds': round(time.time() - t0)}
    if name == 'npm test':
        s['suites_passed'] = r.stdout.count('passed')
    steps.append(s)
    ok = r.returncode == 0
dist = os.path.join(src, 'dist')
made = sorted(f for f in os.listdir(dist) if f.endswith(('.exe', '.tar.gz', '.sha256', '.yml', '.blockmap'))) if os.path.isdir(dist) else []
report = json.load(open(report_path, encoding='utf-8')) if os.path.exists(report_path) else {}
report['build_from_archive'] = {'when': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'manifest_files': n, 'manifest_mismatches': bad, 'source_path_length': len(src), 'steps': steps, 'produced': made, 'pass': ok and bad == 0}
json.dump(report, open(report_path, 'w', encoding='utf-8'), indent=2)
print(json.dumps(report['build_from_archive'], indent=1))
sys.exit(0 if ok and bad == 0 else 1)
