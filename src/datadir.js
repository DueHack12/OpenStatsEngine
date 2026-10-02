/**
 * Choosing where data lives.
 *
 * In order: --data, then OSE_DATA, then the folder picked in Setup → Data
 * Folder, then the default (see runtime.js). The picked folder is remembered in
 * a small settings file outside any data folder — otherwise moving the data
 * would move the note saying where it went.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultDataDir } from './runtime.js';
import { readSettings, writeSettings } from './settings.js';

export { settingsPath, readSettings } from './settings.js';

/** "~/Drive/x" → the home folder's Drive/x; trims the quotes a pasted path often carries. */
export function normalizePath(p) {
  let s = String(p ?? '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) s = path.join(os.homedir(), s.slice(1));
  return s;
}

/**
 * The folder to use, and what decided it: 'flag', 'env', 'setting' or 'default'.
 */
export function resolveDataDir({ flag, env } = {}) {
  if (flag) return { dir: path.resolve(normalizePath(flag)), source: 'flag' };
  if (env) return { dir: path.resolve(normalizePath(env)), source: 'env' };
  const picked = readSettings().dataDir;
  if (picked) return { dir: path.resolve(picked), source: 'setting' };
  return { dir: defaultDataDir(), source: 'default' };
}

/** What a folder holds, without changing anything. */
export function inspectDataDir(dir) {
  const count = (sub, test) => {
    try { return fs.readdirSync(path.join(dir, sub), { withFileTypes: true }).filter(test).length; } catch { return 0; }
  };
  let exists = false;
  try { exists = fs.statSync(dir).isDirectory(); } catch { /* missing */ }
  const teams = count('teams', (e) => e.isFile() && e.name.endsWith('.json'));
  const games = count('games', (e) => e.isDirectory());
  const config = exists && fs.existsSync(path.join(dir, 'config.json'));
  return { dir, exists, teams, games, hasData: teams > 0 || games > 0 || config };
}

const same = (a, b) => process.platform === 'win32' || process.platform === 'darwin'
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  : path.resolve(a) === path.resolve(b);
const inside = (child, parent) => {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * Remember `target` as the data folder from the next start, optionally
 * copying `current` into it first. An empty target resets to the default.
 *
 * Never overwrites: copying into a folder that already holds data is refused,
 * and a folder with data is simply used as it is.
 */
export function chooseDataDir(target, { current, copy = false } = {}) {
  const raw = normalizePath(target);
  if (!raw) {
    writeSettings({ dataDir: null });
    return { dir: defaultDataDir(), reset: true, copied: false };
  }
  if (!path.isAbsolute(raw)) {
    throw new Error('Give the full path to the folder, e.g. G:\\My Drive\\OpenStatsEngine or /Users/you/Google Drive/OpenStatsEngine.');
  }
  const dir = path.resolve(raw);
  const before = inspectDataDir(dir);

  if (copy) {
    if (same(dir, current)) throw new Error('That is already the folder in use — there is nothing to copy.');
    if (inside(dir, current) || inside(current, dir)) {
      throw new Error('The new folder cannot be inside the current one, or the other way round.');
    }
    if (before.hasData) {
      throw new Error(`That folder already has OpenStatsEngine data (${before.teams} teams, ${before.games} games). ` +
        'It will not be copied over. Untick "Copy" to use the data that is already there.');
    }
  }

  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.ose-write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
  } catch (e) {
    throw new Error(`Cannot write to ${dir}: ${e.code || e.message}. Check the folder exists and is synced/available.`);
  }

  if (copy) {
    // vmix/ is regenerated from the games, so it is left behind.
    fs.cpSync(current, dir, {
      recursive: true, force: false, errorOnExist: false,
      filter: (src) => path.relative(current, src).split(path.sep)[0] !== 'vmix'
    });
  }
  writeSettings({ dataDir: dir });
  return { dir, reset: false, copied: copy, found: before.hasData ? before : null };
}
