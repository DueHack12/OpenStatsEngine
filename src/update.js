/**
 * Checking for a newer release.
 *
 * One request to GitHub at startup, never repeated, and never in the way: a
 * venue with no internet simply never hears about updates. Turn it off with
 * --no-update-check or OSE_NO_UPDATE_CHECK=1.
 */
import { VERSION } from './runtime.js';

export const RELEASES_URL = 'https://github.com/DueHack12/OpenStatsEngine/releases/latest';
const API = 'https://api.github.com/repos/DueHack12/OpenStatsEngine/releases';

/**
 * Split "2.0.0-beta1" into numbers [2, 0, 0] and a pre-release tag "beta1".
 * A missing part counts as 0, so 1.5 is the same as 1.5.0.
 */
function parse(v) {
  const [core, ...pre] = String(v).trim().replace(/^v/i, '').split('-');
  return { nums: core.split('.').map((x) => parseInt(x, 10) || 0), pre: pre.join('-') };
}

/**
 * Is `latest` newer than `current`? Numbers compare numerically (1.10.0 beats
 * 1.9.3). On equal numbers a release beats any pre-release of it (2.0.0 beats
 * 2.0.0-beta3), and pre-releases compare part by part, numbers numerically
 * (beta10 beats beta9, rc1 beats beta2).
 */
export function isNewer(latest, current) {
  const a = parse(latest), b = parse(current);
  for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i++) {
    if ((a.nums[i] || 0) !== (b.nums[i] || 0)) return (a.nums[i] || 0) > (b.nums[i] || 0);
  }
  if (a.pre === b.pre) return false;
  if (!a.pre || !b.pre) return !a.pre;
  return a.pre.localeCompare(b.pre, 'en', { numeric: true }) > 0;
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
      // GitHub's "latest" leaves pre-releases out, which is right for a stable
      // install: it should not be nudged onto a beta. A beta install should
      // hear about the next beta too, so it looks at the recent releases.
      const beta = !!parse(VERSION).pre;
      const r = await fetch(beta ? `${API}?per_page=20` : `${API}/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `OpenStatsEngine/${VERSION}` },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!r.ok) return null;
      const body = await r.json();
      const rels = (Array.isArray(body) ? body : [body]).filter((x) => x && x.tag_name && !x.draft);
      const rel = rels.reduce((best, x) => (!best || isNewer(x.tag_name, best.tag_name) ? x : best), null);
      if (!rel || !isNewer(rel.tag_name, VERSION)) return null;
      const version = String(rel.tag_name).replace(/^v/i, '');
      return { version, name: rel.name || `v${version}`, url: rel.html_url || RELEASES_URL };
    } catch { return null; }
  })();
  return pending;
}
