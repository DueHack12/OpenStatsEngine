/**
 * Where and how this copy of OpenStatsEngine is running: from a source checkout
 * with `node server.js`, or as a packaged app (a Node single executable — the
 * Windows .exe or the macOS .app), which carries the web UI inside itself and
 * has no folder of its own to keep data in.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** The `node:sea` module when running packaged, otherwise null. */
export const sea = (() => {
  try {
    const s = createRequire(import.meta.url)('node:sea');
    return s.isSea() ? s : null;
  } catch { return null; }
})();

export const packaged = !!sea;

// The bundler fills __OSE_VERSION__ in; from source, package.json is the truth.
/* global __OSE_VERSION__ */
export const VERSION = typeof __OSE_VERSION__ !== 'undefined'
  ? __OSE_VERSION__
  : JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/** The source checkout's root. Meaningless when packaged. */
export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Where data lives unless --data or OSE_DATA says otherwise.
 *
 * From source it is `data/` in the checkout, as it always was. A packaged app
 * cannot write inside itself — a macOS .app is often run from a read-only
 * location — so it uses Documents/OpenStatsEngine, where it is easy to find and
 * back up. A `data` folder sitting next to a packaged executable wins, which
 * makes a copy on a USB stick self-contained and lets an existing source
 * install's data be moved over by copying one folder.
 */
export function defaultDataDir() {
  if (!packaged) return path.join(ROOT, 'data');
  const beside = path.join(path.dirname(process.execPath), 'data');
  if (fs.existsSync(beside)) return beside;
  const docs = path.join(os.homedir(), 'Documents');
  return path.join(fs.existsSync(docs) ? docs : os.homedir(), 'OpenStatsEngine');
}

/** Open a URL in the default browser. Best effort: failing to is not an error. */
export function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true })
      .on('error', () => {}).unref();
  } catch { /* no browser to open */ }
}
