import { getSport } from './sports/index.js';
import { clockFromEvents, clockNow, clockView, elapsedGameMs, periodLabel,
  auxClockFromEvents, auxView } from './clock.js';
import { fmtClock, fmtDuration } from './util.js';

const OTHER = { home: 'away', away: 'home' };

/**
 * Replay a game's event log into a complete derived state.
 * Pure function of (meta, events, rosters) — no mutation of stored data — so it
 * is safe to call on every request and always reflects the log exactly.
 */
export function deriveGame(store, gameId, { now = Date.now() } = {}) {
  const meta = store.getGame(gameId);
  if (!meta) throw new Error('No such game');
  const sport = getSport(meta.sport);
  const events = store.effectiveEvents(gameId);
  const rawEvents = store.readEvents(gameId);

  const rosters = {
    home: indexRoster(store.getRoster(meta.homeTeamId, meta.sport)),
    away: indexRoster(store.getRoster(meta.awayTeamId, meta.sport))
  };

  const clockState = clockFromEvents(events, sport, meta.settings || {});
  const liveClockMs = clockNow(clockState, now);
  const auxState = auxClockFromEvents(events, sport, meta.settings || {});

  const acc = {
    teams: { home: sport.initTeam(), away: sport.initTeam() },
    players: {},
    extra: sport.initExtra ? sport.initExtra() : {},
    scoringPlays: [],
    timeline: [],
    runs: { current: null, best: { home: 0, away: 0 } },
    lastScore: { home: null, away: null }
  };

  const nameOf = (side, pid) => {
    const p = rosters[side]?.byId.get(pid);
    return p ? (p.name || `#${p.number}`) : (pid ? String(pid) : '');
  };

  const P = (side, pid) => {
    if (!pid) return null;
    const key = `${side}:${pid}`;
    if (!acc.players[key]) {
      const r = rosters[side]?.byId.get(pid);
      acc.players[key] = {
        key, side, playerId: pid,
        number: r?.number ?? '',
        name: r?.name ?? String(pid),
        pos: r?.pos ?? '',
        year: r?.year ?? '',
        ...sport.initPlayer()
      };
    }
    return acc.players[key];
  };

  const T = (side) => acc.teams[side];

  let curElapsed = 0;

  const ctx = {
    P, T, nameOf, meta, rosters,
    get period() { return curPeriod; },
    get elapsedMs() { return curElapsed; },
    score(side, pts, kind, ev, desc) {
      const t = acc.teams[side];
      t.points += pts;
      const per = ev.period || 1;
      t.byPeriod[per] = (t.byPeriod[per] || 0) + pts;
      acc.scoringPlays.push({
        side, points: pts, kind,
        period: per,
        periodLabel: periodLabel(clockState, per),
        clock: fmtClock(ev.clockMs ?? 0),
        clockMs: ev.clockMs ?? null,
        elapsedMs: curElapsed,
        ts: ev.ts, tsLocal: ev.tsLocal,
        desc: desc || kind,
        homeScore: acc.teams.home.points,
        awayScore: acc.teams.away.points,
        eventId: ev.id
      });
      acc.lastScore[side] = { elapsedMs: curElapsed, ts: ev.ts, period: per, clockMs: ev.clockMs ?? null };
      // scoring run bookkeeping
      const r = acc.runs.current;
      if (r && r.side === side) r.points += pts;
      else acc.runs.current = { side, points: pts, startElapsed: curElapsed };
      const cur = acc.runs.current;
      if (cur.points > acc.runs.best[side]) acc.runs.best[side] = cur.points;
    }
  };

  let curPeriod = 1;
  let possession = null;
  let lastElapsed = 0;

  for (const ev of events) {
    curPeriod = ev.period || curPeriod;
    const evClock = ev.clockMs != null ? ev.clockMs : (clockState.countsDown ? clockState.lengthMs : 0);
    curElapsed = sport.hasClock === false ? 0 : elapsedGameMs(clockState, evClock, curPeriod);

    // Attribute the time since the previous event to whoever had the ball.
    if (curElapsed > lastElapsed) {
      if (possession) acc.teams[possession].possession_ms =
        (acc.teams[possession].possession_ms || 0) + (curElapsed - lastElapsed);
      lastElapsed = curElapsed;
    } else if (curElapsed < lastElapsed) {
      lastElapsed = curElapsed; // clock was corrected backwards
    }

    if (ev.type === 'stat' && ev.action) {
      sport.apply(acc, ev, ctx);
      const line = describe(sport, ev, nameOf, clockState);
      if (line) acc.timeline.push(line);
    } else if (ev.type === 'possession') {
      possession = ev.team;
    } else if (ev.type === 'situation_set') {
      // Shared across sports and writable by both the operator and the feed;
      // whoever wrote last wins, which makes a manual correction stick.
      applySituation(acc, ev.data || {});
    } else if (ev.type === 'score_official') {
      acc.officialScore = { home: ev.data?.home ?? null, away: ev.data?.away ?? null, at: ev.tsLocal };
    } else if (ev.type && ev.type !== 'stat') {
      const line = describeSystem(ev, clockState, meta);
      if (line) acc.timeline.push(line);
    }

    // football (and any sport with explicit down/distance) drives possession
    // from the play flow itself
    if (acc.extra?.situation?.possession) possession = acc.extra.situation.possession;
  }

  // Time since the last event up to "now", if the clock is still running.
  if (clockState.running && sport.hasClock !== false) {
    const nowElapsed = elapsedGameMs(clockState, liveClockMs, clockState.period);
    if (nowElapsed > lastElapsed && possession) {
      acc.teams[possession].possession_ms =
        (acc.teams[possession].possession_ms || 0) + (nowElapsed - lastElapsed);
    }
    curElapsed = Math.max(curElapsed, nowElapsed);
  }

  sport.finalize(acc);

  const cv = clockView(clockState, now);
  const homeT = acc.teams.home, awayT = acc.teams.away;

  // In baseball the team at bat owns the runners: away bats the top half.
  const battingSide = acc.extra.half === 'bottom' ? 'home' : 'away';
  const basesView = (b) => {
    const out = { first: null, second: null, third: null };
    for (const base of ['first', 'second', 'third']) {
      const v = b?.[base];
      if (!v) continue;
      out[base] = v === true
        ? { occupied: true, playerId: null, name: '', number: '' }
        : { occupied: true, playerId: v, name: nameOf(battingSide, v), number: rosters[battingSide]?.byId.get(v)?.number ?? '' };
    }
    const code = ['first', 'second', 'third'].map((k) => (out[k] ? '1' : '0')).join('');
    const names = ['first', 'second', 'third'].filter((k) => out[k]);
    return {
      ...out, code,
      occupied: names.length,
      display: names.length
        ? names.map((k) => ({ first: '1st', second: '2nd', third: '3rd' }[k])).join(', ')
        : 'Bases empty',
      loaded: code === '111',
      battingSide
    };
  };

  const droughts = {};
  for (const side of ['home', 'away']) {
    const ls = acc.lastScore[side];
    const since = ls ? Math.max(0, curElapsed - ls.elapsedMs) : curElapsed;
    droughts[side] = {
      ms: since,
      display: fmtDuration(since),
      lastScore: ls ? {
        periodLabel: periodLabel(clockState, ls.period),
        clock: fmtClock(ls.clockMs ?? 0),
        tsLocal: ls.ts
      } : null
    };
  }

  return {
    meta,
    sportId: sport.id,
    sportName: sport.name,
    clock: cv,
    auxClock: auxView(auxState, now),
    updatedAt: new Date().toISOString(),
    teams: {
      home: { ...homeT, id: meta.homeTeamId, name: meta.homeName, ...teamBrand(store, meta.homeTeamId) },
      away: { ...awayT, id: meta.awayTeamId, name: meta.awayName, ...teamBrand(store, meta.awayTeamId) }
    },
    players: acc.players,
    rosters: { home: rosters.home.list, away: rosters.away.list },
    situation: {
      ...(acc.extra.situation || {}),
      possession,
      outs: acc.extra.outs,
      half: acc.extra.half,
      balls: acc.extra.balls,
      strikes: acc.extra.strikes,
      bases: basesView(acc.extra.bases),
      elapsedMs: curElapsed,
      elapsedDisplay: fmtDuration(curElapsed)
    },
    officialScore: acc.officialScore || null,
    scoringPlays: acc.scoringPlays,
    timeline: acc.timeline.slice(-200).reverse(),
    leaders: computeLeaders(sport, acc),
    droughts,
    runs: acc.runs,
    counts: { events: rawEvents.length, effective: events.length },
    lastEvent: events.length ? events[events.length - 1] : null
  };
}

function teamBrand(store, teamId) {
  const t = store.getTeam(teamId);
  if (!t) return { abbrev: String(teamId || '').slice(0, 3).toUpperCase(), shortName: teamId, primaryColor: '#333', mascot: '' };
  return { abbrev: t.abbrev, shortName: t.shortName, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor, mascot: t.mascot };
}

function indexRoster(list) {
  const byId = new Map();
  for (const p of list) byId.set(p.id, p);
  return { list, byId };
}

/** Merge a situation_set payload into the accumulator. */
function applySituation(acc, d) {
  acc.extra.situation = acc.extra.situation || {};
  for (const k of ['down', 'distance', 'ballOn', 'possession']) {
    if (d[k] !== undefined) acc.extra.situation[k] = d[k];
  }
  for (const k of ['half', 'outs', 'balls', 'strikes']) {
    if (d[k] !== undefined) acc.extra[k] = d[k];
  }
  if (d.bases !== undefined) {
    acc.extra.bases = normalizeBases(d.bases);
  }
}

/** Bases arrive as booleans from a feed or as player ids from manual entry. */
function normalizeBases(b) {
  const out = { first: null, second: null, third: null };
  if (!b) return out;
  for (const base of ['first', 'second', 'third']) {
    const v = b[base];
    if (v === true) out[base] = true;
    else if (v === false || v == null || v === '') out[base] = null;
    else out[base] = v; // player id
  }
  return out;
}

export function computeLeaders(sport, acc, topN = 5) {
  const out = {};
  for (const cat of sport.leaderCategories) {
    const rows = Object.values(acc.players)
      .filter((p) => (p[cat.sort] || 0) > 0)
      .sort((a, b) => (b[cat.sort] || 0) - (a[cat.sort] || 0))
      .slice(0, topN)
      .map((p, i) => ({
        rank: i + 1, side: p.side, number: p.number, name: p.name, pos: p.pos,
        value: p[cat.sort] || 0, line: cat.line(p), playerId: p.playerId
      }));
    out[cat.key] = { label: cat.label, rows };
  }
  // per-team leaders, which is what most GT lower thirds actually want
  out._byTeam = {};
  for (const side of ['home', 'away']) {
    out._byTeam[side] = {};
    for (const cat of sport.leaderCategories) {
      const rows = Object.values(acc.players)
        .filter((p) => p.side === side && (p[cat.sort] || 0) > 0)
        .sort((a, b) => (b[cat.sort] || 0) - (a[cat.sort] || 0))
        .slice(0, topN)
        .map((p, i) => ({ rank: i + 1, number: p.number, name: p.name, pos: p.pos, value: p[cat.sort] || 0, line: cat.line(p) }));
      out._byTeam[side][cat.key] = { label: cat.label, rows };
    }
  }
  return out;
}

/** Human-readable play-by-play line built generically from the sport palette. */
function describe(sport, ev, nameOf, clockState) {
  const action = findAction(sport, ev.action);
  if (!action) return null;
  const d = ev.data || {};
  const other = OTHER[ev.team];
  const parts = [];
  for (const f of action.fields || []) {
    const v = d[f.name];
    if (v == null || v === '' || v === false) continue;
    if (f.type === 'player') parts.push(`${f.label}: ${nameOf(ev.team, v)}`);
    else if (f.type === 'player_opp') parts.push(`${f.label}: ${nameOf(other, v)}`);
    else if (f.type === 'players') parts.push(`${f.label}: ${(v || []).map((x) => nameOf(ev.team, x)).join(', ')}`);
    else if (f.type === 'players_opp') parts.push(`${f.label}: ${(v || []).map((x) => nameOf(other, x)).join(', ')}`);
    else if (f.type === 'toggle') parts.push(f.label);
    else parts.push(`${f.label}: ${v}`);
  }
  return {
    id: ev.id, seq: ev.seq, type: 'stat', team: ev.team, action: ev.action,
    label: action.label,
    period: ev.period, periodLabel: periodLabel(clockState, ev.period || 1),
    clock: fmtClock(ev.clockMs ?? 0),
    ts: ev.ts, tsLocal: ev.tsLocal, by: ev.by || '',
    text: parts.join(' · '),
    corrected: !!ev.corrected
  };
}

function describeSystem(ev, clockState, meta) {
  const d = ev.data || {};
  const map = {
    clock_start: 'Clock started',
    clock_stop: 'Clock stopped',
    clock_set: `Clock set to ${fmtClock(d.ms)}`,
    period_set: `${periodLabel(clockState, d.period)} ${clockState.label}`,
    possession: `Possession: ${ev.team === 'home' ? meta.homeName : meta.awayName}`,
    game_start: 'Game start',
    game_end: 'Final',
    scorebot: `Scorebot sync`,
    lineup: 'Lineup set'
  };
  const text = map[ev.type];
  if (!text) return null;
  return {
    id: ev.id, seq: ev.seq, type: ev.type, team: ev.team || null,
    label: text, text: '',
    period: ev.period, periodLabel: periodLabel(clockState, ev.period || 1),
    clock: fmtClock(ev.clockMs ?? 0), ts: ev.ts, tsLocal: ev.tsLocal, by: ev.by || ''
  };
}

export function findAction(sport, key) {
  for (const g of sport.palette) {
    for (const a of g.actions) if (a.key === key) return { ...a, group: g.group };
  }
  return null;
}
