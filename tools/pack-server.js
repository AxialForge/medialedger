#!/usr/bin/env node
'use strict';
// Build the server-only package: dist/medialedger-server-<version>.tar.gz plus a
// versionless copy and a .sha256 file. Contains exactly what the Pi needs (core,
// renderer, server, installer, docs) and nothing from the desktop build:
// no Electron, no node_modules, no installer sources.
//
//   node tools/pack-server.js
//
// CI runs this on every tag and attaches the three files to the GitHub Release;
// server/install.sh downloads and verifies them.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-pack-'));
const top = path.join(stage, 'medialedger-server');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

const copy = (rel, dest = rel) => fs.cpSync(path.join(root, rel), path.join(top, dest), { recursive: true, filter: (src) => !/[\\/](\.git|node_modules)([\\/]|$)/.test(src) });
copy('src/main'); copy('src/renderer'); copy('src/server'); copy('server'); copy('LICENSE'); copy('CHANGELOG.md');
copy('docs/RASPBERRY-PI.md', 'README.md');
// A minimal package.json: the server has no runtime dependencies at all.
fs.writeFileSync(path.join(top, 'package.json'), JSON.stringify({ name: 'medialedger-server', version: pkg.version, description: 'MediaLedger web server (Raspberry Pi / Linux)', license: pkg.license, private: true, engines: { node: '>=22' }, scripts: { start: 'node src/server/server.js' } }, null, 2) + '\n');
// The desktop-only updater and ffmpeg downloader are not needed but harmless; drop the updater to keep the package honest.
for (const f of ['src/main/updater.js', 'src/main/main.js']) { try { fs.rmSync(path.join(top, f)); } catch { /* fine */ } }

const named = path.join(dist, `medialedger-server-${pkg.version}.tar.gz`);
// Run tar inside the staging folder with a relative output name: GNU tar on Windows reads "C:" as a remote host otherwise.
execFileSync('tar', ['-czf', 'pkg.tar.gz', 'medialedger-server'], { cwd: stage });
fs.copyFileSync(path.join(stage, 'pkg.tar.gz'), named);
fs.copyFileSync(named, path.join(dist, 'medialedger-server.tar.gz'));
const sha = crypto.createHash('sha256').update(fs.readFileSync(named)).digest('hex');
fs.writeFileSync(path.join(dist, 'medialedger-server.tar.gz.sha256'), `${sha}  medialedger-server.tar.gz\n`);
fs.rmSync(stage, { recursive: true, force: true });
console.log(`${path.relative(root, named)}  ${(fs.statSync(named).size / 1024).toFixed(0)} kB  sha256 ${sha.slice(0, 12)}…`);
