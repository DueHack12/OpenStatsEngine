/* Redo, the period cap, and timeout/penalty popups. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.js';
import { deriveGame } from '../src/engine.js';
import { announcerView } from '../src/announcer.js';
import { clockFromEvents, periodLabel } from '../src/clock.js';
import { getSport } from '../src/sports/index.js';

let pass = 0, fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
};
const ok = (l, c, x = '') => { console.log(`${c ? '  ok  ' : '  FAIL'} ${l}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ose-v5-'));
const store = new Store(root);
store.saveTeam({ name: 'Home', abbrev: 'HOM' });
store.saveTeam({ name: 'Away', abbrev: 'AWY' });
store.saveRoster('home', 'football', [{ number: '2', name: 'RB One' }, { number: '55', name: 'DL One' }], 'replace');
store.saveRoster('away', 'football', [{ number: '9', name: 'QB Two' }], 'replace');
const H = store.getRoster('home', 'football');
const g0 = store.createGame({ sport: 'football', homeTeamId: 'home', awayTeamId: 'away', date: '2026-11-06' });
const G = g0.id;
const rb = H.find((p) => p.number === '2').id;

console.log('\n== undo / redo ==');
const e1 = store.appendEvent(G, { type: 'stat', team: 'home', action: 'rush', period: 1, clockMs: 600000, data: { rusher: rb, yards: 12, td: true } });
const e2 = store.appendEvent(G, { type: 'stat', team: 'home', action: 'rush', period: 1, clockMs: 580000, data: { rusher: rb, yards: 5 } });
eq('both plays count', deriveGame(store, G).teams.home.rush_yds, 17);
eq('score from the TD', deriveGame(store, G).teams.home.points, 6);

store.undoEvent(G, e1.id);
eq('undo removes the yardage', deriveGame(store, G).teams.home.rush_yds, 5);
eq('undo removes the score', deriveGame(store, G).teams.home.points, 0);
eq('it is listed as undone', deriveGame(store, G).undone.map((u) => u.id), [e1.id]);
eq('undone count reported', deriveGame(store, G).counts.undone, 1);

store.redoEvent(G, e1.id);
let d = deriveGame(store, G);
eq('redo puts the yardage back', d.teams.home.rush_yds, 17);
eq('redo puts the score back', d.teams.home.points, 6);
eq('nothing left undone', d.undone.length, 0);
ok('the whole sequence is still in the log',
  store.readEvents(G).filter((e) => e.type === 'undo' || e.type === 'redo').length === 2);

console.log('\n== undo again after a redo, and redo again ==');
store.undoEvent(G, e1.id);
eq('undone once more', deriveGame(store, G).teams.home.points, 0);
store.redoEvent(G, e1.id);
eq('and restored again', deriveGame(store, G).teams.home.points, 6);
ok('last marker wins regardless of how many there are',
  store.readEvents(G).filter((e) => ['undo', 'redo'].includes(e.type)).length === 4);

console.log('\n== redo only affects its own target ==');
store.undoEvent(G, e1.id);
store.undoEvent(G, e2.id);
eq('both undone', deriveGame(store, G).teams.home.rush_yds, 0);
store.redoEvent(G, e2.id);
d = deriveGame(store, G);
eq('only e2 came back', d.teams.home.rush_yds, 5);
eq('e1 still undone', d.undone.map((u) => u.id), [e1.id]);

console.log('\n== period labels ==');
for (const [sport, checks] of [
  ['football', [[4, '4th'], [5, 'OT'], [6, '2OT'], [7, '3OT']]],
  ['hockey', [[3, '3rd'], [4, 'OT'], [6, '3OT']]],
  ['baseball', [[7, '7th'], [8, '8th'], [10, '10th'], [21, '21st'], [22, '22nd'], [23, '23rd']]]
]) {
  const st = clockFromEvents([], getSport(sport), {});
  for (const [n, want] of checks) eq(`${sport} period ${n}`, periodLabel(st, n), want);
}
ok('baseball extra innings are innings, not overtime',
  periodLabel(clockFromEvents([], getSport('baseball'), {}), 9) === '9th');

console.log('\n== overtime caps are declared per sport ==');
for (const [sport, cap] of [['football', 3], ['basketball', 3], ['hockey', 3], ['soccer', 3], ['lacrosse', 3]]) {
  eq(`${sport} max overtimes`, getSport(sport).periods.maxOvertimes, cap);
}
ok('baseball is effectively uncapped for extra innings',
  getSport('baseball').periods.maxOvertimes >= 20, String(getSport('baseball').periods.maxOvertimes));

console.log('\n== timeout and penalty popups ==');
store.appendEvent(G, { type: 'stat', team: 'home', action: 'timeout', period: 2, clockMs: 300000, data: {} });
let av = announcerView(store, G, deriveGame(store, G));
let n = av.notables[0];
eq('timeout raises a note', [n.headline, n.level], ['TIMEOUT', 'note']);
ok('timeout names the team', /Home/.test(n.detail), n.detail);
store.appendEvent(G, { type: 'stat', team: 'home', action: 'timeout', period: 2, clockMs: 280000, data: {} });
av = announcerView(store, G, deriveGame(store, G));
ok('a second timeout is numbered', /timeout 2/.test(av.notables[0].detail), av.notables[0].detail);

store.appendEvent(G, { type: 'stat', team: 'home', action: 'penalty', period: 2, clockMs: 260000,
  data: { kind: 'False Start', yards: 5 } });
av = announcerView(store, G, deriveGame(store, G));
n = av.notables[0];
eq('a 5-yard penalty is a quiet note', [n.headline, n.level], ['PENALTY', 'note']);
ok('it names the infraction and yardage', /False Start/.test(n.detail) && /5 yards/.test(n.detail), n.detail);

store.appendEvent(G, { type: 'stat', team: 'home', action: 'penalty', period: 2, clockMs: 240000,
  data: { kind: 'Pass Interference', yards: 15, autoFirst: true } });
av = announcerView(store, G, deriveGame(store, G));
n = av.notables[0];
eq('a 15-yarder with an automatic first is louder', n.level, 'big');
ok('automatic first down is called out', /automatic first down/.test(n.detail), n.detail);

const before = announcerView(store, G, deriveGame(store, G)).notables.length;
store.appendEvent(store.createGame({ sport: 'football', homeTeamId: 'home', awayTeamId: 'away', date: '2026-11-07' }).id, {});
store.appendEvent(G, { type: 'stat', team: 'home', action: 'penalty', period: 2, clockMs: 220000,
  data: { kind: 'Holding', yards: 10, declined: true } });
eq('a declined penalty raises nothing', announcerView(store, G, deriveGame(store, G)).notables.length, before);

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${'='.repeat(52)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(52)}\n`);
process.exit(fail ? 1 : 0);
