/**
 * This computer's OpenStatsEngine settings: the few choices that belong to the
 * machine rather than to the season, such as where the data folder is and
 * which releases to be told about. Kept outside any data folder, because the
 * data folder may be shared between computers through a synced drive.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The settings file (OSE_SETTINGS overrides, for tests). */
export function settingsPath() {
  if (process.env.OSE_SETTINGS) return path.resolve(process.env.OSE_SETTINGS);
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'OpenStatsEngine', 'settings.json');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'OpenStatsEngine', 'settings.json');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'openstatsengine', 'settings.json');
}

export function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) || {}; } catch { return {}; }
}

/** Merge `patch` in; a null value removes that setting. */
export function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
  const p = settingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(next, null, 2) + '\n');
  return next;
}
