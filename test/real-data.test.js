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
import { detectStatsFormat } from '../src/importers/index.js';

// Checked at the project root and in a "Hudl Files/" subfolder, which is where
// the working copy keeps them. Both are gitignored.
const find = (name) => {
  for (const rel of [`../${name}`, `../Hudl Files/${name}`]) {
    const u = new URL(rel, import.meta.url);
    if (fs.existsSync(u)) return u;
  }
  return new URL(`../${name}`, import.meta.url);   // reported as missing
};
const FILES = {
  perGame: find('HUDL PER GAME.txt'),
  season: find('HUDL SEASON.html'),
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

if (fs.existsSync(FILES.pdf)) {
  eq('MaxPreps PDF still detected as pdf',
    detectStatsFormat(fs.readFileSync(FILES.pdf, 'latin1')), 'pdf');
}

console.log(`\n  ${pass} passed, ${fail} failed (real-data checks)\n`);
process.exit(fail ? 1 : 0);
