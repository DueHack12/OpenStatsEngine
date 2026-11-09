/**
 * Turns an OpenStatsEngine game state into a searchable list of team stats,
 * and finds the best match for whatever the operator types ("Total Yards",
 * "yds dropped", "3rd down %", "rush_yds"...).
 *
 * Every entry has a home and an away value. Entries come from:
 *   1. the team stats OSE computes (g.teams.home / g.teams.away), labelled with
 *      the sport's own teamStatRows labels where it has them;
 *   2. team totals of player stats OSE only tracks per player (drops, tackles,
 *      sacks made, TFL...), summed per side — or the max for "long" stats.
 */

/* ------------------------------------------------------------------ text */

// Whole-phrase rewrites, applied before splitting into words.
const PHRASES = [
  [/%/g, ' pct '],
  [/\byds?\s*\/\s*(play|carry|catch|att|attempt|rush|rec)\b/g, 'yards per $1'],
  [/\//g, ' per '],
  [/&/g, ' and '],
  [/\b1st\b/g, 'first'], [/\b2nd\b/g, 'second'], [/\b3rd\b/g, 'third'], [/\b4th\b/g, 'fourth'],
  [/\btime of poss(ession)?\b/g, 'top'],
  [/\b3(pt|pts|p)\b/g, 'three point'],
  [/\bfg3\b/g, 'three point']
];

// Word-level synonyms: every spelling on the right becomes the word on the left.
const SYNONYMS = {
  yards: ['yd', 'yds', 'yard', 'yardage'],
  touchdown: ['td', 'tds', 'touchdowns'],
  interception: ['int', 'ints', 'interceptions', 'picks', 'pick'],
  pct: ['percent', 'percentage', 'pct', 'perc'],
  attempt: ['att', 'atts', 'attempts', 'attempted', 'tries'],
  completion: ['comp', 'comps', 'cmp', 'completions', 'completed', 'complete'],
  average: ['avg', 'average', 'averages', 'ave'],
  turnover: ['to', 'tos', 'turnovers', 'giveaway', 'giveaways'],
  penalty: ['pen', 'pens', 'penalties', 'flags', 'flag'],
  reception: ['rec', 'recs', 'receptions', 'catches', 'catch'],
  receiving: ['recv', 'receiving'],
  rush: ['rush', 'rushing', 'rushes', 'run', 'runs', 'running', 'ground', 'carries', 'carry'],
  pass: ['pass', 'passing', 'passes', 'air', 'throwing'],
  drop: ['drop', 'drops', 'dropped', 'dropping'],
  sack: ['sack', 'sacks', 'sacked'],
  tackle: ['tkl', 'tkls', 'tackle', 'tackles'],
  fumble: ['fum', 'fumble', 'fumbles', 'fumbled'],
  conversion: ['conv', 'convs', 'conversion', 'conversions', 'converted', 'conversions'],
  first: ['first', '1st'],
  down: ['down', 'downs', 'dn'],
  lost: ['lost', 'lose', 'loss', 'losses'],
  total: ['total', 'totals', 'tot'],
  offense: ['offense', 'offensive', 'offence'],
  number: ['no', 'num', 'number', 'count', '#'],
  field: ['field'],
  goal: ['goal', 'goals', 'gls'],
  rebound: ['reb', 'rebs', 'rebound', 'rebounds', 'boards'],
  assist: ['ast', 'asts', 'assist', 'assists', 'dimes'],
  steal: ['stl', 'stls', 'steal', 'steals'],
  block: ['blk', 'blks', 'block', 'blocks', 'blocked'],
  foul: ['pf', 'foul', 'fouls'],
  shot: ['sh', 'shot', 'shots', 'shooting'],
  save: ['sv', 'save', 'saves'],
  corner: ['ck', 'corner', 'corners', 'corner kicks'],
  timeout: ['timeout', 'timeouts', 'tos used'],
  play: ['play', 'plays', 'snaps', 'snap'],
  punt: ['punt', 'punts', 'punting'],
  return: ['ret', 'return', 'returns', 'returned'],
  kickoff: ['kickoff', 'kickoffs', 'kr'],
  rating: ['rtg', 'rating', 'qbr'],
  long: ['long', 'lng', 'longest'],
  third: ['third', '3d'],
  fourth: ['fourth', '4d'],
  red: ['red', 'redzone'],
  zone: ['zone'],
  yac: ['yac', 'yards after catch', 'after'],
  tfl: ['tfl', 'tfls']
};
const SYN = new Map();
for (const [canon, list] of Object.entries(SYNONYMS)) for (const w of list) SYN.set(w, canon);

// Filler words that should not affect a match.
const STOP = new Set(['the', 'of', 'a', 'an', 'by', 'for', 'team', 'stat', 'stats', 'game', 'in', 'on']);

function stem(w) {
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('es') && w.length > 4 && /(ss|sh|ch|x)es$/.test(w)) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  // dropp -> drop, runn -> run
  if (/([bdgmnprt])\1$/.test(w)) w = w.slice(0, -1);
  return w;
}

/** Words of a phrase, normalised: lower case, synonyms folded, stemmed. */
export function tokens(text) {
  let s = String(text || '').toLowerCase().replace(/_/g, ' ');
  for (const [re, rep] of PHRASES) s = s.replace(re, rep);
  const out = [];
  for (const raw of s.split(/[^a-z0-9#]+/)) {
    if (!raw || STOP.has(raw)) continue;
    const w = SYN.get(raw) || SYN.get(stem(raw)) || raw;
    out.push(stem(w));
  }
  return out;
}

export const normalize = (text) => tokens(text).join(' ');

/* --------------------------------------------------------------- labels */

// How OSE's raw key fragments read in English, for keys with no label.
const KEY_WORDS = {
  yds: 'Yards', yd: 'Yards', att: 'Attempts', comp: 'Completions', td: 'TDs', int: 'INT',
  pct: '%', avg: 'Avg', fd: 'First Downs', fga: 'FG Attempts', fgm: 'FG Made', fg: 'FG',
  xpa: 'XP Attempts', xpm: 'XP Made', xp: 'XP', rec: 'Receptions', rush: 'Rushing',
  pass: 'Passing', conv: 'Conversions', pts: 'Points', reb: 'Rebounds', oreb: 'Off Rebounds',
  dreb: 'Def Rebounds', ast: 'Assists', stl: 'Steals', blk: 'Blocks', to: 'Turnovers',
  pf: 'Fouls', sh: 'Shots', sog: 'Shots on Goal', yc: 'Yellow Cards', rc: 'Red Cards',
  ga: 'Goals Against', g: 'Goals', a: 'Assists', ms: '', kr: 'Kick Returns', pr: 'Punt Returns',
  def: 'Def', tfl: 'TFL', pbu: 'Pass Breakups', ff: 'Forced Fumbles', fr: 'Fumble Recoveries',
  ret: 'Return', pk: 'PK', a3: '3PA', fg3m: '3PT Made', fg3a: '3PT Attempts', ftm: 'FT Made',
  fta: 'FT Attempts', top: 'Time of Possession'
};
export function humanizeKey(k) {
  if (KEY_WORDS[k]) return KEY_WORDS[k];
  return String(k).split('_').map((p) => KEY_WORDS[p] ?? (p.charAt(0).toUpperCase() + p.slice(1)))
    .filter(Boolean).join(' ');
}

/**
 * Extra ways people say a stat, by OSE key. Team-level keys first; player keys
 * (summed into a team total) use the same table.
 */
const ALIASES = {
  // football — team
  total_yards: ['Total Yards', 'Total Offense', 'Offense', 'Yards', 'Total Yds'],
  rush_yds: ['Rushing Yards', 'Rush Yards', 'Yards Rushing', 'Ground Yards'],
  pass_yds: ['Passing Yards', 'Pass Yards', 'Yards Passing', 'Air Yards'],
  rush_att: ['Rushing Attempts', 'Rush Attempts', 'Carries'],
  pass_att: ['Pass Attempts', 'Passing Attempts'],
  pass_comp: ['Completions', 'Pass Completions'],
  pass_td: ['Passing Touchdowns', 'Passing TDs'],
  rush_td: ['Rushing Touchdowns', 'Rushing TDs'],
  rush_line: ['Rushing', 'Rushing Att-Yds', 'Rushing Attempts-Yards'],
  pass_line: ['Passing', 'Comp-Att-Int', 'Passing C-A-I'],
  rush_avg: ['Yards per Carry', 'Yards per Rush', 'YPC', 'Rushing Average'],
  yards_per_play: ['Yards per Play', 'YPP', 'Average per Play'],
  first_downs: ['First Downs', '1st Downs'],
  fd_detail: ['First Downs Rush-Pass-Penalty', 'First Down Breakdown'],
  first_downs_rush: ['Rushing First Downs'],
  first_downs_pass: ['Passing First Downs'],
  first_downs_pen: ['Penalty First Downs', 'First Downs by Penalty'],
  total_plays: ['Total Plays', 'Plays', 'Snaps', 'Offensive Plays'],
  third_line: ['Third Down', 'Third Downs', 'Third Down Conversions', '3rd Down Efficiency', '3rd Down Conv'],
  third_pct: ['Third Down %', 'Third Down Percentage'],
  fourth_line: ['Fourth Down', 'Fourth Downs', 'Fourth Down Conversions'],
  redzone_line: ['Red Zone', 'Red Zone Scores', 'Red Zone Efficiency'],
  penalty_line: ['Penalties', 'Penalties-Yards', 'Penalties Yards'],
  penalties: ['Number of Penalties', 'Penalty Count'],
  penalty_yds: ['Penalty Yards', 'Penalty Yardage', 'Yards Penalized'],
  turnovers: ['Turnovers', 'Giveaways'],
  fumbles_lost: ['Fumbles Lost'],
  fumbles: ['Fumbles'],
  int_thrown: ['Interceptions Thrown', 'INTs Thrown', 'Picks Thrown'],
  sacks_allowed: ['Sacks Allowed', 'Times Sacked'],
  sack_yds_lost: ['Sack Yards Lost', 'Yards Lost to Sacks'],
  punt_line: ['Punts', 'Punting', 'Punts-Average'],
  punt_yds: ['Punt Yards', 'Punting Yards'],
  top: ['Time of Possession', 'Possession', 'TOP'],
  timeouts_used: ['Timeouts Used', 'Timeouts'],
  score: ['Score', 'Points'],
  fg_line: ['Field Goals', 'FG Made-Attempted'],
  // football — player totals
  drops: ['Drops', 'Dropped Passes', 'Dropped Balls', 'Passes Dropped'],
  sacks: ['Sacks', 'Sacks Made', 'Defensive Sacks'],
  tackles_total: ['Tackles', 'Total Tackles'],
  tackles_solo: ['Solo Tackles'],
  tackles_ast: ['Assisted Tackles'],
  tfl: ['Tackles for Loss', 'TFL'],
  def_int: ['Interceptions', 'Defensive Interceptions', 'Picks', 'INTs'],
  int_yds: ['Interception Return Yards'],
  pbu: ['Pass Breakups', 'Passes Defended', 'PBU'],
  ff: ['Forced Fumbles'],
  fr: ['Fumble Recoveries', 'Fumbles Recovered'],
  def_td: ['Defensive Touchdowns'],
  yac: ['Yards After Catch', 'YAC'],
  targets: ['Targets'],
  rec: ['Receptions', 'Catches'],
  rec_yds: ['Receiving Yards'],
  kr_yds: ['Kick Return Yards', 'Kickoff Return Yards'],
  pr_yds: ['Punt Return Yards'],
  kr: ['Kick Returns', 'Kickoff Returns'],
  pr: ['Punt Returns'],
  ret_td: ['Return Touchdowns'],
  all_purpose: ['All Purpose Yards', 'All-Purpose Yards'],
  punt_in20: ['Punts Inside the 20', 'Punts Inside 20'],
  pass_long: ['Longest Pass', 'Long Pass'],
  rush_long: ['Longest Run', 'Long Run', 'Longest Rush'],
  rec_long: ['Longest Reception', 'Long Reception'],
  punt_long: ['Longest Punt'],
  fg_long: ['Longest Field Goal', 'Long FG'],
  blocks: ['Blocked Kicks'],
  // basketball / soccer / hockey / lacrosse — the common ones
  reb: ['Rebounds', 'Total Rebounds'], oreb: ['Offensive Rebounds'], dreb: ['Defensive Rebounds'],
  ast: ['Assists'], stl: ['Steals'], blk: ['Blocks', 'Blocked Shots'],
  to: ['Turnovers'], pf: ['Fouls', 'Team Fouls', 'Personal Fouls'],
  fg_pct: ['Field Goal %', 'FG Percentage', 'Shooting %'],
  fg3_line: ['Three Pointers', '3-Pointers', '3PT Made-Attempted'],
  fg3_pct: ['Three Point %', '3PT %'],
  ft_line: ['Free Throws'], ft_pct: ['Free Throw %'],
  pts_off_to: ['Points off Turnovers'], bench_pts: ['Bench Points'],
  biggest_lead: ['Biggest Lead', 'Largest Lead'],
  sh: ['Shots', 'Total Shots'], sog: ['Shots on Goal', 'Shots on Target', 'SOG'],
  corners: ['Corner Kicks', 'Corners'], fouls: ['Fouls'], offsides: ['Offsides'],
  yc: ['Yellow Cards'], rc: ['Red Cards'], saves: ['Saves'],
  possession_pct: ['Possession %', 'Possession Percentage']
};

// Player keys that mean nothing summed (averages, ratings...) and ones
// where the team figure is the best single value rather than a sum.
const NOT_SUMMABLE = /(^|_)(avg|pct|rating|line|name|number|pos|year|side|key|id)($|_)|^is_|^comp_att$|_ms$/;
const MAX_KEYS = /(_long$|^biggest_)/;
// Player keys that would double-count or mislead as a team total.
const SKIP_PLAYER_KEYS = new Set(['minutes_ms', 'sacked']);

const ratio = (a, b, mult = 1) => (b ? +((a / b) * mult).toFixed(1) : 0);
const DERIVED = [
  { key: 'comp_pct', label: 'Completion %', needs: ['pass_comp', 'pass_att'], fn: (t) => ratio(t.pass_comp, t.pass_att, 100) },
  { key: 'yards_per_pass', label: 'Yards per Pass', needs: ['pass_yds', 'pass_att'], fn: (t) => ratio(t.pass_yds, t.pass_att) },
  { key: 'fd_pct', label: 'Fourth Down %', needs: ['fourth_conv', 'fourth_att'], fn: (t) => ratio(t.fourth_conv, t.fourth_att, 100) }
];
ALIASES.comp_pct = ['Completion %', 'Completion Percentage', 'Comp %', 'Pass Completion %'];
ALIASES.yards_per_pass = ['Yards per Pass', 'Yards per Attempt', 'YPA'];
ALIASES.fd_pct = ['Fourth Down %', 'Fourth Down Percentage'];

/* -------------------------------------------------------------- catalog */

function isScalar(v) { return typeof v === 'number' || (typeof v === 'string' && v.length < 40); }

/**
 * Build the list of stats available in this game.
 * @param {object} g  OSE /api/games/:id/state response
 * @param {object} [manifest]  OSE /api/sports/:id response (for labels)
 */
export function buildCatalog(g, manifest = null) {
  const home = g?.teams?.home || {}, away = g?.teams?.away || {};
  const labels = new Map((manifest?.teamStatRows || []).map(([k, l]) => [k, l]));
  const order = new Map((manifest?.teamStatRows || []).map(([k], i) => [k, i]));
  const SKIP_TEAM = new Set(['id', 'name', 'abbrev', 'shortName', 'mascot', 'primaryColor',
    'secondaryColor', 'byPeriod', 'points', 'possession_ms', 'logo']);
  const entries = [];

  for (const k of Object.keys(home)) {
    if (SKIP_TEAM.has(k) || !isScalar(home[k])) continue;
    const label = labels.get(k) || (ALIASES[k] || [])[0] || humanizeKey(k);
    entries.push({
      id: k, key: k, label, source: labels.has(k) ? 'team' : 'team-raw',
      home: home[k], away: away[k] ?? '',
      rank: order.has(k) ? order.get(k) : 100
    });
  }

  // A few rates OSE doesn't publish but broadcasters ask for.
  for (const d of DERIVED) {
    if (d.key in home || !d.needs.every((n) => typeof home[n] === 'number')) continue;
    entries.push({ id: d.key, key: d.key, label: d.label, source: 'derived',
      home: d.fn(home), away: d.fn(away), rank: 150 });
  }

  // Team totals of per-player stats OSE doesn't keep at team level.
  const players = Object.values(g?.players || {});
  const pkeys = new Set();
  for (const p of players) for (const [k, v] of Object.entries(p)) if (typeof v === 'number') pkeys.add(k);
  for (const k of pkeys) {
    if (k in home || NOT_SUMMABLE.test(k) || SKIP_PLAYER_KEYS.has(k)) continue;
    const agg = MAX_KEYS.test(k) ? 'max' : 'sum';
    const val = (side) => {
      const xs = players.filter((p) => p.side === side).map((p) => Number(p[k]) || 0);
      if (!xs.length) return 0;
      return agg === 'max' ? Math.max(...xs) : +xs.reduce((a, b) => a + b, 0).toFixed(2);
    };
    entries.push({
      id: 'players.' + k, key: k, label: (ALIASES[k] || [])[0] || humanizeKey(k),
      source: agg === 'max' ? 'player-max' : 'player-sum',
      home: val('home'), away: val('away'), rank: 200
    });
  }

  // Search names for each entry.
  for (const e of entries) {
    const names = [e.label, humanizeKey(e.key), e.key, ...(ALIASES[e.key] || [])];
    e.names = [...new Set(names)];
    e.tokenSets = e.names.map((n) => tokens(n));
    e.norms = e.names.map((n) => tokens(n).join(' '));
  }
  // Rarer words count for more: "drop" is decisive, "yard" is everywhere.
  const df = new Map();
  for (const e of entries) for (const t of new Set(e.tokenSets.flat())) df.set(t, (df.get(t) || 0) + 1);
  const N = entries.length || 1;
  const idf = (t) => Math.log(1 + N / (df.get(t) || 0.5));
  entries.sort((a, b) => a.rank - b.rank);
  return { entries, idf };
}

/* -------------------------------------------------------------- matching */

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** How well query word q matches name word n: 1 exact, less for typos/prefixes. */
function wordSim(q, n) {
  if (q === n) return 1;
  if (q.length >= 3 && n.startsWith(q)) return 0.8;   // "tack" -> "tackle"
  if (n.length >= 3 && q.startsWith(n)) return 0.7;
  if (q.length >= 4 && n.length >= 4 && lev(q, n) <= (q.length >= 7 ? 2 : 1)) return 0.8; // typos
  return 0;
}

function score(qt, nt, idf) {
  if (!qt.length || !nt.length) return 0;
  let hit = 0, qw = 0, nw = 0;
  const used = new Set();
  for (const q of qt) {
    const w = idf(q);
    qw += w;
    let best = 0, bi = -1;
    nt.forEach((n, i) => { if (!used.has(i)) { const s = wordSim(q, n); if (s > best) { best = s; bi = i; } } });
    if (bi >= 0) { used.add(bi); hit += best * Math.max(w, idf(nt[bi])); }
  }
  nt.forEach((n, i) => { if (!used.has(i)) nw += idf(n); });
  // weighted overlap: matched weight over everything either side mentions
  return hit / (qw + nw + (hit ? 0 : 1));
}

/**
 * Rank catalog entries for a typed query.
 * @returns {{entry, score}[]} best first
 */
export function search(catalog, query, limit = 6) {
  const q = String(query || '').trim();
  if (!q) return [];
  const qn = normalize(q);
  const qt = tokens(q);
  const raw = q.toLowerCase();
  const out = [];
  for (const e of catalog.entries) {
    let s = 0;
    if (e.key.toLowerCase() === raw || e.id.toLowerCase() === raw) s = 1.05; // typed an exact OSE key
    for (let i = 0; i < e.names.length; i++) {
      if (e.norms[i] === qn) s = Math.max(s, 1.1 - i * 0.002);
      else s = Math.max(s, score(qt, e.tokenSets[i], catalog.idf));
    }
    // a tiny nudge toward the stats OSE itself puts on its team stats sheet
    if (s > 0) out.push({ entry: e, score: s + (e.source === 'team' ? 0.02 : 0) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

export const MATCH_THRESHOLD = 0.34;

/* ------------------------------------------------------------ formatting */

export function formatValue(entry, v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    const s = Number.isInteger(v) ? String(v) : String(+v.toFixed(1));
    return /_pct$/.test(entry.key) ? s + '%' : s;
  }
  return String(v);
}
