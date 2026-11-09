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
      valB: 'Row{n}ValB.Text'
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
  for (const k of ['sendScore', 'live', 'uppercaseLabels']) if (k in patch) out[k] = !!patch[k];
  if ('header' in patch) out.header = String(patch.header ?? '');
  if ('rowCount' in patch) out.rowCount = clamp(parseInt(patch.rowCount, 10) || 5, 1, MAX_ROWS);
  if ('intervalMs' in patch) out.intervalMs = clamp(parseInt(patch.intervalMs, 10) || 2000, 500, 30000);
  if (Array.isArray(patch.rows)) out.rows = patch.rows.slice(0, MAX_ROWS).map(cleanRow);
  for (const k of ['ose', 'vmix']) for (const f of Object.keys(out[k])) out[k][f] = String(out[k][f] ?? '').trim();
  return out;
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
  const push = (names, value) => { for (const n of names) fields.push({ field: n, value: String(value ?? '') }); };

  const header = fillTokens(settings.header, game, sideA, sideB);
  push(fieldList(f.header), header);

  const A = teamInfo(game, sideA), B = teamInfo(game, sideB);
  if (settings.sendScore && A && B) {
    push(fieldList(f.scoreA), A.score);
    push(fieldList(f.scoreB), B.score);
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
  return { header, A, B, rows, fields, sideA, sideB };
}
