import { fmtClock } from './util.js';

/**
 * The game clock is *derived from the event log*, never stored as mutable state.
 * That means a server restart mid-game recovers the clock exactly, and every
 * stat event can be stamped with the clock value it was entered at.
 *
 * Clock events: clock_start | clock_stop | clock_set | period_set
 */
export function clockFromEvents(events, sport, settings = {}) {
  const lengthMs = (settings.periodLengthMs ?? sport.periods.lengthMs);
  const otLengthMs = (settings.otLengthMs ?? sport.periods.otLengthMs ?? lengthMs);
  const countsDown = sport.clockCountsDown !== false;

  const st = {
    period: 1,
    periodCount: settings.periodCount ?? sport.periods.count,
    label: sport.periods.label,
    lengthMs,
    otLengthMs,
    countsDown,
    base: countsDown ? lengthMs : 0,
    running: false,
    runningSince: null
  };

  for (const e of events) {
    const t = Date.parse(e.ts);
    switch (e.type) {
      case 'clock_start':
        if (!st.running) { st.running = true; st.runningSince = t; }
        break;
      case 'clock_stop':
        if (st.running) {
          st.base = advance(st, t);
          st.running = false;
          st.runningSince = null;
        }
        break;
      case 'clock_set':
        st.base = e.data?.ms ?? st.base;
        if (st.running) st.runningSince = t;
        break;
      case 'period_set': {
        const n = e.data?.period ?? st.period + 1;
        st.period = n;
        const isOT = n > st.periodCount;
        st.base = e.data?.ms ?? (countsDown ? (isOT ? st.otLengthMs : st.lengthMs) : 0);
        st.running = false;
        st.runningSince = null;
        break;
      }
    }
  }
  return st;
}

function advance(st, atMs) {
  const elapsed = atMs - st.runningSince;
  return st.countsDown
    ? Math.max(0, st.base - elapsed)
    : st.base + elapsed;
}

/** Current clock value in ms at wall-clock time `now`. */
export function clockNow(st, now = Date.now()) {
  if (!st.running) return st.base;
  return advance(st, now);
}

/**
 * Elapsed game time from the start of the game to this point, in ms.
 * Used for time-of-possession and drought math, which must be monotonic
 * across periods regardless of whether the clock counts up or down.
 */
export function elapsedGameMs(st, clockMs, period) {
  const p = period ?? st.period;
  const completed = Math.max(0, p - 1);
  const regPeriods = Math.min(completed, st.periodCount);
  const otPeriods = Math.max(0, completed - st.periodCount);
  const before = regPeriods * st.lengthMs + otPeriods * st.otLengthMs;
  const isOT = p > st.periodCount;
  const len = isOT ? st.otLengthMs : st.lengthMs;
  const into = st.countsDown ? (len - clockMs) : clockMs;
  return before + Math.max(0, into);
}

export function clockView(st, now = Date.now()) {
  const ms = clockNow(st, now);
  return {
    period: st.period,
    periodLabel: periodLabel(st, st.period),
    periodCount: st.periodCount,
    clockMs: ms,
    clock: fmtClock(ms, ms < 60000),
    running: st.running,
    lengthMs: st.lengthMs,
    countsDown: st.countsDown
  };
}

export function periodLabel(st, n) {
  if (n > st.periodCount) {
    const ot = n - st.periodCount;
    return st.periodCount >= 4 && st.label === 'Quarter' ? (ot === 1 ? 'OT' : `${ot}OT`) : (ot === 1 ? 'OT' : `${ot}OT`);
  }
  const ord = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'][n - 1] || `${n}th`;
  if (st.label === 'Inning') return `${ord}`;
  return ord;
}

/* ------------------------------------------------------------------ *
 * Secondary clock — football play clock, basketball shot clock        *
 * ------------------------------------------------------------------ */

/**
 * Derived from the event log exactly like the game clock, so it survives a
 * restart and replays identically.
 *
 * Events: aux_start | aux_stop | aux_set {ms} | aux_config {enabled,autoReset}
 *
 * A "linked" secondary clock (basketball) follows the game clock's start/stop
 * automatically — the shot clock only ever runs while the game clock runs, so
 * the operator manages one clock instead of two. Football's play clock is not
 * linked: it runs between plays while the game clock is stopped.
 */
export function auxClockFromEvents(events, sport, settings = {}) {
  const cfg = sport.auxClock;
  if (!cfg) return null;

  const fullMs = settings.auxFullMs ?? cfg.defaultMs;
  const st = {
    key: cfg.key,
    label: cfg.label,
    presets: settings.auxPresets ?? cfg.presets,
    fullMs,
    base: fullMs,
    running: false,
    runningSince: null,
    linked: settings.auxLinked ?? !!cfg.linkedToGameClock,
    enabled: settings.auxEnabled ?? cfg.enabledByDefault !== false,
    autoReset: settings.auxAutoReset ?? cfg.autoResetByDefault !== false,
    expiredAt: null
  };

  // action -> reset value, flattened once so the loop below stays cheap
  const resets = new Map();
  for (const rule of cfg.autoReset || []) {
    for (const action of rule.actions) resets.set(action, rule.ms);
  }

  const start = (t) => { if (!st.running) { st.running = true; st.runningSince = t; } };
  const stop = (t) => {
    if (st.running) { st.base = auxAt(st, t); st.running = false; st.runningSince = null; }
  };
  const reset = (ms, t) => { st.base = ms; if (st.running) st.runningSince = t; };

  for (const e of events) {
    const t = Date.parse(e.ts);
    switch (e.type) {
      case 'aux_start': start(t); break;
      case 'aux_stop': stop(t); break;
      case 'aux_set': reset(e.data?.ms ?? st.fullMs, t); if (e.data?.running != null) (e.data.running ? start(t) : stop(t)); break;
      case 'aux_config':
        if (e.data?.enabled != null) st.enabled = !!e.data.enabled;
        if (e.data?.autoReset != null) st.autoReset = !!e.data.autoReset;
        break;
      case 'clock_start': if (st.linked) start(t); break;
      case 'clock_stop': if (st.linked) stop(t); break;
      case 'period_set': stop(t); st.base = st.fullMs; break;
      case 'stat': {
        if (!st.autoReset) break;
        const ms = resets.get(e.action);
        if (ms != null) reset(ms, t);
        break;
      }
    }
  }
  return st;
}

function auxAt(st, atMs) {
  return Math.max(0, st.base - (atMs - st.runningSince));
}

export function auxNow(st, now = Date.now()) {
  if (!st) return null;
  return st.running ? auxAt(st, now) : st.base;
}

export function auxView(st, now = Date.now()) {
  if (!st) return null;
  const ms = auxNow(st, now);
  return {
    key: st.key,
    label: st.label,
    ms,
    // secondary clocks are read in whole seconds, rounded up the way a
    // stadium clock does it: 34.2s left still reads 35
    seconds: Math.ceil(ms / 1000),
    display: String(Math.ceil(ms / 1000)),
    running: st.running,
    expired: ms <= 0,
    fullMs: st.fullMs,
    presets: st.presets,
    linked: st.linked,
    enabled: st.enabled,
    autoReset: st.autoReset
  };
}
