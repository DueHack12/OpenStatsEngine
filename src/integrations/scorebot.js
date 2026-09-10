import { clockFromEvents, clockNow, auxClockFromEvents, auxNow } from '../clock.js';
import { getSport } from '../sports/index.js';
import { parseClock } from '../util.js';
import { MqttClient } from './mqtt.js';

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
  { key: 'auxClock', label: 'Play / Shot Clock', hint: 'football play clock, basketball shot clock' },
  { key: 'down', label: 'Down', hint: 'football' },
  { key: 'distance', label: 'Distance to Go', hint: 'football' },
  { key: 'ballOn', label: 'Ball On', hint: 'football yard line' },
  { key: 'shots', label: 'Shots on Goal', hint: 'soccer / hockey / lacrosse — both sides' },
  { key: 'corners', label: 'Corner Kicks', hint: 'soccer — both sides' },
  { key: 'saves', label: 'Saves', hint: 'soccer / hockey / lacrosse — both sides' }
];

/** Fields most scoreboards do send, versus the ones usually entered by hand. */
export const DEFAULT_SOURCES = {
  period: 'scorebot', clock: 'scorebot', running: 'scorebot',
  homeScore: 'scorebot', awayScore: 'scorebot', possession: 'scorebot',
  auxClock: 'scorebot', down: 'scorebot', distance: 'scorebot', ballOn: 'scorebot',
  shots: 'scorebot', corners: 'scorebot', saves: 'scorebot',
  half: 'manual', outs: 'manual', balls: 'manual', strikes: 'manual', bases: 'manual'
};

const CANDIDATES = {
  // Sportzcast ScoreConnect III publishes PascalCase keys ("Quarter", "Clock",
  // "GuestScore"), so those names sit alongside the generic ones.
  // Casing no longer matters (see dig), so one spelling of each name is enough.
  // 'half' is deliberately absent: baseball uses it for the half-inning, and
  // matching it here would read "top" as a period number.
  period: ['period', 'quarter', 'inning', 'currentPeriod', 'periodNumber', 'data.period'],
  clock: ['clock', 'Clock', 'gameClock', 'displayClock', 'time', 'timeRemaining', 'data.clock'],
  running: ['running', 'clockRunning', 'ClockStatus', 'isRunning', 'clockState', 'data.running'],
  homeScore: ['homeScore', 'HomeScore', 'home.score', 'scores.home', 'homeTeamScore', 'data.homeScore'],
  awayScore: ['awayScore', 'AwayScore', 'GuestScore', 'VisitorScore', 'away.score', 'scores.away',
    'awayTeamScore', 'visitorScore', 'data.awayScore'],
  possession: ['possession', 'possessionTeam', 'ballPossession', 'data.possession'],
  homeShots: ['homeShots', 'HomeShots', 'homeSOG', 'HomeSOG', 'homeShotsOnGoal', 'data.homeShots'],
  awayShots: ['awayShots', 'AwayShots', 'GuestShots', 'VisitorShots', 'awaySOG', 'GuestSOG',
    'awayShotsOnGoal', 'data.awayShots'],
  homeCorners: ['homeCorners', 'HomeCorners', 'HomeCornerKicks', 'homeCornerKicks', 'data.homeCorners'],
  awayCorners: ['awayCorners', 'AwayCorners', 'GuestCornerKicks', 'GuestCorners', 'VisitorCorners',
    'awayCornerKicks', 'data.awayCorners'],
  homeSaves: ['homeSaves', 'HomeSaves', 'data.homeSaves'],
  awaySaves: ['awaySaves', 'AwaySaves', 'GuestSaves', 'VisitorSaves', 'data.awaySaves'],
  // Sportzcast flags possession per side with a marker character rather than a name
  homePossession: ['HomePossession', 'homePossession'],
  awayPossession: ['GuestPossession', 'VisitorPossession', 'guestPossession', 'awayPossession'],
  down: ['down', 'Down', 'data.down'],
  distance: ['distance', 'ToGo', 'toGo', 'togo', 'yardsToGo', 'data.distance'],
  ballOn: ['ballOn', 'BallOn', 'yardLine', 'data.ballOn'],
  half: ['half', 'inningHalf', 'topBottom', 'isTop', 'topOfInning', 'data.half'],
  outs: ['outs', 'outCount', 'data.outs'],
  balls: ['balls', 'ballCount', 'data.balls'],
  strikes: ['strikes', 'strikeCount', 'data.strikes'],
  bases: ['bases', 'runners', 'baseRunners', 'onBase', 'data.bases'],
  auxClock: ['playClock', 'PlayClock', 'shotClock', 'ShotClock', 'play_clock', 'shot_clock',
    'playClockSeconds', 'shotClockSeconds', 'secondaryClock', 'data.playClock', 'data.shotClock'],
  auxRunning: ['playClockRunning', 'PlayClockStatus', 'shotClockRunning', 'auxClockRunning',
    'data.playClockRunning', 'data.shotClockRunning']
};

/* ---------------- path helpers ---------------- */

/**
 * Walk a dotted path, matching key names case-insensitively.
 *
 * Sportzcast varies its capitalisation by sport — soccer sends `Period`, other
 * sports send it differently — and chasing that one spelling at a time is how
 * a live match ends up stuck in the first half. An exact match still wins, so
 * a feed carrying both spellings behaves predictably.
 */
function dig(obj, path) {
  return path.split('.').reduce((o, k) => {
    if (o == null || typeof o !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(o, k)) return o[k];
    const want = k.toLowerCase();
    for (const key of Object.keys(o)) if (key.toLowerCase() === want) return o[key];
    return undefined;
  }, obj);
}

function pick(obj, paths) {
  for (const p of paths) {
    const v = dig(obj, p);
    if (v === undefined || v === null) continue;
    // Scoreboards pad unused fields with spaces; " " means absent, not a value.
    if (typeof v === 'string' && v.trim() === '') continue;
    return v;
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
  // Drive this off CANDIDATES rather than FEED_FIELDS: a few fields are a
  // single on/off switch covering a per-side pair (shots, corners, saves are
  // read as homeShots/awayShots and so on), so the two lists do not match
  // one-for-one and the toggle key itself has no candidates of its own.
  for (const key of Object.keys(CANDIDATES)) {
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

export function normalizeFeed(raw, fieldMap = {}, opts = {}) {
  // A default only covers `undefined`, and a config that stored fieldMap:null
  // would land here as null. Every caller happens to guard with `|| {}` today;
  // this makes the fifth one not have to remember.
  fieldMap = fieldMap || {};
  const map = {};
  for (const { key } of [...FEED_FIELDS, { key: 'auxRunning' },
    { key: 'homePossession' }, { key: 'awayPossession' },
    { key: 'homeShots' }, { key: 'awayShots' }, { key: 'homeCorners' },
    { key: 'awayCorners' }, { key: 'homeSaves' }, { key: 'awaySaves' }]) {
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
    running: parseRunning(runningRaw, opts.runningValues),
    homeScore: toInt(pick(raw, map.homeScore)),
    awayScore: toInt(pick(raw, map.awayScore)),
    possession: normPoss(pick(raw, map.possession)) ?? sidePossession(raw, map),
    down: toInt(pick(raw, map.down)),
    distance: toInt(pick(raw, map.distance)),
    ballOn: toInt(pick(raw, map.ballOn)),
    half: normHalf(pick(raw, map.half)),
    outs: toInt(pick(raw, map.outs)),
    balls: toInt(pick(raw, map.balls)),
    strikes: toInt(pick(raw, map.strikes)),
    bases: normBases(pick(raw, map.bases)),
    homeShots: toInt(pick(raw, map.homeShots)),
    awayShots: toInt(pick(raw, map.awayShots)),
    homeCorners: toInt(pick(raw, map.homeCorners)),
    awayCorners: toInt(pick(raw, map.awayCorners)),
    homeSaves: toInt(pick(raw, map.homeSaves)),
    awaySaves: toInt(pick(raw, map.awaySaves)),
    auxClockMs: auxMs(pick(raw, map.auxClock)),
    auxRunning: parseRunning(pick(raw, map.auxRunning), opts.runningValues),
    // kept for diagnostics: a status the feed sent that we could not read
    _unreadRunning: runningRaw !== undefined && parseRunning(runningRaw, opts.runningValues) === undefined
      ? runningRaw : undefined
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

/**
 * Some scoreboards mark possession by putting a character next to a side
 * ("<" or "*") rather than naming the team, so a non-blank value wins.
 */
function sidePossession(raw, map) {
  const flag = (v) => v !== undefined && v !== null && String(v).trim() !== '';
  if (flag(pick(raw, map.homePossession))) return 'home';
  if (flag(pick(raw, map.awayPossession))) return 'away';
  return undefined;
}

function toInt(v) { if (v == null || v === '') return undefined; const n = parseInt(v, 10); return isFinite(n) ? n : undefined; }

// 'r'/'s' are Sportzcast's: ClockStatus "R" while the clock runs, "S" when it
// is stopped. Without them a running clock fell through to movement inference,
// which works but lags a second behind what the board already knows.
const RUN_TRUE = ['true', '1', 'y', 'yes', 'on', 'run', 'running', 'active', 'started', 'go', 'r'];
const RUN_FALSE = ['false', '0', 'n', 'no', 'off', 'stop', 'stopped', 'halt', 'halted', 'paused',
  'inactive', 's'];

/**
 * Read a clock run/stop flag, returning **undefined** for anything we do not
 * positively recognise.
 *
 * This matters more than it looks. Scoreboards use all sorts of markers, and
 * guessing "stopped" from an unknown value is the worst possible failure: the
 * game clock silently freezes while the board counts down, and time of
 * possession is wrong for the rest of the night. Returning undefined instead
 * hands the decision to the movement inference, which observes what the clock
 * is actually doing and is right either way.
 *
 * `extra` lets a venue teach it a marker without a code change:
 *   "runningValues": { "true": ["R"], "false": ["S"] }
 */
export function parseRunning(v, extra = {}) {
  if (typeof v === 'boolean') return v;
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === '') return undefined;
  const more = (k) => (extra[k] || []).map((x) => String(x).trim().toLowerCase());
  if (more('true').includes(s)) return true;
  if (more('false').includes(s)) return false;
  if (RUN_TRUE.includes(s)) return true;
  if (RUN_FALSE.includes(s)) return false;
  return undefined;   // unrecognised — let the inference decide
}

/** Only used for plain flags where "present and non-blank" is the whole meaning. */
function truthy(v) {
  const r = parseRunning(v);
  return r === undefined ? false : r;
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

/** Silence longer than this counts as a dead feed. Sportzcast publishes about
 *  once a second; five seconds is four missed beats, not a hiccup. */
export const DEFAULT_STALE_MS = 5000;

export class ScorebotClient {
  constructor({ store, onChange = () => {}, onStatus = () => {} }) {
    this.store = store;
    this.onChange = onChange;
    this.onStatus = onStatus;
    this.timer = null;
    this.ws = null;
    this.gameId = null;
    this._stopping = false;
    this._watchdog = null;
    this._lastMsgAt = 0;
    this.status = {
      connected: false, lastMessage: null, lastError: null, messages: 0, mode: 'off',
      droppedAt: null, dropReason: null, stalled: false
    };
  }

  /**
   * Every connection-state change goes through here so a feed that died on its
   * own can be told apart from one the operator switched off. Only the first
   * kind is worth interrupting the booth for, and nothing else would announce
   * it: a dead feed sends no events, so the screen would simply stop changing.
   */
  _setConnected(v, why = null, stalled = false) {
    const was = this.status.connected;
    this.status.connected = !!v;
    if (was === this.status.connected) return;
    const unexpected = !v && !this._stopping;
    if (unexpected) {
      this.status.droppedAt = new Date().toISOString();
      this.status.dropReason = why || this.status.lastError || 'connection lost';
      // Passed in rather than set by the caller beforehand, so a real socket
      // drop following a stall cannot inherit the stale flag.
      this.status.stalled = !!stalled;
    } else if (v) {
      this.status.droppedAt = null;
      this.status.dropReason = null;
      this.status.lastError = null;
      // Fresh grace window: a link that comes up and never delivers anything
      // should still trip the watchdog rather than sit there looking healthy.
      this._lastMsgAt = Date.now();
      this.status.stalled = false;
    }
    this._notify(unexpected);
  }

  _notify(unexpected = false) {
    try { this.onStatus({ ...this.status, unexpected }); }
    catch { /* a listener must never take the feed down with it */ }
  }

  get cfg() { return this.store.config.scorebot || {}; }
  get sources() { return { ...DEFAULT_SOURCES, ...(this.cfg.sources || {}) }; }

  start(gameId) {
    this.stop();
    const cfg = this.cfg;
    if (!cfg.enabled || !cfg.url) { this.status.mode = 'off'; this._notify(); return this.status; }
    this.gameId = gameId;
    this.status.droppedAt = null;
    this.status.dropReason = null;
    this._lastMsgAt = Date.now();
    if (/^mqtts?:\/\//i.test(cfg.url)) this._startMqtt(cfg);
    else if (/^wss?:\/\//i.test(cfg.url)) this._startWS(cfg);
    else this._startPoll(cfg);
    this._startWatchdog();
    this._notify();
    return this.status;
  }

  stop() {
    // Guards the whole teardown, including the close/error callbacks the
    // transports fire on their way out, so an operator-initiated stop never
    // reads as an unexpected drop.
    this._stopping = true;
    try {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      if (this._watchdog) { clearInterval(this._watchdog); this._watchdog = null; }
      if (this.ws) { try { this.ws.close(); } catch { /* already closing */ } this.ws = null; }
      if (this.mqtt) { try { this.mqtt.end(); } catch { /* already closing */ } this.mqtt = null; }
      this._setConnected(false);
      this.status.mode = 'off';
      this.status.droppedAt = null;
      this.status.dropReason = null;
    } finally { this._stopping = false; }
    this._notify();
  }

  /**
   * How long the feed may stay silent before it counts as gone. `staleMs: 0`
   * turns the check off, for a board that only publishes when something
   * changes and is legitimately quiet between plays.
   */
  _staleMs() {
    const v = this.cfg.staleMs;
    if (v === 0 || v === '0') return 0;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.max(1000, n) : DEFAULT_STALE_MS;
  }

  /**
   * A scoreboard can stop sending while the socket stays perfectly healthy.
   * Switch the ScoreConnect emulator off and MQTT holds its TCP connection and
   * its keepalives, so nothing looks wrong while every number on screen quietly
   * freezes — which is the failure the operator actually notices, ten minutes
   * late. Silence past the threshold is treated as a disconnection.
   *
   * The transport is deliberately left running. Recovery is automatic: the next
   * message marks the feed live again, exactly like a socket coming back.
   */
  _startWatchdog() {
    if (this._watchdog) { clearInterval(this._watchdog); this._watchdog = null; }
    const ms = this._staleMs();
    if (!ms) return;
    this._watchdog = setInterval(() => {
      if (!this.status.connected || !this._lastMsgAt) return;
      const quiet = Date.now() - this._lastMsgAt;
      if (quiet <= ms) return;
      this.status.quietMs = quiet;
      // Flagged stalled so the booth can tell the two failures apart: a dead
      // socket is a network problem, a quiet board is a source problem.
      this._setConnected(false, `no data for ${Math.round(quiet / 1000)}s — ` +
        'the connection is open but the board has gone quiet', true);
    }, 1000);
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
        this.status.lastError = `${e.message} @ ${new Date().toLocaleTimeString()}`;
        this._setConnected(false, e.message);
      }
    };
    tick();
    this.timer = setInterval(tick, Math.max(250, cfg.pollMs || 1000));
  }

  /**
   * Sportzcast ScoreConnect III runs a local MQTT broker and publishes the
   * scoreboard as JSON. The topic is the URL path, e.g.
   *   mqtt://127.0.0.1:1883/bot/0/json
   */
  _startMqtt(cfg) {
    this.status.mode = 'mqtt';
    const url = cfg.gameCode ? cfg.url.replace('{game}', encodeURIComponent(cfg.gameCode)) : cfg.url;
    this.mqtt = new MqttClient({
      url,
      topic: cfg.topic,
      username: cfg.mqttUser,
      password: cfg.mqttPassword || cfg.apiKey || undefined,
      onStatus: (st) => {
        if (st.topic) this.status.topic = st.topic;
        if (st.error) this.status.lastError = `${st.error} @ ${new Date().toLocaleTimeString()}`;
        this._setConnected(!!st.connected, st.error);
      },
      onMessage: (topic, payload) => {
        try { this._handle(JSON.parse(payload)); }
        catch {
          // Non-JSON topics (ScoreConnect also publishes a raw `sbdata` string)
          // are ignored rather than treated as an error.
          this.status.lastRawText = payload.slice(0, 200);
        }
      }
    }).connect();
  }

  _startWS(cfg) {
    this.status.mode = 'ws';
    try {
      const ws = new WebSocket(this._url(cfg));
      this.ws = ws;
      ws.addEventListener('open', () => {
        this.status.lastError = null; this._setConnected(true);
        if (cfg.subscribeMessage) {
          try { ws.send(typeof cfg.subscribeMessage === 'string' ? cfg.subscribeMessage : JSON.stringify(cfg.subscribeMessage)); }
          catch (e) { this.status.lastError = e.message; }
        }
      });
      ws.addEventListener('message', (m) => {
        try { this._handle(JSON.parse(m.data)); }
        catch (e) { this.status.lastError = `Bad message: ${e.message}`; }
      });
      ws.addEventListener('error', () => { this.status.lastError = 'WebSocket error'; this._setConnected(false, 'WebSocket error'); });
      ws.addEventListener('close', () => {
        this._setConnected(false, 'socket closed');
        if (this.ws === ws && this.gameId) setTimeout(() => { if (this.ws === ws) this._startWS(this.cfg); }, 3000);
      });
    } catch (e) {
      this.status.lastError = e.message;
    }
  }

  /**
   * Many scoreboards publish a clock value but no run/stop flag — Sportzcast
   * sends ClockStatus as a blank character. A clock that is changing is
   * running; one that has held the same value for a few messages is stopped.
   * Only fills in what the feed left undefined.
   */
  _inferRunning(feed) {
    const track = (key, msKey, stateKey) => {
      const ms = feed[msKey];
      if (ms == null) return;
      const prev = this[stateKey];
      if (prev && prev.ms === ms) {
        prev.still++;
        // a few identical readings in a row is a genuinely stopped clock
        if (feed[key] === undefined && prev.still >= 3) feed[key] = false;
      } else {
        if (feed[key] === undefined && prev) feed[key] = true;
        this[stateKey] = { ms, still: 0 };
      }
    };
    track('running', 'clockMs', '_clockTrack');
    track('auxRunning', 'auxClockMs', '_auxTrack');
  }

  _handle(raw) {
    // Data arriving is proof of life, whatever the transport last reported.
    this._setConnected(true);
    this._lastMsgAt = Date.now();
    this.status.quietMs = 0;
    this.status.messages++;
    this.status.lastMessage = new Date().toISOString();
    this.status.lastRaw = raw;
    if (!this.gameId) return;
    const feed = normalizeFeed(raw, this.cfg.fieldMap || {}, { runningValues: this.cfg.runningValues });
    if (feed._unreadRunning !== undefined) {
      this.status.unreadRunningValue = feed._unreadRunning;
      this.status.hint = `The feed reports clock status as ${JSON.stringify(feed._unreadRunning)}, ` +
        `which isn't a value I recognise — falling back to watching whether the clock moves. ` +
        `Add "runningValues": { "true": [...], "false": [...] } to the scorebot config to map it.`;
    }
    if (this.cfg.inferRunning !== false) this._inferRunning(feed);
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
  for (const f of ['half', 'outs', 'balls', 'strikes', 'bases', 'down', 'distance', 'ballOn']) {
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

  // Counting stats the board keeps for us — shots on goal, corners, saves.
  // Kept as the board's own figures rather than folded into the team totals:
  // four shots on the board cannot be turned into four shot events, and
  // overwriting a total the operator has been logging by hand would lose work.
  const board = {};
  for (const [field, keys] of [
    ['shots', ['homeShots', 'awayShots']],
    ['corners', ['homeCorners', 'awayCorners']],
    ['saves', ['homeSaves', 'awaySaves']]
  ]) {
    if (!on(field)) continue;
    const [hk, ak] = keys;
    if (feed[hk] != null) board[hk] = feed[hk];
    if (feed[ak] != null) board[ak] = feed[ak];
  }
  if (Object.keys(board).length) {
    const last = [...events].reverse().find((e) => e.type === 'board_stats');
    const changed = !last || Object.entries(board).some(([k, v]) => last.data?.[k] !== v);
    if (changed) {
      written.push(store.appendEvent(gameId, {
        type: 'board_stats', source: 'scorebot',
        period: feed.period ?? st.period, clockMs: feed.clockMs ?? cur, data: board
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
