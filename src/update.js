/**
 * Checking for a newer release.
 *
 * One request to GitHub at startup, and again only when asked (Setup → Updates).
 * Never in the way: a venue with no internet simply never hears about updates.
 * Turn it off with --no-update-check or OSE_NO_UPDATE_CHECK=1.
 *
 * Every release is a tag on main; a beta is one GitHub marks as pre-release.
 * The channel decides which of them count:
 *   stable — finished releases only (GitHub's "latest" leaves pre-releases out)
 *   beta   — the newest of everything, finished or not
 */
import { VERSION } from './runtime.js';
import { readSettings, writeSettings } from './settings.js';

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

export const CHANNELS = ['stable', 'beta'];

/** Without a choice, a beta follows betas and a finished release follows releases. */
export const defaultChannel = () => (parse(VERSION).pre ? 'beta' : 'stable');

export function getChannel() {
  const c = readSettings().updateChannel;
  return CHANNELS.includes(c) ? c : defaultChannel();
}

export function setChannel(c) {
  if (!CHANNELS.includes(c)) throw new Error(`Unknown update channel "${c}"`);
  writeSettings({ updateChannel: c });
  return c;
}

const cache = new Map(); // channel -> Promise of the result

/**
 * What GitHub says for a channel: { channel, checked, update }.
 * `update` is { version, name, url, prerelease } when a newer release is out,
 * else null; `checked` is false when GitHub could not be reached (or checking
 * is off), so "no update" is never claimed on no information. Never rejects.
 * The answer is kept until `force` asks again.
 */
export function checkUpdates({ enabled = true, channel = getChannel(), force = false, timeoutMs = 5000 } = {}) {
  if (!enabled) return Promise.resolve({ channel, checked: false, update: null });
  if (force) cache.delete(channel);
  if (!cache.has(channel)) {
    cache.set(channel, (async () => {
      try {
        const r = await fetch(channel === 'beta' ? `${API}?per_page=20` : `${API}/latest`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': `OpenStatsEngine/${VERSION}` },
          signal: AbortSignal.timeout(timeoutMs)
        });
        // No stable release at all yet is an answer, not a failure.
        if (r.status === 404) return { channel, checked: true, update: null };
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = await r.json();
        const rels = (Array.isArray(body) ? body : [body])
          .filter((x) => x && x.tag_name && !x.draft && (channel === 'beta' || !x.prerelease));
        const rel = rels.reduce((best, x) => (!best || isNewer(x.tag_name, best.tag_name) ? x : best), null);
        if (!rel || !isNewer(rel.tag_name, VERSION)) return { channel, checked: true, update: null };
        const version = String(rel.tag_name).replace(/^v/i, '');
        return {
          channel, checked: true,
          update: { version, name: rel.name || `v${version}`, url: rel.html_url || RELEASES_URL, prerelease: !!rel.prerelease }
        };
      } catch {
        cache.delete(channel); // a failed check is retried next time, not remembered
        return { channel, checked: false, update: null };
      }
    })());
  }
  return cache.get(channel);
}

/** Just the newer release, if any. */
export const checkForUpdate = (opts) => checkUpdates(opts).then((r) => r.update);
