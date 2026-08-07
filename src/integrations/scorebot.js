import { clockFromEvents, clockNow, auxClockFromEvents, auxNow } from '../clock.js';
import { getSport } from '../sports/index.js';
import { parseClock } from '../util.js';

/**
 * Genius Sports Scorebot (or any other clock/score feed) adapter.
 *
 * The JSON shape differs between venues, so the mapping is *configuration*:
 * point `fieldMap` at the real paths and this normalises them. Paste a raw
 * sample into /api/scorebot/parse and `discoverPaths` will suggest the map.
 *
 * Every field has its own source setting — `scorebot` or `manual`. A field set
 * to manual is never written by the feed, which is how you take just the clock
 * from a scoreboard that doesn't send (say) the half-inning or the bases.
 */

export const FEED_FIELDS = [
  { key: 'period', label: 'Period / Inning', hint: 'quarter, period or inning number' },
  { key: 'clock', label: 'Game Clock', hint: 'mm:ss or milliseconds' },
  { key: 'running', label: 'Clock Running', hint: 'true / false' },
  { key: 'homeScore', label: 'Home Score' },
  { key: 'awayScore', label: 'Away Score' },
  { key: 'possession', label: 'Possession' },
  { key: 'half', label: 'Top / Bottom', hint: 'baseball half-inning' },
  { key: 'outs', label: 'Outs' },
  { key: 'balls', label: 'Balls' },
  { key: 'strikes', label: 'Strikes' },
  { key: 'bases', label: 'Runners on Base' },
  { key: 'auxClock', label: 'Play / Shot Clock', hint: 'football play clock, basketball shot clock' }
];

/** Fields most scoreboards do send, versus the ones usually entered by hand. */
export const DEFAULT_SOURCES = {
  period: 'scorebot', clock: 'scorebot', running: 'scorebot',
  homeScore: 'scorebot', awayScore: 'scorebot', possession: 'scorebot',
  auxClock: 'scorebot',
  half: 'manual', outs: 'manual', balls: 'manual', strikes: 'manual', bases: 'manual'
};

const CANDIDATES = {
  period: ['period', 'quarter', 'inning', 'currentPeriod', 'periodNumber', 'data.period'],
  clock: ['clock', 'gameClock', 'displayClock', 'time', 'timeRemaining', 'data.clock'],
  running: ['running', 'clockRunning', 'isRunning', 'clockState', 'data.running'],
  homeScore: ['homeScore', 'home.score', 'scores.home', 'homeTeamScore', 'data.homeScore'],
  awayScore: ['awayScore', 'away.score', 'scores.away', 'awayTeamScore', 'visitorScore', 'data.awayScore'],
  possession: ['possession', 'possessionTeam', 'ballPossession', 'data.possession'],
  half: ['half', 'inningHalf', 'topBottom', 'isTop', 'topOfInning', 'data.half'],
  outs: ['outs', 'outCount', 'data.outs'],
  balls: ['balls', 'ballCount', 'data.balls'],
  strikes: ['strikes', 'strikeCount', 'data.strikes'],
  bases: ['bases', 'runners', 'baseRunners', 'onBase', 'data.bases'],
  auxClock: ['playClock', 'shotClock', 'play_clock', 'shot_clock', 'playClockSeconds',
    'shotClockSeconds', 'secondaryClock', 'data.playClock', 'data.shotClock'],
  auxRunning: ['playClockRunning', 'shotClockRunning', 'auxClockRunning',
    'data.playClockRunning', 'data.shotClockRunning']
};

/* ---------------- path helpers ---------------- */

function dig(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function pick(obj, paths) {
  for (const p of paths) {
    const v = dig(obj, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/** Every leaf path in an object, so we can suggest mappings from a raw sample. */
export function flattenPaths(obj, prefix = '', out = {}, depth = 0) {
  if (depth > 6 || obj == null) return out;
  if (Array.isArray(obj)) {
    out[prefix] = obj;
    obj.slice(0, 4).forEach((v, i) => flattenPaths(v, `${prefix}.${i}`, out, depth + 1));
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === 'object') flattenPaths(v, p, out, depth + 1);
      else out[p] = v;
    }
    return out;
  }
  out[prefix] = obj;
  return out;
}

/**
 * Suggest a fieldMap from a raw sample. Scores each leaf path by how well its
 * key name matches the field, so pasting one message is usually enough.
 */
export function discoverPaths(raw) {
  const flat = flattenPaths(raw);
  const suggestions = {};
  for (const { key } of FEED_FIELDS) {
    const wants = CANDIDATES[key].map((c) => c.split('.').pop().toLowerCase());
    const scored = [];
    for (const [path, value] of Object.entries(flat)) {
      const leaf = path.split('.').pop().toLowerCase();
      let score = 0;
      if (wants.includes(leaf)) score = 100 - wants.indexOf(leaf);
      else if (wants.some((w) => leaf === w.toLowerCase())) score = 80;
      else if (wants.some((w) => leaf.includes(w) || w.includes(leaf))) score = 40;
      if (!score) continue;
      // a clock field that doesn't look like a clock is probably the wrong one
      if (key === 'clock' && typeof value === 'string' && !/^\d+:\d{2}/.test(value) && !/^\d+$/.test(value)) score -= 30;
      if (key === 'running' && typeof value !== 'boolean' && !/^(true|false|running|stopped)$/i.test(String(value))) score -= 20;
      scored.push({ path, value, score });
    }
    scored.sort((a, b) => b.score - a.score);
    if (scored.length) suggestions[key] = scored.slice(0, 3);
  }
  return { suggestions, paths: flat };
}

/* ---------------- normalisation ---------------- */

export function normalizeFeed(raw, fieldMap = {}) {
  const map = {};
  for (const { key } of [...FEED_FIELDS, { key: 'auxRunning' }]) {
    const custom = fieldMap[key];
    map[key] = custom
      ? (Array.isArray(custom) ? custom : [custom, ...CANDIDATES[key]])
      : CANDIDATES[key];
  }
  const clockRaw = pick(raw, map.clock);
  const runningRaw = pick(raw, map.running);
  return {
    period: toInt(pick(raw, map.period)),
    clockMs: typeof clockRaw === 'number' ? clockRaw : parseClock(clockRaw),
    running: runningRaw === undefined ? undefined : truthy(runningRaw),
    homeScore: toInt(pick(raw, map.homeScore)),
    awayScore: toInt(pick(raw, map.awayScore)),
    possession: normPoss(pick(raw, map.possession)),
    half: normHalf(pick(raw, map.half)),
    outs: toInt(pick(raw, map.outs)),
    balls: toInt(pick(raw, map.balls)),
    strikes: toInt(pick(raw, map.strikes)),
    bases: normBases(pick(raw, map.bases)),
    auxClockMs: auxMs(pick(raw, map.auxClock)),
    auxRunning: (() => {
      const v = pick(raw, map.auxRunning);
      return v === undefined ? undefined : truthy(v);
    })()
  };
}

/**
 * A play or shot clock is at most 40 seconds, so a bare number is read as
 * seconds unless it is far too large to be one. That removes the main ambiguity
 * a scoreboard feed presents here — 24 means 24 seconds, not 24 milliseconds.
 */
export function auxMs(v) {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return v > 200 ? Math.round(v) : Math.round(v * 1000);
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    return n > 200 ? Math.round(n) : Math.round(n * 1000);
  }
  return parseClock(s);
}

function toInt(v) { if (v == null || v === '') return undefined; const n = parseInt(v, 10); return isFinite(n) ? n : undefined; }
function truthy(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'running' || s === 'on' || s === 'active';
}
function normPoss(v) {
  if (v == null) return undefined;
  const s = String(v).toLowerCase();
  if (s.startsWith('h')) return 'home';
  if (s.startsWith('a') || s.startsWith('v') || s.startsWith('g')) return 'away';
  return undefined;
}
function normHalf(v) {
  if (v == null) return undefined;
  if (typeof v === 'boolean') return v ? 'top' : 'bottom';
  const s = String(v).toLowerCase();
  if (s.startsWith('t') || s === '0' || s === 'true') return 'top';
  if (s.startsWith('b') || s === '1' || s === 'false') return 'bottom';
  return undefined;
}
/** Accepts {first,second,third} · [1,3] · "101" · 5 (bitmask) */
export function normBases(v) {
  if (v == null) return undefined;
  if (typeof v === 'object' && !Array.isArray(v)) {
    const g = (...keys) => keys.some((k) => truthy(v[k]));
    return { first: g('first', '1', 'b1', 'onFirst'), second: g('second', '2', 'b2', 'onSecond'), third: g('third', '3', 'b3', 'onThird') };
  }
  if (Array.isArray(v)) {
    const s = v.map(String);
    return { first: s.includes('1'), second: s.includes('2'), third: s.includes('3') };
  }
  const s = String(v).trim();
  if (/^[01]{3}$/.test(s)) return { first: s[0] === '1', second: s[1] === '1', third: s[2] === '1' };
  const n = parseInt(s, 10);
  if (isFinite(n) && n >= 0 && n <= 7) return { first: !!(n & 1), second: !!(n & 2), third: !!(n & 4) };
  return undefined;
}

export const basesCode = (b) => b ? `${b.first ? 1 : 0}${b.second ? 1 : 0}${b.third ? 1 : 0}` : '000';

/* ---------------- client ---------------- */

export class ScorebotClient {
  constructor({ store, onChange = () => {} }) {
    this.store = store;
    this.onChange = onChange;
    this.timer = null;
    this.ws = null;
    this.gameId = null;
    this.status = { connected: false, lastMessage: null, lastError: null, messages: 0, mode: 'off' };
  }

  get cfg() { return this.store.config.scorebot || {}; }
  get sources() { return { ...DEFAULT_SOURCES, ...(this.cfg.sources || {}) }; }

  start(gameId) {
    this.stop();
    const cfg = this.cfg;
    if (!cfg.enabled || !cfg.url) { this.status.mode = 'off'; return this.status; }
    this.gameId = gameId;
    if (/^wss?:\/\//i.test(cfg.url)) this._startWS(cfg);
    else this._startPoll(cfg);
    return this.status;
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.ws) { try { this.ws.close(); } catch { /* already closing */ } this.ws = null; }
    this.status.connected = false;
    this.status.mode = 'off';
  }

  _headers(cfg) {
    const h = { Accept: 'application/json' };
    if (cfg.apiKey) { h.Authorization = `Bearer ${cfg.apiKey}`; h['x-api-key'] = cfg.apiKey; }
    return h;
  }

  _url(cfg) {
    return cfg.gameCode ? cfg.url.replace('{game}', encodeURIComponent(cfg.gameCode)) : cfg.url;
  }

  _startPoll(cfg) {
    this.status.mode = 'poll';
    const tick = async () => {
      try {
        const res = await fetch(this._url(cfg), { headers: this._headers(cfg), signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this._handle(await res.json());
      } catch (e) {
        this.status.connected = false;
        this.status.lastError = `${e.message} @ ${new Date().toLocaleTimeString()}`;
      }
    };
    tick();
    this.timer = setInterval(tick, Math.max(250, cfg.pollMs || 1000));
  }

  _startWS(cfg) {
    this.status.mode = 'ws';
    try {
      const ws = new WebSocket(this._url(cfg));
      this.ws = ws;
      ws.addEventListener('open', () => {
        this.status.connected = true; this.status.lastError = null;
        if (cfg.subscribeMessage) {
          try { ws.send(typeof cfg.subscribeMessage === 'string' ? cfg.subscribeMessage : JSON.stringify(cfg.subscribeMessage)); }
          catch (e) { this.status.lastError = e.message; }
        }
      });
      ws.addEventListener('message', (m) => {
        try { this._handle(JSON.parse(m.data)); }
        catch (e) { this.status.lastError = `Bad message: ${e.message}`; }
      });
      ws.addEventListener('error', () => { this.status.lastError = 'WebSocket error'; this.status.connected = false; });
      ws.addEventListener('close', () => {
        this.status.connected = false;
        if (this.ws === ws && this.gameId) setTimeout(() => { if (this.ws === ws) this._startWS(this.cfg); }, 3000);
      });
    } catch (e) {
      this.status.lastError = e.message;
    }
  }

  _handle(raw) {
    this.status.connected = true;
    this.status.messages++;
    this.status.lastMessage = new Date().toISOString();
    this.status.lastRaw = raw;
    if (!this.gameId) return;
    const feed = normalizeFeed(raw, this.cfg.fieldMap || {});
    this.status.lastNormalized = feed;
    const written = applyFeed(this.store, this.gameId, feed, { ...this.cfg, sources: this.sources });
    if (written.length) this.onChange(this.gameId, written);
  }
}

/**
 * Diff a normalised feed against current state and append only real changes.
 * Fields whose source is 'manual' are skipped entirely — the feed never touches
 * them, so an operator entry is never fought over by the next poll.
 */
export function applyFeed(store, gameId, feed, cfg = {}) {
  const meta = store.getGame(gameId);
  if (!meta) return [];
  const sources = { ...DEFAULT_SOURCES, ...(cfg.sources || {}) };
  const on = (f) => sources[f] === 'scorebot';

  const sport = getSport(meta.sport);
  const events = store.effectiveEvents(gameId);
  const st = clockFromEvents(events, sport, meta.settings || {});
  const cur = clockNow(st);
  const written = [];
  const tol = cfg.toleranceMs ?? 1200;

  if (on('period') && feed.period != null && feed.period !== st.period) {
    written.push(store.appendEvent(gameId, {
      type: 'period_set', source: 'scorebot', period: feed.period,
      data: { period: feed.period, ms: on('clock') ? (feed.clockMs ?? undefined) : undefined }
    }));
  }
  if (on('clock') && feed.clockMs != null && Math.abs(feed.clockMs - cur) > tol) {
    written.push(store.appendEvent(gameId, {
      type: 'clock_set', source: 'scorebot',
      period: feed.period ?? st.period, clockMs: feed.clockMs, data: { ms: feed.clockMs }
    }));
  }
  if (on('running') && feed.running != null && feed.running !== st.running) {
    written.push(store.appendEvent(gameId, {
      type: feed.running ? 'clock_start' : 'clock_stop', source: 'scorebot',
      period: feed.period ?? st.period, clockMs: feed.clockMs ?? cur, data: {}
    }));
  }
  if (on('possession') && feed.possession) {
    const last = [...events].reverse().find((e) => e.type === 'possession');
    if (!last || last.team !== feed.possession) {
      written.push(store.appendEvent(gameId, {
        type: 'possession', source: 'scorebot', team: feed.possession,
        period: feed.period ?? st.period, clockMs: feed.clockMs ?? cur, data: {}
      }));
    }
  }

  // Play clock / shot clock. Same tolerance trick as the game clock: a steady
  // countdown is extrapolated locally and writes nothing, so only a reset or a
  // real disagreement lands in the log.
  // Only engage if the feed is actually carrying a value — a scoreboard that
  // sends no play clock must not switch off the local auto-reset.
  if (on('auxClock') && sport.auxClock && (feed.auxClockMs != null || feed.auxRunning != null)) {
    const auxSt = auxClockFromEvents(events, sport, meta.settings || {});
    if (feed.auxClockMs != null && Math.abs(feed.auxClockMs - auxNow(auxSt)) > tol) {
      written.push(store.appendEvent(gameId, {
        type: 'aux_set', source: 'scorebot',
        period: feed.period ?? st.period, clockMs: feed.clockMs ?? cur,
        data: { ms: feed.auxClockMs }
      }));
    }
    if (feed.auxRunning != null && feed.auxRunning !== auxSt.running) {
      written.push(store.appendEvent(gameId, {
        type: feed.auxRunning ? 'aux_start' : 'aux_stop', source: 'scorebot',
        period: feed.period ?? st.period, clockMs: feed.clockMs ?? cur, data: {}
      }));
    }
    // While the feed owns this clock, resetting it from logged plays would
    // briefly show the wrong number until the next poll corrected it.
    if (auxSt.autoReset) {
      written.push(store.appendEvent(gameId, {
        type: 'aux_config', source: 'scorebot',
        period: feed.period ?? st.period,
        data: { autoReset: false, reason: 'clock is coming from the feed' }
      }));
    }
  }

  // Situation fields (half / outs / count / bases) travel together as one
  // situation_set so the log stays readable.
  const sit = {};
  for (const f of ['half', 'outs', 'balls', 'strikes', 'bases']) {
    if (on(f) && feed[f] !== undefined) sit[f] = feed[f];
  }
  if (Object.keys(sit).length) {
    const last = [...events].reverse().find((e) => e.type === 'situation_set' && e.source === 'scorebot');
    const changed = !last || Object.entries(sit).some(([k, v]) => JSON.stringify(last.data?.[k]) !== JSON.stringify(v));
    if (changed) {
      written.push(store.appendEvent(gameId, {
        type: 'situation_set', source: 'scorebot',
        period: feed.period ?? st.period, clockMs: feed.clockMs ?? cur, data: sit
      }));
    }
  }

  // Official score from the scoreboard, kept alongside the score derived from
  // logged plays so a discrepancy is visible rather than silently overwriting.
  if ((on('homeScore') || on('awayScore')) && (feed.homeScore != null || feed.awayScore != null)) {
    const last = [...events].reverse().find((e) => e.type === 'score_official');
    const next = { home: feed.homeScore, away: feed.awayScore };
    if (!last || last.data?.home !== next.home || last.data?.away !== next.away) {
      written.push(store.appendEvent(gameId, {
        type: 'score_official', source: 'scorebot',
        period: feed.period ?? st.period, clockMs: feed.clockMs ?? cur, data: next
      }));
    }
  }
  return written;
}
