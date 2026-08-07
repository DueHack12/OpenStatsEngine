import { parseCSV } from '../util.js';
import { parseHTMLTables, stripTags } from './html.js';

/**
 * HUDL football exports come in two shapes, both handled here:
 *
 *  1. Per-game  — pipe-delimited text with CamelCase column names and a Jersey
 *     column but NO player name. Rows are per stat-group, so one player can
 *     appear several times, and a file often contains BOTH teams.
 *  2. Season    — the "cumulative stats" page saved from the browser: one HTML
 *     table per category, identified by the heading above it.
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
 * 2. Season "cumulative stats" HTML                                  *
 * ================================================================== */

// Section heading -> per-column-header stat keys.
const SEASON_SECTIONS = [
  { match: /passing/i, key: 'passing', cols: {
    GAMES: 'games', CMP: 'pass_comp', ATT: 'pass_att', YDS: 'pass_yds',
    LNG: ['pass_long', 'max'], TD: 'pass_td', INT: 'pass_int', SACKED: 'sacked', RAT: 'rating' } },
  { match: /rushing/i, key: 'rushing', cols: {
    GAMES: 'games', CARRIES: 'rush_att', YDS: 'rush_yds', LNG: ['rush_long', 'max'],
    TD: 'rush_td', FUM: 'fumbles' } },
  { match: /receiving/i, key: 'receiving', cols: {
    GAMES: 'games', REC: 'rec', YDS: 'rec_yds', LNG: ['rec_long', 'max'],
    TD: 'rec_td', FUM: 'fumbles' } },
  { match: /defensive|defense/i, key: 'defense', cols: {
    GAMES: 'games', TACKLE: 'tackles_total', SOLO: 'tackles_solo', ASSIST: 'tackles_ast',
    SACK: 'sacks', TFL: 'tfl', SAFETY: 'safeties', INT: 'def_int',
    'INT RET YDS': 'int_yds', FF: 'ff', 'FUM REC': 'fr', 'FUM RET YDS': 'fr_yds' } },
  { match: /kicking/i, key: 'kicking', cols: {
    GAMES: 'games', 'FGM/FGA': ['fgm', 'fga'], LNG: ['fg_long', 'max'],
    'XPM/XPA': ['xpm', 'xpa'], PTS: 'kick_pts' } },
  { match: /punting/i, key: 'punting', cols: {
    GAMES: 'games', PUNTS: 'punts', YDS: 'punt_yds', 'IN 20': 'punt_in20', LNG: ['punt_long', 'max'] } },
  // These two have identical column headers, so the heading is the only way to
  // tell them apart — never reorder or match them by shape.
  { match: /kickoff return/i, key: 'kickoff_return', cols: {
    GAMES: 'games', RETURNS: 'kr', YDS: 'kr_yds', TD: 'ret_td', LNG: ['kr_long', 'max'] } },
  { match: /punt return/i, key: 'punt_return', cols: {
    GAMES: 'games', RETURNS: 'pr', YDS: 'pr_yds', TD: 'ret_td', LNG: ['pr_long', 'max'] } }
];

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

  const byNumber = new Map();
  const sections = [];
  const warnings = [];

  for (const t of tables) {
    const before = headings.filter((h) => h.at < t.at).pop();
    const label = before?.text || '';
    const section = SEASON_SECTIONS.find((s) => s.match.test(label));
    if (!section) continue;
    const rows = t.rows;
    if (rows.length < 2) continue;
    const header = rows[0].map((h) => h.trim().toUpperCase());

    let count = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const number = String(r[0] ?? '').trim();
      const name = String(r[1] ?? '').trim();
      if (!name || isTotalsRow(name) || isTotalsRow(number)) continue;

      const key = `${number}|${name.toLowerCase()}`;
      if (!byNumber.has(key)) byNumber.set(key, { number, name, stats: {}, sections: [] });
      const p = byNumber.get(key);
      if (!p.sections.includes(section.key)) p.sections.push(section.key);

      for (let c = 0; c < header.length; c++) {
        const spec = section.cols[header[c]];
        if (!spec) continue;
        const raw = String(r[c] ?? '').trim();
        // "7 / 11" style made/attempted pairs
        if (Array.isArray(spec) && spec[1] !== 'max' && raw.includes('/')) {
          const [a, b] = raw.split('/').map(num);
          if (a != null) p.stats[spec[0]] = a;
          if (b != null) p.stats[spec[1]] = b;
          continue;
        }
        const v = num(raw);
        if (v == null) continue;
        if (Array.isArray(spec) && spec[1] === 'max') p.stats[spec[0]] = Math.max(p.stats[spec[0]] ?? 0, v);
        else if (Array.isArray(spec)) p.stats[spec[0]] = v;
        else p.stats[spec] = v;
      }
      count++;
    }
    sections.push({ label, key: section.key, players: count });
  }

  const players = [...byNumber.values()];
  if (!players.length) {
    warnings.push('No stat tables were recognised. Save the HUDL cumulative-stats page as "Webpage, Complete" and upload the .html file.');
  }
  const found = sections.map((s) => s.key);
  for (const s of SEASON_SECTIONS) {
    if (!found.includes(s.key)) warnings.push(`No "${s.key.replace('_', ' ')}" table found on the page.`);
  }
  return { players, sections, warnings, matched: [...new Set(players.flatMap((p) => Object.keys(p.stats)))], kind: 'hudl-season' };
}
