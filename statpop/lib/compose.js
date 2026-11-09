/**
 * Settings + OSE game -> exactly what each vMix title field should say.
 */
import { search, formatValue, MATCH_THRESHOLD } from './catalog.js';

export const MAX_ROWS = 12;

export function defaultSettings() {
  return {
    ose: { url: 'http://localhost:8080', gameId: '' },          // '' = whichever game is active
    vmix: { url: 'http://localhost:8088', input: '' },
    teamA: 'away',                                                // left-hand column
    fields: {
      header: 'HeaderTitle.Text',
      scoreA: 'TeamAScore.Text, TeamAScore1.Text',
      scoreB: 'TeamBScore.Text, TeamBScore1.Text',
      label: 'Row{n}Label.Text',
      valA: 'Row{n}ValA.Text',
      valB: 'Row{n}ValB.Text',
      // Shape fills behind each score, from the title's Color tab
      // (e.g. "Rectangle3.Fill.Color"). Blank = don't touch box colours.
      boxA: '',
      boxB: ''
    },
    // Per team (follows the team when you swap sides).
    //   box:  'team' = the team's colour from OSE, 'custom' = boxColor, 'off' = leave as designed
    //   text: 'auto' = black or white, whichever reads on the box, 'custom' = textColor, 'off'
    colors: {
      home: { box: 'team', boxColor: '', text: 'auto', textColor: '' },
      away: { box: 'team', boxColor: '', text: 'auto', textColor: '' }
    },
    sendScore: true,
    rowCount: 5,
    live: false,
    intervalMs: 2000,
    uppercaseLabels: false,
    header: 'TEAM STATS',
    rows: [
      { query: 'Total Yards' }, { query: 'Rushing Yards' }, { query: 'Passing Yards' },
      { query: 'First Downs' }, { query: 'Turnovers' }
    ],
    presets: {}
  };
}

const blankRow = () => ({ query: '', label: '', pick: '', a: '', b: '' });

export function cleanRow(r = {}) {
  const s = (v) => (v == null ? '' : String(v));
  return { query: s(r.query), label: s(r.label), pick: s(r.pick), a: s(r.a), b: s(r.b) };
}

/** Merge a partial update into settings, keeping types sane. */
export function mergeSettings(cur, patch = {}) {
  const out = structuredClone(cur);
  if (patch.ose) Object.assign(out.ose, pick(patch.ose, ['url', 'gameId']));
  if (patch.vmix) Object.assign(out.vmix, pick(patch.vmix, ['url', 'input']));
  if (patch.fields) Object.assign(out.fields, pick(patch.fields, Object.keys(out.fields)));
  if (patch.teamA === 'home' || patch.teamA === 'away') out.teamA = patch.teamA;
  if (patch.colors) {
    for (const side of ['home', 'away']) {
      const c = patch.colors[side];
      if (!c) continue;
      const o = out.colors[side];
      if (['team', 'custom', 'off'].includes(c.box)) o.box = c.box;
      if (['auto', 'custom', 'off'].includes(c.text)) o.text = c.text;
      if ('boxColor' in c) o.boxColor = hex(c.boxColor);
      if ('textColor' in c) o.textColor = hex(c.textColor);
    }
  }
  for (const k of ['sendScore', 'live', 'uppercaseLabels']) if (k in patch) out[k] = !!patch[k];
  if ('header' in patch) out.header = String(patch.header ?? '');
  if ('rowCount' in patch) out.rowCount = clamp(parseInt(patch.rowCount, 10) || 5, 1, MAX_ROWS);
  if ('intervalMs' in patch) out.intervalMs = clamp(parseInt(patch.intervalMs, 10) || 2000, 500, 30000);
  if (Array.isArray(patch.rows)) out.rows = patch.rows.slice(0, MAX_ROWS).map(cleanRow);
  for (const k of ['ose', 'vmix']) for (const f of Object.keys(out[k])) out[k][f] = String(out[k][f] ?? '').trim();
  out.ose.url = normalizeUrl(out.ose.url, 8080);
  out.vmix.url = normalizeUrl(out.vmix.url, 8088);
  return out;
}

/**
 * Accept what people actually type for another computer: "192.168.1.50",
 * "192.168.1.50:8080", "ose-laptop", "http://192.168.1.50:8080/" all work.
 */
export function normalizeUrl(raw, defaultPort) {
  let s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return `http://localhost:${defaultPort}`;
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  try {
    const u = new URL(s);
    if (!u.port && u.protocol === 'http:') u.port = String(defaultPort);
    return `${u.protocol}//${u.host}`;
  } catch {
    return s;
  }
}

/** "#1e40af", "1E40AF", "#80FF0000" -> "#1E40AF" style; anything else -> ''. */
export function hex(v) {
  const m = String(v ?? '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!m) return '';
  let h = m[1].toUpperCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return '#' + h;
}

/** Black or white, whichever is easier to read on this background. */
export function contrastText(bg) {
  const h = hex(bg);
  if (!h) return '';
  const rgb = h.length === 9 ? h.slice(3) : h.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(rgb.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // contrast against white vs against black
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? '#FFFFFF' : '#000000';
}

/** The box and score-text colours one team should get right now ('' = don't send). */
export function teamColors(settings, game, side) {
  const c = settings.colors?.[side] || {};
  const teamColor = hex(game?.teams?.[side]?.primaryColor);
  const box = c.box === 'custom' ? hex(c.boxColor) : c.box === 'team' ? teamColor : '';
  const text = c.text === 'custom' ? hex(c.textColor) : c.text === 'auto' ? contrastText(box) : '';
  return { box, text, teamColor };
}

function pick(o, keys) { const r = {}; for (const k of keys) if (k in o) r[k] = o[k]; return r; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

export const fieldList = (spec) => String(spec || '').split(',').map((s) => s.trim()).filter(Boolean);
const rowField = (tpl, n) => fieldList(String(tpl).replace(/\{n\}/gi, n));

function teamInfo(g, side) {
  const t = g?.teams?.[side];
  if (!t) return null;
  return { side, name: t.name, short: t.shortName, abbrev: t.abbrev, mascot: t.mascot,
    color: t.primaryColor, score: t.points ?? t.score ?? 0 };
}

export function fillTokens(text, g, sideA, sideB) {
  const A = teamInfo(g, sideA) || {}, B = teamInfo(g, sideB) || {};
  const map = {
    A: A.abbrev, B: B.abbrev, ANAME: A.name, BNAME: B.name, ASHORT: A.short, BSHORT: B.short,
    AMASCOT: A.mascot, BMASCOT: B.mascot, ASCORE: A.score, BSCORE: B.score,
    PERIOD: g?.clock?.periodLabel, CLOCK: g?.clock?.clock
  };
  return String(text || '').replace(/\{([A-Za-z]+)\}/g, (m, k) => {
    const v = map[k.toUpperCase()];
    return v == null ? m : String(v);
  });
}

/**
 * @param settings  current settings
 * @param game      OSE game state (may be null when OSE is unreachable)
 * @param catalog   buildCatalog(game) (may be null)
 */
export function compose(settings, game, catalog) {
  const sideA = settings.teamA === 'home' ? 'home' : 'away';
  const sideB = sideA === 'home' ? 'away' : 'home';
  const f = settings.fields;
  const fields = [];
  const push = (names, value, fn = 'SetText') => {
    for (const n of names) fields.push({ field: n, value: String(value ?? ''), fn });
  };

  const header = fillTokens(settings.header, game, sideA, sideB);
  push(fieldList(f.header), header);

  const A = teamInfo(game, sideA), B = teamInfo(game, sideB);
  if (settings.sendScore && A && B) {
    push(fieldList(f.scoreA), A.score);
    push(fieldList(f.scoreB), B.score);
  }

  // Score box fills (SetColor) and score text colour (SetTextColour).
  const colors = { A: teamColors(settings, game, sideA), B: teamColors(settings, game, sideB) };
  for (const [k, boxF, textF] of [['A', f.boxA, f.scoreA], ['B', f.boxB, f.scoreB]]) {
    if (colors[k].box) push(fieldList(boxF), colors[k].box, 'SetColor');
    if (colors[k].text) push(fieldList(textF), colors[k].text, 'SetTextColour');
  }

  const rows = [];
  for (let n = 1; n <= settings.rowCount; n++) {
    const r = cleanRow(settings.rows[n - 1] || blankRow());
    let entry = null, score = null, alternatives = [], pinned = false;
    if (catalog) {
      if (r.pick) {
        entry = catalog.entries.find((e) => e.id === r.pick) || null;
        pinned = !!entry;
      }
      if (r.query.trim()) {
        const found = search(catalog, r.query, 8);
        alternatives = found.map((x) => ({
          id: x.entry.id, label: x.entry.label, source: x.entry.source, score: +x.score.toFixed(2),
          a: formatValue(x.entry, x.entry[sideA]), b: formatValue(x.entry, x.entry[sideB])
        }));
        if (!entry && found[0] && found[0].score >= MATCH_THRESHOLD) { entry = found[0].entry; score = found[0].score; }
      }
    }
    const autoA = entry ? formatValue(entry, entry[sideA]) : '';
    const autoB = entry ? formatValue(entry, entry[sideB]) : '';
    let label = r.label.trim() || r.query.trim();
    if (settings.uppercaseLabels) label = label.toUpperCase();
    const valA = r.a !== '' ? r.a : autoA;
    const valB = r.b !== '' ? r.b : autoB;
    rows.push({
      n, query: r.query, label, rawLabel: r.label, pick: r.pick, pinned,
      match: entry ? { id: entry.id, label: entry.label, source: entry.source, score: score == null ? null : +score.toFixed(2) } : null,
      alternatives, autoA, autoB, valA, valB, overA: r.a !== '', overB: r.b !== '',
      empty: !r.query.trim() && !r.label.trim() && r.a === '' && r.b === ''
    });
    push(rowField(f.label, n), label);
    push(rowField(f.valA, n), valA);
    push(rowField(f.valB, n), valB);
  }
  return { header, A, B, rows, fields, sideA, sideB, colors };
}
