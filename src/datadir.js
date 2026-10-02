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

/**
 * What to do about a folder the system will not let us into. On a Mac the
 * usual cause is privacy protection: the app runs inside Terminal, and
 * Terminal has to be allowed into Google Drive and other cloud folders.
 */
export function permissionHint(code) {
  if (!['EPERM', 'EACCES'].includes(code)) return '';
  if (process.platform === 'darwin') {
    return 'macOS is not letting OpenStatsEngine into this folder. Open System Settings → Privacy & Security → ' +
      'Files and Folders, find Terminal (OpenStatsEngine runs inside it) and allow access; if Terminal is not ' +
      'listed, add it under Full Disk Access instead. Then quit Terminal and open OpenStatsEngine again.';
  }
  return 'This computer is not letting OpenStatsEngine into this folder. Check that your user account can open it.';
}

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

/** The OpenStatsEngine data directly in `dir`: counts, and whether there is any. */
function dataIn(dir) {
  const count = (sub, test) => {
    try { return fs.readdirSync(path.join(dir, sub), { withFileTypes: true }).filter(test).length; } catch { return 0; }
  };
  const teams = count('teams', (e) => e.isFile() && e.name.endsWith('.json'));
  const games = count('games', (e) => e.isDirectory());
  const config = fs.existsSync(path.join(dir, 'config.json'));
  return { teams, games, hasData: teams > 0 || games > 0 || config };
}

/**
 * What a folder holds, without changing anything.
 *
 * Beyond the counts, it says why a folder looks empty when it may not be: it
 * could not be read (on a Mac, Terminal not yet allowed into Google Drive), or
 * the data is one level down, as when pointing at a source install whose data
 * sits in its `data` folder. `nested` lists subfolders that hold data.
 */
export function inspectDataDir(dir) {
  let exists = false;
  try { exists = fs.statSync(dir).isDirectory(); } catch { /* missing */ }
  if (!exists) return { dir, exists, teams: 0, games: 0, hasData: false, nested: [], error: null };

  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return { dir, exists, teams: 0, games: 0, hasData: false, nested: [], error: e.code || e.message }; }

  const here = dataIn(dir);
  const nested = [];
  if (!here.hasData) {
    // A source install keeps data in "data"; look there first, then anywhere
    // one level down. Capped, so pointing at a huge folder stays quick.
    const subs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !['teams', 'games', 'node_modules'].includes(e.name))
      .sort((a, b) => (b.name === 'data') - (a.name === 'data'))
      .slice(0, 200);
    for (const e of subs) {
      const sub = path.join(dir, e.name);
      const d = dataIn(sub);
      if (d.hasData) nested.push({ dir: sub, teams: d.teams, games: d.games });
    }
  }
  return { dir, exists, ...here, nested, error: null };
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
    throw new Error(`Cannot write to ${dir}: ${e.code || e.message}. ` +
      (permissionHint(e.code) || 'Check the folder exists and is synced/available.'));
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
