/**
 * Builds a PDF laid out like HUDL's "Season Stats & Team Leaders" report, the
 * way HUDL's renderer (Qt) writes it: Type0 fonts with Identity-H encoding and
 * a ToUnicode map, one BT block per table cell with every glyph placed by its
 * own Td, a flipped coordinate system, and tables that run over a page break
 * repeating their header (and their total row) on the next page.
 *
 * Real HUDL exports name real students, so they stay out of the repository;
 * this builds the same structure from invented names and numbers.
 */
import zlib from 'node:zlib';

export const SUMMARY = {
  title: 'Season Stats & Team Leaders for 5 out of 10 games',
  us: 'RIVER', them: 'OPP',
  rows: [
    ['Total yds', '1,184', '1,347'], ['Passing yards', '584', '525'],
    ['Passing yards per game', '116.80', '105.00'], ['Pass completions/attempts', '42 / 92', '39 / 80'],
    ['Pass completion %', '45.65 %', '48.75 %'], ['Passing TDs', '8', '6'],
    ['Rushing yards', '600', '822'], ['Rushing yards per game', '120.00', '164.40'],
    ['Rush plays/average', '137 / 4.38', '181 / 4.54'], ['Rushing TDs', '4', '8'],
    ['3rd Down Conversions', '(22.64 %) 12', '(38.98 %) 23'], ['4th Down Conversions', '(60.00 %) 6', '(46.15 %) 6'],
    ['First Downs', '54', '61'], ['Turnovers', '6', '9'], ['Sacks', '8', '2'], ['Penalty yards', '212', '180']
  ],
  // drawn to the right of the summary, on the same lines
  leaders: ['PASSING', '#11 R. Riverton', '579 yds, 41 for 91 (45.05 %), 8 TDs, 4 INTs',
    'RUSHING', '#2 S. Calder', '259 yds, 60 carries, 1 TDs, 1 Fum']
};

/** Rows are written as HUDL prints them; `total` is the "Total:" row. */
export const SECTIONS = [
  { title: 'Passing Stats',
    header: ['#', 'NAME', 'GAMES', 'CMP', 'ATT', 'CMP %', 'YDS', 'YDS/ATT', 'YDS/GAME', 'LNG', 'TD', 'INT', 'SACKED', 'RAT'],
    rows: [
      ['11', 'R. Riverton', '5', '41', '91', '45.05 %', '579', '6.36', '115.80', '67', '8', '4', '1', '77'],
      ['3', 'K. Ashby', '2', '1', '1', '100.00 %', '5', '5.00', '2.50', '5', '-', '-', '-', '87']],
    total: ['Total:', '', '', '42', '92', '45.65 %', '584', '6.35', '116.80', '', '8', '4', '1', '77'] },
  { title: 'Rushing Stats',
    header: ['#', 'NAME', 'GAMES', 'CARRIES', 'YDS', 'YDS/CARRY', 'YDS/GAME', 'LNG', 'TD', 'FUM'],
    rows: [
      ['2', 'S. Calder', '4', '60', '259', '4.32', '64.75', '55', '1', '1'],
      ['21', 'J. Okafor', '5', '40', '179', '4.47', '35.80', '32', '-', '-'],
      ['11', 'R. Riverton', '5', '11', '11', '1.00', '2.20', '10', '1', '1'],
      ['17', 'T. Velasquez', '3', '1', '-9', '-9.00', '-3.00', '-', '-', '-']],
    total: ['Total:', '', '', '112', '440', '3.93', '88.00', '', '2', '2'] },
  // Breaks after its first row, as the real report does at the foot of page 1.
  { title: 'Receiving Stats', breakAfter: 1,
    header: ['#', 'NAME', 'GAMES', 'REC', 'YDS', 'YDS/REC', 'YDS/GAME', 'LNG', 'TD', 'FUM'],
    rows: [
      ['1', 'J. Lanniston', '4', '8', '228', '28.50', '57.00', '67', '4', '-'],
      ['4', 'D. Whitfield', '5', '14', '191', '13.64', '38.20', '63', '2', '-'],
      ['6', 'C. Jameson', '4', '5', '45', '9.00', '11.25', '24', '-', '-'],
      ['21', 'J. Okafor', '5', '1', '-', '0.00', '0.00', '-', '-', '-']],
    total: ['Total:', '', '', '28', '464', '16.57', '92.80', '', '6', '-'] },
  { title: 'Defensive Stats',
    header: ['#', 'NAME', 'GAMES', 'TACKLE', 'SOLO', 'ASSIST', 'SACK', 'TFL', 'SAFETY', 'INT', 'INT RET YDS',
      'FF', 'FUM REC', 'FUM RET YDS', 'DEF TD'],
    rows: [
      ['7', 'J. Morrow', '5', '47', '14', '33', '-', '1', '-', '-', '-', '-', '-', '-', '-'],
      ['9', 'B. Sommerville', '5', '45', '8', '37', '-', '2', '-', '5', '-', '-', '-', '-', '-'],
      ['52', 'S. Darrow', '5', '11', '3', '8', '2', '3', '-', '1', '-', '-', '-', '-', '1'],
      ['16', 'M. Crane', '5', '11', '7', '4', '1', '2', '-', '-', '-', '1', '-', '-', '-'],
      ['', 'Rest of team', '', '-', '-', '-', '-', '-', '-', '-', '-', '1', '2', '-', '-']],
    total: ['Total:', '', '', '114', '32', '82', '3', '8', '-', '6', '-', '2', '2', '-', '1'] },
  // Heading and header at the foot of a page, every row on the next.
  { title: 'Kicking Stats', breakAfter: 0,
    header: ['#', 'NAME', 'GAMES', 'FGM/FGA', 'FG %', 'LNG', 'XPM/XPA', 'XP %', 'PTS'],
    rows: [['28', 'B. Cornell', '5', '- / 1', '0.00 %', '-', '11 / 13', '84.62 %', '11']],
    total: ['Total:', '', '', '0 / 1', '0.00 %', '', '11 / 13', '84.62 %', '11'] },
  { title: 'Punting Stats',
    header: ['#', 'NAME', 'GAMES', 'PUNTS', 'YDS', 'YDS/PUNT', 'YDS/GAME', 'IN 20', 'LNG'],
    rows: [
      ['28', 'B. Cornell', '5', '25', '857', '34.28', '171.40', '10', '50'],
      ['', 'Rest of team', '', '1', '-', '0.00', '0.00', '-', '-']],
    total: ['Total:', '', '', '26', '857', '32.96', '171.40', '10', ''] },
  { title: 'Kickoff Return Stats',
    header: ['#', 'NAME', 'GAMES', 'RETURNS', 'YDS', 'YDS/RETURN', 'YDS/GAME', 'TD', 'LNG'],
    rows: [
      ['6', 'C. Jameson', '5', '3', '69', '23.00', '13.80', '1', '31'],
      ['1', 'J. Lanniston', '4', '2', '52', '26.00', '13.00', '-', '36'],
      ['', 'Rest of team', '', '1', '-', '0.00', '0.00', '-', '-']],
    total: ['Total:', '', '', '6', '121', '20.17', '24.20', '1', ''] },
  { title: 'Punt Return Stats',
    header: ['#', 'NAME', 'GAMES', 'RETURNS', 'YDS', 'YDS/RETURN', 'YDS/GAME', 'TD', 'LNG'],
    rows: [
      ['6', 'C. Jameson', '4', '3', '12', '4.00', '3.00', '1', '12'],
      ['', 'Rest of team', '', '17', '-', '0.00', '0.00', '-', '-']],
    total: ['Total:', '', '', '20', '12', '0.60', '2.40', '1', ''] }
];

// Rough Tahoma advance widths, in thousandths of an em.
const width = (ch) => (/[0-9]/.test(ch) ? 546 : /[A-Z#&%]/.test(ch) ? 640 : /[ .,:;'()/\-]/.test(ch) ? 300 : 500);
const SIZE = 14;                                     // font size in layout units
const textW = (s) => [...s].reduce((w, ch) => w + width(ch), 0) * SIZE / 1000;
const PAGE_ROWS = 1180;                              // usable layout height of a page

export function hudlSeasonPdf({ summary = SUMMARY, sections = SECTIONS } = {}) {
  // Each font numbers its glyphs differently, as Qt's subsets do, so a reader
  // that ignores which font is selected decodes garbage.
  const chars = [...new Set([summary, sections].flatMap((x) => [...JSON.stringify(x)]))].sort();
  const gid = { regular: new Map(), bold: new Map() };
  chars.forEach((ch, i) => { gid.regular.set(ch, i + 1); gid.bold.set(ch, chars.length - i); });

  const pages = [[]];
  let y = 40;
  const page = () => pages[pages.length - 1];
  const newPage = () => { pages.push([]); y = 40; };

  /** One cell: its own BT block, one Td + Tj per glyph. */
  const cell = (text, x, yy, { bold = false, align = 'left' } = {}) => {
    if (!text) return;
    const map = bold ? gid.bold : gid.regular;
    const x0 = align === 'right' ? x - textW(text) : x;
    let ops = `q\nBT\n/${bold ? 'F6' : 'F7'} ${SIZE} Tf 1 0 0 -1 0 0 Tm\n`;
    let prev = null;
    for (const ch of text) {
      const g = map.get(ch).toString(16).padStart(4, '0').toUpperCase();
      ops += prev == null ? `${Math.round(x0)} ${-Math.round(yy)} Td <${g}> Tj\n`
        : `${Math.round(width(prev) * SIZE / 1000)} 0 Td <${g}> Tj\n`;
      prev = ch;
    }
    page().push(ops + 'ET\nQ\n');
  };
  const fill = (x, yy, w, h) => page().push(`q\n0.9 0.9 0.9 rg\n${x} ${yy} ${w} ${h} re\nf\nQ\n`);

  // ---- summary block
  cell(summary.title, 20, y, { bold: true });
  y += 48;
  cell(summary.us, 373, y, { bold: true, align: 'right' });
  cell(summary.them, 501, y, { bold: true, align: 'right' });
  const leaders = [...summary.leaders];
  const leader = () => { const t = leaders.shift(); if (t) cell(t, 640, y + 6, { bold: /^[A-Z#]/.test(t) && !/yds/.test(t) }); };
  leader();
  for (const [label, us, them] of summary.rows) {
    y += 25;
    cell(label, 26, y);
    cell(us, 373, y, { align: 'right' });
    cell(them, 501, y, { align: 'right' });
    leader();
  }
  y += 70;

  // ---- tables
  for (const s of sections) {
    const cols = s.header.map((h, i) => {
      const w = i === 0 ? 45 : i === 1 ? 120 : Math.max(40, textW(h) + 12);
      return { h, w };
    });
    let x = 20;
    for (const c of cols) { c.left = x; c.right = x + c.w; x += c.w; }
    const row = (cells, { bold = false } = {}) => {
      cells.forEach((v, i) => {
        const c = cols[i];
        if (i === 1) return cell(v, c.left + 6, y, { bold });
        if (i === 0 && /^Total/.test(v)) return cell(v, 6, y, { bold });
        // Made/attempted cells are drawn in pieces — "11", "/", "13" — as HUDL does.
        const pair = v.match(/^(\S+) \/ (\S+)$/);
        if (pair && !bold) {
          const right = c.right - 8;
          cell(pair[2], right, y, { align: 'right' });
          cell('/', right - textW(pair[2]) - 2, y, { align: 'right' });
          return cell(pair[1], right - textW(pair[2]) - textW('/') - 6, y, { align: 'right' });
        }
        cell(v, c.right - 8, y, { bold, align: 'right' });
      });
      y += 25;
    };
    const header = () => { fill(20, y - 18, x - 20, 22); row(s.header, { bold: true }); };

    if (y + 120 > PAGE_ROWS) newPage();
    cell(s.title, 20, y, { bold: true });
    y += 39;
    header();
    s.rows.forEach((r, i) => {
      if (i === s.breakAfter || y + 25 > PAGE_ROWS) {
        if (i > 0) row(s.total, { bold: true });            // the footer repeats too
        newPage();
        header();
      }
      row(r);
    });
    row(s.total, { bold: true });
    y += 48;
  }

  // ---- assemble the file
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const stream = (dict, data) => {
    const z = zlib.deflateSync(Buffer.from(data, 'latin1'));
    return Buffer.concat([Buffer.from(`<< ${dict} /Length ${z.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), z, Buffer.from('\nendstream', 'latin1')]);
  };
  const font = (name, map) => {
    const ordered = [...map.entries()].sort((a, b) => a[1] - b[1]);
    const uni = ordered.map(([ch]) => `<${ch.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}>`).join(' ');
    const cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
      '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n2 beginbfrange\n<0000> <0000> <0000>\n' +
      `<0001> <${ordered.length.toString(16).padStart(4, '0').toUpperCase()}> [${uni} ]\nendbfrange\nendcmap\n` +
      'CMapName currentdict /CMap defineresource pop\nend\nend\n';
    const toUni = add(stream('', cmap));
    const w = ordered.map(([ch]) => width(ch)).join(' ');
    const cid = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /CIDToGIDMap /Identity /W [0 [500 ${w}]] >>`);
    return add(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUni} 0 R >>`);
  };
  const catalog = add(null);
  const pagesObj = add(null);
  const bold = font('TahomaBold', gid.bold);
  const regular = font('TahomaRegular', gid.regular);
  const kids = [];
  for (const ops of pages) {
    const content = add(stream('', `1 0 0 -1 28 764 cm\nq\n0.600161969 0 0 0.600161969 0 0 cm\n${ops.join('')}Q\n`));
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /Contents ${content} 0 R /Resources << /Font << /F6 ${bold} 0 R /F7 ${regular} 0 R >> >> /MediaBox [0 0 612 792] >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let offset = parts[0].length;
  const xref = [];
  objs.forEach((body, i) => {
    const buf = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'),
      Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]);
    xref.push(offset);
    offset += buf.length;
    parts.push(buf);
  });
  parts.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    xref.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}
