import { toCSV } from '../util.js';
import { getSport } from '../sports/index.js';

/** Wide box score: one row per player, all stat columns for the sport. */
export function boxScoreCSV(g) {
  const sport = getSport(g.sportId);
  const statKeys = [];
  for (const t of sport.playerStatTables) for (const [k] of t.cols) if (!statKeys.includes(k)) statKeys.push(k);
  const head = ['Game', 'Date', 'Sport', 'Team', 'Side', 'Number', 'Name', 'Pos', 'Year', ...statKeys];
  const rows = [head];
  for (const p of Object.values(g.players).sort(sortPlayers)) {
    rows.push([g.meta.id, g.meta.date, g.sportName, g.teams[p.side].name, p.side,
      p.number, p.name, p.pos, p.year, ...statKeys.map((k) => p[k] ?? '')]);
  }
  return toCSV(rows);
}

/** One row per team-stat category, home vs away. */
export function teamStatsCSV(g) {
  const sport = getSport(g.sportId);
  const rows = [['Game', 'Date', 'Stat', g.teams.away.name, g.teams.home.name]];
  for (const [k, label] of sport.teamStatRows) {
    rows.push([g.meta.id, g.meta.date, label, g.teams.away[k] ?? '', g.teams.home[k] ?? '']);
  }
  return toCSV(rows);
}

/** Full audit trail — every entry with the wall-clock time it was logged. */
export function playByPlayCSV(store, gameId, g) {
  const raw = store.readEvents(gameId);
  const head = ['Seq', 'EntryTimeLocal', 'EntryTimeISO', 'Type', 'Period', 'Clock', 'Team',
    'Action', 'Operator', 'Data'];
  const rows = [head];
  const byId = new Map(g.timeline.map((t) => [t.id, t]));
  for (const e of raw) {
    const t = byId.get(e.id);
    rows.push([
      e.seq, e.tsLocal, e.ts, e.type, e.period ?? '',
      t?.clock ?? (e.clockMs != null ? msToClock(e.clockMs) : ''),
      e.team ? g.teams[e.team]?.name ?? e.team : '',
      e.action || (e.targetId ? `${e.type}->${e.targetId}` : ''),
      e.by || '',
      JSON.stringify(e.data || {})
    ]);
  }
  return toCSV(rows);
}

export function scoringCSV(g) {
  const rows = [['Period', 'Clock', 'Team', 'Type', 'Points', 'Description', 'AwayScore', 'HomeScore', 'EnteredAt']];
  for (const s of g.scoringPlays) {
    rows.push([s.periodLabel, s.clock, g.teams[s.side].name, s.kind, s.points, s.desc, s.awayScore, s.homeScore, s.tsLocal]);
  }
  return toCSV(rows);
}

/** Season totals for one team across every committed game. */
export function seasonCSV(store, teamId, sport, season) {
  const team = store.getTeam(teamId);
  if (!team) throw new Error('Unknown team');
  const bucket = team.sports?.[sport]?.season?.[season];
  if (!bucket) return toCSV([['No committed games for this team/sport/season']]);
  const sportDef = getSport(sport);
  const statKeys = [];
  for (const t of sportDef.playerStatTables) for (const [k] of t.cols) if (!statKeys.includes(k)) statKeys.push(k);

  const totals = new Map();
  const rows = [['Game', 'Date', 'Opponent', 'H/A', 'Number', 'Name', 'Pos', ...statKeys]];
  for (const [gameId, gm] of Object.entries(bucket.games)) {
    for (const p of gm.players) {
      rows.push([gameId, gm.date, gm.opponent, gm.homeAway, p.number, p.name, p.pos,
        ...statKeys.map((k) => p[k] ?? '')]);
      const key = `${p.number}|${p.name}`;
      if (!totals.has(key)) totals.set(key, { number: p.number, name: p.name, pos: p.pos, games: 0 });
      const t = totals.get(key);
      t.games++;
      for (const k of statKeys) {
        const v = p[k];
        if (typeof v === 'number') t[k] = (t[k] || 0) + v;
      }
    }
  }
  rows.push([]);
  rows.push(['SEASON TOTALS']);
  rows.push(['Games', '', '', '', 'Number', 'Name', 'Pos', ...statKeys]);
  for (const t of [...totals.values()].sort((a, b) => cmpNum(a.number, b.number))) {
    rows.push([t.games, '', '', '', t.number, t.name, t.pos, ...statKeys.map((k) => t[k] ?? '')]);
  }
  return toCSV(rows);
}

export function rosterCSV(store, teamId, sport) {
  const roster = store.getRoster(teamId, sport);
  const rows = [['Number', 'Name', 'Pos', 'Year', 'Height', 'Weight', 'Level', 'Id']];
  for (const p of roster) rows.push([p.number, p.name, p.pos || '', p.year || '', p.height || '', p.weight || '', p.level || '', p.id]);
  return toCSV(rows);
}

function sortPlayers(a, b) {
  if (a.side !== b.side) return a.side === 'away' ? -1 : 1;
  return cmpNum(a.number, b.number) || String(a.name).localeCompare(String(b.name));
}
function cmpNum(a, b) {
  const x = parseInt(a, 10), z = parseInt(b, 10);
  if (isFinite(x) && isFinite(z)) return x - z;
  if (isFinite(x) !== isFinite(z)) return isFinite(x) ? -1 : 1;
  return 0;
}
function msToClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
