/**
 * Checking for a newer release.
 *
 * One request to GitHub at startup, never repeated, and never in the way: a
 * venue with no internet simply never hears about updates. Turn it off with
 * --no-update-check or OSE_NO_UPDATE_CHECK=1.
 */
import { VERSION } from './runtime.js';

export const RELEASES_URL = 'https://github.com/DueHack12/OpenStatsEngine/releases/latest';
const API_URL = 'https://api.github.com/repos/DueHack12/OpenStatsEngine/releases/latest';

/** Compare dotted versions numerically: 1.10.0 is newer than 1.9.3. */
export function isNewer(latest, current) {
  const a = String(latest).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const b = String(current).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

let pending = null;

/**
 * The latest release, if it is newer than this one: { version, name, url }.
 * Resolves to null when up to date, offline, or disabled. Never rejects.
 */
export function checkForUpdate({ enabled = true, timeoutMs = 5000 } = {}) {
  if (!enabled) return Promise.resolve(null);
  pending ??= (async () => {
    try {
      const r = await fetch(API_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `OpenStatsEngine/${VERSION}` },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!r.ok) return null;
      const rel = await r.json();
      const version = String(rel.tag_name || '').replace(/^v/, '');
      if (!version || !isNewer(version, VERSION)) return null;
      return { version, name: rel.name || `v${version}`, url: rel.html_url || RELEASES_URL };
    } catch { return null; }
  })();
  return pending;
}
