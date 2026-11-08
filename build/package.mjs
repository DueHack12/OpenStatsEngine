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
 * - win   → OpenStatsEngine-<v>-windows-x64.zip: OpenStatsEngine.exe, a small
 *           window that shows in the taskbar with our name and icon, and
 *           ose-server.exe, the server it runs. Needs mingw-w64 for the window
 *           (brew install mingw-w64, or apt install gcc-mingw-w64-x86-64).
 * - mac   → OpenStatsEngine-<v>-macos.zip, a universal (Apple silicon + Intel)
 *           .app that lives in the menu bar. Must be built on a Mac: the
 *           binary has to be re-signed after injection, and Apple silicon
 *           refuses to run an unsigned one; the menu bar part is Swift.
 * - linux → OpenStatsEngine-<v>-linux-x64.tar.gz
 *
 * The two launchers are in build/windows and build/mac. They run the server
 * with OSE_HOSTED set and show its output in their own window (see server.js).
 *
 * Build tools (esbuild, postject) are fetched with npx at build time; the app
 * itself still has no dependencies. Needs network access for those and for the
 * Node binaries, which are checked against nodejs.org's published SHA-256 sums.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const WORK = path.join(DIST, '.work');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const NODE = process.version; // the blob must come from the same Node as the binaries
const NAME = 'OpenStatsEngine';
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const ESBUILD = 'esbuild@0.28.2';
const POSTJECT = 'postject@1.0.0-alpha.6';
const RESEDIT = 'resedit@3.1.0';
const ICON = path.join(ROOT, 'build', 'icon');
const MINGW = 'x86_64-w64-mingw32';
const NUMERIC = VERSION.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);

const here = { win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform];
let targets = process.argv.slice(2);
if (!targets.length) targets = [here];
if (targets.includes('all')) targets = ['win', 'mac', 'linux'];
for (const t of targets) if (!['win', 'mac', 'linux'].includes(t)) die(`Unknown target "${t}"`);
if (targets.includes('mac') && process.platform !== 'darwin') {
  die('The macOS app has to be built on a Mac (it must be re-signed after injection).');
}
if (targets.includes('win') && !has(`${MINGW}-gcc`)) {
  die(`The Windows app needs mingw-w64 (${MINGW}-gcc) for its window.\n` +
      '  On a Mac: brew install mingw-w64. On Ubuntu: apt install gcc-mingw-w64-x86-64.');
}

function has(cmd) {
  try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
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

/**
 * Give the Windows binary our icon and name. Without this it is a copy of
 * node.exe: Node's icon in Explorer, and "Node.js" in its Properties and in
 * Task Manager. Done after injection: postject cannot parse the binary once
 * resedit has rewritten it, while resedit carries the injected blob through.
 * Checked afterwards, byte for byte, because a wrong guess there is a broken app.
 */
async function brandWindowsExe(exe, { description, filename }) {
  const tools = path.join(WORK, 'tools');
  fs.mkdirSync(tools, { recursive: true });
  run('npm', ['install', '--silent', '--no-save', '--no-package-lock', '--prefix', tools, RESEDIT]);
  // resedit is ESM-only; a module inside the install resolves it for us.
  const shim = path.join(tools, 'shim.mjs');
  fs.writeFileSync(shim, "export * as ResEdit from 'resedit';\nexport * as PE from 'pe-library';\n");
  const { ResEdit, PE } = await import(pathToFileURL(shim).href);

  const bin = PE.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  const res = PE.NtExecutableResource.from(bin);

  const icons = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(ICON, 'icon.ico'))).icons.map((i) => i.data);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const g = groups[0] || { id: 1, lang: 1033 };
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, icons);

  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (vi) {
    const strings = {
      ProductName: NAME, FileDescription: description, CompanyName: NAME,
      InternalName: NAME, OriginalFilename: filename,
      FileVersion: VERSION, ProductVersion: VERSION,
      LegalCopyright: 'MIT License'
    };
    // The numeric versions first: setting them also rewrites the version
    // strings, which should read 2.0.0-beta2 rather than 2.0.0.0.
    vi.setFileVersion(...NUMERIC, 0);
    vi.setProductVersion(...NUMERIC, 0);
    for (const lang of vi.getAllLanguagesForStringValues()) vi.setStringValues(lang, strings);
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(bin);
  const outBuf = Buffer.from(bin.generate());

  // The app is the blob: make sure it survived, and the fuse is still set.
  const after = PE.NtExecutableResource.from(PE.NtExecutable.from(outBuf, { ignoreCert: true }));
  const sea = after.entries.find((e) => e.type === 10 && e.id === 'NODE_SEA_BLOB');
  if (!sea || !Buffer.from(sea.bin).equals(fs.readFileSync(blob))) die('The Windows build lost its app while setting the icon.');
  if (!outBuf.includes(Buffer.from(`${SENTINEL}:1`))) die('The Windows build lost its single-executable fuse while setting the icon.');
  fs.writeFileSync(exe, outBuf);
  console.log(`  icon and version info set (${icons.length} icon sizes)`);
}

/** The window that runs the server on Windows: build/windows, compiled with mingw-w64. */
function windowsLauncher(exe) {
  const src = path.join(ROOT, 'build', 'windows');
  fs.writeFileSync(path.join(WORK, 'version.h'),
    `#define OSE_VERSION_NUM ${[...NUMERIC, 0].join(',')}\n#define OSE_VERSION_STR "${VERSION}"\n`);
  const res = path.join(WORK, 'launcher-res.o');
  run(`${MINGW}-windres`, ['-I', WORK, '-I', ICON, '-I', src, path.join(src, 'launcher.rc'), '-O', 'coff', '-o', res]);
  run(`${MINGW}-gcc`, ['-std=c11', '-O2', '-Wall', '-municode', '-mwindows', '-s', '-static-libgcc',
    path.join(src, 'launcher.c'), res, '-o', exe, '-lcomctl32', '-lshell32']);
}

/**
 * A .zip of `dir`, folder and all. Written here rather than with a zip tool so
 * it is the same on every build machine.
 */
function zipFolder(dir, zipPath) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xFFFFFFFF;
    for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = [];
  let offset = 0;
  const add = (name, data) => {
    const isDir = data === null;
    const raw = isDir ? Buffer.alloc(0) : data;
    const body = isDir ? raw : zlib.deflateRawSync(raw, { level: 9 });
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(isDir ? 0 : 8, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(isDir ? 0 : 8, 10); entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(raw.length, 24); entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(isDir ? 0x10 : 0, 38); entry.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, body);
    central.push(entry, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  };
  (function walk(d, prefix) {
    add(`${prefix}/`, null);
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, `${prefix}/${e.name}`);
      else add(`${prefix}/${e.name}`, fs.readFileSync(p));
    }
  })(dir, path.basename(dir));
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(zipPath, Buffer.concat([...parts, cd, end]));
}

const out = [];

/* ---------- Windows ---------- */
if (targets.includes('win')) {
  console.log('\nWindows');
  // One folder: the window people open, and the server it runs beside it.
  const dir = path.join(WORK, NAME);
  fs.mkdirSync(dir, { recursive: true });
  const server = path.join(dir, 'ose-server.exe');
  await nodeBinary('win', 'x64', server);
  inject(server);
  await brandWindowsExe(server, { description: `${NAME} server`, filename: 'ose-server.exe' });
  windowsLauncher(path.join(dir, `${NAME}.exe`));
  const zip = path.join(DIST, `${NAME}-${VERSION}-windows-x64.zip`);
  zipFolder(dir, zip);
  out.push(zip);
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
  const resources = path.join(app, 'Contents', 'Resources');
  fs.mkdirSync(resources, { recursive: true });

  // The app icon: every size macOS asks for, scaled from the 1024px master.
  const iconset = path.join(WORK, 'icon.iconset');
  fs.mkdirSync(iconset, { recursive: true });
  for (const n of [16, 32, 128, 256, 512]) {
    run('sips', ['-z', String(n), String(n), path.join(ICON, 'icon-1024.png'), '--out', path.join(iconset, `icon_${n}x${n}.png`)], { stdio: 'ignore' });
    run('sips', ['-z', String(n * 2), String(n * 2), path.join(ICON, 'icon-1024.png'), '--out', path.join(iconset, `icon_${n}x${n}@2x.png`)], { stdio: 'ignore' });
  }
  run('iconutil', ['-c', 'icns', iconset, '-o', path.join(resources, 'icon.icns')]);
  // Not "openstatsengine": macOS file names ignore case, so that would be the
  // same file as the OpenStatsEngine launcher below, which would overwrite it.
  const server = path.join(macos, 'ose-server');
  run('lipo', ['-create', ...slices, '-output', server]);

  // The app itself is the menu bar icon (build/mac): it runs the server and
  // shows its output in a window of its own, instead of in Terminal.
  const launcherSlices = [];
  for (const [arch, triple] of [['arm64', 'arm64-apple-macos11'], ['x64', 'x86_64-apple-macos11']]) {
    const bin = path.join(WORK, `launcher-${arch}`);
    run('xcrun', ['swiftc', '-O', '-swift-version', '5', '-parse-as-library', '-target', triple,
      path.join(ROOT, 'build', 'mac', 'OpenStatsEngine.swift'), '-o', bin]);
    launcherSlices.push(bin);
  }
  run('lipo', ['-create', ...launcherSlices, '-output', path.join(macos, NAME)]);
  for (const f of ['MenuBarIcon.png', 'MenuBarIcon@2x.png']) {
    fs.copyFileSync(path.join(ICON, f), path.join(resources, f));
  }

  // macOS wants bundle versions purely numeric, so "2.0.0-beta1" goes in as
  // 2.0.0 there and in full in the info string.
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${NAME}</string>
  <key>CFBundleDisplayName</key><string>${NAME}</string>
  <key>CFBundleIdentifier</key><string>io.github.duehack12.openstatsengine</string>
  <key>CFBundleVersion</key><string>${VERSION.split('-')[0]}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION.split('-')[0]}</string>
  <key>CFBundleGetInfoString</key><string>${NAME} ${VERSION}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>${NAME}</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <!-- A menu bar app: no Dock icon until its console window is open. -->
  <key>LSUIElement</key><true/>
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
// Every package carries a whole Node runtime, so anything small is broken.
for (const f of out) {
  if (fs.statSync(f).size < 20 * 1048576) die(`${path.basename(f)} is too small to contain the server — the build is broken.`);
}
console.log('\nBuilt:');
for (const f of out) console.log(`  ${path.relative(ROOT, f)}  (${(fs.statSync(f).size / 1048576).toFixed(1)} MB)`);
console.log('');
