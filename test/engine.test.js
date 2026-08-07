/* Unit tests for the replay engine: clock math, time of possession, droughts.
   These build event logs with explicit clock values so the maths is exercised
   properly rather than depending on how fast the test happens to run. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.js';
import { deriveGame } from '../src/engine.js';
import { clockFromEvents, elapsedGameMs } from '../src/clock.js';
import { getSport } from '../src/sports/index.js';
import { parseRosterCSV, parseStatsCSV } from '../src/importers/index.js';
import { parseHTMLTables } from '../src/importers/html.js';
import { normalizeFeed, applyFeed } from '../src/integrations/scorebot.js';
import { parseCSV } from '../src/util.js';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (expected ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
};
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
  cond ? pass++ : fail++;
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ose-test-'));
const store = new Store(root);

store.saveTeam({ name: 'Home Team', abbrev: 'HOM' });
store.saveTeam({ name: 'Away Team', abbrev: 'AWY' });
store.saveRoster('home-team', 'football', [
  { number: '7', name: 'QB One' }, { number: '22', name: 'RB One' }, { number: '80', name: 'WR One' }
], 'replace');
store.saveRoster('away-team', 'football', [{ number: '9', name: 'QB Two' }], 'replace');

const hR = store.getRoster('home-team', 'football');
const aR = store.getRoster('away-team', 'football');
const pid = (r, n) => r.find((p) => p.number === n).id;

const game = store.createGame({
  sport: 'football', homeTeamId: 'home-team', awayTeamId: 'away-team', date: '2026-09-11'
});
const G = game.id;

/* --------------------------------------------------------------
 * Time of possession — 12:00 quarters counting down.
 * Home has the ball 12:00 -> 9:30 (2:30), away 9:30 -> 5:00 (4:30).
 * -------------------------------------------------------------- */
const at = (clock, extra) => {
  const [m, s] = clock.split(':').map(Number);
  return { period: 1, clockMs: (m * 60 + s) * 1000, ...extra };
};
store.appendEvent(G, { type: 'clock_start', ...at('12:00') });
store.appendEvent(G, { type: 'possession', team: 'home', ...at('12:00') });
store.appendEvent(G, { type: 'stat', team: 'home', action: 'rush', ...at('11:00'), data: { rusher: pid(hR, '22'), yards: 4 } });
store.appendEvent(G, { type: 'stat', team: 'home', action: 'pass_complete', ...at('10:10'), data: { passer: pid(hR, '7'), receiver: pid(hR, '80'), yards: 8 } });
store.appendEvent(G, { type: 'stat', team: 'home', action: 'punt', ...at('9:30'), data: { punter: pid(hR, '7'), yards: 40 } });
store.appendEvent(G, { type: 'stat', team: 'away', action: 'rush', ...at('7:00'), data: { rusher: pid(aR, '9'), yards: 3 } });
store.appendEvent(G, { type: 'stat', team: 'away', action: 'rush', ...at('5:00'), data: { rusher: pid(aR, '9'), yards: 2 } });
store.appendEvent(G, { type: 'clock_stop', ...at('5:00') });

console.log('\n== time of possession ==');
let g = deriveGame(store, G);
eq('home TOP (12:00 -> 9:30)', g.teams.home.top, '02:30');
eq('away TOP (9:30 -> 5:00)', g.teams.away.top, '04:30');
eq('total elapsed', g.situation.elapsedDisplay, '07:00');
eq('possession after punt', g.situation.possession, 'away');

console.log('\n== first downs from the 4 + 8 = 12 yard series ==');
eq('home first downs', g.teams.home.first_downs, 1);
eq('home total yards', g.teams.home.total_yards, 12);

console.log('\n== scoring drought ==');
store.appendEvent(G, { type: 'period_set', period: 2, clockMs: 12 * 60000, data: { period: 2, ms: 12 * 60000 } });
store.appendEvent(G, { type: 'stat', team: 'home', action: 'rush', period: 2, clockMs: 10 * 60000, data: { rusher: pid(hR, '22'), yards: 60, td: true } });
store.appendEvent(G, { type: 'stat', team: 'home', action: 'rush', period: 2, clockMs: 4 * 60000, data: { rusher: pid(hR, '22'), yards: 3 } });
g = deriveGame(store, G);
eq('home scored', g.teams.home.points, 6);
// TD at Q2 10:00 = 14:00 elapsed; now at Q2 4:00 = 20:00 elapsed -> 6:00 drought
eq('home drought since TD', g.droughts.home.display, '06:00');
ok('away drought spans whole game', g.droughts.away.display === '20:00', g.droughts.away.display);
eq('scoring play periodLabel', g.scoringPlays[0].periodLabel, '2nd');

console.log('\n== elapsed across periods ==');
const st = clockFromEvents(store.effectiveEvents(G), getSport('football'), {});
eq('Q1 12:00 -> 0 elapsed', elapsedGameMs(st, 12 * 60000, 1), 0);
eq('Q3 6:00 -> 30:00 elapsed', elapsedGameMs(st, 6 * 60000, 3), 30 * 60000);
eq('countsUp sport (soccer) 2nd half', elapsedGameMs(
  clockFromEvents([], getSport('soccer'), {}), 10 * 60000, 2), 50 * 60000);

console.log('\n== undo / correct ==');
const target = store.readEvents(G).find((e) => e.action === 'rush' && e.data?.td);
store.correctEvent(G, target.id, { data: { yards: 75 } });
g = deriveGame(store, G);
eq('corrected yardage applied', Object.values(g.players).find((p) => p.name === 'RB One').rush_yds, 4 + 75 + 3);
ok('correction flagged in timeline', g.timeline.some((t) => t.corrected));
store.undoEvent(G, target.id);
g = deriveGame(store, G);
eq('undo removes the TD', g.teams.home.points, 0);
ok('raw log still has the event', store.readEvents(G).some((e) => e.id === target.id));

console.log('\n== CSV parsing ==');
eq('comma CSV', parseCSV('a,b\n1,2')[1], ['1', '2']);
eq('tab CSV', parseCSV('a\tb\n1\t2')[1], ['1', '2']);
eq('quoted fields with commas', parseCSV('a,b\n"Smith, John",2')[1], ['Smith, John', '2']);
eq('escaped quotes', parseCSV('a\n"He said ""hi"""')[1], ['He said "hi"']);

console.log('\n== roster import formats ==');
eq('MaxPreps style', parseRosterCSV('Jersey,First Name,Last Name,Pos,Grade\n12,John,Smith,QB,11').players[0],
  { number: '12', name: 'John Smith', pos: 'QB', year: '11', height: '', weight: '', level: '' });
eq('Last, First order', parseRosterCSV('No,Name,Pos\n5,"Doe, Jane",MF').players[0].name, 'Jane Doe');
eq('skips totals row', parseRosterCSV('No,Name\n1,Real Player\n,TOTAL').players.length, 1);
eq('title row before header', parseRosterCSV('2026 Varsity Roster\n\nNo,Name,Pos\n3,Ann Lee,GK').players[0].name, 'Ann Lee');

console.log('\n== HTML table scrape (CIAC shape) ==');
const html = `<html><body><table><tr><th>Level</th><th>No</th><th>Name</th><th>Position</th><th>Grade</th></tr>
<tr><td>V</td><td>9</td><td>Jordan Reyes</td><td>P</td><td>11</td></tr>
<tr><td>V</td><td>25</td><td>Casey Whitfield</td><td>C</td><td>10</td></tr></table></body></html>`;
const tables = parseHTMLTables(html);
eq('table found', tables.length, 1);
eq('rows parsed', tables[0].length, 3);
eq('cell text', tables[0][1][2], 'Jordan Reyes');

console.log('\n== stat import (HUDL/MaxPreps headings) ==');
const si = parseStatsCSV('Name,Comp,Att,Pass Yds,TD,INT\nJohn Smith,120,200,1850,18,6', 'football');
eq('stat rows', si.players.length, 1);
eq('pass yards mapped', si.players[0].stats.pass_yds, 1850);
eq('completions mapped', si.players[0].stats.pass_comp, 120);
ok('matched columns reported', si.matched.includes('pass_yds'), si.matched.join(','));
eq('bare "TD" resolves to passing, not returns', si.players[0].stats.pass_td, 18);
eq('bare "INT" resolves to interceptions thrown', si.players[0].stats.pass_int, 6);
ok('ambiguity is reported, not silent', si.warnings.some((w) => /ambiguous/i.test(w)), si.warnings[0] || '(none)');
const siR = parseStatsCSV('Name,Car,Yds,TD\nAmy Diaz,140,900,12', 'football', 'rushing');
eq('category hint steers YDS to rushing', siR.players[0].stats.rush_yds, 900);
eq('category hint steers TD to rushing', siR.players[0].stats.rush_td, 12);

console.log('\n== scorebot normalisation ==');
eq('flat shape', normalizeFeed({ period: 3, clock: '7:22', clockRunning: true, homeScore: 14, awayScore: 7 }),
  { period: 3, clockMs: 442000, running: true, homeScore: 14, awayScore: 7, possession: undefined });
eq('nested shape', normalizeFeed({ data: { period: 2, clock: '11:05' } }).clockMs, 665000);
eq('custom fieldMap', normalizeFeed({ x: { y: '3:00' } }, { clock: 'x.y' }).clockMs, 180000);
eq('possession letters', normalizeFeed({ possession: 'HOME' }).possession, 'home');
eq('visitor maps to away', normalizeFeed({ possession: 'Visitor' }).possession, 'away');

const g2 = store.createGame({ sport: 'basketball', homeTeamId: 'home-team', awayTeamId: 'away-team', date: '2026-02-02' });
const w1 = applyFeed(store, g2.id, { period: 2, clockMs: 300000, running: true });
ok('scorebot writes only changes', w1.length === 3, w1.map((e) => e.type).join(','));
const w2 = applyFeed(store, g2.id, { period: 2, clockMs: 300000, running: true });
ok('scorebot is idempotent when nothing changed', w2.length === 0, `${w2.length} events`);

console.log('\n== baseball innings/outs ==');
const g3 = store.createGame({ sport: 'baseball', homeTeamId: 'home-team', awayTeamId: 'away-team', date: '2026-04-04' });
store.saveRoster('home-team', 'baseball', [{ number: '1', name: 'Batter One' }], 'replace');
store.saveRoster('away-team', 'baseball', [{ number: '2', name: 'Pitcher Two' }], 'replace');
const bH = store.getRoster('home-team', 'baseball')[0].id;
const bA = store.getRoster('away-team', 'baseball')[0].id;
store.appendEvent(g3.id, { type: 'stat', team: 'away', action: 'pitcher_in', period: 1, data: { player: bA } });
store.appendEvent(g3.id, { type: 'stat', team: 'home', action: 'single', period: 1, data: { batter: bH, rbi: 0 } });
store.appendEvent(g3.id, { type: 'stat', team: 'home', action: 'home_run', period: 1, data: { batter: bH, rbi: 2 } });
store.appendEvent(g3.id, { type: 'stat', team: 'home', action: 'strikeout_swinging', period: 1, data: { batter: bH } });
const gb = deriveGame(store, g3.id);
const bat = Object.values(gb.players).find((p) => p.name === 'Batter One');
eq('AB counted', bat.ab, 3);
eq('hits', bat.h, 2);
eq('RBI', bat.rbi, 2);
eq('batting average', bat.avg_disp, '.667');
eq('team runs', gb.teams.home.points, 2);
const pit = Object.values(gb.players).find((p) => p.name === 'Pitcher Two');
eq('pitcher strikeouts', pit.k, 1);
eq('pitcher hits allowed', pit.h_allowed, 2);
eq('pitcher IP', pit.ip, '0.1');

console.log('\n== hockey plus/minus & special teams ==');
const g4 = store.createGame({ sport: 'hockey', homeTeamId: 'home-team', awayTeamId: 'away-team', date: '2026-12-12' });
store.saveRoster('home-team', 'hockey', [{ number: '11', name: 'Center' }, { number: '30', name: 'Goalie H' }], 'replace');
store.saveRoster('away-team', 'hockey', [{ number: '4', name: 'Dman' }, { number: '31', name: 'Goalie A' }], 'replace');
const hH = store.getRoster('home-team', 'hockey'), hA = store.getRoster('away-team', 'hockey');
store.appendEvent(g4.id, { type: 'stat', team: 'away', action: 'goalie_in', period: 1, data: { player: pid(hA, '31') } });
store.appendEvent(g4.id, { type: 'stat', team: 'home', action: 'shot', period: 1, data: { player: pid(hH, '11'), goalie: pid(hA, '31') } });
store.appendEvent(g4.id, { type: 'stat', team: 'away', action: 'penalty', period: 1, data: { player: pid(hA, '4'), kind: 'Tripping', minutes: '2' } });
store.appendEvent(g4.id, { type: 'stat', team: 'home', action: 'goal', period: 1, data: { scorer: pid(hH, '11'), strength: 'PP' } });
const gh = deriveGame(store, g4.id);
eq('home PP goal', gh.teams.home.pp_line, '1/1');
eq('away PIM', gh.teams.away.pim, 2);
eq('goalie saves', Object.values(gh.players).find((p) => p.name === 'Goalie A').sv, 1);
eq('goalie GA', Object.values(gh.players).find((p) => p.name === 'Goalie A').ga, 1);
eq('center points', Object.values(gh.players).find((p) => p.name === 'Center').pts, 1);

console.log('\n== crash recovery ==');
// simulate a torn final line, which is what a power cut mid-write looks like
fs.appendFileSync(store.eventsPath(G), '{"id":"broken","seq":99,"typ');
store._eventCache.delete(G);
const recovered = deriveGame(store, G);
ok('torn line skipped, game still derives', recovered.teams.home.points === 0 && recovered.counts.events > 5,
  `${recovered.counts.events} events read`);

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${'='.repeat(50)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(50)}\n`);
process.exit(fail ? 1 : 0);
