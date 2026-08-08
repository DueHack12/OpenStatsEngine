/* Announcer view: notable-play detection, credit attribution, milestones,
   watch list and storylines. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.js';
import { deriveGame } from '../src/engine.js';
import { announcerView } from '../src/announcer.js';

let pass = 0, fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
};
const ok = (l, c, x = '') => { console.log(`${c ? '  ok  ' : '  FAIL'} ${l}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ose-ann-'));
const store = new Store(root);
store.saveTeam({ name: 'Home', abbrev: 'HOM' });
store.saveTeam({ name: 'Away', abbrev: 'AWY' });
const R = [{ number: '11', name: 'QB One' }, { number: '1', name: 'WR One' },
           { number: '2', name: 'RB One' }, { number: '7', name: 'LB One' }, { number: '28', name: 'K One' }];
const R2 = [{ number: '9', name: 'Opp QB' }, { number: '22', name: 'Opp RB' }];
store.saveRoster('home', 'football', R, 'replace');
store.saveRoster('away', 'football', R2, 'replace');
const H = store.getRoster('home', 'football'), A = store.getRoster('away', 'football');
const id = (r, n) => r.find((p) => p.number === n).id;

const g0 = store.createGame({ sport: 'football', homeTeamId: 'home', awayTeamId: 'away', date: '2026-09-25' });
const G = g0.id;
const ev = (team, action, data, clockMs = 600000) =>
  store.appendEvent(G, { type: 'stat', team, action, data, period: 1, clockMs });
const view = () => announcerView(store, G, deriveGame(store, G));

console.log('\n== notable plays ==');
ev('home', 'rush', { rusher: id(H, '2'), yards: 3 });
eq('a routine 3-yard run is not notable', view().notables.length, 0);
ev('home', 'rush', { rusher: id(H, '2'), yards: 24 });
eq('a 24-yard run is', view().notables.length, 1);
eq('level', view().notables[0].level, 'big');
eq('headline', view().notables[0].headline, 'BIG RUN');
ev('home', 'pass_complete', { passer: id(H, '11'), receiver: id(H, '1'), yards: 40, td: true });
eq('touchdown is huge', view().notables[0].level, 'huge');
eq('detail names both players', view().notables[0].detail, '#11 QB One 40 yd TD pass to #1 WR One');

console.log('\n== credit goes to the team that made the play ==');
// The sack is logged against the away offence but belongs to the home defence.
ev('away', 'sack', { passer: id(A, '9'), by: id(H, '7'), yards: 8 });
let n = view().notables[0];
eq('sack credited to the defence', n.teamAbbrev, 'HOM');
eq('sack headline', n.headline, 'SACK');
ev('away', 'pass_int', { passer: id(A, '9'), by: id(H, '7'), returnYards: 30, td: true });
n = view().notables[0];
eq('pick six credited to the defence', n.teamAbbrev, 'HOM');
eq('pick six headline', n.headline, 'PICK SIX');
ok('carries the crediting team colour', !!n.color);
ok('carries period and clock for the popup', n.periodLabel === '1st' && !!n.clock, `${n.periodLabel} ${n.clock}`);

console.log('\n== milestones ==');
// QB One: 3 passing TDs, but he scored none of them himself.
ev('home', 'pass_complete', { passer: id(H, '11'), receiver: id(H, '1'), yards: 30, td: true });
ev('home', 'pass_complete', { passer: id(H, '11'), receiver: id(H, '1'), yards: 20, td: true });
let v = view();
const qbMiles = v.milestones.filter((m) => m.name === 'QB One');
ok('QB gets the passing-TD milestone', qbMiles.some((m) => m.stat === 'pass_td'), qbMiles.map((m) => m.stat).join(','));
ok('QB is NOT credited with scoring those touchdowns',
  !qbMiles.some((m) => m.stat === 'scored_td'), qbMiles.map((m) => m.text).join(' | '));
const wrMiles = v.milestones.filter((m) => m.name === 'WR One');
ok('receiver IS credited with the touchdowns he scored',
  wrMiles.some((m) => m.stat === 'scored_td'), wrMiles.map((m) => m.text).join(' | '));
// 40 + 30 + 20 = 90 receiving yards — under the line, so it should be a *watch*
ok('at 90 yards it is a watch item, not a milestone',
  !wrMiles.some((m) => m.stat === 'rec_yds') &&
  v.watch.some((w) => w.name === 'WR One' && w.stat === 'rec_yds' && w.need === 10),
  v.watch.find((w) => w.stat === 'rec_yds')?.text);
ev('home', 'pass_complete', { passer: id(H, '11'), receiver: id(H, '1'), yards: 15 });
v = view();
ok('crossing 100 moves it to milestones',
  v.milestones.some((m) => m.name === 'WR One' && m.stat === 'rec_yds' && m.threshold === 100),
  v.milestones.filter((m) => m.name === 'WR One').map((m) => m.text).join(' | '));
ok('and it leaves the watch list', !v.watch.some((w) => w.name === 'WR One' && w.stat === 'rec_yds' && w.threshold === 100));

console.log('\n== watch list ==');
// Put a yardage chase back on the board so ordering can be checked.
ev('home', 'rush', { rusher: id(H, '2'), yards: 55 });   // RB One to 82 — 18 short of 100
v = view();
ok('a yardage chase surfaces', v.watch.some((w) => w.yardage), v.watch.map((w) => w.stat).join(','));
const firstCount = v.watch.findIndex((w) => !w.yardage);
const lastYardage = v.watch.map((w) => w.yardage).lastIndexOf(true);
ok('yardage chases are listed before count chases',
  firstCount === -1 || lastYardage < firstCount, v.watch.map((w) => `${w.stat}${w.yardage ? '(yd)' : ''}`).join(' > '));
ok('no filler for a player with nothing on the board',
  !v.watch.some((w) => w.value === 0));
eq('watch list is capped', v.watch.length <= 6, true);

console.log('\n== storylines ==');
ok('a big unanswered run is called out', v.storylines.some((s) => s.kind === 'run'), v.storylines.map((s) => s.text).join(' | '));

console.log('\n== other sports do not crash and do detect their own plays ==');
for (const [sport, action, data, expect] of [
  ['basketball', 'fg3_made', { player: null }, 'THREE'],
  ['hockey', 'goal', { scorer: null, strength: 'PP' }, 'GOAL'],
  ['soccer', 'red', { player: null }, 'RED CARD'],
  ['lacrosse', 'goal', { scorer: null }, 'GOAL'],
  ['baseball', 'home_run', { batter: null, rbi: 2 }, 'HOME RUN']
]) {
  store.saveRoster('home', sport, [{ number: '1', name: 'P One' }], 'replace');
  store.saveRoster('away', sport, [{ number: '9', name: 'O One' }], 'replace');
  const pid = store.getRoster('home', sport)[0].id;
  const gm = store.createGame({ sport, homeTeamId: 'home', awayTeamId: 'away', date: '2026-04-0' + sport.length });
  const d = { ...data };
  for (const k of Object.keys(d)) if (d[k] === null) d[k] = pid;
  store.appendEvent(gm.id, { type: 'stat', team: 'home', action, data: d, period: 1, clockMs: 500000 });
  const av = announcerView(store, gm.id, deriveGame(store, gm.id));
  ok(`${sport}: "${expect}" detected`, av.notables[0]?.headline === expect,
    av.notables[0]?.headline || '(none)');
}

console.log('\n== a game with no plays produces an empty, non-crashing view ==');
const quiet = store.createGame({ sport: 'football', homeTeamId: 'home', awayTeamId: 'away', date: '2026-12-01' });
const qv = announcerView(store, quiet.id, deriveGame(store, quiet.id));
eq('no notables', qv.notables.length, 0);
eq('no milestones', qv.milestones.length, 0);
eq('no watch', qv.watch.length, 0);
eq('no storylines', qv.storylines.length, 0);

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${'='.repeat(52)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(52)}\n`);
process.exit(fail ? 1 : 0);
