import { fmtDuration } from './util.js';

/**
 * The announcer view. Different job from the operator console: nobody here is
 * entering data, they are talking, so this turns the raw log into things worth
 * saying — big plays worth calling out, milestones just reached, and the ones
 * a player is a few yards short of.
 *
 * Presentation logic only; nothing here changes a stat.
 */

const HUGE = 'huge', BIG = 'big', NOTE = 'note';
// `credit` decides which team's badge the popup carries: 'us' is the team the
// event was logged against, 'them' the opponent. A sack or an interception is
// logged on the offence but is the defence's play to celebrate.
const mk = (level, headline, detail, credit = 'us') => ({ level, headline, detail, credit });

/* ------------------------------------------------------------------ *
 * What counts as worth interrupting for                               *
 * ------------------------------------------------------------------ */

const NOTABLE = {
  football(ev, C) {
    const d = ev.data || {};
    const y = Number(d.yards) || 0;
    const turnover = d.fumbleLost ? mk(HUGE, 'FUMBLE LOST', `${C.us} lose it`) : null;
    switch (ev.action) {
      case 'pass_complete':
        if (d.td) return mk(HUGE, 'TOUCHDOWN', `${C.p(d.passer)} ${y} yd TD pass to ${C.p(d.receiver)}`);
        if (turnover) return turnover;
        if (y >= 25) return mk(BIG, 'BIG PLAY', `${C.p(d.passer)} to ${C.p(d.receiver)} for ${y}`);
        if (d.first) return null;
        return null;
      case 'rush':
        if (d.td) return mk(HUGE, 'TOUCHDOWN', `${C.p(d.rusher)} ${y} yd TD run`);
        if (turnover) return turnover;
        if (y >= 20) return mk(BIG, 'BIG RUN', `${C.p(d.rusher)} breaks off ${y}`);
        return null;
      case 'pass_int':
        return d.td
          ? mk(HUGE, 'PICK SIX', `${C.o(d.by)} takes it back ${Number(d.returnYards) || 0}`, 'them')
          : mk(HUGE, 'INTERCEPTION', `${C.o(d.by)} picks off ${C.p(d.passer)}`, 'them');
      case 'sack':
        return mk(BIG, 'SACK', `${C.o(d.by)} drops ${C.p(d.passer)} for -${Math.abs(y)}`, 'them');
      case 'fumble_recovery':
        return mk(HUGE, 'TURNOVER', d.td
          ? `${C.p(d.player)} returns the fumble ${y} for a TD`
          : `${C.p(d.player)} recovers`);
      case 'fg_good':
        return mk(HUGE, 'FIELD GOAL', `${C.p(d.kicker)} from ${d.distance} — good`);
      case 'fg_miss':
        return mk(BIG, 'FG NO GOOD', `${C.p(d.kicker)} from ${d.distance}`);
      case 'safety':
        return mk(HUGE, 'SAFETY', `${C.us} two points`);
      case 'two_pt_good':
        return mk(BIG, 'TWO-POINT CONVERSION', `${C.p(d.player)} converts`);
      case 'punt_return':
      case 'kick_return':
        if (d.td) return mk(HUGE, 'RETURN TOUCHDOWN', `${C.p(d.returner)} ${y} yards to the house`);
        if (y >= 30) return mk(BIG, 'BIG RETURN', `${C.p(d.returner)} for ${y}`);
        return null;
      case 'turnover_downs':
        return mk(BIG, 'TURNOVER ON DOWNS', `${C.us} come up short`);
      case 'penalty': {
        if (d.declined) return null;
        const on = d.player ? ` on ${C.p(d.player)}` : '';
        const yds = d.yards ? `, ${Math.abs(Number(d.yards))} yards` : '';
        // A false start every other series is noise; a 15-yarder or an
        // automatic first down changes the drive and is worth saying.
        const heavy = d.autoFirst || Math.abs(Number(d.yards) || 0) >= 15;
        return mk(heavy ? BIG : NOTE, 'PENALTY',
          `${C.us} — ${d.kind || 'penalty'}${on}${yds}${d.autoFirst ? ', automatic first down' : ''}`);
      }
      case 'timeout':
        return mk(NOTE, 'TIMEOUT', `${C.usName}${C.seq ? ` — timeout ${C.seq}` : ''}`);
      default:
        return turnover;
    }
  },

  basketball(ev, C) {
    const d = ev.data || {};
    switch (ev.action) {
      case 'fg3_made':
        return mk(BIG, 'THREE', `${C.p(d.player)} from deep${d.assist ? ` (${C.p(d.assist)})` : ''}`);
      case 'fg2_made':
        if (d.andOne) return mk(BIG, 'AND-ONE', `${C.p(d.player)} through contact`);
        if (d.kind === 'Dunk') return mk(BIG, 'DUNK', `${C.p(d.player)}`);
        return null;
      case 'block': return mk(BIG, 'BLOCK', `${C.p(d.player)} rejects it`);
      case 'steal': return mk(BIG, 'STEAL', `${C.p(d.player)} takes it away`);
      case 'foul':
        if (d.kind === 'Technical') return mk(BIG, 'TECHNICAL', `${C.p(d.player)}`);
        if (d.kind === 'Flagrant') return mk(BIG, 'FLAGRANT', `${C.p(d.player)}`);
        return null;   // ordinary fouls are far too frequent to interrupt for
      case 'timeout': return mk(NOTE, 'TIMEOUT', `${C.usName}${C.seq ? ` — timeout ${C.seq}` : ''}`);
      default: return null;
    }
  },

  hockey(ev, C) {
    const d = ev.data || {};
    if (ev.action === 'goal') {
      const s = d.strength && d.strength !== 'EV' ? ` (${d.strength})` : '';
      return mk(HUGE, 'GOAL', `${C.p(d.scorer)}${s}${d.assist1 ? ` from ${C.p(d.assist1)}` : ' unassisted'}`);
    }
    if (ev.action === 'penalty') return mk(BIG, 'PENALTY', `${C.p(d.player)} — ${d.kind}, ${d.minutes} min`);
    if (ev.action === 'timeout') return mk(NOTE, 'TIMEOUT', `${C.usName}${C.seq ? ` — timeout ${C.seq}` : ''}`);
    return null;
  },

  soccer(ev, C) {
    const d = ev.data || {};
    if (ev.action === 'goal') return mk(HUGE, 'GOAL', `${C.p(d.scorer)}${d.assist ? ` (${C.p(d.assist)})` : ''} — ${d.kind || 'open play'}`);
    if (ev.action === 'red') return mk(HUGE, 'RED CARD', `${C.p(d.player)}`);
    if (ev.action === 'yellow') return mk(BIG, 'YELLOW', `${C.p(d.player)}`);
    if (ev.action === 'pk_miss') return mk(BIG, 'PENALTY MISSED', `${C.p(d.player)}`);
    return null;
  },

  lacrosse(ev, C) {
    const d = ev.data || {};
    if (ev.action === 'goal') {
      const s = d.strength && d.strength !== 'EV' ? ` (${d.strength})` : '';
      return mk(HUGE, 'GOAL', `${C.p(d.scorer)}${s}${d.assist ? ` from ${C.p(d.assist)}` : ''}`);
    }
    if (ev.action === 'penalty') {
      return mk(BIG, 'PENALTY', `${C.p(d.player)} — ${d.kind}${d.seconds ? `, ${d.seconds}s` : ''}`);
    }
    if (ev.action === 'timeout') return mk(NOTE, 'TIMEOUT', `${C.usName}${C.seq ? ` — timeout ${C.seq}` : ''}`);
    return null;
  },

  baseball(ev, C) {
    const d = ev.data || {};
    const rbi = Number(d.rbi) || 0;
    if (ev.action === 'home_run') return mk(HUGE, 'HOME RUN', `${C.p(d.batter)}${rbi > 1 ? `, ${rbi} runs` : ''}`);
    if (ev.action === 'triple') return mk(BIG, 'TRIPLE', `${C.p(d.batter)}`);
    if (ev.action === 'double' && rbi) return mk(BIG, 'RBI DOUBLE', `${C.p(d.batter)}, ${rbi} in`);
    if (rbi >= 2) return mk(BIG, `${rbi} RBI`, `${C.p(d.batter)}`);
    if (ev.action === 'double_play') return mk(BIG, 'DOUBLE PLAY', 'Two down');
    return null;
  }
};

/* ------------------------------------------------------------------ *
 * Milestones — the numbers an announcer wants the moment they land    *
 * ------------------------------------------------------------------ */

const MILESTONES = {
  football: [
    { stat: 'rush_yds', at: [100, 150, 200], unit: 'rushing yards' },
    { stat: 'pass_yds', at: [200, 300, 400], unit: 'passing yards' },
    { stat: 'rec_yds', at: [100, 150], unit: 'receiving yards' },
    { stat: 'pass_td', at: [3, 4, 5], unit: 'passing TDs' },
    { stat: 'scored_td', at: [2, 3, 4], unit: 'touchdowns' },
    { stat: 'tackles_total', at: [10, 15, 20], unit: 'tackles' },
    { stat: 'sacks', at: [2, 3], unit: 'sacks' },
    { stat: 'all_purpose', at: [150, 200], unit: 'all-purpose yards' }
  ],
  basketball: [
    { stat: 'pts', at: [10, 20, 30, 40], unit: 'points' },
    { stat: 'reb', at: [10, 15], unit: 'rebounds' },
    { stat: 'ast', at: [5, 10], unit: 'assists' },
    { stat: 'fg3m', at: [3, 5, 7], unit: 'threes' }
  ],
  hockey: [
    { stat: 'g', at: [2, 3], unit: 'goals' },
    { stat: 'pts', at: [3, 4], unit: 'points' },
    { stat: 'sv', at: [20, 30, 40], unit: 'saves' }
  ],
  soccer: [
    { stat: 'g', at: [2, 3], unit: 'goals' },
    { stat: 'saves', at: [5, 10], unit: 'saves' }
  ],
  lacrosse: [
    { stat: 'g', at: [3, 5], unit: 'goals' },
    { stat: 'pts', at: [5, 7], unit: 'points' },
    { stat: 'saves', at: [10, 15], unit: 'saves' },
    { stat: 'gb', at: [5, 10], unit: 'ground balls' }
  ],
  baseball: [
    { stat: 'h', at: [3, 4], unit: 'hits' },
    { stat: 'rbi', at: [3, 4], unit: 'RBI' },
    { stat: 'k', at: [8, 10, 12], unit: 'strikeouts' }
  ]
};

/** How close counts as "coming up" — announcers like a heads-up. */
const WATCH_WINDOW = { rush_yds: 25, pass_yds: 40, rec_yds: 25, all_purpose: 30, sv: 5, saves: 3 };

export function announcerView(store, gameId, g) {
  const sport = g.sportId;
  const events = store.effectiveEvents(gameId);
  const players = Object.values(g.players);
  const byId = new Map(players.map((p) => [`${p.side}:${p.playerId}`, p]));
  const roster = { home: new Map(), away: new Map() };
  for (const side of ['home', 'away']) {
    for (const p of g.rosters[side] || []) roster[side].set(p.id, p);
  }
  const nameOf = (side, id) => {
    const r = roster[side].get(id);
    if (r) return r.number ? `#${r.number} ${r.name}` : r.name;
    return byId.get(`${side}:${id}`)?.name || '';
  };

  /* ---- notable plays ---- */
  const rule = NOTABLE[sport];
  const notables = [];
  // how many times each team has done a given thing, for "timeout 2"
  const seqCount = new Map();
  for (const ev of events) {
    if (ev.type !== 'stat' || !ev.action || !rule) continue;
    const other = ev.team === 'home' ? 'away' : 'home';
    const countKey = `${ev.team}:${ev.action}`;
    seqCount.set(countKey, (seqCount.get(countKey) || 0) + 1);
    const C = {
      us: g.teams[ev.team].abbrev,
      them: g.teams[other].abbrev,
      usName: g.teams[ev.team].shortName || g.teams[ev.team].name,
      seq: seqCount.get(countKey),
      p: (id) => nameOf(ev.team, id),
      o: (id) => nameOf(other, id)
    };
    let n = null;
    try { n = rule(ev, C); } catch { n = null; }
    if (!n) continue;
    const credited = n.credit === 'them' ? other : ev.team;
    const line = g.timeline.find((t) => t.id === ev.id) || {};
    notables.push({
      id: ev.id,
      level: n.level,
      headline: n.headline,
      detail: n.detail,
      team: credited,
      teamAbbrev: g.teams[credited].abbrev,
      teamName: g.teams[credited].shortName || g.teams[credited].name,
      color: g.teams[credited].primaryColor,
      period: ev.period,
      periodLabel: line.periodLabel || '',
      clock: line.clock || '',
      ts: ev.ts,
      tsLocal: ev.tsLocal
    });
  }
  notables.reverse(); // newest first

  /* ---- milestones reached, and ones coming up ---- */
  const defs = MILESTONES[sport] || [];
  const milestones = [], watch = [];
  for (const p of players) {
    for (const def of defs) {
      const v = Number(p[def.stat]) || 0;
      const hit = [...def.at].filter((t) => v >= t).pop();
      if (hit != null) {
        milestones.push({
          key: `${p.side}:${p.playerId}:${def.stat}:${hit}`,
          side: p.side, team: g.teams[p.side].abbrev,
          number: p.number, name: p.name,
          stat: def.stat, value: v, threshold: hit,
          text: `${p.name} — ${v} ${def.unit}`
        });
      }
      const next = def.at.find((t) => v < t);
      if (next != null && v > 0) {
        const need = next - v;
        const yardage = WATCH_WINDOW[def.stat] != null;
        // Yardage gets a generous window; counting stats only when one away and
        // the player is already on the board, or it reads as filler.
        const worth = yardage ? need <= WATCH_WINDOW[def.stat] : (need === 1 && v >= next - 1);
        if (worth) {
          watch.push({
            side: p.side, team: g.teams[p.side].abbrev,
            number: p.number, name: p.name,
            stat: def.stat, value: v, need, threshold: next, yardage,
            text: `${p.name} needs ${need} for ${next} ${def.unit}`
          });
        }
      }
    }
  }
  // yardage chases read better on air than count chases, so lead with them
  watch.sort((a, b) => (b.yardage - a.yardage) || (a.need - b.need));

  /* ---- storylines: the context that makes a broadcast sound informed ---- */
  const storylines = [];
  const H = g.teams.home, A = g.teams.away;
  const lead = Math.abs(H.points - A.points);
  if (g.scoringPlays.length) {
    for (const side of ['home', 'away']) {
      const d = g.droughts[side];
      if (d.ms > 6 * 60000) {
        storylines.push({
          kind: 'drought',
          text: `${g.teams[side].shortName || g.teams[side].name} without a score for ${d.display}`
        });
      }
    }
    const run = g.runs.current;
    if (run && run.points >= (sport === 'basketball' ? 8 : 10)) {
      storylines.push({ kind: 'run', text: `${g.teams[run.side].abbrev} on a ${run.points}-0 run` });
    }
  }
  if (sport === 'football') {
    const topGap = Math.abs((H.possession_ms || 0) - (A.possession_ms || 0));
    if (topGap > 5 * 60000) {
      const more = (H.possession_ms || 0) > (A.possession_ms || 0) ? 'home' : 'away';
      storylines.push({
        kind: 'top',
        text: `${g.teams[more].abbrev} holding the ball ${fmtDuration(topGap)} longer — ${H.top} to ${A.top}`
      });
    }
    for (const side of ['home', 'away']) {
      const t = g.teams[side];
      if (t.third_att >= 4) {
        if (t.third_pct >= 60) storylines.push({ kind: '3rd', text: `${t.abbrev} converting ${t.third_line} on third down` });
        else if (t.third_pct <= 25) storylines.push({ kind: '3rd', text: `${t.abbrev} just ${t.third_line} on third down` });
      }
      if (t.turnovers >= 3) storylines.push({ kind: 'to', text: `${t.abbrev} have turned it over ${t.turnovers} times` });
    }
  }
  if (lead === 0 && g.scoringPlays.length) storylines.push({ kind: 'tied', text: `Tied at ${H.points}` });

  return {
    notables: notables.slice(0, 40),
    milestones,
    watch: watch.slice(0, 6),
    storylines
  };
}
