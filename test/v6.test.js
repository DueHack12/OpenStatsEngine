/* Feed-loss alerting and the board-vs-entered score comparison. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.js';
import { deriveGame } from '../src/engine.js';
import { ScorebotClient, normalizeFeed, DEFAULT_STALE_MS } from '../src/integrations/scorebot.js';
import * as vmix from '../src/vmix.js';

let pass = 0, fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
};
const ok = (l, c, x = '') => { console.log(`${c ? '  ok  ' : '  FAIL'} ${l}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ose-v6-'));
const store = new Store(root);

/* ------------------------------------------------------------------ *
 * Connection state: only a feed that died on its own should alarm.
 * ------------------------------------------------------------------ */
console.log('\n== unexpected vs deliberate disconnection ==');

const seen = [];
const sb = new ScorebotClient({ store, onStatus: (st) => seen.push(st) });

sb._setConnected(true);
eq('connecting raises no drop', [sb.status.droppedAt, sb.status.dropReason], [null, null]);
eq('the change is announced', seen.at(-1).unexpected, false);

sb._setConnected(true);
eq('a repeat of the same state says nothing', seen.length, 1);

sb._setConnected(false, 'broker went away');
ok('a drop is flagged unexpected', seen.at(-1).unexpected === true);
eq('and carries the cause', sb.status.dropReason, 'broker went away');
ok('and is timestamped', !!sb.status.droppedAt, sb.status.droppedAt);

sb._setConnected(true);
eq('coming back clears the drop', [sb.status.droppedAt, sb.status.dropReason], [null, null]);

// The operator pressing Disconnect must never look like a fault.
sb.stop();
eq('a deliberate stop is not unexpected', seen.at(-1).unexpected, false);
eq('and leaves no drop behind', [sb.status.droppedAt, sb.status.dropReason, sb.status.mode],
   [null, null, 'off']);

/* A transport that fires close/error handlers on its way out during stop()
   must not sneak an "unexpected" through behind the operator's back. */
const sb2 = new ScorebotClient({ store, onStatus: () => {} });
sb2._setConnected(true);
sb2.ws = { close() { sb2._setConnected(false, 'socket closed'); } };
sb2.stop();
eq('a late close during teardown stays deliberate', sb2.status.droppedAt, null);

/* An error from before a successful connect is history. Reusing it as the drop
   reason reported a stale (and misleading) cause hours later. */
const sb3 = new ScorebotClient({ store, onStatus: () => {} });
sb3.status.lastError = 'ECONNREFUSED 127.0.0.1:1 @ 7:04:11 PM';
sb3._setConnected(true);
eq('a successful connect clears the old error', sb3.status.lastError, null);
sb3._setConnected(false);
eq('so a later drop reports its own cause', sb3.status.dropReason, 'connection lost');

/* ------------------------------------------------------------------ *
 * The alarm predicate the console uses.
 * ------------------------------------------------------------------ */
console.log('\n== the alarm predicate ==');
const alarm = (f) => !!f.wanted && f.mode !== 'off' && !f.connected && !!f.droppedAt;

ok('running normally is quiet',
  !alarm({ wanted: true, mode: 'mqtt', connected: true, droppedAt: null }));
ok('the moment Connect is pressed is quiet',
  !alarm({ wanted: true, mode: 'mqtt', connected: false, droppedAt: null }));
ok('switched off is quiet',
  !alarm({ wanted: false, mode: 'off', connected: false, droppedAt: null }));
ok('a feed that died alarms',
  alarm({ wanted: true, mode: 'mqtt', connected: false, droppedAt: '2026-08-17T00:00:00Z' }));
ok('switching off after a drop goes quiet again',
  !alarm({ wanted: false, mode: 'off', connected: false, droppedAt: null }));

/* ------------------------------------------------------------------ *
 * Board score vs the score our logged plays add up to.
 * ------------------------------------------------------------------ */
console.log('\n== board score never adds to the entered score ==');

store.saveTeam({ name: 'Home', abbrev: 'HOM' });
store.saveTeam({ name: 'Away', abbrev: 'AWY' });
store.saveRoster('home', 'football', [{ number: '7', name: 'QB One' }], 'replace');
const G = store.createGame({ sport: 'football', homeTeamId: 'home', awayTeamId: 'away', date: '2026-09-11' }).id;
const p = store.getRoster('home', 'football')[0].id;

store.appendEvent(G, { type: 'stat', team: 'home', action: 'rush', period: 1, clockMs: 600000,
  data: { rusher: p, yards: 20, td: true } });
eq('the touchdown scores 6', deriveGame(store, G).teams.home.points, 6);

// The board says 7 — the extra point has not been logged yet.
store.appendEvent(G, { type: 'score_official', source: 'scorebot', period: 1, clockMs: 600000,
  data: { home: 7, away: 0 } });
let g = deriveGame(store, G);
eq('the entered score is untouched by the board', g.teams.home.points, 6);
eq('the board score is kept apart', [g.officialScore.home, g.officialScore.away], [7, 0]);

// A board that keeps repeating itself must not accumulate.
for (let i = 0; i < 5; i++) {
  store.appendEvent(G, { type: 'score_official', source: 'scorebot', period: 1, clockMs: 599000,
    data: { home: 7, away: 0 } });
}
g = deriveGame(store, G);
eq('repeated board readings replace rather than add', g.officialScore.home, 7);
eq('and still never touch the entered score', g.teams.home.points, 6);

// Log the extra point and the two agree.
store.appendEvent(G, { type: 'stat', team: 'home', action: 'xp_good', period: 1, clockMs: 598000,
  data: { kicker: p } });
g = deriveGame(store, G);
eq('entering the PAT closes the gap', [g.teams.home.points, g.officialScore.home], [7, 7]);

/* ------------------------------------------------------------------ *
 * A feed that names the home score almost certainly names the away one.
 * ------------------------------------------------------------------ */
console.log('\n== PascalCase away score ==');
const f = normalizeFeed({ HomeScore: 14, AwayScore: 7, Period: 2 }, null);   // null map must not throw
eq('HomeScore reads', f.homeScore, 14);
eq('AwayScore reads too', f.awayScore, 7);
const f2 = normalizeFeed({ HomeScore: 21, GuestScore: 3 }, null);
eq('GuestScore still reads', f2.awayScore, 3);

/* ------------------------------------------------------------------ *
 * A board can stop sending while the socket stays perfectly healthy.
 *
 * Switching the ScoreConnect emulator off leaves MQTT connected and pinging
 * happily, so the connection check alone saw nothing wrong while every number
 * on screen froze. Silence is now a disconnection in its own right.
 * ------------------------------------------------------------------ */
console.log('\n== a quiet feed counts as a dead one ==');

const stale = (cfg) => {
  const c = new ScorebotClient({ store, onStatus: () => {} });
  Object.defineProperty(c, 'cfg', { get: () => cfg });
  return c._staleMs();
};
eq('unset falls back to the default', stale({}), DEFAULT_STALE_MS);
eq('the default is five seconds', DEFAULT_STALE_MS, 5000);
eq('a value is honoured', stale({ staleMs: 8000 }), 8000);
eq('0 disables the check', stale({ staleMs: 0 }), 0);
eq('"0" from a form field disables it too', stale({ staleMs: '0' }), 0);
eq('nonsense falls back rather than disabling', stale({ staleMs: 'soon' }), DEFAULT_STALE_MS);
eq('a negative value cannot disable it by accident', stale({ staleMs: -1 }), DEFAULT_STALE_MS);
eq('sub-second thresholds are floored', stale({ staleMs: 50 }), 1000);

const quiet = new ScorebotClient({ store, onStatus: () => {} });
Object.defineProperty(quiet, 'cfg', { get: () => ({ staleMs: 5000 }) });
quiet._setConnected(true);
ok('connecting starts the clock', quiet._lastMsgAt > 0);
eq('and is not stalled', quiet.status.stalled, false);

// Wind the last message back past the threshold and let the watchdog look.
quiet._startWatchdog();
quiet._lastMsgAt = Date.now() - 6000;
await new Promise((r) => setTimeout(r, 1200));
eq('silence past the threshold disconnects', quiet.status.connected, false);
eq('and is marked as a stall, not a dropped socket', quiet.status.stalled, true);
ok('with a reason naming the silence', /no data for/.test(quiet.status.dropReason), quiet.status.dropReason);
ok('and says the link itself is fine', /connection is open/.test(quiet.status.dropReason));

// The next message revives it — recovery must not need an operator.
quiet._handle({ HomeScore: 1 });
eq('data resuming brings it straight back', quiet.status.connected, true);
eq('and clears the stall', quiet.status.stalled, false);
quiet.stop();
eq('stopping clears the watchdog', quiet._watchdog, null);

/* A genuine socket drop after a stall must not inherit the stale flag —
   they need different fixes and so must not be reported as the same thing. */
const mixed = new ScorebotClient({ store, onStatus: () => {} });
mixed._setConnected(true);
mixed._setConnected(false, 'no data for 5s', true);
eq('the stall is flagged', mixed.status.stalled, true);
mixed._setConnected(true);
mixed._setConnected(false, 'socket closed');
eq('a later real drop is not', mixed.status.stalled, false);

/* ------------------------------------------------------------------ *
 * The alert has to be dismissable in both of its states.
 *
 * It shipped with `#feedalert.back .fa-acts{display:none}`, which hid the
 * whole button row on the green "reconnected" note — leaving a banner with
 * nothing to click. Static checks, because the console JS needs a DOM.
 * ------------------------------------------------------------------ */
console.log('\n== the alert can always be dismissed ==');

const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

ok('the banner markup has a dismiss control', html.includes('id="fa-dismiss"'));
ok('the reconnected state does not hide the whole button row',
  !/#feedalert\.back\s+\.fa-acts\s*\{[^}]*display\s*:\s*none/.test(css), 'the original bug');
ok('it hides only the pointless Reconnect button',
  /#feedalert\.back\s+#fa-retry\s*\{[^}]*display\s*:\s*none/.test(css));
ok('the banner itself is clickable', /\$\('#feedalert'\)\.onclick/.test(app));

/* Dismissing must settle the state machine, not just hide the element: leaving
   `lost` true meant pressing Reconnect hid the warning and the successful
   reconnect immediately raised the green note in its place, so the alert
   looked like it came back on its own. */
ok('dismissing clears the lost flag', /function dismissFeedAlert\(\)\s*\{\s*FEED\.lost = false;/.test(app));

// The same transition, modelled: dismiss then reconnect must stay quiet.
const machine = () => {
  let lost = false; const shown = [];
  const step = (f) => {
    const isLost = !!f.wanted && f.mode !== 'off' && !f.connected && !!f.droppedAt;
    if (isLost && !lost) { lost = true; shown.push('disconnected'); }
    else if (!isLost && lost) { lost = false; shown.push('reconnected'); }
  };
  return { step, dismiss: () => { lost = false; }, shown };
};

let m = machine();
m.step({ wanted: true, mode: 'mqtt', connected: false, droppedAt: 'x' });
m.step({ wanted: true, mode: 'mqtt', connected: true, droppedAt: null });
eq('left alone, a drop and recovery show both notes', m.shown, ['disconnected', 'reconnected']);

m = machine();
m.step({ wanted: true, mode: 'mqtt', connected: false, droppedAt: 'x' });
m.dismiss();                                   // operator presses Reconnect
m.step({ wanted: true, mode: 'mqtt', connected: true, droppedAt: null });
eq('after dismissing, the recovery note does not reappear', m.shown, ['disconnected']);

m = machine();
m.step({ wanted: true, mode: 'mqtt', connected: false, droppedAt: 'x' });
m.dismiss();
m.step({ wanted: true, mode: 'mqtt', connected: true, droppedAt: null });
m.step({ wanted: true, mode: 'mqtt', connected: false, droppedAt: 'y' });
eq('but a fresh drop still warns', m.shown, ['disconnected', 'disconnected']);

/* ------------------------------------------------------------------ *
 * Every XPath the vMix tab advertises has to match the XML we emit.
 *
 * The app handed out URLs without mentioning the XPath at all, so vMix was
 * left pointed at the document rather than the rows inside it and returned a
 * single row of every field concatenated — "Timeouts Usedtimeouts_used00PREPSHS".
 * It reads like corrupt data, but it was a missing setting.
 * ------------------------------------------------------------------ */
console.log('\n== advertised XPaths match the XML ==');

const advertised = /\['[^']+', `\$\{base\}\/vmix\/live\/([a-z]+)\.xml`, '([^']+)'/g;
const listed = [...app.matchAll(advertised)].map(([, file, xp]) => ({ file, xp }));
eq('every feed in the vMix tab carries one', listed.length, 9);

// Walk the path by element name — enough to prove the route exists in the doc.
const resolves = (xml, path) => {
  let depth = 0;
  for (const step of path.split('/')) {
    const at = xml.indexOf(`<${step}`, depth);
    if (at < 0) return false;
    depth = at + step.length;
  }
  return true;
};

const G2 = store.createGame({ sport: 'football', homeTeamId: 'home', awayTeamId: 'away', date: '2026-10-02' }).id;
store.appendEvent(G2, { type: 'stat', team: 'home', action: 'rush', period: 1, clockMs: 600000,
  data: { rusher: p, yards: 12, td: true } });
store.appendEvent(G2, { type: 'stat', team: 'home', action: 'pass_complete', period: 1, clockMs: 580000,
  data: { passer: p, receiver: p, yards: 22, first: true } });
const g2 = deriveGame(store, G2);
ok('the fixture actually produces player stats', Object.keys(g2.players).length > 0,
  `${Object.keys(g2.players).length} players`);

for (const { file, xp } of listed) {
  const build = vmix.XML_VIEWS[file];
  if (!build) { ok(`${file}.xml is a real view`, false, 'no builder for it'); continue; }
  const xml = build(g2, {});
  ok(`${xp} resolves in ${file}.xml`, resolves(xml, xp));
  // The failure being guarded against: the document name alone is not enough.
  ok(`${file}.xml really does repeat <Row>`, xml.includes('<Row>'));
}

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${'='.repeat(52)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(52)}\n`);
process.exit(fail ? 1 : 0);
