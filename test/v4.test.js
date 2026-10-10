/* Play / shot clock driven from the Scorebot feed. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.js';
import { auxClockFromEvents, auxNow } from '../src/clock.js';
import { getSport } from '../src/sports/index.js';
import { normalizeFeed, applyFeed, auxMs, discoverPaths, DEFAULT_SOURCES } from '../src/integrations/scorebot.js';

let pass = 0, fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
};
const ok = (l, c, x = '') => { console.log(`${c ? '  ok  ' : '  FAIL'} ${l}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ose-v4-'));
const store = new Store(root);
store.saveTeam({ name: 'Home', abbrev: 'HOM' });
store.saveTeam({ name: 'Away', abbrev: 'AWY' });
for (const s of ['football', 'basketball']) {
  store.saveRoster('home', s, [{ number: '1', name: 'P One' }], 'replace');
  store.saveRoster('away', s, [{ number: '9', name: 'Opp' }], 'replace');
}
const aux = (id, sport) => auxClockFromEvents(store.effectiveEvents(id), getSport(sport), {});

console.log('\n== seconds vs milliseconds ==');
eq('number 24 read as 24 seconds', auxMs(24), 24000);
eq('number 35 read as 35 seconds', auxMs(35), 35000);
eq('string "24" read as seconds', auxMs('24'), 24000);
eq('a real ms value passes through', auxMs(24000), 24000);
eq('"0:24" parsed', auxMs('0:24'), 24000);
eq('absent stays undefined', auxMs(null), undefined);
eq('feed field reaches normalizeFeed', normalizeFeed({ shotClock: 18 }).auxClockMs, 18000);
eq('play clock alias works', normalizeFeed({ playClock: 25 }).auxClockMs, 25000);
eq('nested path works', normalizeFeed({ data: { shotClock: 7 } }).auxClockMs, 7000);
eq('custom fieldMap works', normalizeFeed({ sc: { v: 12 } }, { auxClock: 'sc.v' }).auxClockMs, 12000);
eq('running flag read', normalizeFeed({ shotClock: 12, shotClockRunning: true }).auxRunning, true);
ok('discovery suggests the shot clock path',
  discoverPaths({ data: { shotClock: 30 } }).suggestions.auxClock?.[0].path === 'data.shotClock');

console.log('\n== feed drives the shot clock ==');
const bb = store.createGame({ sport: 'basketball', homeTeamId: 'home', awayTeamId: 'away', date: '2026-01-20' });
eq('starts at the NFHS 35', auxNow(aux(bb.id, 'basketball')), 35000);

let w = applyFeed(store, bb.id, normalizeFeed({ shotClock: 19 }), { sources: DEFAULT_SOURCES });
ok('a real change is written', w.some((e) => e.type === 'aux_set'), w.map((e) => e.type).join(','));
eq('value applied', auxNow(aux(bb.id, 'basketball')), 19000);

console.log('\n== a steady countdown does not spam the log ==');
const before = store.readEvents(bb.id).length;
// clock stopped locally, so a value within tolerance is treated as no change
w = applyFeed(store, bb.id, normalizeFeed({ shotClock: 19 }), { sources: DEFAULT_SOURCES });
eq('identical value writes nothing', w.length, 0);
w = applyFeed(store, bb.id, normalizeFeed({ shotClock: 18.5 }), { sources: DEFAULT_SOURCES });
eq('sub-tolerance drift writes nothing', w.length, 0);
eq('log unchanged', store.readEvents(bb.id).length, before);
w = applyFeed(store, bb.id, normalizeFeed({ shotClock: 35 }), { sources: DEFAULT_SOURCES });
ok('a reset IS written', w.some((e) => e.type === 'aux_set'));
eq('reset applied', auxNow(aux(bb.id, 'basketball')), 35000);

console.log('\n== the feed switches off auto-reset so the two never fight ==');
ok('auto-reset now off', aux(bb.id, 'basketball').autoReset === false);
const pid = store.getRoster('home', 'basketball')[0].id;
store.appendEvent(bb.id, { type: 'aux_set', period: 1, data: { ms: 8000 } });
store.appendEvent(bb.id, { type: 'stat', team: 'home', action: 'fg2_made', period: 1, clockMs: 400000, data: { player: pid } });
eq('a logged basket no longer yanks the clock to 35', auxNow(aux(bb.id, 'basketball')), 8000);
const n2 = store.readEvents(bb.id).length;
applyFeed(store, bb.id, normalizeFeed({ shotClock: 8 }), { sources: DEFAULT_SOURCES });
eq('and the feed agrees, so still no churn', store.readEvents(bb.id).length, n2);

console.log('\n== a feed with no clock value leaves auto-reset alone ==');
store.saveRoster('home', 'basketball', [{ number: '1', name: 'P One' }], 'replace');
const bb2 = store.createGame({ sport: 'basketball', homeTeamId: 'home', awayTeamId: 'away', date: '2026-01-22' });
const w0 = applyFeed(store, bb2.id, normalizeFeed({ period: 2, clock: '5:00', clockRunning: true }), { sources: DEFAULT_SOURCES });
eq('only the game-clock events are written', w0.map((e) => e.type), ['period_set', 'clock_set', 'clock_start']);
ok('auto-reset untouched', aux(bb2.id, 'basketball').autoReset === true);

console.log('\n== manual keeps the feed out entirely ==');
const fb = store.createGame({ sport: 'football', homeTeamId: 'home', awayTeamId: 'away', date: '2026-09-11' });
w = applyFeed(store, fb.id, normalizeFeed({ playClock: 12 }), { sources: { ...DEFAULT_SOURCES, auxClock: 'manual' } });
eq('nothing written when set to manual', w.filter((e) => e.type.startsWith('aux')).length, 0);
eq('play clock still at its default', auxNow(aux(fb.id, 'football')), 40000);
ok('auto-reset left alone under manual', aux(fb.id, 'football').autoReset === true);
w = applyFeed(store, fb.id, normalizeFeed({ playClock: 12 }), { sources: DEFAULT_SOURCES });
eq('and it works once switched to scorebot', auxNow(aux(fb.id, 'football')), 12000);

console.log('\n== running state from the feed ==');
w = applyFeed(store, fb.id, normalizeFeed({ playClock: 12, playClockRunning: true }), { sources: DEFAULT_SOURCES });
ok('aux_start written', w.some((e) => e.type === 'aux_start'), w.map((e) => e.type).join(','));
eq('clock reported running', aux(fb.id, 'football').running, true);
w = applyFeed(store, fb.id, normalizeFeed({ playClock: 12, playClockRunning: false }), { sources: DEFAULT_SOURCES });
ok('aux_stop written', w.some((e) => e.type === 'aux_stop'));

console.log('\n== sports with no secondary clock ignore the field ==');
store.saveRoster('home', 'hockey', [{ number: '1', name: 'P' }], 'replace');
store.saveRoster('away', 'hockey', [{ number: '9', name: 'O' }], 'replace');
const hk = store.createGame({ sport: 'hockey', homeTeamId: 'home', awayTeamId: 'away', date: '2026-02-02' });
w = applyFeed(store, hk.id, normalizeFeed({ shotClock: 12 }), { sources: DEFAULT_SOURCES });
eq('no aux events for hockey', w.filter((e) => e.type.startsWith('aux')).length, 0);

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${'='.repeat(52)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(52)}\n`);
process.exit(fail ? 1 : 0);
