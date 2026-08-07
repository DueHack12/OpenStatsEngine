/* Play clock / shot clock, the empty-team-id import guard, and Google Sheets
   team import. Sheet tests are skipped offline. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.js';
import { deriveGame } from '../src/engine.js';
import { auxClockFromEvents, auxNow, auxView } from '../src/clock.js';
import { getSport } from '../src/sports/index.js';
import { scoreboardXml } from '../src/vmix.js';
import { parseValidationTeams, parsePicsColors, sheetId, csvExportUrl } from '../src/importers/sheets.js';

let pass = 0, fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
};
const ok = (l, c, x = '') => { console.log(`${c ? '  ok  ' : '  FAIL'} ${l}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ose-v3-'));
const store = new Store(root);
store.saveTeam({ name: 'Home', abbrev: 'HOM' });
store.saveTeam({ name: 'Away', abbrev: 'AWY' });
for (const sport of ['football', 'basketball']) {
  store.saveRoster('home', sport, [{ number: '1', name: 'P One' }, { number: '2', name: 'P Two' }], 'replace');
  store.saveRoster('away', sport, [{ number: '9', name: 'Opp' }], 'replace');
}
const hR = (s) => store.getRoster('home', s);

/* -------------------- football play clock -------------------- */
console.log('\n== football play clock (NFHS 40 / 25) ==');
const fb = store.createGame({ sport: 'football', homeTeamId: 'home', awayTeamId: 'away', date: '2026-09-11' });
const ev = (o) => store.appendEvent(fb.id, o);
let st = auxClockFromEvents(store.effectiveEvents(fb.id), getSport('football'), {});
eq('starts at 40s', auxNow(st), 40000);
eq('not linked to the game clock', st.linked, false);
eq('presets', st.presets, [40, 25]);

// the game clock starting must NOT start the play clock (they are independent)
ev({ type: 'clock_start', period: 1, clockMs: 720000 });
st = auxClockFromEvents(store.effectiveEvents(fb.id), getSport('football'), {});
eq('game clock start does not start the play clock', st.running, false);

// a normal play resets to 40, an administrative stoppage to 25
ev({ type: 'stat', team: 'home', action: 'penalty', period: 1, clockMs: 700000, data: { kind: 'Holding', yards: 10 } });
st = auxClockFromEvents(store.effectiveEvents(fb.id), getSport('football'), {});
eq('penalty resets to 25', auxNow(st), 25000);
ev({ type: 'stat', team: 'home', action: 'rush', period: 1, clockMs: 690000, data: { rusher: hR('football')[0].id, yards: 4 } });
st = auxClockFromEvents(store.effectiveEvents(fb.id), getSport('football'), {});
eq('normal play resets to 40', auxNow(st), 40000);
ev({ type: 'stat', team: 'home', action: 'punt', period: 1, clockMs: 680000, data: { punter: hR('football')[0].id, yards: 35 } });
st = auxClockFromEvents(store.effectiveEvents(fb.id), getSport('football'), {});
eq('punt (change of possession) resets to 25', auxNow(st), 25000);

// auto-reset can be turned off
ev({ type: 'aux_config', period: 1, data: { autoReset: false } });
ev({ type: 'aux_set', period: 1, data: { ms: 12000 } });
ev({ type: 'stat', team: 'home', action: 'rush', period: 1, clockMs: 670000, data: { rusher: hR('football')[0].id, yards: 2 } });
st = auxClockFromEvents(store.effectiveEvents(fb.id), getSport('football'), {});
eq('auto-reset off leaves the clock alone', auxNow(st), 12000);

console.log('\n== play clock counts down and floors at zero ==');
const t0 = Date.now();
const fake = [
  { ts: new Date(t0).toISOString(), type: 'aux_set', data: { ms: 10000 } },
  { ts: new Date(t0).toISOString(), type: 'aux_start' }
];
let fs2 = auxClockFromEvents(fake, getSport('football'), {});
eq('4s in, 6s left', Math.round(auxNow(fs2, t0 + 4000) / 1000), 6);
eq('never goes negative', auxNow(fs2, t0 + 99000), 0);
eq('view reports expired', auxView(fs2, t0 + 99000).expired, true);
eq('view rounds up like a stadium clock', auxView(fs2, t0 + 4200).display, '6');

/* -------------------- basketball shot clock -------------------- */
console.log('\n== basketball shot clock (NFHS 35, linked) ==');
const bb = store.createGame({ sport: 'basketball', homeTeamId: 'home', awayTeamId: 'away', date: '2026-01-20' });
let bs = auxClockFromEvents(store.effectiveEvents(bb.id), getSport('basketball'), {});
eq('starts at 35s', auxNow(bs), 35000);
eq('linked to the game clock', bs.linked, true);
store.appendEvent(bb.id, { type: 'clock_start', period: 1, clockMs: 480000 });
bs = auxClockFromEvents(store.effectiveEvents(bb.id), getSport('basketball'), {});
eq('game clock start starts the shot clock', bs.running, true);
store.appendEvent(bb.id, { type: 'clock_stop', period: 1, clockMs: 470000 });
bs = auxClockFromEvents(store.effectiveEvents(bb.id), getSport('basketball'), {});
eq('game clock stop stops the shot clock', bs.running, false);
store.appendEvent(bb.id, { type: 'aux_set', period: 1, data: { ms: 4000 } });
store.appendEvent(bb.id, { type: 'stat', team: 'home', action: 'fg2_made', period: 1, clockMs: 460000,
  data: { player: hR('basketball')[0].id } });
bs = auxClockFromEvents(store.effectiveEvents(bb.id), getSport('basketball'), {});
eq('made basket resets to 35', auxNow(bs), 35000);
store.appendEvent(bb.id, { type: 'aux_set', period: 1, data: { ms: 4000 } });
store.appendEvent(bb.id, { type: 'stat', team: 'home', action: 'rebound_off', period: 1, clockMs: 455000,
  data: { player: hR('basketball')[0].id } });
bs = auxClockFromEvents(store.effectiveEvents(bb.id), getSport('basketball'), {});
eq('NFHS: offensive rebound resets to full 35', auxNow(bs), 35000);
store.appendEvent(bb.id, { type: 'period_set', period: 2, data: { period: 2 } });
bs = auxClockFromEvents(store.effectiveEvents(bb.id), getSport('basketball'), {});
eq('new period resets and stops it', [auxNow(bs), bs.running], [35000, false]);

console.log('\n== shot clock length is configurable per game ==');
const bb30 = store.createGame({ sport: 'basketball', homeTeamId: 'home', awayTeamId: 'away',
  date: '2026-01-21', settings: { auxFullMs: 30000 } });
eq('30-second states honoured', auxNow(auxClockFromEvents(store.effectiveEvents(bb30.id), getSport('basketball'), { auxFullMs: 30000 })), 30000);

console.log('\n== exposed in state and XML ==');
let g = deriveGame(store, fb.id);
eq('football aux label', g.auxClock.label, 'Play Clock');
let x = scoreboardXml(g);
ok('XML has <PlayClock>', /<PlayClock>/.test(x), (x.match(/<PlayClock>(.*?)</) || [])[1]);
ok('XML has generic <AuxClock>', /<AuxClock>/.test(x));
ok('XML has <AuxClockLabel>Play Clock', /<AuxClockLabel>Play Clock<\/AuxClockLabel>/.test(x));
ok('football has no <ShotClock>', !/<ShotClock>/.test(x));
g = deriveGame(store, bb.id);
x = scoreboardXml(g);
ok('basketball XML has <ShotClock>', /<ShotClock>/.test(x), (x.match(/<ShotClock>(.*?)</) || [])[1]);
ok('basketball has no <PlayClock>', !/<PlayClock>/.test(x));
eq('basketball aux label', g.auxClock.label, 'Shot Clock');

console.log('\n== sports without a secondary clock are unaffected ==');
for (const sport of ['hockey', 'soccer', 'lacrosse', 'baseball']) {
  store.saveRoster('home', sport, [{ number: '1', name: 'P One' }], 'replace');
  store.saveRoster('away', sport, [{ number: '9', name: 'Opp' }], 'replace');
  const gm = store.createGame({ sport, homeTeamId: 'home', awayTeamId: 'away', date: '2026-03-0' + sport.length });
  const d = deriveGame(store, gm.id);
  ok(`${sport}: auxClock is null`, d.auxClock === null);
  ok(`${sport}: XML omits aux fields`, !/<AuxClock>/.test(scoreboardXml(d)));
}

console.log('\n== hiding the clock blanks the XML but keeps it running ==');
store.appendEvent(fb.id, { type: 'aux_config', period: 1, data: { enabled: false } });
g = deriveGame(store, fb.id);
eq('reported as disabled', g.auxClock.enabled, false);
ok('XML value blanked', /<PlayClock><\/PlayClock>/.test(scoreboardXml(g)));
ok('AuxClockVisible flag published', /<AuxClockVisible>0<\/AuxClockVisible>/.test(scoreboardXml(g)));

/* -------------------- google sheets -------------------- */
console.log('\n== google sheet parsing ==');
eq('id from a full edit URL', sheetId('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_EXAMPLE/edit?gid=681600433#gid=0'), '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_EXAMPLE');
eq('id passed through bare', sheetId('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_EXAMPLE'), '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_EXAMPLE');
ok('rejects junk', (() => { try { sheetId('hello'); return false; } catch { return true; } })());
ok('builds a csv export url', csvExportUrl('ABC', '1').endsWith('/export?format=csv&gid=1'));

// the team block sits to the right of unrelated validation lists
const validation = [
  'Women,Home,Automatic,Women\'s,,Team,Mascot,Abrv,Stat Name,Shorthand',
  'Men,Visitors,Manual,Men\'s,2024,Fairfield College Preparatory School,JESUITS,PREP,Fairfield Prep Jesuits,Fairfield Prep',
  ',,,,2024,Amity High School,SPARTANS,AHS,Amity Spartans,Amity',
  'Athletic Director,,,Title,,,,,,'
].join('\n');
const vt = parseValidationTeams(validation);
eq('teams found', vt.teams.length, 2);
eq('first team', [vt.teams[0].name, vt.teams[0].abbrev, vt.teams[0].shortName], ['Fairfield College Preparatory School', 'PREP', 'Fairfield Prep']);
eq('SHOUTED mascot made readable', vt.teams[0].mascot, 'Jesuits');
ok('left-hand validation lists ignored', !vt.teams.some(t => /Athletic Director|Women|Men/.test(t.name)));

// colours live on rows tagged "TD Color"; the hex column moves between sections
const pics = [
  'School,Image,Jersey,,Pic Location',
  'Fairfield College Preparatory School,Helmet,Right,Fairfield ... Helmet,',
  'Fairfield College Preparatory School,TD Color,,Fairfield ... TD Color,C8102E',
  'Amity High School,TD Color,,Amity ... TD Color,',
  'Some School,ABC,Logo,Some School Logo,G:\\path'
].join('\n');
const colors = parsePicsColors(pics);
eq('colour picked up', colors.get('fairfield college preparatory school'), '#c8102e');
eq('blank colour not invented', colors.has('amity high school'), false);
eq('non-colour rows ignored', colors.size, 1);

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${'='.repeat(52)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(52)}\n`);
process.exit(fail ? 1 : 0);
