import fs from 'node:fs';
import path from 'node:path';
import { xmlEscape, fmtDuration } from './util.js';
import { getSport } from './sports/index.js';

/**
 * vMix Data Sources consume XML by picking a *repeating element* and mapping its
 * children to columns. Every document here is therefore a flat list of <Row>
 * elements with XML-safe PascalCase children — bind them straight to GT fields.
 */
function doc(root, rows, attrs = {}) {
  const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${xmlEscape(v)}"`).join('');
  const body = rows.map((r) => {
    const cells = Object.entries(r)
      .map(([k, v]) => `    <${k}>${xmlEscape(fmtVal(v))}</${k}>`)
      .join('\n');
    return `  <Row>\n${cells}\n  </Row>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${root}${a}>\n${body}\n</${root}>\n`;
}

function fmtVal(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(2));
  return String(v);
}

const key = (s) => String(s).replace(/[^A-Za-z0-9]/g, '');

/** One-row headline document: scores, clock, situation, branding. */
export function scoreboardXml(g) {
  const h = g.teams.home, a = g.teams.away;
  const sit = g.situation || {};
  // Baseball and similar have no game clock; emit blanks rather than a fake 0:00
  const hasClock = getSport(g.sportId).hasClock !== false;
  const row = {
    GameId: g.meta.id,
    Sport: g.sportName,
    Date: g.meta.date,
    Venue: g.meta.venue,
    Level: g.meta.level,
    Status: g.meta.status,
    Period: g.clock.period,
    PeriodLabel: g.clock.periodLabel,
    Clock: hasClock ? g.clock.clock : '',
    ClockRunning: hasClock ? g.clock.running : '',
    HomeName: h.name, HomeShort: h.shortName, HomeAbbrev: h.abbrev, HomeMascot: h.mascot,
    HomeColor: h.primaryColor, HomeScore: h.points,
    AwayName: a.name, AwayShort: a.shortName, AwayAbbrev: a.abbrev, AwayMascot: a.mascot,
    AwayColor: a.primaryColor, AwayScore: a.points,
    ScoreLine: `${a.abbrev} ${a.points} - ${h.abbrev} ${h.points}`,
    LeaderAbbrev: h.points === a.points ? 'TIE' : (h.points > a.points ? h.abbrev : a.abbrev),
    Margin: Math.abs(h.points - a.points),
    Possession: sit.possession || '',
    PossessionAbbrev: sit.possession ? g.teams[sit.possession].abbrev : '',
    HomeTOP: fmtDuration(h.possession_ms || 0),
    AwayTOP: fmtDuration(a.possession_ms || 0),
    HomeDrought: g.droughts.home.display,
    AwayDrought: g.droughts.away.display,
    Updated: g.updatedAt
  };
  // Secondary clock: play clock (football) or shot clock (basketball).
  // Both are published under generic names as well as their sport-specific one,
  // so a shared GT template can bind once and work for either sport.
  if (g.auxClock) {
    const ac = g.auxClock;
    row.AuxClock = ac.enabled ? ac.display : '';
    row.AuxClockLabel = ac.label;
    row.AuxClockRunning = ac.running;
    row.AuxClockExpired = ac.expired;
    row.AuxClockVisible = ac.enabled;
    row[ac.key === 'shotClock' ? 'ShotClock' : 'PlayClock'] = ac.enabled ? ac.display : '';
    row[ac.key === 'shotClock' ? 'ShotClockRunning' : 'PlayClockRunning'] = ac.running;
  }

  // sport-specific situation fields
  if (sit.down != null) {
    row.Down = sit.down;
    row.Distance = sit.distance;
    row.DownDistance = `${ordinal(sit.down)} & ${sit.distance === 0 ? 'Goal' : sit.distance}`;
    row.BallOn = sit.ballOn ?? '';
  }
  if (getSport(g.sportId).hasCount) {
    row.Outs = sit.outs ?? 0;
    row.Balls = sit.balls ?? 0;
    row.Strikes = sit.strikes ?? 0;
    row.Count = `${sit.balls ?? 0}-${sit.strikes ?? 0}`;
    row.Half = sit.half || '';
    row.HalfArrow = sit.half === 'bottom' ? 'BOT' : 'TOP';
    row.InningHalf = `${sit.half === 'bottom' ? 'BOT' : 'TOP'} ${g.clock.periodLabel}`;
    const b = sit.bases || {};
    row.BasesCode = b.code || '000';
    row.BasesLoaded = !!b.loaded;
    row.RunnersOn = b.occupied ?? 0;
    row.BasesDisplay = b.display || 'Bases empty';
    row.RunnerFirst = b.first?.name || '';
    row.RunnerSecond = b.second?.name || '';
    row.RunnerThird = b.third?.name || '';
    row.AtBatTeam = b.battingSide ? g.teams[b.battingSide].abbrev : '';
  }
  // Official scoreboard score when a feed supplies it, kept beside the score
  // derived from logged plays so a mismatch is visible on air.
  if (g.officialScore) {
    row.OfficialHomeScore = g.officialScore.home ?? '';
    row.OfficialAwayScore = g.officialScore.away ?? '';
    row.ScoreMismatch = (g.officialScore.home != null && g.officialScore.home !== h.points) ||
                        (g.officialScore.away != null && g.officialScore.away !== a.points);
  }
  // Counting stats the scoreboard keeps itself — shots on goal, corners,
  // saves. Separate from the logged totals so a title can bind whichever the
  // crew trusts for that sport.
  if (g.boardStats) {
    for (const [side, b] of [['Home', g.boardStats.home], ['Away', g.boardStats.away]]) {
      row[`Board${side}SOG`] = b.sog ?? '';
      row[`Board${side}Corners`] = b.corners ?? '';
      row[`Board${side}Saves`] = b.saves ?? '';
    }
  }
  // score by period
  for (let p = 1; p <= Math.max(g.clock.periodCount, g.clock.period); p++) {
    row[`HomeP${p}`] = h.byPeriod?.[p] ?? 0;
    row[`AwayP${p}`] = a.byPeriod?.[p] ?? 0;
  }
  return doc('Scoreboard', [row], { generated: g.updatedAt });
}

/** One row per team-stat category — ideal for a side-by-side comparison GT. */
export function teamStatsXml(g) {
  const sport = getSport(g.sportId);
  const rows = sport.teamStatRows.map(([k, label]) => ({
    Stat: label,
    Key: k,
    Home: g.teams.home[k] ?? '',
    Away: g.teams.away[k] ?? '',
    HomeName: g.teams.home.abbrev,
    AwayName: g.teams.away.abbrev
  }));
  return doc('TeamStats', rows, { generated: g.updatedAt });
}

/** Flat wide document: every team stat as its own Home / Away prefixed column. */
export function teamStatsFlatXml(g) {
  const sport = getSport(g.sportId);
  const row = { GameId: g.meta.id, Updated: g.updatedAt };
  for (const [k, label] of sport.teamStatRows) {
    row['Home' + key(label)] = g.teams.home[k] ?? '';
    row['Away' + key(label)] = g.teams.away[k] ?? '';
  }
  return doc('TeamStatsFlat', [row], { generated: g.updatedAt });
}

/**
 * One row per player. `cat` selects a stat table (passing, rushing, box, ...);
 * omit it to get every player with the union of all columns.
 */
export function playersXml(g, { side = null, cat = null, min = 1, limit = 100, sort = null } = {}) {
  const sport = getSport(g.sportId);
  const table = cat ? sport.playerStatTables.find((t) => t.key === cat) : null;
  let players = Object.values(g.players);
  if (side) players = players.filter((p) => p.side === side);
  if (table) {
    const full = sport.playerStatTables.find((t) => t.key === cat);
    players = players.filter((p) => (full.when ? full.when(p) : true));
  }
  const sortKey = sort || (table ? table.cols[0][0] : null);
  if (sortKey) players.sort((a, b) => (num(b[sortKey]) - num(a[sortKey])));
  players = players.filter((p) => !sortKey || num(p[sortKey]) >= 0).slice(0, limit);

  const cols = table ? table.cols : null;
  const rows = players.map((p, i) => {
    const r = {
      Rank: i + 1,
      Side: p.side,
      Team: g.teams[p.side].abbrev,
      TeamName: g.teams[p.side].name,
      Number: p.number,
      Name: p.name,
      FirstName: String(p.name).split(' ')[0],
      LastName: String(p.name).split(' ').slice(1).join(' '),
      NumberName: `#${p.number} ${p.name}`,
      Pos: p.pos,
      Year: p.year
    };
    if (cols) {
      for (const [k, label] of cols) r[key(label) || key(k)] = p[k] ?? '';
      r.StatLine = cols.map(([k, label]) => `${p[k] ?? 0} ${label}`).join('  ');
    } else {
      for (const [k, v] of Object.entries(p)) {
        if (['key', 'side', 'playerId', 'number', 'name', 'pos', 'year'].includes(k)) continue;
        if (typeof v === 'object') continue;
        r[key(k)] = v;
      }
    }
    return r;
  });
  return doc('Players', rows, { generated: g.updatedAt, category: cat || 'all', side: side || 'both' });
}

/** Broadcast leader boards, e.g. top 3 passers. */
export function leadersXml(g, { cat = null, side = null, limit = 5 } = {}) {
  const src = side ? g.leaders._byTeam[side] : g.leaders;
  const cats = cat ? [cat] : Object.keys(src).filter((k) => !k.startsWith('_'));
  const rows = [];
  for (const c of cats) {
    const entry = src[c];
    if (!entry) continue;
    for (const r of entry.rows.slice(0, limit)) {
      rows.push({
        Category: entry.label,
        CategoryKey: c,
        Rank: r.rank,
        Side: r.side || side || '',
        Team: r.side ? g.teams[r.side].abbrev : (side ? g.teams[side].abbrev : ''),
        Number: r.number,
        Name: r.name,
        NumberName: `#${r.number} ${r.name}`,
        Pos: r.pos,
        Value: r.value,
        StatLine: r.line
      });
    }
  }
  return doc('Leaders', rows, { generated: g.updatedAt });
}

export function scoringXml(g) {
  const rows = g.scoringPlays.map((s, i) => ({
    Index: i + 1,
    Side: s.side,
    Team: g.teams[s.side].abbrev,
    TeamName: g.teams[s.side].name,
    Period: s.period,
    PeriodLabel: s.periodLabel,
    Clock: s.clock,
    Kind: s.kind,
    Points: s.points,
    Description: s.desc,
    HomeScore: s.homeScore,
    AwayScore: s.awayScore,
    ScoreLine: `${g.teams.away.abbrev} ${s.awayScore} - ${g.teams.home.abbrev} ${s.homeScore}`,
    Time: s.tsLocal
  }));
  return doc('Scoring', rows, { generated: g.updatedAt });
}

export function playsXml(g, { n = 12 } = {}) {
  const rows = g.timeline.slice(0, n).map((t, i) => ({
    Index: i + 1,
    Side: t.team || '',
    Team: t.team ? g.teams[t.team].abbrev : '',
    Period: t.period ?? '',
    PeriodLabel: t.periodLabel ?? '',
    Clock: t.clock,
    Action: t.label,
    Detail: t.text,
    Text: `${t.label}${t.text ? ' — ' + t.text : ''}`,
    Time: t.tsLocal
  }));
  return doc('Plays', rows, { generated: g.updatedAt });
}

export function rosterXml(g, side) {
  const rows = (g.rosters[side] || []).map((p) => ({
    Side: side, Team: g.teams[side].abbrev,
    Number: p.number, Name: p.name,
    NumberName: `#${p.number} ${p.name}`,
    Pos: p.pos || '', Year: p.year || '',
    Height: p.height || '', Weight: p.weight || ''
  }));
  return doc('Roster', rows, { generated: g.updatedAt });
}

/** Everything in one document, for setups that prefer a single data source. */
export function allXml(g) {
  const parts = [
    scoreboardXml(g), teamStatsXml(g), leadersXml(g), scoringXml(g), playsXml(g)
  ].map((x) => x.replace(/^<\?xml[^>]*\?>\s*/, ''));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Game id="${xmlEscape(g.meta.id)}" generated="${xmlEscape(g.updatedAt)}">\n${parts.join('\n')}</Game>\n`;
}

export const XML_VIEWS = {
  scoreboard: (g) => scoreboardXml(g),
  teamstats: (g) => teamStatsXml(g),
  teamstatsflat: (g) => teamStatsFlatXml(g),
  players: (g, q) => playersXml(g, q),
  leaders: (g, q) => leadersXml(g, q),
  scoring: (g) => scoringXml(g),
  plays: (g, q) => playsXml(g, q),
  roster: (g, q) => rosterXml(g, q.side || 'home'),
  all: (g) => allXml(g)
};

/** Mirror the standard views to disk for vMix file-based data sources. */
export function writeXmlFiles(store, g) {
  const dir = path.join(store.dirs.vmix, g.meta.id);
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    'scoreboard.xml': scoreboardXml(g),
    'teamstats.xml': teamStatsXml(g),
    'teamstats-flat.xml': teamStatsFlatXml(g),
    'leaders.xml': leadersXml(g),
    'scoring.xml': scoringXml(g),
    'plays.xml': playsXml(g),
    'players-home.xml': playersXml(g, { side: 'home' }),
    'players-away.xml': playersXml(g, { side: 'away' }),
    'all.xml': allXml(g)
  };
  for (const [name, body] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.writeFileSync(p + '.tmp', body);
    fs.renameSync(p + '.tmp', p);
  }
  // stable "current game" mirror so vMix never needs re-pointing
  const live = path.join(store.dirs.vmix, '_live');
  fs.mkdirSync(live, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    const p = path.join(live, name);
    fs.writeFileSync(p + '.tmp', body);
    fs.renameSync(p + '.tmp', p);
  }
  return dir;
}

function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
function ordinal(n) { return ['1st', '2nd', '3rd', '4th'][n - 1] || `${n}th`; }
