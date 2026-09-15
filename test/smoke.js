/* End-to-end smoke test: drives the real HTTP API like an operator would. */
// 8781 rather than 8770: macOS `sharingd` binds 8770 opportunistically, and a
// test server that quietly falls back to the next free port while the test
// keeps calling 8770 fails in a thoroughly confusing way.
const BASE = process.env.BASE || 'http://localhost:8781';
let pass = 0, fail = 0;

const j = async (path, opts = {}) => {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : {}
  });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${body?.error || body}`);
  return body;
};
const bin = async (path) => {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};
function check(label, got, want) {
  const ok = String(got) === String(want);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}: ${got}${ok ? '' : `  (expected ${want})`}`);
  ok ? pass++ : fail++;
}
function ok(label, cond, extra = '') {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
  cond ? pass++ : fail++;
}

const ROSTER_HOME = `Number,Name,Position,Grade
7,Jake Miller,QB,12
22,Chris Doyle,RB,11
80,Ryan Alves,WR,12
11,Sam Turner,WR,10
44,Nick Brady,LB,12
3,Owen Kim,K,11`;

const ROSTER_AWAY = `No,Player,Pos,Yr
9,Alex Reed,QB,11
28,Marcus Hill,RB,12
84,Tyler Cross,WR,11
55,Devin Park,DL,12`;

(async () => {
  console.log('\n== teams ==');
  const home = await j('/api/teams', { method: 'POST', body: JSON.stringify({ name: 'Newtown High School', abbrev: 'NHS', shortName: 'Newtown', mascot: 'Nighthawks' }) });
  const away = await j('/api/teams', { method: 'POST', body: JSON.stringify({ name: 'Bethel High School', abbrev: 'BET', shortName: 'Bethel', mascot: 'Wildcats' }) });
  check('home team id', home.id, 'newtown-high-school');

  const r1 = await j(`/api/teams/${home.id}/roster/import`, { method: 'POST', body: JSON.stringify({ sport: 'football', csv: ROSTER_HOME }) });
  const r2 = await j(`/api/teams/${away.id}/roster/import`, { method: 'POST', body: JSON.stringify({ sport: 'football', csv: ROSTER_AWAY }) });
  check('home roster size', r1.total, 6);
  check('away roster size', r2.total, 4);
  check('roster parsed name', r1.roster.find((p) => p.number === '7').name, 'Jake Miller');
  check('alt-header roster name', r2.roster.find((p) => p.number === '28').name, 'Marcus Hill');

  const P = (roster, num) => roster.find((p) => String(p.number) === String(num)).id;
  const H = r1.roster, A = r2.roster;

  console.log('\n== game ==');
  const game = await j('/api/games', {
    method: 'POST',
    body: JSON.stringify({ sport: 'football', homeTeamId: home.id, awayTeamId: away.id, venue: 'Blue & Gold Stadium', operator: 'Test Op', date: '2026-09-11' })
  });
  const G = game.id;
  console.log('  game:', G);

  const ev = (team, action, data) => j(`/api/games/${G}/events`, { method: 'POST', body: JSON.stringify({ type: 'stat', team, action, data }) });
  const clock = (op, extra = {}) => j(`/api/games/${G}/clock`, { method: 'POST', body: JSON.stringify({ op, ...extra }) });

  await clock('start');
  await j(`/api/games/${G}/possession`, { method: 'POST', body: JSON.stringify({ team: 'home' }) });

  // Home drive: 1st&10 -> 12yd pass (1st down) -> 5yd run -> sack -8 -> 22yd TD pass -> XP
  await ev('home', 'pass_complete', { passer: P(H, 7), receiver: P(H, 80), yards: 12 });
  let st = await j(`/api/games/${G}/state`);
  check('after 12yd completion, down', st.situation.down, 1);
  check('first downs (pass)', st.teams.home.first_downs_pass, 1);

  await ev('home', 'rush', { rusher: P(H, 22), yards: 5, tackledBy: P(A, 55) });
  st = await j(`/api/games/${G}/state`);
  check('2nd & 5 after 5yd run', `${st.situation.down}&${st.situation.distance}`, '2&5');

  await ev('home', 'sack', { passer: P(H, 7), by: P(A, 55), yards: 8 });
  st = await j(`/api/games/${G}/state`);
  check('3rd & 13 after sack', `${st.situation.down}&${st.situation.distance}`, '3&13');
  check('sacks allowed', st.teams.home.sacks_allowed, 1);
  check('team rush yards net of sack', st.teams.home.rush_yds, -3);

  await ev('home', 'pass_complete', { passer: P(H, 7), receiver: P(H, 11), yards: 22, td: true });
  await ev('home', 'xp_good', { kicker: P(H, 3) });
  st = await j(`/api/games/${G}/state`);
  check('home score after TD+XP', st.teams.home.points, 7);
  check('3rd down conversions', st.teams.home.third_line, '1/1');

  const qb = Object.values(st.players).find((p) => p.name === 'Jake Miller');
  check('QB comp/att (sack is NOT a pass attempt)', qb.comp_att, '2/2');
  check('QB sacks taken', qb.sacked, 1);
  check('QB yards', qb.pass_yds, 34);
  check('QB TD', qb.pass_td, 1);
  check('QB long', qb.pass_long, 22);
  ok('QB passer rating computed', qb.rating > 0, `rating=${qb.rating}`);
  const dl = Object.values(st.players).find((p) => p.name === 'Devin Park');
  check('DL sacks', dl.sacks, 1);
  check('DL tackles', dl.tackles_total, 2);

  // Away possession: INT returned for a TD (points must go to the DEFENSE)
  await ev('away', 'rush', { rusher: P(A, 28), yards: 6 });
  await ev('away', 'pass_int', { passer: P(A, 9), by: P(H, 44), returnYards: 30, td: true });
  st = await j(`/api/games/${G}/state`);
  check('pick-6 credits home', st.teams.home.points, 13);
  check('away score unchanged', st.teams.away.points, 0);
  check('away INT thrown', st.teams.away.pass_int, 1);
  const lb = Object.values(st.players).find((p) => p.name === 'Nick Brady');
  check('LB interceptions', lb.def_int, 1);
  check('possession flipped to home', st.situation.possession, 'home');

  console.log('\n== time of possession ==');
  ok('home TOP accumulating', st.teams.home.possession_ms > 0, st.teams.home.top);
  ok('away TOP accumulating', st.teams.away.possession_ms > 0, st.teams.away.top);
  ok('drought tracked', st.droughts.away.display != null, `away drought ${st.droughts.away.display}`);

  console.log('\n== undo ==');
  const before = st.teams.home.points;
  const lastTD = st.scoringPlays[st.scoringPlays.length - 1].eventId;
  const u = await j(`/api/games/${G}/undo`, { method: 'POST', body: JSON.stringify({ eventId: lastTD }) });
  check('score drops after undo', u.state.teams.home.points, before - 6);
  ok('audit trail keeps the raw event', (await j(`/api/games/${G}/events`)).some((e) => e.id === lastTD), 'original event still on disk');
  await ev('home', 'fumble_recovery', { player: P(H, 44), yards: 30, td: true }); // re-score another way
  st = await j(`/api/games/${G}/state`);
  check('score restored via new play', st.teams.home.points, 13);

  console.log('\n== timestamps ==');
  const evs = await j(`/api/games/${G}/events`);
  const s1 = evs.find((e) => e.type === 'stat');
  ok('event has ISO timestamp', /^\d{4}-\d{2}-\d{2}T/.test(s1.ts), s1.ts);
  ok('event has local timestamp', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s1.tsLocal), s1.tsLocal);
  ok('event has clock + period', s1.clockMs != null && s1.period != null, `P${s1.period} ${s1.clockMs}ms`);

  console.log('\n== vMix XML ==');
  const sb = await (await fetch(`${BASE}/vmix/live/scoreboard.xml`)).text();
  ok('scoreboard is XML', sb.startsWith('<?xml'), '');
  ok('scoreboard has HomeScore', /<HomeScore>13<\/HomeScore>/.test(sb));
  ok('scoreboard has clock', /<Clock>/.test(sb));
  ok('scoreboard has down & distance', /<DownDistance>/.test(sb), (sb.match(/<DownDistance>(.*?)</) || [])[1]);
  ok('scoreboard has TOP', /<HomeTOP>/.test(sb), (sb.match(/<HomeTOP>(.*?)</) || [])[1]);
  const ts = await (await fetch(`${BASE}/vmix/live/teamstats.xml`)).text();
  ok('teamstats has rows', (ts.match(/<Row>/g) || []).length > 10, `${(ts.match(/<Row>/g) || []).length} rows`);
  const ld = await (await fetch(`${BASE}/vmix/live/leaders.xml?cat=passing&limit=3`)).text();
  ok('leaders XML has a stat line', /<StatLine>/.test(ld), (ld.match(/<StatLine>(.*?)</) || [])[1]);
  const pl = await (await fetch(`${BASE}/vmix/live/players.xml?side=home&cat=passing`)).text();
  ok('players XML filtered to home passing', /Jake Miller/.test(pl) && !/Marcus Hill/.test(pl));
  const all = await (await fetch(`${BASE}/vmix/live/all.xml`)).text();
  ok('all.xml well-formed-ish', all.startsWith('<?xml') && all.trim().endsWith('</Game>'));
  ok('no raw ampersands in XML', !/&(?!(amp|lt|gt|quot|apos);)/.test(sb + ts + ld + pl));

  console.log('\n== exports ==');
  const box = await (await fetch(`${BASE}/api/games/${G}/export/boxscore.csv`)).text();
  ok('box score CSV has header', box.split('\r\n')[0].includes('Number,Name'));
  ok('box score CSV has players', box.includes('Jake Miller'));
  const pbp = await (await fetch(`${BASE}/api/games/${G}/export/pbp.csv`)).text();
  ok('PBP CSV includes entry times', /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(pbp));
  ok('PBP CSV includes undo record', pbp.includes('undo'));
  const pdf = await bin(`/api/games/${G}/export/report.pdf`);
  ok('PDF magic bytes', pdf.slice(0, 5).toString() === '%PDF-', `${pdf.length} bytes`);
  ok('PDF has EOF marker', pdf.slice(-8).toString().includes('%%EOF'));
  ok('PDF is a plausible size', pdf.length > 3000, `${pdf.length} bytes`);

  console.log('\n== season commit ==');
  await j(`/api/games/${G}/commit`, { method: 'POST', body: '{}' });
  const season = await (await fetch(`${BASE}/api/teams/${home.id}/export/season.csv?sport=football&season=${new Date().getFullYear()}`)).text();
  ok('season CSV has totals block', season.includes('SEASON TOTALS'));
  ok('season CSV has the player', season.includes('Jake Miller'));
  const t = await j(`/api/teams/${home.id}`);
  ok('game stored on team record', Object.keys(t.sports.football.season[Object.keys(t.sports.football.season)[0]].games).length === 1);

  console.log('\n== other sports ==');
  for (const sport of ['basketball', 'hockey', 'soccer', 'lacrosse', 'baseball']) {
    await j(`/api/teams/${home.id}/roster`, { method: 'POST', body: JSON.stringify({ sport, players: [{ number: '1', name: 'A Player' }, { number: '2', name: 'B Player' }] }) });
    await j(`/api/teams/${away.id}/roster`, { method: 'POST', body: JSON.stringify({ sport, players: [{ number: '9', name: 'C Player' }] }) });
    const g2 = await j('/api/games', { method: 'POST', body: JSON.stringify({ sport, homeTeamId: home.id, awayTeamId: away.id, date: '2026-01-0' + (1 + ['basketball', 'hockey', 'soccer', 'lacrosse', 'baseball'].indexOf(sport)) }) });
    const hr = await j(`/api/teams/${home.id}/roster?sport=${sport}`);
    const pid = hr.players[0].id;
    const manifest = await j(`/api/sports/${sport}`);
    const firstAction = manifest.palette[0].actions[0];
    const data = {};
    for (const f of firstAction.fields || []) {
      if (f.type === 'player') data[f.name] = pid;
      else if (f.type === 'number') data[f.name] = 2;
      else if (f.type === 'select') data[f.name] = f.options[0];
    }
    await j(`/api/games/${g2.id}/events`, { method: 'POST', body: JSON.stringify({ type: 'stat', team: 'home', action: firstAction.key, data }) });
    const s2 = await j(`/api/games/${g2.id}/state`);
    ok(`${sport}: "${firstAction.label}" scores/records`, s2.counts.effective >= 1,
      `home ${s2.teams.home.points} — ${Object.values(s2.players).length} player(s) tracked`);
    const x2 = await (await fetch(`${BASE}/vmix/${g2.id}/scoreboard.xml`)).text();
    ok(`${sport}: XML renders`, x2.startsWith('<?xml') && x2.includes('<HomeScore>'));
    const p2 = await bin(`/api/games/${g2.id}/export/report.pdf`);
    ok(`${sport}: PDF renders`, p2.slice(0, 5).toString() === '%PDF-', `${p2.length} bytes`);
  }

  console.log('\n== scorebot connect / disconnect ==');
// No real feed here; what matters is that the enabled flag is persisted, since a
// stop that does not survive silently reconnects on the next ordinary action.
await j('/api/config', { method: 'POST', body: JSON.stringify({ scorebot: { enabled: true, url: 'mqtt://127.0.0.1:1/none' } }) });
let sbState = await j('/api/scorebot/status');
check('enabled persisted', sbState.config.enabled, true);

await j('/api/scorebot/stop', { method: 'POST', body: '{}' });
sbState = await j('/api/scorebot/status');
check('disconnect stops it', sbState.mode, 'off');
check('disconnect also persists enabled:false', sbState.config.enabled, false);

// the actions that used to silently bring it back
await j(`/api/games/${G}/activate`, { method: 'POST', body: '{}' });
sbState = await j('/api/scorebot/status');
check('activating a game does not reconnect', sbState.mode, 'off');
await j('/api/config', { method: 'POST', body: JSON.stringify({ operator: 'Someone' }) });
sbState = await j('/api/scorebot/status');
check('saving unrelated settings does not reconnect', sbState.mode, 'off');
check('and it is still disabled', (await j('/api/scorebot/status')).config.enabled, false);

try { await j('/api/scorebot/start', { method: 'POST', body: '{}' }); }
catch { /* no broker listening on that port; the persistence is the point */ }
check('connect flips enabled back on', (await j('/api/scorebot/status')).config.enabled, true);
await j('/api/scorebot/stop', { method: 'POST', body: '{}' });

console.log('\n== errors are sane ==');
  try { await j(`/api/games/${G}/events`, { method: 'POST', body: JSON.stringify({ type: 'stat', team: 'home', action: 'not_a_real_action' }) }); ok('rejects unknown action', false); }
  catch (e) { ok('rejects unknown action', /Unknown action/.test(e.message), e.message.split(':').pop().trim()); }
  try { await j('/api/games/nope/state'); ok('404s unknown game', false); }
  catch (e) { ok('404s unknown game', /404/.test(e.message)); }

  console.log('\n== editing a logged entry ==');
  {
    // Its own game: these checks are about exact totals, and piggybacking on a
    // game that already has a drive logged makes them meaningless.
    const EG = (await j('/api/games', { method: 'POST', body: JSON.stringify({
      sport: 'football', homeTeamId: home.id, awayTeamId: away.id, date: '2026-11-21'
    }) })).id;

    const r1 = await j(`/api/games/${EG}/events`, {
      method: 'POST',
      body: JSON.stringify({ type: 'stat', team: 'home', action: 'pass_complete',
        data: { passer: P(H, 7), receiver: P(H, 80), yards: 9 } })
    });
    const mine = r1.state.timeline.filter((t) => t.type === 'stat');
    check('one entry logged', mine.length, 1);
    const evId = mine[0].id;
    ok('the timeline carries the entered values back', mine[0].data?.yards === 9, JSON.stringify(mine[0].data));
    ok('and the action, so the right form can be reopened', mine[0].action === 'pass_complete');

    const recOf = (st, name) => Object.values(st.players).find((p) => p.name === name) || {};
    check('receiver credited as entered', recOf(r1.state, 'Ryan Alves').rec_yds, 9);

    // Reassign to a different receiver, longer, and a touchdown.
    const r2 = await j(`/api/games/${EG}/correct`, {
      method: 'POST',
      body: JSON.stringify({ eventId: evId, data: { data: { passer: P(H, 7), receiver: P(H, 11), yards: 30, td: true } } })
    });
    check('the original receiver loses it', recOf(r2.state, 'Ryan Alves').rec_yds || 0, 0);
    check('the new receiver gains it', recOf(r2.state, 'Sam Turner').rec_yds, 30);
    check('and is credited the touchdown', recOf(r2.state, 'Sam Turner').rec_td, 1);
    check('the score follows', r2.state.teams.home.points, 6);
    ok('the entry is flagged as edited', r2.state.timeline.find((t) => t.id === evId).corrected === true);

    // Clearing a field has to clear it. A correction is merged onto the
    // original, so a field simply left out would keep its old value.
    const r3 = await j(`/api/games/${EG}/correct`, {
      method: 'POST',
      body: JSON.stringify({ eventId: evId, data: { data: { passer: P(H, 7), receiver: P(H, 11), yards: 30, td: null } } })
    });
    check('unticking the touchdown removes it', recOf(r3.state, 'Sam Turner').rec_td, 0);
    check('and takes the points with it', r3.state.teams.home.points, 0);

    // Nothing is rewritten in place — the original entry and both edits stay.
    const raw = await j(`/api/games/${EG}/events`);
    check('two corrections are on the log', raw.filter((e) => e.type === 'correct' && e.targetId === evId).length, 2);
    ok('the original entry is untouched', raw.some((e) => e.id === evId && e.data?.yards === 9));

    try { await j(`/api/games/${EG}/correct`, { method: 'POST', body: JSON.stringify({ data: {} }) }); ok('rejects a correction with no eventId', false); }
    catch (e) { ok('rejects a correction with no eventId', /eventId/.test(e.message)); }

    // Creating a game makes it active, so put the original back before the
    // checks that follow go looking for it.
    await j(`/api/games/${EG}`, { method: 'DELETE' });
    await j(`/api/games/${G}/activate`, { method: 'POST', body: '{}' });
  }

  console.log('\n== archiving ==');
  {
    // Archiving is a visibility flag and nothing more: everything the game
    // holds has to survive it, or "archive" would just be a slower delete.
    const before = await j(`/api/games/${G}/state`);
    const r1 = await j(`/api/games/${G}/archive`, { method: 'POST', body: '{}' });
    ok('archive reports the new state', r1.archived === true);
    const meta = (await j('/api/games')).find((x) => x.id === G);
    ok('the flag is on the game', !!meta.archived);
    ok('and it is timestamped', !!meta.archivedAt, meta.archivedAt);

    const after = await j(`/api/games/${G}/state`);
    check('the score is untouched', after.teams.home.points, before.teams.home.points);
    check('the log is untouched', after.counts.effective, before.counts.effective);
    ok('the PDF still exports', (await bin(`/api/games/${G}/export/report.pdf`)).length > 800);
    ok('the box score still exports', (await j(`/api/games/${G}/export/boxscore.csv`)).length > 50);
    ok('vMix XML still serves', (await j(`/vmix/${G}/scoreboard.xml`)).includes('<Row>'));

    // It must be reversible, and it must not have quietly deactivated anything.
    const r2 = await j(`/api/games/${G}/archive`, { method: 'POST', body: JSON.stringify({ archived: false }) });
    ok('unarchiving works', r2.archived === false);
    ok('and clears the timestamp', !(await j('/api/games')).find((x) => x.id === G).archivedAt);

    try { await j('/api/games/not-a-game/archive', { method: 'POST', body: '{}' }); ok('404s an unknown game', false); }
    catch (e) { ok('404s an unknown game', /404|No such game/.test(e.message)); }
  }

  console.log('\n== monitor endpoint ==');
  {
    const m = await j('/api/monitor');
    ok('reports this server\'s addresses', Array.isArray(m.server.addresses));
    ok('and the port it is really on', m.server.port > 0, String(m.server.port));
    ok('carries the feed block', !!m.feed && 'connected' in m.feed);
    ok('and the active game', !!m.game, m.game ? m.game.matchup : 'none');
    ok('with a recent-log list', Array.isArray(m.game.recent));
    ok('and the clock as displayed', typeof m.game.clock === 'string', m.game.clock);
    ok('the monitor page is served', (await fetch(BASE + '/monitor')).ok);
  }

  console.log(`\n${'='.repeat(50)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(50)}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\nFATAL:', e.message); process.exit(1); });
