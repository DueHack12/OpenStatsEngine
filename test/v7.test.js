/* Soccer + Sportzcast: the fields a real ScoreConnect message carries. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.js';
import { deriveGame } from '../src/engine.js';
import { normalizeFeed, applyFeed, FEED_FIELDS } from '../src/integrations/scorebot.js';
import * as vmix from '../src/vmix.js';
import { getSport } from '../src/sports/index.js';

let pass = 0, fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
};
const ok = (l, c, x = '') => { console.log(`${c ? '  ok  ' : '  FAIL'} ${l}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ose-v7-'));
const store = new Store(root);

/* A real message off Fairfield Prep's ScoreConnect III, soccer, 2nd half. */
const RAW = {
  HomeScoreTens: ' ', HomeScoreOnes: '2', GuestScoreTens: ' ', GuestScoreOnes: '0',
  HomeScore: '2', GuestScore: '0', HomePossession: ' ', GuestPossession: ' ',
  HomeShots: ' 4', GuestShots: ' 1', HomeCornerKicks: ' 2', GuestCornerKicks: ' 3',
  HomeSaves: '  ', GuestSaves: '  ', HomeTimeouts: ' ', GuestTimeouts: ' ',
  Period: '2', PeriodOrdinal: '2nd', Clock: '31:00', FullClock: '31:00.0',
  ClockStatus: 'R', PlayClockStatus: 'S', ClockMode: ':', VendorSportId: 23
};

console.log('\n== a real ScoreConnect soccer message ==');
const f = normalizeFeed(RAW);

// The half never advanced because 'Period' (PascalCase) was not a candidate —
// and with the feed owning the field, the manual buttons were greyed out too,
// leaving no way at all to change halves.
eq('Period is read', f.period, 2);
eq('the clock is read', f.clockMs, 31 * 60000);
// ClockStatus "R" fell through to movement inference before.
eq('ClockStatus R means running', f.running, true);
eq('the score is read', [f.homeScore, f.awayScore], [2, 0]);

// Space-padded counting stats.
eq('shots on goal', [f.homeShots, f.awayShots], [4, 1]);
eq('corner kicks', [f.homeCorners, f.awayCorners], [2, 3]);
eq('blank saves stay absent', [f.homeSaves, f.awaySaves], [undefined, undefined]);

// Sportzcast calls the away side "Guest".
const guest = normalizeFeed({ GuestShots: '7', GuestCornerKicks: '3', GuestSaves: '5' });
eq('Guest* names map to the away side',
  [guest.awayShots, guest.awayCorners, guest.awaySaves], [7, 3, 5]);

/* ------------------------------------------------------------------ *
 * Sportzcast capitalises its field names differently from sport to sport.
 * Matching one spelling at a time is how a live match ends up stuck in the
 * first half, so key lookup ignores case entirely.
 * ------------------------------------------------------------------ */
console.log('\n== capitalisation must not matter ==');

const recase = (o, fn) => Object.fromEntries(Object.entries(o).map(([k, v]) => [fn(k), v]));
const summary = (o) => {
  const n = normalizeFeed(o);
  return [n.period, n.clockMs, n.running, n.homeScore, n.awayScore,
    n.homeShots, n.awayShots, n.homeCorners, n.awayCorners];
};
const want = summary(RAW);
eq('the PascalCase message reads fully', want, [2, 1860000, true, 2, 0, 4, 1, 2, 3]);
eq('all-lowercase reads the same', summary(recase(RAW, (k) => k.toLowerCase())), want);
eq('ALL-UPPERCASE reads the same', summary(recase(RAW, (k) => k.toUpperCase())), want);

// An exact match still wins, so a feed carrying two spellings is predictable.
eq('an exact match beats a case-folded one',
  normalizeFeed({ period: '4', Period: '9' }).period, 4);

// Nested paths fold case per segment.
eq('dotted paths fold case too', normalizeFeed({ DATA: { Clock: '5:00' } }).clockMs, 300000);

// The collision this opened up: baseball's half-inning must not be read as a
// period number just because 'half' looks like a period name.
const bb = normalizeFeed({ Half: 'BOT', Inning: '5', Outs: '2' });
eq('baseball half stays a half', bb.half, 'bottom');
eq('and the inning is the period', bb.period, 5);
eq('with outs intact', bb.outs, 2);

console.log('\n== S means stopped, R means running ==');
eq('R runs', normalizeFeed({ ClockStatus: 'R' }).running, true);
eq('S stops', normalizeFeed({ ClockStatus: 'S' }).running, false);
// A blank status must still fall through to inference rather than reading false.
eq('blank is undecided', normalizeFeed({ ClockStatus: ' ' }).running, undefined);

console.log('\n== soccer has no play clock ==');
// PlayClockStatus is in the feed, but soccer defines no aux clock, so nothing
// should be written for it.
ok('soccer declares no aux clock', !getSport('soccer').auxClock);

console.log('\n== the board keeps its own counting stats ==');
store.saveTeam({ name: 'Home', abbrev: 'HOM' });
store.saveTeam({ name: 'Away', abbrev: 'AWY' });
const G = store.createGame({ sport: 'soccer', homeTeamId: 'home', awayTeamId: 'away', date: '2026-09-08' }).id;
applyFeed(store, G, f, { period: 1, clockMs: 0 }, () => true);

let g = deriveGame(store, G);
eq('the half follows the board', g.clock.period, 2);
eq('and is labelled a half', g.clock.periodLabel, '2nd');
eq('board shots and corners are stored', [g.boardStats.home.sog, g.boardStats.home.corners], [4, 2]);
eq('for the away side too', [g.boardStats.away.sog, g.boardStats.away.corners], [1, 3]);
eq('saves the board did not send stay null', g.boardStats.home.saves, null);

// They are the board's figures, not ours: four shots cannot become four shot
// events, so the logged totals must stay untouched.
eq('the logged shot total is not overwritten', g.teams.home.sog, 0);
eq('nor the logged corners', g.teams.home.corners, 0);

// A board that sends corners but not saves must not blank the saves it sent
// a moment ago.
applyFeed(store, G, { ...f, homeSaves: 6 }, { period: 2, clockMs: 31 * 60000 }, () => true);
applyFeed(store, G, { homeCorners: 5 }, { period: 2, clockMs: 31 * 60000 }, () => true);
g = deriveGame(store, G);
eq('a later partial message keeps the earlier saves', g.boardStats.home.saves, 6);
eq('and applies its own change', g.boardStats.home.corners, 5);

console.log('\n== board stats reach vMix ==');
const xml = vmix.XML_VIEWS.scoreboard(g);
for (const tag of ['BoardHomeSOG', 'BoardHomeCorners', 'BoardAwaySOG', 'BoardAwayCorners'])
  ok(`${tag} is emitted`, xml.includes(`<${tag}>`));

console.log('\n== every feed field has a source default ==');
const { DEFAULT_SOURCES } = await import('../src/integrations/scorebot.js');
for (const { key } of FEED_FIELDS)
  ok(`${key} has a default`, DEFAULT_SOURCES[key] !== undefined, DEFAULT_SOURCES[key]);

console.log('\n== the keeper is remembered across plays ==');
store.saveRoster('home', 'soccer', [{ number: '9', name: 'Striker' }], 'replace');
store.saveRoster('away', 'soccer', [{ number: '00', name: 'Keeper' }], 'replace');
const H = store.getRoster('home', 'soccer'), A = store.getRoster('away', 'soccer');
const G2 = store.createGame({ sport: 'soccer', homeTeamId: 'home', awayTeamId: 'away', date: '2026-09-09' }).id;
store.appendEvent(G2, { type: 'stat', team: 'away', action: 'goalie_in', period: 1, clockMs: 2400000,
  data: { player: A[0].id } });
for (const t of [2300000, 2200000, 2100000])
  store.appendEvent(G2, { type: 'stat', team: 'home', action: 'goal', period: 1, clockMs: t,
    data: { scorer: H[0].id } });          // Keeper field deliberately left blank

const g2 = deriveGame(store, G2);
const gk = Object.values(g2.players).find((p) => p.name === 'Keeper');
eq('naming the keeper once is enough', gk.ga, 3);
ok('and marks them a keeper', gk.is_goalie);
eq('the current keeper is exposed to the console', g2.goalies.away, A[0].id);
eq('with none named for the other side', g2.goalies.home, null);

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${'='.repeat(52)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(52)}\n`);
process.exit(fail ? 1 : 0);
