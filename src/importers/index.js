import { parseCSV } from '../util.js';
import { getSport } from '../sports/index.js';
import { parseHTMLTables, stripTags } from './html.js';
import { parseHudlPerGame, parseHudlSeasonHTML, looksLikeHudlPerGame, looksLikeHudlSeason } from './hudl.js';

/* ------------------------------------------------------------------ *
 * Header normalisation                                                *
 * ------------------------------------------------------------------ */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIAS = {
  number: ['no', 'num', 'number', 'jersey', 'jerseyno', 'jerseynumber', 'uni', 'uninumber', 'no1'],
  name: ['name', 'player', 'playername', 'fullname', 'athlete', 'athletename'],
  first: ['first', 'firstname', 'fname', 'givenname'],
  last: ['last', 'lastname', 'lname', 'surname', 'familyname'],
  pos: ['pos', 'position', 'positions', 'pos1', 'primaryposition'],
  year: ['year', 'grade', 'gradelevel', 'class', 'yr', 'classyear', 'gr'],
  height: ['height', 'ht'],
  weight: ['weight', 'wt'],
  level: ['level', 'team', 'squad', 'teamlevel']
};

function mapHeaders(header) {
  const map = {};
  header.forEach((h, i) => {
    const n = norm(h);
    for (const [field, aliases] of Object.entries(ALIAS)) {
      if (aliases.includes(n)) { if (map[field] == null) map[field] = i; }
    }
  });
  return map;
}

/** "Smith, John" -> "John Smith"; leaves normal order alone. */
function fixName(s) {
  const v = String(s || '').trim().replace(/\s+/g, ' ');
  const m = v.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2].trim()} ${m[1].trim()}` : v;
}

/* ------------------------------------------------------------------ *
 * Roster import                                                       *
 * ------------------------------------------------------------------ */

/**
 * Import a roster from CSV/TSV text. Understands MaxPreps, HUDL and generic
 * exports by matching header aliases; falls back to positional guessing when
 * the file has no recognisable header.
 */
export function parseRosterCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return { players: [], warnings: ['File was empty'] };
  const warnings = [];

  // find the header row within the first few lines (exports often have a title row)
  let headerIdx = -1, map = {};
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const m = mapHeaders(rows[i]);
    if (m.name != null || (m.first != null && m.last != null)) { headerIdx = i; map = m; break; }
  }
  if (headerIdx === -1) {
    warnings.push('No header row recognised — assuming columns are Number, Name, Position, Year.');
    headerIdx = -1;
    map = { number: 0, name: 1, pos: 2, year: 3 };
  }

  const players = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    let name = map.name != null ? fixName(r[map.name]) : '';
    if (!name && map.first != null) {
      name = `${String(r[map.first] || '').trim()} ${String(r[map.last] ?? '').trim()}`.trim();
    }
    if (!name) continue;
    if (/^(total|team|totals)$/i.test(name)) continue;
    players.push({
      number: String(map.number != null ? (r[map.number] ?? '') : '').trim(),
      name,
      pos: String(map.pos != null ? (r[map.pos] ?? '') : '').trim(),
      year: String(map.year != null ? (r[map.year] ?? '') : '').trim(),
      height: String(map.height != null ? (r[map.height] ?? '') : '').trim(),
      weight: String(map.weight != null ? (r[map.weight] ?? '') : '').trim(),
      level: String(map.level != null ? (r[map.level] ?? '') : '').trim()
    });
  }
  if (!players.length) warnings.push('No player rows found.');
  return { players, warnings };
}

/* ------------------------------------------------------------------ *
 * HTML table scrape (CIAC / fpsports and similar GridView pages)      *
 * ------------------------------------------------------------------ */

/**
 * Fetch a roster page (e.g. the CIAC DashboardTeamRoster URL) and pull the
 * roster table out of it. Picks the table whose header mentions a name column.
 */
export async function importRosterFromURL(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 OpenStatsEngine/1.0', 'Accept': 'text/html,*/*' },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status} ${res.statusText}`);
  const ct = res.headers.get('content-type') || '';
  const body = await res.text();

  if (/csv|plain/.test(ct) && !/<table/i.test(body)) {
    const out = parseRosterCSV(body);
    return { ...out, source: url, kind: 'csv' };
  }

  const tables = parseHTMLTables(body);
  let best = null, bestMap = null, bestHeader = -1;
  for (const rows of tables) {
    for (let i = 0; i < Math.min(rows.length, 3); i++) {
      const m = mapHeaders(rows[i]);
      const score = (m.name != null ? 2 : 0) + (m.number != null ? 1 : 0) + (m.pos != null ? 1 : 0);
      if (m.name != null && (!best || score > best.score || rows.length > best.rows.length)) {
        best = { rows, score }; bestMap = m; bestHeader = i;
      }
    }
  }
  if (!best) {
    const title = (body.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
    throw new Error(`No roster table found on the page${title ? ` (page title: "${stripTags(title)}")` : ''}. ` +
      `If the page needs a team selected first, copy the URL after selecting the team, or export a CSV instead.`);
  }

  const map = bestMap;
  const players = [];
  for (let i = bestHeader + 1; i < best.rows.length; i++) {
    const r = best.rows[i];
    const name = fixName(r[map.name] ?? '');
    if (!name || /^(total|team|totals|no players)/i.test(name)) continue;
    players.push({
      number: String(map.number != null ? (r[map.number] ?? '') : '').trim(),
      name,
      pos: String(map.pos != null ? (r[map.pos] ?? '') : '').trim(),
      year: String(map.year != null ? (r[map.year] ?? '') : '').trim(),
      height: String(map.height != null ? (r[map.height] ?? '') : '').trim(),
      weight: String(map.weight != null ? (r[map.weight] ?? '') : '').trim(),
      level: String(map.level != null ? (r[map.level] ?? '') : '').trim()
    });
  }
  return { players, warnings: players.length ? [] : ['Table found but no player rows parsed.'], source: url, kind: 'html' };
}

/* ------------------------------------------------------------------ *
 * Format detection + dispatch                                         *
 * ------------------------------------------------------------------ */

/** Identify what the operator just pasted or uploaded. */
export function detectStatsFormat(text) {
  const s = String(text);
  if (s.slice(0, 8).startsWith('%PDF-')) return 'pdf';
  if (looksLikeHudlPerGame(s)) return 'hudl-pergame';
  // A saved HUDL page is several MB with the first <table> a long way in, so
  // this has to look at the whole document, not just the head.
  if (/<table/i.test(s)) return looksLikeHudlSeason(s) ? 'hudl-season' : 'html';
  return 'csv';
}

/**
 * One entry point for every stat-import shape we support. Returns a uniform
 * `{ players:[{number,name,stats}], kind, warnings, matched }`.
 *
 * MaxPreps PDFs are refused on purpose: that layout drops empty cells, so the
 * remaining values no longer line up with their column headers and any parse
 * would produce confidently wrong numbers.
 */
export function importStatsAuto(text, sportId, { category = null, merge = true, rosterNums = null } = {}) {
  const kind = detectStatsFormat(text);
  switch (kind) {
    case 'pdf':
      throw new Error(
        'That is a PDF. MaxPreps PDF reports drop empty cells, so the values no longer ' +
        'line up with their column headings and importing one would produce wrong numbers. ' +
        'Use the MaxPreps CSV/Excel export instead, or copy the stats table from the web ' +
        'page and paste it here — both import cleanly.'
      );
    case 'hudl-pergame':
      return parseHudlPerGame(text, { merge, rosterNums });
    case 'hudl-season':
      return parseHudlSeasonHTML(text);
    case 'html': {
      // Any other page with stat tables: reuse the CSV path on the widest table.
      const tables = parseHTMLTables(text);
      if (!tables.length) throw new Error('No tables found in that HTML.');
      const best = tables.reduce((a, b) => (b[0].length > a[0].length ? b : a));
      const csv = best.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      return { ...parseStatsCSV(csv, sportId, category), kind: 'html' };
    }
    default:
      return { ...parseStatsCSV(text, sportId, category), kind: 'csv' };
  }
}

/* ------------------------------------------------------------------ *
 * Season stat import (HUDL / MaxPreps exports)                        *
 * ------------------------------------------------------------------ */

/**
 * Build an alias map from a sport's own stat keys plus common export headings,
 * so a HUDL or MaxPreps CSV lands on the right fields without hand-mapping.
 */
function statAliases(sport, category = null) {
  const alias = {};
  const ambiguous = {};
  // Explicit aliases always win; generic label matches are first-come so that
  // an ambiguous heading resolves to the sport's leading stat table.
  const add = (key, ...names) => { for (const n of names) alias[norm(n)] = key; };
  const addGeneric = (key, name) => {
    const n = norm(name);
    if (!n) return;
    if (n in alias) { (ambiguous[n] = ambiguous[n] || [alias[n]]).push(key); return; }
    alias[n] = key;
  };
  // A category hint (e.g. a HUDL "Passing" export) puts that table first, so a
  // bare "TD"/"YDS" column lands on the stats the file is actually about.
  const tables = category
    ? [...sport.playerStatTables].sort((a, b) => (b.key === category) - (a.key === category))
    : sport.playerStatTables;
  for (const t of tables) for (const [k, label] of t.cols) { addGeneric(k, k); addGeneric(k, label); }
  alias.__ambiguous = ambiguous;
  if (sport.id === 'football') {
    add('pass_yds', 'passyds', 'passingyards', 'passyards', 'pyds');
    add('pass_td', 'passtd', 'passingtd', 'ptd', 'passingtouchdowns');
    add('pass_int', 'int', 'interceptions', 'intthrown');
    add('pass_comp', 'comp', 'completions', 'cmp');
    add('pass_att', 'att', 'passatt', 'passingattempts');
    add('rush_yds', 'rushyds', 'rushingyards', 'ryds');
    add('rush_att', 'car', 'carries', 'rushatt', 'rushingattempts');
    add('rush_td', 'rushtd', 'rushingtd', 'rtd');
    add('rec', 'rec', 'receptions', 'catches');
    add('rec_yds', 'recyds', 'receivingyards');
    add('rec_td', 'rectd', 'receivingtd');
    add('tackles_total', 'tot', 'tackles', 'totaltackles', 'tkl');
    add('tackles_solo', 'solo', 'solotackles');
    add('sacks', 'sacks', 'sk');
    add('def_int', 'defint', 'interceptionsdef');
  } else if (sport.id === 'basketball') {
    add('pts', 'points', 'pts');
    add('reb', 'rebounds', 'reb', 'totreb', 'treb');
    add('ast', 'assists', 'ast');
    add('stl', 'steals', 'stl');
    add('blk', 'blocks', 'blk');
    add('to', 'turnovers', 'to', 'tov');
  } else if (sport.id === 'baseball') {
    add('avg', 'ba', 'battingaverage', 'avg');
    add('h', 'hits', 'h');
    add('rbi', 'rbi', 'rbis');
    add('hr', 'hr', 'homeruns');
  }
  return alias;
}

/**
 * Import per-player season stats from a HUDL/MaxPreps style CSV. Stored under
 * team.sports[sport].season[season].imported so a later export simply replaces
 * it without touching anything you logged live.
 */
export function parseStatsCSV(text, sportId, category = null) {
  const sport = getSport(sportId);
  const alias = statAliases(sport, category);
  const ambiguous = alias.__ambiguous || {};
  const rows = parseCSV(text);
  if (!rows.length) return { players: [], warnings: ['File was empty'], matched: [] };

  const notes = [];
  let headerIdx = -1, hmap = {}, smap = {};
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const m = mapHeaders(rows[i]);
    if (m.name != null || (m.first != null && m.last != null)) {
      headerIdx = i; hmap = m;
      rows[i].forEach((h, ci) => {
        const n = norm(h);
        const k = alias[n];
        if (!k || smap[k] != null) return;
        smap[k] = ci;
        if (ambiguous[n]) {
          notes.push(`Column "${h}" is ambiguous for ${sportId} (could be ${ambiguous[n].join(' or ')}); ` +
            `read as ${k}. Pass a category (e.g. "passing") to steer it.`);
        }
      });
      break;
    }
  }
  if (headerIdx === -1) return { players: [], warnings: ['Could not find a header row with a player name column.'], matched: [] };

  const players = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    let name = hmap.name != null ? fixName(r[hmap.name]) : '';
    if (!name && hmap.first != null) name = `${r[hmap.first] || ''} ${r[hmap.last] || ''}`.trim();
    if (!name || /^(total|team|totals|opponent)/i.test(name)) continue;
    const p = {
      number: String(hmap.number != null ? (r[hmap.number] ?? '') : '').trim(),
      name,
      pos: String(hmap.pos != null ? (r[hmap.pos] ?? '') : '').trim(),
      year: String(hmap.year != null ? (r[hmap.year] ?? '') : '').trim(),
      stats: {}
    };
    for (const [k, ci] of Object.entries(smap)) {
      const raw = String(r[ci] ?? '').trim();
      if (raw === '') continue;
      const n = parseFloat(raw.replace(/[,%]/g, ''));
      p.stats[k] = isFinite(n) ? n : raw;
    }
    players.push(p);
  }
  return {
    players,
    matched: Object.keys(smap),
    warnings: Object.keys(smap).length ? notes
      : ['No stat columns were recognised — player names imported only.', ...notes]
  };
}
