"""Builds and verifies the reconstruction archive.

    python docs/_tools/release-docs/make-archive.py <tag> <release-package-dir> <clean-build-dir> <work-dir>

Layout of the archive:
    /source   the source at the tag, from `git archive` (never the working tree)
    /build    build scripts, installer configuration, the release workflow
    /deps     lock file, package.json, and a plain list of pinned versions
    /assets   icons and images, and the fictional sample data
    /bin      installers and server packages built from the tag
    /docs     the three documents, the inventory, the screenshots, and the tools that made them
    MANIFEST.txt, README_FIRST.txt, SECRET_SCAN.txt

Writes <release-package-dir>/archive-report.json with the secret scan and the verification result.
"""
import datetime, hashlib, io, json, os, re, shutil, subprocess, sys, tarfile, zipfile

tag, pkg_dir, clean_dir, work = sys.argv[1], os.path.abspath(sys.argv[2]), os.path.abspath(sys.argv[3]), os.path.abspath(sys.argv[4])
repo = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
tools = os.path.dirname(os.path.abspath(__file__))
version = tag.lstrip('v')
stamp = datetime.date.today().strftime('%Y%m%d')
name = f'MediaLedger_v{version}_{stamp}'
stage = os.path.join(work, name)
shutil.rmtree(work, ignore_errors=True)
os.makedirs(stage)

EXCLUDE_DIRS = {'node_modules', '__pycache__', '.git', 'venv', '.venv', 'env', 'out', 'dist', 'win-unpacked', '.npm', 'demo-data'}
EXCLUDE_FILES = re.compile(r'(^\.env($|\.)|\.pem$|\.pfx$|\.p12$|\.key$|^web\.json$|^portal\.json$|^security\.log$|\.log$|^id_rsa|\.kdbx$)', re.I)


def copy_tree(src, dst, keep=lambda rel: True):
    n = 0
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            if EXCLUDE_FILES.search(f):
                continue
            rel = os.path.relpath(os.path.join(root, f), src)
            if not keep(rel.replace('\\', '/')):
                continue
            to = os.path.join(dst, rel)
            os.makedirs(os.path.dirname(to), exist_ok=True)
            shutil.copy2(os.path.join(root, f), to)
            n += 1
    return n


def put(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)


# ---- /source: git archive at the tag
src_dir = os.path.join(stage, 'source')
os.makedirs(src_dir)
tar_bytes = subprocess.run(['git', '-C', repo, 'archive', '--format=tar', tag], check=True, capture_output=True).stdout
with tarfile.open(fileobj=io.BytesIO(tar_bytes)) as t:
    t.extractall(src_dir)
commit = subprocess.run(['git', '-C', repo, 'rev-parse', tag + '^{commit}'], check=True, capture_output=True, text=True).stdout.strip()
n_source = sum(len(f) for _, _, f in os.walk(src_dir))

# ---- /build
for rel in ['electron-builder.yml', '.github/workflows/release.yml', 'tools/pack-server.js', 'tools/make-icon.js', 'server/install.sh', 'package.json']:
    p = os.path.join(src_dir, rel)
    if os.path.exists(p):
        put(p, os.path.join(stage, 'build', rel.replace('.github/workflows/', 'ci/')))
put(os.path.join(tools, 'clean-build.sh'), os.path.join(stage, 'build', 'clean-build.sh'))

# ---- /deps
for rel in ['package.json', 'package-lock.json']:
    put(os.path.join(src_dir, rel), os.path.join(stage, 'deps', rel))
lock = json.load(open(os.path.join(src_dir, 'package-lock.json'), encoding='utf-8'))
pj = json.load(open(os.path.join(src_dir, 'package.json'), encoding='utf-8'))
direct = {**pj.get('dependencies', {}), **pj.get('devDependencies', {})}
lines = [f'MediaLedger {version}: pinned versions, from package-lock.json at {tag}', '', 'Direct dependencies', '-------------------']
for k in sorted(direct):
    lines.append(f'{k}  declared {direct[k]}  installed {lock["packages"].get("node_modules/" + k, {}).get("version", "?")}  ({"runtime" if k in pj.get("dependencies", {}) else "development"})')
lines += ['', 'Toolchain', '---------', 'Node.js 22 in the release workflow (actions/setup-node); the clean build for this archive used the version in clean-build-result.json', 'ffprobe: not pinned', '', f'Every package in the lock file ({len(lock["packages"]) - 1})', '-' * 40]
for k in sorted(lock['packages']):
    if k:
        lines.append(f'{k.replace("node_modules/", "")}  {lock["packages"][k].get("version", "?")}')
open(os.path.join(stage, 'deps', 'PINNED_VERSIONS.txt'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')

# ---- /assets: icons and images from the tag, the local installer icon if there is one, and the sample data
IMG = re.compile(r'\.(png|ico|svg|jpg|jpeg|webp|gif|woff2?|ttf|webmanifest)$', re.I)
copy_tree(os.path.join(src_dir, 'src'), os.path.join(stage, 'assets', 'application'), lambda rel: bool(IMG.search(rel)))
if os.path.isdir(os.path.join(repo, 'build')):
    copy_tree(os.path.join(repo, 'build'), os.path.join(stage, 'assets', 'installer-icon-not-in-repository'), lambda rel: bool(IMG.search(rel)))
demo = os.path.join(tools, 'demo-data')
if os.path.isdir(demo):
    for f in ['medialedger.db', 'settings.json', 'posters-wanted.json']:
        if os.path.exists(os.path.join(demo, f)):
            put(os.path.join(demo, f), os.path.join(stage, 'assets', 'sample-data', f))
    if os.path.isdir(os.path.join(demo, 'posters')):
        copy_tree(os.path.join(demo, 'posters'), os.path.join(stage, 'assets', 'sample-data', 'posters'))
    open(os.path.join(stage, 'assets', 'sample-data', 'README.txt'), 'w', encoding='utf-8').write(
        'Fictional sample data, generated by docs/tools/release-docs/make-demo-data.js with a fixed seed.\n'
        'Every title, person and address in it is invented. Accounts and invites are not included; the capture tool makes them.\n'
        'To use it: node source/src/server/server.js --data=<a copy of this folder> --set-password, then start the server on it.\n')

# ---- /bin: what the clean build produced
dist = os.path.join(clean_dir, 'src', 'dist')
n_bin = 0
for f in sorted(os.listdir(dist)) if os.path.isdir(dist) else []:
    if re.search(r'(-setup\.exe|\.blockmap|^latest\.yml|\.tar\.gz|\.sha256)$', f) and version in f or f in ('latest.yml', 'medialedger-server.tar.gz', 'medialedger-server.tar.gz.sha256'):
        put(os.path.join(dist, f), os.path.join(stage, 'bin', f))
        n_bin += 1
open(os.path.join(stage, 'bin', 'README.txt'), 'w', encoding='utf-8').write(
    f'Built from {tag} (commit {commit}) by build/clean-build.sh in an empty folder.\n'
    'The installer published on GitHub Releases was built by the release workflow from the same source; the two are not\n'
    'byte-identical because the installer embeds build times. Neither is code-signed.\n'
    f'Published files: https://github.com/AxialForge/medialedger/releases/tag/{tag}\n')

# ---- /docs
for f in ['USER_MANUAL.docx', 'USER_MANUAL.pdf', 'RELEASE_OVERVIEW.docx', 'RELEASE_OVERVIEW.pdf', 'DEVELOPER_GUIDE.md', 'DEVELOPER_GUIDE.pdf', 'ui_inventory.json', 'clean-build-result.json', 'QA_REPORT.md']:
    if os.path.exists(os.path.join(pkg_dir, f)):
        put(os.path.join(pkg_dir, f), os.path.join(stage, 'docs', f))
for d in ['screenshots', 'diagrams']:
    if os.path.isdir(os.path.join(pkg_dir, d)):
        copy_tree(os.path.join(pkg_dir, d), os.path.join(stage, 'docs', d))
copy_tree(tools, os.path.join(stage, 'docs', 'tools', 'release-docs'), lambda rel: not rel.startswith('package-lock'))

# ---- secret scan over everything staged
PATTERNS = [
    ('private key block', re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY')),
    ('GitHub token', re.compile(r'\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}')),
    ('AWS access key', re.compile(r'\bAKIA[0-9A-Z]{16}\b')),
    ('Slack token', re.compile(r'\bxox[baprs]-[A-Za-z0-9-]{10,}')),
    ('Plex token in an address', re.compile(r'X-Plex-Token=([A-Za-z0-9_-]{16,})')),
    ('Tailscale key', re.compile(r'\btskey-[a-z]+-[A-Za-z0-9-]{10,}')),
    ('bearer token', re.compile(r'[Bb]earer\s+[A-Za-z0-9._-]{30,}')),
    ('assigned secret', re.compile(r'''(?i)\b(pass(?:word|wd)?|secret|token|api[_-]?key|auth)\b["']?\s*[:=]\s*["']([^"'\s$<>{}]{8,})["']''')),
    ('address with credentials', re.compile(r'\b[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]{3,}@')),
    ('long hexadecimal secret', re.compile(r'''(?i)(?:secret|token|key)["']?\s*[:=]\s*["']([0-9a-f]{32,})["']''')),
]
BENIGN = re.compile(r'example|invalid|placeholder|your-|changeme|\*{3,}|•|<[^>]+>|\$\{|process\.env|not needed|testpass|Demo-Password|hunter2|correct horse|password123|tok\b|^tok$|secret\'|wrong|x{6,}', re.I)
TEXT = re.compile(r'\.(js|json|md|txt|yml|yaml|sh|py|ps1|html|css|mmd|csv|webmanifest|gitignore)$|^[^.]+$', re.I)
findings, scanned = [], 0
for root, _, files in os.walk(stage):
    for f in files:
        p = os.path.join(root, f)
        rel = os.path.relpath(p, stage).replace('\\', '/')
        if EXCLUDE_FILES.search(f):
            findings.append({'file': rel, 'kind': 'excluded file type present', 'line': 0, 'verdict': 'REVIEW', 'text': ''})
        if not TEXT.search(f) or os.path.getsize(p) > 4_000_000:
            continue
        scanned += 1
        try:
            text = open(p, encoding='utf-8', errors='ignore').read()
        except OSError:
            continue
        for i, line in enumerate(text.split('\n'), 1):
            if len(line) > 2000:
                continue
            for kind, rx in PATTERNS:
                m = rx.search(line)
                if not m:
                    continue
                value = m.group(m.lastindex) if m.lastindex else m.group(0)
                test_file = '/test/' in '/' + rel or rel.startswith('docs/tools/')
                benign = bool(BENIGN.search(line)) or test_file or len(set(value)) < 5
                findings.append({'file': rel, 'kind': kind, 'line': i, 'verdict': 'benign' if benign else 'REVIEW', 'why': 'test or tool fixture' if test_file else ('placeholder or example' if benign else ''), 'text': line.strip()[:160]})
review = [f for f in findings if f['verdict'] == 'REVIEW']
with open(os.path.join(stage, 'SECRET_SCAN.txt'), 'w', encoding='utf-8') as o:
    o.write(f'Secret scan of {name}\n{scanned} text files scanned with {len(PATTERNS)} patterns: ' + ', '.join(k for k, _ in PATTERNS) + '.\n')
    o.write(f'{len(findings)} matches, of which {len(review)} need review and {len(findings) - len(review)} are fixtures, placeholders or examples.\n\n')
    for f in sorted(findings, key=lambda x: (x['verdict'] != 'REVIEW', x['file'], x['line'])):
        o.write(f"[{f['verdict']}] {f['file']}:{f['line']}  {f['kind']}  {f.get('why', '')}\n    {f['text']}\n")

# ---- README_FIRST and MANIFEST
open(os.path.join(stage, 'README_FIRST.txt'), 'w', encoding='utf-8').write(f'''MediaLedger {version}: reconstruction archive
Made {datetime.date.today().isoformat()} from tag {tag}, commit {commit}.

WHAT THIS IS
Everything needed to understand, rebuild and continue MediaLedger {version} without access to the original
repository or its author: the source exactly as released, the build configuration, the pinned dependencies,
the built installers, and the documentation.

REBUILD IN FIVE LINES (Windows, Node 22 or newer, internet access)
  cd source
  npm ci
  npm test
  node tools/pack-server.js
  npm run build:win -- --publish never

The installer and the server package appear in source/dist.

UNZIP INTO A SHORT FOLDER, for example C:\ml. Windows limits a path to 260 characters and the installer
step fails below a deeply nested folder. Tests and the server package are not affected. A clean build from this archive was verified:
see docs/clean-build-result.json and archive-report.json beside this archive.

WHAT IS WHERE
  source/   the source at {tag}, from git archive
  build/    build scripts, installer configuration, the release workflow, the clean build script
  deps/     package.json, package-lock.json, PINNED_VERSIONS.txt
  assets/   icons and images, and fictional sample data
  bin/      installer and server package built from this source (not code-signed)
  docs/     USER_MANUAL, RELEASE_OVERVIEW, DEVELOPER_GUIDE, ui_inventory.json, screenshots, diagrams,
            and docs/tools: the scripts that produced them
  MANIFEST.txt      every file with its SHA-256 and size
  SECRET_SCAN.txt   what the secret scan looked for and found

START WITH docs/DEVELOPER_GUIDE.pdf.

NOT INCLUDED, ON PURPOSE
  node_modules, build caches, the .git folder, environment files, certificates and keys, accounts,
  logs, and any real library or personal data. The sample data is generated and fictional.
''')
manifest = []
for root, _, files in os.walk(stage):
    for f in files:
        if f == 'MANIFEST.txt':
            continue
        p = os.path.join(root, f)
        h = hashlib.sha256()
        with open(p, 'rb') as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b''):
                h.update(chunk)
        manifest.append((os.path.relpath(p, stage).replace('\\', '/'), h.hexdigest(), os.path.getsize(p)))
manifest.sort()
with open(os.path.join(stage, 'MANIFEST.txt'), 'w', encoding='utf-8') as o:
    o.write(f'# {name}: {len(manifest)} files, {sum(m[2] for m in manifest):,} bytes\n# SHA-256  size in bytes  path\n')
    for rel, h, size in manifest:
        o.write(f'{h}  {size:>12}  {rel}\n')

# ---- zip
zip_path = os.path.join(pkg_dir, name + '.zip')
if os.path.exists(zip_path):
    os.remove(zip_path)
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for root, _, files in os.walk(stage):
        for f in files:
            p = os.path.join(root, f)
            z.write(p, name + '/' + os.path.relpath(p, stage).replace('\\', '/'))

# ---- verify: unzip elsewhere, compare every hash with the manifest
check = os.path.join(work, 'verify')
with zipfile.ZipFile(zip_path) as z:
    z.extractall(check)
base = os.path.join(check, name)
bad, seen = [], 0
for line in open(os.path.join(base, 'MANIFEST.txt'), encoding='utf-8'):
    if line.startswith('#') or not line.strip():
        continue
    h, size, rel = line.rstrip('\n').split(None, 2)
    p = os.path.join(base, rel)
    seen += 1
    if not os.path.exists(p):
        bad.append(rel + ': missing')
        continue
    hh = hashlib.sha256(open(p, 'rb').read()).hexdigest()
    if hh != h or os.path.getsize(p) != int(size):
        bad.append(rel + ': differs')
extra = []
listed = {l.rstrip('\n').split(None, 2)[2] for l in open(os.path.join(base, 'MANIFEST.txt'), encoding='utf-8') if l.strip() and not l.startswith('#')}
for root, _, files in os.walk(base):
    for f in files:
        rel = os.path.relpath(os.path.join(root, f), base).replace('\\', '/')
        if rel != 'MANIFEST.txt' and rel not in listed:
            extra.append(rel)
forbidden = [r for r in listed if re.search(r'(^|/)(node_modules|__pycache__|\.git|venv|\.venv)(/|$)|(^|/)\.env($|\.)|\.pem$|\.key$|(^|/)web\.json$|(^|/)portal\.json$', r)]

report = {'archive': os.path.basename(zip_path), 'bytes': os.path.getsize(zip_path), 'tag': tag, 'commit': commit, 'files': len(manifest),
          'sections': {'source': n_source, 'bin': n_bin}, 'manifest_checked': seen, 'manifest_mismatches': bad, 'files_not_in_manifest': extra, 'forbidden_paths': forbidden,
          'hashes_match': not bad and not extra, 'secret_scan': {'files_scanned': scanned, 'matches': len(findings), 'need_review': len(review), 'review': review[:40]},
          'extracted_to': base}
json.dump(report, open(os.path.join(pkg_dir, 'archive-report.json'), 'w', encoding='utf-8'), indent=2)
print(json.dumps({k: v for k, v in report.items() if k not in ('secret_scan',)}, indent=1))
print('secret scan:', scanned, 'files,', len(findings), 'matches,', len(review), 'need review')
for f in review[:25]:
    print('  REVIEW', f['file'] + ':' + str(f['line']), f['kind'], '|', f['text'][:110])
