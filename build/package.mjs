#!/usr/bin/env node
/**
 * Package OpenStatsEngine as standalone apps: nothing to install, not even Node.
 *
 *   node build/package.mjs                 # this machine's platform only
 *   node build/package.mjs win mac linux   # any of: win, mac, linux, all
 *
 * Uses Node's own single-executable support: the server is bundled into one
 * script, the web UI is attached as assets, and both are injected into a copy
 * of the official Node binary for each platform. Output lands in dist/.
 *
 * - win   → OpenStatsEngine-<v>-windows-x64.exe
 * - mac   → OpenStatsEngine-<v>-macos.zip, a universal (Apple silicon + Intel)
 *           .app. Must be built on a Mac: the binary has to be re-signed after
 *           injection, and Apple silicon refuses to run an unsigned one.
 * - linux → OpenStatsEngine-<v>-linux-x64.tar.gz
 *
 * Build tools (esbuild, postject) are fetched with npx at build time; the app
 * itself still has no dependencies. Needs network access for those and for the
 * Node binaries, which are checked against nodejs.org's published SHA-256 sums.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const WORK = path.join(DIST, '.work');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const NODE = process.version; // the blob must come from the same Node as the binaries
const NAME = 'OpenStatsEngine';
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const ESBUILD = 'esbuild@0.28.2';
const POSTJECT = 'postject@1.0.0-alpha.6';

const here = { win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform];
let targets = process.argv.slice(2);
if (!targets.length) targets = [here];
if (targets.includes('all')) targets = ['win', 'mac', 'linux'];
for (const t of targets) if (!['win', 'mac', 'linux'].includes(t)) die(`Unknown target "${t}"`);
if (targets.includes('mac') && process.platform !== 'darwin') {
  die('The macOS app has to be built on a Mac (it must be re-signed after injection).');
}

function die(msg) { console.error(`\n  ${msg}\n`); process.exit(1); }
function run(cmd, args, opts = {}) {
  console.log(`  $ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32', ...opts });
}
const npx = (pkg, args) => run('npx', ['--yes', pkg, ...args]);

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

/* ---------- 1. one script ---------- */
console.log(`\nBundling OpenStatsEngine ${VERSION} (Node ${NODE})`);
const bundle = path.join(WORK, 'ose.cjs');
npx(ESBUILD, [
  'server.js', '--bundle', '--platform=node', '--format=cjs', `--target=node${NODE.slice(1).split('.')[0]}`,
  `--outfile=${bundle}`, '--log-level=warning',
  `--define:__OSE_VERSION__="${VERSION}"`,
  // import.meta.url does not exist in CommonJS; point it at the executable.
  '--define:import.meta.url=__ose_url',
  '--banner:js=const __ose_url = require("node:url").pathToFileURL(__filename).href;'
]);

/* ---------- 2. the blob: script + web UI ---------- */
const assets = {};
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else assets[path.relative(ROOT, p).split(path.sep).join('/')] = p;
  }
})(path.join(ROOT, 'public'));
const blob = path.join(WORK, 'sea.blob');
const seaConfig = path.join(WORK, 'sea-config.json');
fs.writeFileSync(seaConfig, JSON.stringify({
  main: bundle, output: blob, assets,
  disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false
}, null, 2));
run(process.execPath, ['--experimental-sea-config', seaConfig]);
console.log(`  ${Object.keys(assets).length} web files attached`);

/* ---------- 3. Node binaries ---------- */
let sums = null;
async function sha256s() {
  if (sums) return sums;
  const r = await fetch(`https://nodejs.org/dist/${NODE}/SHASUMS256.txt`);
  if (!r.ok) die(`Could not fetch Node checksums: HTTP ${r.status}`);
  sums = Object.fromEntries((await r.text()).trim().split('\n').map((l) => l.split(/\s+/).reverse()));
  return sums;
}

async function download(file) {
  const dest = path.join(WORK, file.replace(/\//g, '_'));
  console.log(`  downloading ${file}`);
  const r = await fetch(`https://nodejs.org/dist/${NODE}/${file}`);
  if (!r.ok) die(`Could not download ${file}: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const want = (await sha256s())[file];
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (want !== got) die(`Checksum mismatch for ${file}`);
  fs.writeFileSync(dest, buf);
  return dest;
}

/** A fresh copy of the official Node binary for a platform, at `dest`. */
async function nodeBinary(platform, arch, dest) {
  if (platform === 'win') {
    fs.copyFileSync(await download('win-x64/node.exe'), dest);
  } else {
    const ext = platform === 'linux' ? 'tar.xz' : 'tar.gz';
    const base = `node-${NODE}-${platform === 'mac' ? 'darwin' : 'linux'}-${arch}`;
    const tar = await download(`${base}.${ext}`);
    run('tar', ['-xf', tar, '-C', WORK, `${base}/bin/node`]);
    fs.copyFileSync(path.join(WORK, base, 'bin', 'node'), dest);
  }
  fs.chmodSync(dest, 0o755);
  return dest;
}

function inject(bin, macho = false) {
  npx(POSTJECT, [bin, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', SENTINEL,
    ...(macho ? ['--macho-segment-name', 'NODE_SEA'] : [])]);
}

const out = [];

/* ---------- Windows ---------- */
if (targets.includes('win')) {
  console.log('\nWindows');
  const exe = path.join(DIST, `${NAME}-${VERSION}-windows-x64.exe`);
  await nodeBinary('win', 'x64', exe);
  inject(exe);
  out.push(exe);
}

/* ---------- Linux ---------- */
if (targets.includes('linux')) {
  console.log('\nLinux');
  const dir = path.join(WORK, `${NAME}-${VERSION}-linux-x64`);
  fs.mkdirSync(dir, { recursive: true });
  const bin = await nodeBinary('linux', 'x64', path.join(dir, 'openstatsengine'));
  inject(bin);
  const tgz = path.join(DIST, `${NAME}-${VERSION}-linux-x64.tar.gz`);
  run('tar', ['-czf', tgz, '-C', WORK, path.basename(dir)]);
  out.push(tgz);
}

/* ---------- macOS ---------- */
if (targets.includes('mac')) {
  console.log('\nmacOS');
  const slices = [];
  for (const arch of ['arm64', 'x64']) {
    const bin = await nodeBinary('mac', arch, path.join(WORK, `node-mac-${arch}`));
    run('codesign', ['--remove-signature', bin]);
    inject(bin, true);
    slices.push(bin);
  }

  const app = path.join(WORK, `${NAME}.app`);
  const macos = path.join(app, 'Contents', 'MacOS');
  fs.mkdirSync(macos, { recursive: true });
  fs.mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true });
  const server = path.join(macos, 'openstatsengine');
  run('lipo', ['-create', ...slices, '-output', server]);

  // The server is a console program: it prints its addresses and stops with
  // Ctrl+C. So the app's job is to open it in a Terminal window.
  const launcher = path.join(macos, NAME);
  fs.writeFileSync(launcher, [
    '#!/bin/bash',
    '# Opens the OpenStatsEngine server in a Terminal window.',
    'HERE="$(cd "$(dirname "$0")" && pwd)"',
    'open -a Terminal "$HERE/openstatsengine"',
    ''
  ].join('\n'));
  fs.chmodSync(launcher, 0o755);

  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${NAME}</string>
  <key>CFBundleDisplayName</key><string>${NAME}</string>
  <key>CFBundleIdentifier</key><string>io.github.duehack12.openstatsengine</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>${NAME}</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`);

  // Ad-hoc signatures: enough for Apple silicon to run it. Not notarised, so
  // the first launch needs right-click → Open (see docs/MANUAL.md).
  run('codesign', ['--force', '--sign', '-', server]);
  run('codesign', ['--force', '--sign', '-', app]);
  const zip = path.join(DIST, `${NAME}-${VERSION}-macos.zip`);
  run('ditto', ['-c', '-k', '--keepParent', app, zip]);
  out.push(zip);
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log('\nBuilt:');
for (const f of out) console.log(`  ${path.relative(ROOT, f)}  (${(fs.statSync(f).size / 1048576).toFixed(1)} MB)`);
console.log('');
