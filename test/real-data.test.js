/**
 * Validates the importers against real HUDL / MaxPreps exports.
 *
 * Those files contain real students' names and stats, so they are NOT in the
 * repository. Drop them in the project root and this runs; otherwise it skips.
 * The committed fixtures in test/fixtures/ mirror their format exactly, so the
 * main suite still covers the parsers without publishing anyone's data.
 */
import fs from 'node:fs';
import { parseHudlPerGame, parseHudlSeasonHTML } from '../src/importers/hudl.js';
import { detectStatsFormat, importStatsAuto } from '../src/importers/index.js';

// Checked at the project root and in a "Hudl Files/" subfolder, which is where
// the working copy keeps them. Both are gitignored.
const find = (name) => {
  for (const rel of [`../${name}`, `../Hudl Files/${name}`]) {
    const u = new URL(rel, import.meta.url);
    if (fs.existsSync(u)) return u;
  }
  return new URL(`../${name}`, import.meta.url);   // reported as missing
};
// HUDL names its season PDF download "hudl-season_stats_<ids>.pdf"; take
// that name as it comes, or one renamed to "HUDL SEASON.pdf".
const findSeasonPdf = () => {
  for (const rel of ['../', '../Hudl Files/']) {
    const dir = new URL(rel, import.meta.url);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    const hit = names.find((n) => /^(hudl season\.pdf|hudl-season_stats.*\.pdf)$/i.test(n));
    if (hit) return new URL(hit, dir);
  }
  return new URL('../HUDL SEASON.pdf', import.meta.url);
};
const FILES = {
  perGame: find('HUDL PER GAME.txt'),
  season: find('HUDL SEASON.html'),
  seasonPdf: findSeasonPdf(),
  pdf: find('MAXPREPS EXAMPLE.pdf')
};

const present = Object.entries(FILES).filter(([, u]) => fs.existsSync(u)).map(([k]) => k);
if (!present.length) {
  console.log('\n  (skipped) No real HUDL/MaxPreps exports in the project root — ' +
    'the committed fixtures cover these parsers.\n');
  process.exit(0);
}

let pass = 0, fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
};
const ok = (l, c, x = '') => { console.log(`${c ? '  ok  ' : '  FAIL'} ${l}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };

console.log(`\n== real exports found: ${present.join(', ')} ==`);

if (fs.existsSync(FILES.perGame)) {
  const txt = fs.readFileSync(FILES.perGame, 'utf8');
  eq('per-game detected', detectStatsFormat(txt), 'hudl-pergame');
  const roster = ['1', '2', '3', '4', '6', '7', '11', '28', '33', '48', '56', '57'];
  const hp = parseHudlPerGame(txt, { rosterNums: roster });
  eq('this team only', hp.players.length, 12);
  ok('other team surfaced', hp.unmatched.length === 13, `${hp.unmatched.length} rows`);
  const qb = hp.players.find((p) => p.number === '11');
  eq('QB line', [qb.stats.pass_comp, qb.stats.pass_att, qb.stats.pass_yds, qb.stats.pass_td], [11, 17, 188, 4]);
  const wr = hp.players.find((p) => p.number === '1');
  eq('split rows summed', [wr.stats.rec, wr.stats.rec_yds, wr.stats.rec_td], [7, 154, 4]);
  eq('long is the max', wr.stats.rec_long, 46);
}

if (fs.existsSync(FILES.season)) {
  const html = fs.readFileSync(FILES.season, 'utf8');
  eq('season detected', detectStatsFormat(html), 'hudl-season');
  const hs = parseHudlSeasonHTML(html);
  eq('all sections', hs.sections.length, 8);
  ok('players parsed', hs.players.length > 40, `${hs.players.length} players`);
  const kick = hs.players.find((p) => p.stats.fga);
  ok('made/attempted pairs split', kick && kick.stats.fgm <= kick.stats.fga,
    kick ? `${kick.stats.fgm}/${kick.stats.fga}` : 'none');
  ok('no totals rows leaked in', !hs.players.some((p) => /rest of team|total/i.test(p.name)));
}

if (fs.existsSync(FILES.seasonPdf)) {
  const buf = fs.readFileSync(FILES.seasonPdf);
  eq('season PDF detected', detectStatsFormat(buf), 'pdf');
  const hp = importStatsAuto(buf, 'football');
  eq('season PDF read as HUDL', hp.kind, 'hudl-season-pdf');
  eq('season PDF: all sections', hp.sections.length, 8);
  eq('season PDF: every total checks out', hp.warnings.filter((w) => /add up/.test(w)), []);
  ok('season PDF: players parsed', hp.players.length > 20, `${hp.players.length} players`);
  ok('season PDF: team totals', hp.team && hp.team.games > 0 && hp.team.stats.total_yards > 0,
    hp.team ? `${hp.team.games} of ${hp.team.scheduled} games` : 'none');
  ok('season PDF: no totals rows leaked in', !hp.players.some((p) => /rest of team|total/i.test(p.name)));
}

if (fs.existsSync(FILES.pdf)) {
  eq('MaxPreps PDF still detected as pdf',
    detectStatsFormat(fs.readFileSync(FILES.pdf, 'latin1')), 'pdf');
}

console.log(`\n  ${pass} passed, ${fail} failed (real-data checks)\n`);
process.exit(fail ? 1 : 0);
