/* HUDL season stats as a PDF, and the log every stat import now leaves behind. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.js';
import { registerRoutes } from '../src/api.js';
import { PDF } from '../src/exports/pdf.js';
import { extractPdfText, pdfLines } from '../src/importers/pdftext.js';
import { parseHudlSeasonPDF, parseHudlSeasonHTML } from '../src/importers/hudl.js';
import { detectStatsFormat, importStatsAuto, compareImports, rosterNewcomers } from '../src/importers/index.js';
import { hudlSeasonPdf, SECTIONS, SUMMARY } from './fixtures/hudl-season-pdf.js';

let pass = 0, fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
};
const ok = (l, c, x = '') => { console.log(`${c ? '  ok  ' : '  FAIL'} ${l}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };
const throws = (l, fn, re) => {
  try { fn(); ok(l, false, 'did not throw'); } catch (e) { ok(l, re.test(e.message), e.message.slice(0, 70)); }
};
const clone = (x) => JSON.parse(JSON.stringify(x));

/* ------------------------------------------------------------------ */
console.log('\n== PDF text extraction ==');
const pdf = hudlSeasonPdf();
const ex = extractPdfText(pdf);
eq('every page read', ex.pages.length, 3);
const lines = pdfLines(ex);
const defHeader = lines.find((l) => l.runs.some((r) => r.text === 'TACKLE'));
// The headers sit a space apart; only the PDF's own cell boundaries keep them separate.
ok('cells drawn side by side stay separate runs', defHeader && defHeader.runs.some((r) => r.text === 'SOLO'),
  defHeader?.runs.slice(3, 6).map((r) => r.text).join(' | '));
ok('a name with spaces stays one run', lines.some((l) => l.runs.some((r) => r.text === 'Rest of team')));
ok('decoded through each font\'s own ToUnicode map',
  lines.some((l) => l.text.startsWith('Season Stats & Team Leaders')) && lines.some((l) => l.text.startsWith('Total yds')));
ok('lines come top to bottom', lines[0].text.startsWith('Season Stats'), lines[0].text);

// Our own report writer: Type1 Helvetica, literal strings, no ToUnicode.
const own = new PDF();
own.text(40, 60, 'Box Score (Final)', { size: 14, bold: true });
own.text(40, 80, 'Rushing 12-88');
own.text(300, 80, '1,595', { align: 'right' });
const ownLines = pdfLines(extractPdfText(own.build()));
eq('plain single-byte fonts and escaped parens', ownLines.map((l) => l.text), ['Box Score (Final)', 'Rushing 12-88 1,595']);
throws('not a PDF at all', () => extractPdfText(Buffer.from('Name,No\nA,1')), /not a pdf/i);

/* ------------------------------------------------------------------ */
console.log('\n== HUDL season PDF ==');
eq('detected as a PDF', detectStatsFormat(pdf), 'pdf');
const hs = importStatsAuto(pdf, 'football');
eq('read as the HUDL season report', hs.kind, 'hudl-season-pdf');
eq('all eight sections', hs.sections.map((s) => s.key),
  ['passing', 'rushing', 'receiving', 'defense', 'kicking', 'punting', 'kickoff_return', 'punt_return']);
eq('no warnings — every total checks out', hs.warnings, []);
const P = (name) => hs.players.find((p) => p.name === name);
eq('passing line', ['pass_comp', 'pass_att', 'pass_yds', 'pass_td', 'pass_int', 'pass_long', 'sacked', 'rating']
  .map((k) => P('R. Riverton').stats[k]), [41, 91, 579, 8, 4, 67, 1, 77]);
eq('one player across tables', [P('R. Riverton').stats.rush_att, P('R. Riverton').stats.rush_yds, P('R. Riverton').sections],
  [11, 11, ['passing', 'rushing']]);
eq('negative yards kept', P('T. Velasquez').stats.rush_yds, -9);
ok('"-" read as absent', !('pass_td' in P('K. Ashby').stats) && !('rush_long' in P('T. Velasquez').stats));
eq('a table split by a page break is one table', hs.sections.find((s) => s.key === 'receiving').players, 4);
eq('rows after the break land in the right columns', [P('D. Whitfield').stats.rec, P('D. Whitfield').stats.rec_yds, P('D. Whitfield').stats.rec_td], [14, 191, 2]);
eq('a heading at the foot of a page still owns the next page', P('B. Cornell').stats.kick_pts, 11);
eq('"- / 1" and "11 / 13" drawn in pieces', [P('B. Cornell').stats.fgm, P('B. Cornell').stats.fga, P('B. Cornell').stats.xpm, P('B. Cornell').stats.xpa],
  [undefined, 1, 11, 13]);
eq('defense, including DEF TD', ['tackles_total', 'sacks', 'tfl', 'def_int', 'def_td'].map((k) => P('S. Darrow').stats[k]), [11, 2, 3, 1, 1]);
eq('kickoff and punt returns kept apart', [P('C. Jameson').stats.kr, P('C. Jameson').stats.kr_yds, P('C. Jameson').stats.pr, P('C. Jameson').stats.pr_yds],
  [3, 69, 3, 12]);
eq('return TDs from both tables add up', P('C. Jameson').stats.ret_td, 2);
eq('games played is the most of any table', P('C. Jameson').stats.games, 5);
ok('"Rest of team" and "Total:" are not players', !hs.players.some((p) => /rest of team|total/i.test(p.name)));
eq('each table keeps its own row order', hs.sections.find((s) => s.key === 'receiving').order,
  ['1|j. lanniston', '4|d. whitfield', '6|c. jameson', '21|j. okafor']);
eq('sections carry their columns', hs.sections.find((s) => s.key === 'kicking').cols.map(([k]) => k),
  ['games', 'fgm', 'fga', 'fg_long', 'xpm', 'xpa', 'kick_pts']);

console.log('\n== team and opponent totals ==');
eq('games out of the schedule', [hs.team.games, hs.team.scheduled], [5, 10]);
eq('abbreviations', [hs.team.abbrev, hs.team.opponents.abbrev], ['RIVER', 'OPP']);
eq('team line', ['total_yards', 'pass_comp', 'pass_att', 'pass_pct', 'rush_att', 'rush_avg', 'first_downs', 'sacks']
  .map((k) => hs.team.stats[k]), [1184, 42, 92, 45.65, 137, 4.38, 54, 8]);
eq('"(22.64 %) 12" is 12 conversions at 22.64%', [hs.team.stats.third_conv, hs.team.stats.third_pct], [12, 22.64]);
eq('opponent line', [hs.team.opponents.stats.total_yards, hs.team.opponents.stats.rush_ypg, hs.team.opponents.stats.fourth_conv], [1347, 164.4, 6]);
eq('a row HUDL adds later still imports', [hs.team.stats.penalty_yards, hs.team.opponents.stats.penalty_yards], [212, 180]);
ok('team leaders beside the totals are left out',
  !Object.keys(hs.team.stats).some((k) => /passing$|rushing$|riverton|calder/.test(k)), Object.keys(hs.team.stats).length + ' keys');

console.log('\n== totals catch a value in the wrong column ==');
const bad = clone(SECTIONS);
bad[1].total[4] = '450';                                    // rushing YDS
const badRun = parseHudlSeasonPDF(hudlSeasonPdf({ sections: bad }));
ok('a sum that disagrees is reported', badRun.warnings.some((w) => /Rushing Stats.*440 rush_yds.*450/.test(w)), badRun.warnings[0]);

const noSummary = parseHudlSeasonPDF(hudlSeasonPdf({ summary: { ...SUMMARY, title: 'Season Stats', rows: [], leaders: [] } }));
eq('without the summary block there are no team totals', noSummary.team, null);
eq('...and the players still import', noSummary.players.length, hs.players.length);

console.log('\n== other PDFs ==');
throws('a PDF that is not HUDL\'s report is refused, with a way forward', () => importStatsAuto(own.build(), 'football'), /CSV|copy/i);
throws('a PDF mangled by being read as text says so', () => importStatsAuto(pdf.toString('utf8'), 'football'), /damaged/);

console.log('\n== the HTML season page shares the same reader ==');
const html = parseHudlSeasonHTML(fs.readFileSync(new URL('./fixtures/hudl-season.html', import.meta.url), 'utf8'));
eq('HTML sections carry columns too', html.sections.find((s) => s.key === 'passing').cols.slice(0, 3), [['games', 'GAMES'], ['pass_comp', 'CMP'], ['pass_att', 'ATT']]);
eq('HTML totals agree', html.warnings.filter((w) => /add up/.test(w)), []);

/* ------------------------------------------------------------------ */
console.log('\n== comparing an import with the one it replaces ==');
const first = compareImports(null, { players: [{ number: '1', name: 'A', stats: { x: 1 } }] });
eq('a first import adds everyone, stats included', first.added, [{ number: '1', name: 'A', stats: { x: 1 } }]);
const prev = { players: [{ number: '1', name: 'A', stats: { x: 1, y: 2 } }, { number: '2', name: 'B', stats: { x: 4 } }, { number: '3', name: 'C', stats: { x: 5 } }],
  team: { games: 4, scheduled: 10, stats: { total_yards: 900 }, opponents: { stats: { total_yards: 1000 } } } };
const next = { players: [{ number: '1', name: 'A', stats: { x: 3, y: 2 } }, { number: '3', name: 'C', stats: { x: 5 } }, { number: '9', name: 'D', stats: { x: 1 } }],
  team: { games: 5, scheduled: 10, stats: { total_yards: 1184 }, opponents: { stats: { total_yards: 1000 } } } };
const d = compareImports(prev, next);
eq('changed stats keep old and new', d.changed, [{ number: '1', name: 'A', stats: { x: [1, 3] } }]);
eq('a removed player keeps the old line', d.removed, [{ number: '2', name: 'B', stats: { x: 4 } }]);
eq('added and unchanged', [d.added.map((p) => p.name), d.unchanged], [['D'], 1]);
eq('team totals compared', d.team, { games: [4, 5], 'team.total_yards': [900, 1184] });
const same = compareImports(next, clone(next));
eq('re-importing the same file changes nothing', [same.changed.length, same.added.length, same.removed.length, same.team], [0, 0, 0, null]);

console.log('\n== who a stat import adds to the roster ==');
const roster = [{ number: '11', name: 'Riley Riverton', pos: 'QB' }, { number: '7', name: 'J. Morrow' }];
eq('only players the roster lacks', rosterNewcomers(roster, [
  { number: '11', name: 'R. Riverton' },          // HUDL's short form of a roster name
  { number: '7', name: 'J. Morrow' },             // exact
  { number: '8', name: 'j. morrow' },             // same person, new number
  { number: '7', name: '' },                      // per-game file: number only
  { number: '11', name: 'K. Riverton' },          // a different player wearing 11
  { number: '9', name: 'B. Sommerville' }
]).map((p) => `${p.number} ${p.name}`), ['11 K. Riverton', '9 B. Sommerville']);

/* ------------------------------------------------------------------ */
console.log('\n== the import log, through the API ==');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ose-v8-'));
const store = new Store(root);
store.updateConfig({ season: '2026' });
const routes = new Map();
registerRoutes((method, pattern, handler) => routes.set(`${method} ${pattern}`, handler), { store, broadcast: () => {}, scorebot: {} });
const call = (method, pattern, { params = {}, query = {}, body = null } = {}) => routes.get(`${method} ${pattern}`)({ params, query, body });
const IMPORT = 'POST /api/teams/:id/stats/import';
const importPdf = (buf, extra = {}) => call('POST', '/api/teams/:id/stats/import',
  { params: { id: 'river' }, body: { sport: 'football', base64: buf.toString('base64'), source: 'hudl-season.pdf', ...extra } });

store.saveTeam({ name: 'River' });
store.saveRoster('river', 'football', [
  { number: '11', name: 'Riley Riverton', pos: 'QB', year: '12' },
  { number: '7', name: 'J. Morrow', pos: 'LB', year: '11' }
], 'replace');
ok('route registered', routes.has(IMPORT) && routes.has('GET /api/teams/:id/imports'));

const pv = importPdf(pdf, { preview: true });
eq('preview: nothing to replace yet', [pv.preview, pv.replaces, pv.changes.added.length], [true, null, 13]);
eq('preview saves nothing and logs nothing', [store.getImportedStats('river', 'football', '2026'), store.readImportLog().length], [null, 0]);

const r1 = importPdf(pdf);
eq('first import', [r1.ok, r1.imported, r1.kind, r1.season, r1.replaced], [true, 13, 'hudl-season-pdf', '2026', null]);
const set1 = store.getImportedStats('river', 'football', '2026');
eq('stored with its source, sections and team totals', [set1.source, set1.label, set1.sections.length, set1.team.games], ['hudl-season.pdf', 'hudl-season.pdf', 8, 5]);
const log1 = store.readImportLog({ teamId: 'river' });
eq('one log entry', log1.map((e) => [e.action, e.sport, e.season, e.kind, e.players, e.games, e.scheduled]),
  [['import', 'football', '2026', 'hudl-season-pdf', 13, 5, 10]]);
eq('the entry holds every imported line', log1[0].changes.added.length, 13);

const rost = store.getRoster('river', 'football');
eq('roster entries keep their position and grade', rost.filter((p) => ['11', '7'].includes(p.number)).map((p) => [p.name, p.pos, p.year]),
  [['J. Morrow', 'LB', '11'], ['Riley Riverton', 'QB', '12']]);
ok('"R. Riverton" did not become a second #11', rost.filter((p) => p.number === '11').length === 1);
eq('players new to the roster were added, and logged', [rost.length, log1[0].rosterAdded.length], [13, 11]);

// A week later: one more game in the file.
const week6 = clone(SECTIONS);
week6[0].rows[0] = ['11', 'R. Riverton', '6', '50', '110', '45.45 %', '700', '6.36', '116.67', '67', '10', '4', '1', '80'];
week6[0].total = ['Total:', '', '', '51', '111', '45.95 %', '705', '6.35', '117.50', '', '10', '4', '1', '80'];
week6[3].rows.splice(3, 1);                                         // M. Crane drops off the sheet
week6[3].rows.splice(1, 0, ['20', 'A. Calloway', '1', '3', '1', '2', '-', '-', '-', '-', '-', '-', '-', '-', '-']);
week6[3].total = ['Total:', '', '', '106', '26', '80', '2', '6', '-', '6', '-', '1', '2', '-', '1'];
const pdf6 = hudlSeasonPdf({ sections: week6, summary: { ...SUMMARY, title: 'Season Stats & Team Leaders for 6 out of 10 games' } });

const pv2 = importPdf(pdf6, { preview: true, source: 'hudl-week6.pdf' });
eq('preview names the set it would replace', [pv2.replaces.label, pv2.replaces.players, pv2.replaces.games], ['hudl-season.pdf', 13, 5]);
eq('...and what would change', [pv2.changes.changed.map((c) => c.name), pv2.changes.added.map((c) => c.name), pv2.changes.removed.map((c) => c.name)],
  [['R. Riverton'], ['A. Calloway'], ['M. Crane']]);
eq('nothing written by the preview', store.readImportLog().length, 1);

const r2 = importPdf(pdf6, { source: 'hudl-week6.pdf' });
eq('second import reports the overwrite', [r2.replaced.label, r2.changes.changed.length], ['hudl-season.pdf', 1]);
const log2 = store.readImportLog({ teamId: 'river' });
eq('logged as an overwrite', log2.map((e) => e.action), ['import', 'overwrite']);
const ow = log2[1];
eq('the overwrite records what it replaced', [ow.replaced.label, ow.replaced.importedAt === set1.importedAt, ow.replaced.games], ['hudl-season.pdf', true, 5]);
eq('old and new values for each changed stat', ow.changes.changed[0].stats.pass_yds, [579, 700]);
eq('a removed player\'s old line is kept', ow.changes.removed[0], { number: '16', name: 'M. Crane', stats: P('M. Crane').stats });
eq('team totals change with the games played', ow.changes.team.games, [5, 6]);
eq('the team file holds the new set', store.getImportedStats('river', 'football', '2026').players.find((p) => p.name === 'R. Riverton').stats.pass_yds, 700);

const r3 = importPdf(pdf, { source: 'hudl-season.pdf' });
ok('importing an older file over a newer one is flagged', r3.warnings[0]?.includes('covers 5 game(s); the set it replaces covers 6'), r3.warnings[0]);

const listed = call('GET', '/api/teams/:id/imports', { params: { id: 'river' }, query: { sport: 'football' } });
eq('the log endpoint is newest first', listed.entries.map((e) => e.label), ['hudl-season.pdf', 'hudl-week6.pdf', 'hudl-season.pdf']);
eq('...and filters by sport', call('GET', '/api/teams/:id/imports', { params: { id: 'river' }, query: { sport: 'basketball' } }).entries, []);

const hist = call('GET', '/api/teams/:id/history', { params: { id: 'river' }, query: { sport: 'football' } });
const imp = hist.seasons[0].imported;
eq('history shows the imported set', [imp.kind, imp.source, imp.team.games, imp.sections.length], ['hudl-season-pdf', 'hudl-season.pdf', 5, 8]);

// A per-game file names nobody; it must not add nameless players any more.
const before = store.getRoster('river', 'football').length;
call('POST', '/api/teams/:id/stats/import', { params: { id: 'river' }, body: { sport: 'football', season: '2025',
  csv: fs.readFileSync(new URL('./fixtures/hudl-pergame.txt', import.meta.url), 'utf8') } });
eq('a per-game import leaves the roster alone', store.getRoster('river', 'football').length, before);
eq('...and is logged under its own season', store.readImportLog({ teamId: 'river' }).at(-1).season, '2025');

console.log('\n== the log is part of the data ==');
fs.appendFileSync(store.importLogPath, '{"torn":');
eq('a torn final line is skipped', store.readImportLog().length, 4);
const snap = store.backup();
ok('backups include imports.jsonl', fs.existsSync(path.join(snap, 'imports.jsonl')));

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
