import { parseCSV } from '../util.js';
import { parseHTMLTables, stripTags } from './html.js';
import { extractPdfText, pdfLines } from './pdftext.js';

/**
 * HUDL football exports come in two shapes, both handled here:
 *
 *  1. Per-game  — pipe-delimited text with CamelCase column names and a Jersey
 *     column but NO player name. Rows are per stat-group, so one player can
 *     appear several times, and a file often contains BOTH teams.
 *  2. Season    — the "cumulative stats" page saved from the browser: one HTML
 *     table per category, identified by the heading above it — or the same
 *     report saved as a PDF, which also carries team and opponent totals.
 */

/* ---------------- shared value cleaning ---------------- */

/** "1,595" -> 1595 · "55.67 %" -> 55.67 · "-" -> 0 · "" -> null */
export function num(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '' || s === '-' || s === '--') return null;
  const n = parseFloat(s.replace(/,/g, '').replace(/\s*%$/, ''));
  return isFinite(n) ? n : null;
}

const isTotalsRow = (s) => /^(rest of team|total|totals|team|opponent|season totals)\b/i.test(String(s || '').trim());

/* ================================================================== *
 * 1. Per-game pipe export                                            *
 * ================================================================== */

// HUDL column name -> OpenStatsEngine stat key. `max` keys take the highest
// value across rows instead of summing (they are "long" records).
const PER_GAME = {
  RushingNum: 'rush_att', RushingYards: 'rush_yds', RushingLong: ['rush_long', 'max'],
  RushingTDNum: 'rush_td',
  ReceivingNum: 'rec', ReceivingYards: 'rec_yds', ReceivingLong: ['rec_long', 'max'],
  ReceivingTDNum: 'rec_td',
  PassingComp: 'pass_comp', PassingAtt: 'pass_att', PassingYards: 'pass_yds',
  PassingTD: 'pass_td', PassingLong: ['pass_long', 'max'], PassingInt: 'pass_int',
  OffensiveFumbles: 'fumbles', OffensiveFumblesLost: 'fumbles_lost',
  Tackles: 'tackles_solo', Assists: 'tackles_ast',
  TacklesForLoss: 'tfl', Sacks: 'sacks', SacksYardsLost: 'sack_yds', QBHurries: 'hurries',
  INTs: 'def_int', INTYards: 'int_yds', PassesDefensed: 'pbu',
  BlockedPunts: 'blocks', BlockedFG: 'blocks',
  FumbleRecoveries: 'fr', FumbleRecoveryYards: 'fr_yds', CausedFumbles: 'ff',
  PuntReturnNum: 'pr', PuntReturnYards: 'pr_yds', PuntReturnLong: ['pr_long', 'max'],
  PuntReturnFairCatches: 'pr_fc',
  KickoffReturnNum: 'kr', KickoffReturnYards: 'kr_yds', KickoffReturnLong: ['kr_long', 'max'],
  PuntNum: 'punts', PuntYards: 'punt_yds', PuntLong: ['punt_long', 'max'], PuntInside20: 'punt_in20',
  KickoffNum: 'kickoffs', KickoffYards: 'kickoff_yds', KickoffLong: ['kickoff_long', 'max'],
  KickoffTouchbacks: 'kickoff_tb',
  FumbleReturnedTDNum: 'def_td', IntReturnedTDNum: 'def_td',
  PuntReturnedTDNum: 'ret_td', KickoffReturnedTDNum: 'ret_td',
  PATKickingMade: 'xpm', PATKickingAtt: 'xpa',
  FGMade: 'fgm', FGAttempted: 'fga', FGLong: ['fg_long', 'max'],
  Safeties: 'safeties'
};

/** Does this text look like a HUDL per-game pipe export? */
export function looksLikeHudlPerGame(text) {
  const first = String(text).split(/\r?\n/, 1)[0] || '';
  return first.includes('Jersey') && first.includes('|') &&
    (first.includes('RushingNum') || first.includes('TotalTackles'));
}

/**
 * Parse a per-game export. Returns one entry per jersey, with the contributing
 * row numbers kept so the operator can see why a player was merged.
 *
 * @param {object} opts
 *   merge      - combine repeated jerseys into one player (default true)
 *   rosterNums - jersey numbers on the team being imported; rows whose jersey is
 *                not on the roster are returned as `unmatched` rather than
 *                silently dropped, because these files often hold both teams.
 */
export function parseHudlPerGame(text, { merge = true, rosterNums = null } = {}) {
  const rows = parseCSV(text);
  if (!rows.length) return { players: [], unmatched: [], warnings: ['File was empty'], matched: [] };
  const header = rows[0].map((h) => h.trim());
  const jerseyIdx = header.findIndex((h) => /^jersey$/i.test(h));
  if (jerseyIdx === -1) {
    return { players: [], unmatched: [], matched: [], warnings: ['No Jersey column found — is this a HUDL per-game export?'] };
  }

  const cols = header.map((h) => {
    const m = PER_GAME[h];
    if (!m) return null;
    return Array.isArray(m) ? { key: m[0], mode: m[1] } : { key: m, mode: 'sum' };
  });

  const known = rosterNums ? new Set(rosterNums.map((n) => String(n).trim())) : null;
  const out = new Map();
  const unmatched = [];
  const matchedKeys = new Set();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const jersey = String(r[jerseyIdx] ?? '').trim();
    if (jersey === '' || isTotalsRow(jersey)) continue;

    const stats = {};
    for (let c = 0; c < cols.length; c++) {
      const spec = cols[c];
      if (!spec) continue;
      const v = num(r[c]);
      if (v == null) continue;
      matchedKeys.add(spec.key);
      if (spec.mode === 'max') stats[spec.key] = Math.max(stats[spec.key] ?? 0, v);
      else stats[spec.key] = (stats[spec.key] ?? 0) + v;
    }
    if (!Object.keys(stats).length) continue;

    const rec = { number: jersey, name: '', stats, rows: [i] };
    if (known && !known.has(jersey)) { unmatched.push(rec); continue; }

    const key = merge ? jersey : `${jersey}#${i}`;
    if (!out.has(key)) { out.set(key, rec); continue; }
    const prev = out.get(key);
    prev.rows.push(i);
    for (const [k, v] of Object.entries(stats)) {
      const isMax = Object.values(PER_GAME).some((m) => Array.isArray(m) && m[0] === k);
      prev.stats[k] = isMax ? Math.max(prev.stats[k] ?? 0, v) : (prev.stats[k] ?? 0) + v;
    }
  }

  const players = [...out.values()];
  for (const p of players) {
    if (p.stats.tackles_solo != null || p.stats.tackles_ast != null) {
      p.stats.tackles_total = (p.stats.tackles_solo || 0) + (p.stats.tackles_ast || 0);
    }
  }

  const warnings = [];
  const dupes = players.filter((p) => p.rows.length > 1);
  if (dupes.length) {
    warnings.push(
      `${dupes.length} jersey number(s) appeared on more than one row and were ` +
      `${merge ? 'combined' : 'kept separate'}: ${dupes.map((d) => '#' + d.number).join(', ')}. ` +
      `HUDL splits a player across rows by stat group, but two players can also share a number — check these.`
    );
  }
  if (unmatched.length) {
    warnings.push(
      `${unmatched.length} row(s) had jersey numbers not on this roster ` +
      `(${[...new Set(unmatched.map((u) => '#' + u.number))].join(', ')}). ` +
      `HUDL per-game files usually contain both teams — import the other team separately.`
    );
  }
  return { players, unmatched, matched: [...matchedKeys], warnings, kind: 'hudl-pergame' };
}

/* ================================================================== *
 * 2. Season "cumulative stats" — saved HTML page or printed PDF      *
 * ================================================================== */

// Section heading -> per-column-header stat keys. A plain key is read from the
// player's one row in that table. ['key', 'max'] keeps the highest value seen
// across tables (longs, games played, and the rating, none of which add up);
// ['key', 'sum'] adds tables together, because fumbles appear under both
// rushing and receiving and return TDs under both return tables. Any other
// pair splits a "made / attempted" cell into two keys.
const SEASON_SECTIONS = [
  { match: /passing/i, key: 'passing', cols: {
    GAMES: ['games', 'max'], CMP: 'pass_comp', ATT: 'pass_att', YDS: 'pass_yds',
    LNG: ['pass_long', 'max'], TD: 'pass_td', INT: 'pass_int', SACKED: 'sacked', RAT: ['rating', 'max'] } },
  { match: /rushing/i, key: 'rushing', cols: {
    GAMES: ['games', 'max'], CARRIES: 'rush_att', YDS: 'rush_yds', LNG: ['rush_long', 'max'],
    TD: 'rush_td', FUM: ['fumbles', 'sum'] } },
  { match: /receiving/i, key: 'receiving', cols: {
    GAMES: ['games', 'max'], REC: 'rec', YDS: 'rec_yds', LNG: ['rec_long', 'max'],
    TD: 'rec_td', FUM: ['fumbles', 'sum'] } },
  { match: /defensive|defense/i, key: 'defense', cols: {
    GAMES: ['games', 'max'], TACKLE: 'tackles_total', SOLO: 'tackles_solo', ASSIST: 'tackles_ast',
    SACK: 'sacks', TFL: 'tfl', SAFETY: 'safeties', INT: 'def_int',
    'INT RET YDS': 'int_yds', FF: 'ff', 'FUM REC': 'fr', 'FUM RET YDS': 'fr_yds', 'DEF TD': 'def_td' } },
  { match: /kicking/i, key: 'kicking', cols: {
    GAMES: ['games', 'max'], 'FGM/FGA': ['fgm', 'fga'], LNG: ['fg_long', 'max'],
    'XPM/XPA': ['xpm', 'xpa'], PTS: 'kick_pts' } },
  { match: /punting/i, key: 'punting', cols: {
    GAMES: ['games', 'max'], PUNTS: 'punts', YDS: 'punt_yds', 'IN 20': 'punt_in20', LNG: ['punt_long', 'max'] } },
  // These two have identical column headers, so the heading is the only way to
  // tell them apart — never reorder or match them by shape.
  { match: /kickoff return/i, key: 'kickoff_return', cols: {
    GAMES: ['games', 'max'], RETURNS: 'kr', YDS: 'kr_yds', TD: ['ret_td', 'sum'], LNG: ['kr_long', 'max'] } },
  { match: /punt return/i, key: 'punt_return', cols: {
    GAMES: ['games', 'max'], RETURNS: 'pr', YDS: 'pr_yds', TD: ['ret_td', 'sum'], LNG: ['pr_long', 'max'] } }
];

const MODES = new Set(['max', 'sum']);
const isGrandTotal = (s) => /^(total|totals|season totals)\b/i.test(String(s || '').trim());

function modeOf(section, key) {
  for (const spec of Object.values(section.cols)) {
    if (Array.isArray(spec) && spec[0] === key && MODES.has(spec[1])) return spec[1];
  }
  return 'set';
}

/** One row's cells -> { key: value }. `zero` reads "-" as 0, for checking totals. */
function readSeasonRow(section, header, cells, { zero = false } = {}) {
  const out = {};
  const val = (raw) => (zero && /^-+$/.test(String(raw).trim()) ? 0 : num(raw));
  for (let c = 0; c < header.length; c++) {
    const spec = section.cols[header[c]];
    if (!spec) continue;
    const raw = String(cells[c] ?? '').trim();
    // "7 / 11" style made/attempted pairs
    if (Array.isArray(spec) && !MODES.has(spec[1]) && raw.includes('/')) {
      const [a, b] = raw.split('/').map(val);
      if (a != null) out[spec[0]] = a;
      if (b != null) out[spec[1]] = b;
      continue;
    }
    const v = val(raw);
    if (v != null) out[Array.isArray(spec) ? spec[0] : spec] = v;
  }
  return out;
}

/**
 * Fold HUDL's season tables into one record per player, however the tables
 * were read. Each table is `{ label, header, rows }` with every row's cells
 * already lined up under the header — the part that differs between a saved
 * page and a PDF.
 *
 * Each table's player rows (plus "Rest of team") are also added up and checked
 * against HUDL's own "Total:" row, so a value read into the wrong column is
 * reported instead of quietly landing on a graphic.
 */
function collectSeason(tables, { emptyHint }) {
  const byKey = new Map();
  const sections = [];
  const warnings = [];

  for (const t of tables) {
    const section = SEASON_SECTIONS.find((s) => s.match.test(t.label));
    if (!section) continue;
    const header = t.header.map((h) => String(h ?? '').trim().toUpperCase());
    const col = (name, fallback) => (header.includes(name) ? header.indexOf(name) : fallback);
    const numIdx = col('#', 0), nameIdx = col('NAME', 1);
    const sums = {};
    const order = [];
    let total = null, count = 0;

    for (const r of t.rows) {
      const number = String(r[numIdx] ?? '').trim();
      const name = String(r[nameIdx] ?? '').trim();
      if (isGrandTotal(number) || isGrandTotal(name)) { total = r; continue; }
      if (!name) continue;
      const restOfTeam = /^rest of team\b/i.test(name);
      if (!restOfTeam && (isTotalsRow(name) || isTotalsRow(number))) continue;
      for (const [k, v] of Object.entries(readSeasonRow(section, header, r, { zero: true }))) {
        sums[k] = (sums[k] || 0) + v;
      }
      if (restOfTeam) continue;

      const key = `${number}|${name.toLowerCase()}`;
      if (!byKey.has(key)) byKey.set(key, { number, name, stats: {}, sections: [] });
      const p = byKey.get(key);
      if (!p.sections.includes(section.key)) p.sections.push(section.key);
      for (const [k, v] of Object.entries(readSeasonRow(section, header, r))) {
        const mode = modeOf(section, k);
        if (mode === 'max') p.stats[k] = p.stats[k] == null ? v : Math.max(p.stats[k], v);
        else if (mode === 'sum') p.stats[k] = (p.stats[k] ?? 0) + v;
        else p.stats[k] = v;
      }
      order.push(key);
      count++;
    }

    if (total) {
      for (const [k, want] of Object.entries(readSeasonRow(section, header, total, { zero: true }))) {
        if (modeOf(section, k) === 'max') continue;
        const got = Math.round((sums[k] || 0) * 100) / 100;
        if (Math.abs(got - want) > 0.01) {
          warnings.push(`${t.label}: the players add up to ${got} ${k}, but the file's total says ${want}. ` +
            'Check this section before using it.');
        }
      }
    }
    // The table's columns as [key, heading] and its players as number|name
    // keys, both in the file's order, so the set can be shown back the way
    // HUDL laid it out.
    const cols = [];
    for (const h of header) {
      const spec = section.cols[h];
      if (Array.isArray(spec) && !MODES.has(spec[1])) spec.forEach((k, i) => cols.push([k, (h.split('/')[i] || k).trim()]));
      else if (spec) cols.push([Array.isArray(spec) ? spec[0] : spec, h]);
    }
    sections.push({ label: t.label, key: section.key, players: count, cols, order });
  }

  const players = [...byKey.values()];
  if (!players.length) warnings.push(emptyHint);
  const found = sections.map((s) => s.key);
  for (const s of SEASON_SECTIONS) {
    if (!found.includes(s.key)) warnings.push(`No "${s.key.replace('_', ' ')}" table found.`);
  }
  return { players, sections, warnings, matched: [...new Set(players.flatMap((p) => Object.keys(p.stats)))] };
}

export function looksLikeHudlSeason(html) {
  return /cumulative|hudl/i.test(html) && /<table/i.test(html) &&
    /(Passing|Rushing|Receiving)\s*Stats/i.test(html);
}

/**
 * Parse a saved HUDL season page. Tables are matched to categories by the
 * nearest preceding heading, which is required because the kickoff-return and
 * punt-return tables are structurally identical.
 */
export function parseHudlSeasonHTML(html) {
  const tables = parseHTMLTables(html, { withOffsets: true });
  // headings with their position in the document
  const headings = [];
  const hRe = /<h[1-6][^>]*>([\s\S]{0,200}?)<\/h[1-6]>/gi;
  let m;
  while ((m = hRe.exec(html))) headings.push({ at: m.index, text: stripTags(m[1]) });

  const found = [];
  for (const t of tables) {
    if (t.rows.length < 2) continue;
    const label = headings.filter((h) => h.at < t.at).pop()?.text || '';
    found.push({ label, header: t.rows[0], rows: t.rows.slice(1) });
  }
  return {
    ...collectSeason(found, {
      emptyHint: 'No stat tables were recognised. Save the HUDL cumulative-stats page as "Webpage, Complete" and upload the .html file.'
    }),
    kind: 'hudl-season'
  };
}

/* ---------------- the same report, printed to PDF ---------------- */

// Team summary rows at the top of the PDF -> stat keys, named as the engine
// names a game's team line. "a / b" cells fill two keys; a conversion cell,
// "(22.64 %) 12", fills the count and then the rate.
const TEAM_ROWS = [
  [/^total (yds|yards)$/i, ['total_yards']],
  [/^passing yards$/i, ['pass_yds']],
  [/^passing yards per game$/i, ['pass_ypg']],
  [/^pass completions\s*\/\s*attempts$/i, ['pass_comp', 'pass_att']],
  [/^pass completion %$/i, ['pass_pct']],
  [/^passing tds?$/i, ['pass_td']],
  [/^rushing yards$/i, ['rush_yds']],
  [/^rushing yards per game$/i, ['rush_ypg']],
  [/^rush plays\s*\/\s*average$/i, ['rush_att', 'rush_avg']],
  [/^rushing tds?$/i, ['rush_td']],
  [/^3rd down conversions$/i, ['third_conv', 'third_pct']],
  [/^4th down conversions$/i, ['fourth_conv', 'fourth_pct']],
  [/^first downs$/i, ['first_downs']],
  [/^turnovers$/i, ['turnovers']],
  [/^sacks$/i, ['sacks']]
];

/** A row HUDL adds later still imports, under a key made from its label. */
function teamKeys(label) {
  const hit = TEAM_ROWS.find(([re]) => re.test(label));
  return hit ? hit[1] : [label.toLowerCase().replace(/%/g, 'pct').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')];
}

function teamValues(raw) {
  const s = String(raw).trim();
  const conv = s.match(/^\(\s*(-?[\d.,]+)\s*%\s*\)\s*(-?[\d,]+)$/);
  if (conv) return [num(conv[2]), num(conv[1])];
  if (s.includes('/')) return s.split('/').map(num);
  return [num(s)];
}

/**
 * Lay a line's runs out under a header by horizontal overlap. HUDL right-aligns
 * numbers and left-aligns names, and either way a value sits over its heading;
 * with no overlap at all the nearest column takes it. A cell drawn in pieces
 * ("11", "/", "13") is joined back together.
 */
function placeCells(runs, cols) {
  const cells = new Array(cols.length).fill('');
  for (const r of runs) {
    let best = 0, bestScore = -Infinity;
    cols.forEach((c, i) => {
      const overlap = Math.min(r.x2, c.x2) - Math.max(r.x, c.x);
      if (overlap > bestScore) { bestScore = overlap; best = i; }
    });
    cells[best] = cells[best] ? `${cells[best]} ${r.text}` : r.text;
  }
  return cells;
}

const overlaps = (r, c) => Math.min(r.x2, c.x2) - Math.max(r.x, c.x) > 0;

/**
 * Parse HUDL's "Season Stats & Team Leaders" report saved as a PDF.
 *
 * The PDF carries the same eight tables as the season page, plus the team's
 * and its opponents' season totals at the top. Text is read with its position
 * (see pdftext.js), so a cell left blank — a "Total:" row with no long, a
 * "Rest of team" row with no jersey — stays blank instead of shifting the rest
 * of the row left. A table that runs over a page break repeats its header on
 * the next page; that is treated as the same table continuing.
 */
export function parseHudlSeasonPDF(buf) {
  const lines = pdfLines(extractPdfText(buf));
  const tables = [];
  let label = '', cols = null, table = null, summary = null;
  const team = { games: null, scheduled: null, abbrev: '', stats: {}, opponents: { abbrev: '', stats: {} } };

  for (const line of lines) {
    const upper = line.runs.map((r) => r.text.trim().toUpperCase());

    const g = line.text.match(/\bfor\s+(\d+)\s+out\s+of\s+(\d+)\s+games\b/i);
    if (g && team.games == null) { team.games = +g[1]; team.scheduled = +g[2]; continue; }

    // Any "… Stats" heading ends the table before it, even one we do not map.
    if (line.runs.length === 1 && /\S\s+stats$/i.test(line.text)) {
      label = line.text; cols = null; table = null;
      continue;
    }

    if (upper.includes('#') && upper.includes('NAME')) {
      cols = line.runs.map((r, i) => ({ label: upper[i], x: r.x, x2: r.x2 }));
      if (table && table.header.join('|') === upper.join('|')) continue;   // continued over a page
      table = { label, header: upper, rows: [] };
      tables.push(table);
      continue;
    }

    if (table) {
      const cells = placeCells(line.runs, cols);
      // A footer or caption has nothing under the stat columns.
      if (cells.some((c, i) => c && cols[i].label !== '#' && cols[i].label !== 'NAME')) table.rows.push(cells);
      continue;
    }

    // Above the first table: the "FPREP  OPP" summary block. Team leaders sit
    // on the same lines further right, and are left alone.
    if (tables.length || label) continue;
    const opp = upper.findIndex((t, i) => i > 0 && /^OPP(ONENTS?)?$/.test(t));
    if (!summary && opp > 0) {
      summary = { us: line.runs[opp - 1], them: line.runs[opp] };
      team.abbrev = summary.us.text;
      team.opponents.abbrev = summary.them.text;
      continue;
    }
    if (!summary) continue;
    const name = line.runs.filter((r) => r.x2 < summary.us.x && !overlaps(r, summary.them)).map((r) => r.text).join(' ');
    if (!name) continue;
    const keys = teamKeys(name);
    for (const [col, into] of [[summary.us, team.stats], [summary.them, team.opponents.stats]]) {
      const raw = line.runs.filter((r) => overlaps(r, col)).map((r) => r.text).join(' ');
      if (!raw) continue;
      teamValues(raw).forEach((v, i) => { if (v != null && keys[i]) into[keys[i]] = v; });
    }
  }

  const out = collectSeason(tables, { emptyHint: 'No stat tables were found in that PDF.' });
  const hasTeam = team.games != null || Object.keys(team.stats).length > 0;
  return { ...out, team: hasTeam ? team : null, kind: 'hudl-season-pdf' };
}
