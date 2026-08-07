import { PDF } from './pdf.js';
import { getSport } from '../sports/index.js';

/** Full game report PDF: linescore, team comparison, scoring, box scores, PBP. */
export function gameReportPDF(g, { includePBP = true } = {}) {
  const sport = getSport(g.sportId);
  const pdf = new PDF({ width: 792, height: 612, margin: 36 });
  const M = pdf.margin;
  const h = g.teams.home, a = g.teams.away;
  let y = M + 6;

  pdf.text(M, y, `${a.name} at ${h.name}`, { size: 18, bold: true });
  pdf.text(pdf.right, y, `${a.abbrev} ${a.points}  —  ${h.abbrev} ${h.points}`, { size: 18, bold: true, align: 'right' });
  y += 16;
  const status = g.meta.status === 'final' ? 'FINAL' : `${g.clock.periodLabel} ${g.clock.clock}`;
  pdf.text(M, y, [g.sportName, g.meta.level, g.meta.date, g.meta.venue].filter(Boolean).join('  ·  '),
    { size: 9, color: [0.35, 0.35, 0.35] });
  pdf.text(pdf.right, y, status, { size: 10, bold: true, align: 'right', color: [0.6, 0.1, 0.1] });
  y += 6;
  pdf.line(M, y, pdf.right, y, { width: 1, color: [0.2, 0.2, 0.2] });
  y += 16;

  // ---- linescore ----
  const nPer = Math.max(g.clock.periodCount, g.clock.period);
  const lsCols = [{ label: 'Team', key: 'team', w: 150, bold: true }];
  for (let p = 1; p <= nPer; p++) lsCols.push({ label: labelPeriod(sport, p, g), key: `p${p}`, w: 34, align: 'center' });
  lsCols.push({ label: 'FINAL', key: 'total', w: 46, align: 'center' });
  const lsRow = (side) => {
    const t = g.teams[side];
    const r = { team: t.name, total: t.points };
    for (let p = 1; p <= nPer; p++) r[`p${p}`] = t.byPeriod?.[p] ?? 0;
    return r;
  };
  y = pdf.table(y, lsCols, [lsRow('away'), lsRow('home')], { rowH: 14, size: 9 });
  y += 8;

  // ---- team comparison ----
  const tsRows = sport.teamStatRows.map(([k, label]) => ({
    stat: label, away: fmt(g.teams.away[k]), home: fmt(g.teams.home[k])
  }));
  const half = Math.ceil(tsRows.length / 2);
  const leftRows = tsRows.slice(0, half), rightRows = tsRows.slice(half);
  const colW = [{ label: a.abbrev, key: 'away', w: 62, align: 'center' },
                { label: 'TEAM STATS', key: 'stat', w: 138, align: 'center' },
                { label: h.abbrev, key: 'home', w: 62, align: 'center' }];
  const yStart = y;
  const y1 = pdf.table(yStart, colW, leftRows, { rowH: 12, size: 8 });
  const y2 = pdf.table(yStart, colW, rightRows, { rowH: 12, size: 8, x: M + 300 });
  y = Math.max(y1, y2) + 8;

  // ---- scoring summary ----
  if (g.scoringPlays.length) {
    if (y > pdf.bottom - 120) { pdf.newPage(); y = M + 10; }
    y = pdf.table(y, [
      { label: 'PER', key: 'per', w: 40, align: 'center' },
      { label: 'CLOCK', key: 'clock', w: 46, align: 'center' },
      { label: 'TEAM', key: 'team', w: 50 },
      { label: 'PLAY', key: 'desc', w: 400 },
      { label: 'AWAY', key: 'as', w: 40, align: 'center' },
      { label: 'HOME', key: 'hs', w: 40, align: 'center' }
    ], g.scoringPlays.map((s) => ({
      per: s.periodLabel, clock: s.clock, team: g.teams[s.side].abbrev,
      desc: s.desc, as: s.awayScore, hs: s.homeScore
    })), { rowH: 12, size: 8, title: 'SCORING SUMMARY' });
    y += 6;
  }

  // ---- box scores ----
  for (const side of ['away', 'home']) {
    const t = g.teams[side];
    for (const table of sport.playerStatTables) {
      const rows = Object.values(g.players)
        .filter((p) => p.side === side && (table.when ? table.when(p) : true))
        .sort((x, z) => byNumber(x, z));
      if (!rows.length) continue;
      if (y > pdf.bottom - 60) { pdf.newPage(); y = M + 10; }
      const cols = [
        { label: '#', key: 'number', w: 26, align: 'center' },
        { label: 'PLAYER', key: 'name', w: 130 },
        { label: 'POS', key: 'pos', w: 34, align: 'center' },
        ...table.cols.map(([k, label]) => ({ label, key: k, w: Math.max(34, label.length * 7 + 12), align: 'right' }))
      ];
      y = pdf.table(y, cols, rows.map((p) => {
        const r = { number: p.number, name: p.name, pos: p.pos };
        for (const [k] of table.cols) r[k] = fmt(p[k]);
        return r;
      }), { rowH: 11, size: 8, title: `${t.name} — ${table.label}` });
      y += 4;
    }
  }

  // ---- play by play ----
  if (includePBP && g.timeline.length) {
    pdf.newPage(); y = M + 10;
    pdf.text(M, y, 'PLAY BY PLAY', { size: 12, bold: true }); y += 16;
    const rows = [...g.timeline].reverse().map((t) => ({
      per: t.periodLabel ?? '', clock: t.clock,
      team: t.team ? g.teams[t.team].abbrev : '',
      play: `${t.label}${t.text ? ' — ' + t.text : ''}`,
      time: t.tsLocal
    }));
    pdf.table(y, [
      { label: 'PER', key: 'per', w: 36, align: 'center' },
      { label: 'CLOCK', key: 'clock', w: 44, align: 'center' },
      { label: 'TM', key: 'team', w: 34 },
      { label: 'PLAY', key: 'play', w: 480 },
      { label: 'ENTERED', key: 'time', w: 122 }
    ], rows, { rowH: 10.5, size: 7.5 });
  }

  // footer on every page
  for (let i = 0; i < pdf.pages.length; i++) {
    const ops = pdf.ops;
    pdf.ops = pdf.pages[i];
    pdf.text(M, pdf.h - 20, `OpenStatsEngine · ${g.meta.id} · generated ${new Date().toLocaleString()}`,
      { size: 7, color: [0.5, 0.5, 0.5] });
    pdf.text(pdf.right, pdf.h - 20, `Page ${i + 1} of ${pdf.pages.length}`, { size: 7, align: 'right', color: [0.5, 0.5, 0.5] });
    pdf.ops = ops;
  }
  return pdf.build();
}

function labelPeriod(sport, p, g) {
  if (p > g.clock.periodCount) return p - g.clock.periodCount === 1 ? 'OT' : `${p - g.clock.periodCount}OT`;
  return String(p);
}
function byNumber(a, b) {
  const x = parseInt(a.number, 10), z = parseInt(b.number, 10);
  if (isFinite(x) && isFinite(z)) return x - z;
  return String(a.name).localeCompare(String(b.name));
}
function fmt(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(1));
  return String(v);
}
