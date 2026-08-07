/* Tests for the second round: scorebot field sources, baseball bases/count,
   HUDL importers, and per-team season history. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.js';
import { deriveGame } from '../src/engine.js';
import { normalizeFeed, discoverPaths, applyFeed, normBases, DEFAULT_SOURCES } from '../src/integrations/scorebot.js';
import { parseHudlPerGame, parseHudlSeasonHTML } from '../src/importers/hudl.js';
import { detectStatsFormat, importStatsAuto } from '../src/importers/index.js';
import { scoreboardXml } from '../src/vmix.js';

let pass = 0, fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
};
const ok = (l, c, x = '') => { console.log(`${c ? '  ok  ' : '  FAIL'} ${l}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ose-v2-'));
const store = new Store(root);
store.saveTeam({ name: 'Fairfield Prep', abbrev: 'FP' });
store.saveTeam({ name: 'Visitor', abbrev: 'VIS' });

console.log('\n== scorebot: field sources ==');
store.saveRoster('fairfield-prep', 'baseball', [{ number: '5', name: 'Runner One' }], 'replace');
const bg = store.createGame({ sport: 'baseball', homeTeamId: 'fairfield-prep', awayTeamId: 'visitor', date: '2026-05-05' });
// half/outs default to manual, so a feed carrying them must be ignored
let w = applyFeed(store, bg.id, { period: 3, half: 'bottom', outs: 2, balls: 3 }, { sources: DEFAULT_SOURCES });
eq('manual fields ignored (only period written)', w.map(e => e.type), ['period_set']);
w = applyFeed(store, bg.id, { half: 'bottom', outs: 2, balls: 3 },
  { sources: { ...DEFAULT_SOURCES, half: 'scorebot', outs: 'scorebot', balls: 'scorebot' } });
eq('fields switched to scorebot are written', w.map(e => e.type), ['situation_set']);
let g = deriveGame(store, bg.id);
eq('half applied', g.situation.half, 'bottom');
eq('outs applied', g.situation.outs, 2);
eq('balls applied', g.situation.balls, 3);

console.log('\n== scorebot: official score kept beside derived score ==');
applyFeed(store, bg.id, { homeScore: 4, awayScore: 2 }, { sources: DEFAULT_SOURCES });
g = deriveGame(store, bg.id);
eq('official score recorded', g.officialScore && [g.officialScore.away, g.officialScore.home], [2, 4]);
eq('derived score untouched', [g.teams.away.points, g.teams.home.points], [0, 0]);
ok('mismatch flagged in XML', /<ScoreMismatch>1<\/ScoreMismatch>/.test(scoreboardXml(g)));

console.log('\n== baseball: bases, count, half in XML ==');
const rid = store.getRoster('fairfield-prep', 'baseball')[0].id;
store.appendEvent(bg.id, { type: 'situation_set', source: 'manual', period: 3,
  data: { bases: { first: rid, second: false, third: true }, balls: 2, strikes: 1, outs: 1, half: 'bottom' } });
g = deriveGame(store, bg.id);
eq('bases code', g.situation.bases.code, '101');
eq('runner on first resolved to a name', g.situation.bases.first.name, 'Runner One');
eq('bases display', g.situation.bases.display, '1st, 3rd');
eq('batting side follows the half', g.situation.bases.battingSide, 'home');
const x = scoreboardXml(g);
for (const [tag, val] of [['BasesCode', '101'], ['Count', '2-1'], ['Outs', '1'], ['HalfArrow', 'BOT'], ['RunnerFirst', 'Runner One']]) {
  ok(`XML <${tag}> = ${val}`, new RegExp(`<${tag}>${val}</${tag}>`).test(x));
}
ok('InningHalf reads naturally', /<InningHalf>BOT 3rd<\/InningHalf>/.test(x), (x.match(/<InningHalf>(.*?)</) || [])[1]);
eq('manual entry beats the earlier feed value', g.situation.balls, 2);

console.log('\n== scorebot: normalisation + discovery ==');
eq('bases from object', normBases({ first: true, second: false, third: true }), { first: true, second: false, third: true });
eq('bases from array', normBases([1, 3]), { first: true, second: false, third: true });
eq('bases from "101"', normBases('101'), { first: true, second: false, third: true });
eq('bases from bitmask 5', normBases(5), { first: true, second: false, third: true });
eq('half from isTop boolean', normalizeFeed({ isTop: true }).half, 'top');
const sample = { data: { period: 3, gameClock: '7:22', clockRunning: true, homeScore: 14, awayScore: 7 } };
const d = discoverPaths(sample);
eq('discovers nested clock path', d.suggestions.clock[0].path, 'data.gameClock');
eq('discovers nested period path', d.suggestions.period[0].path, 'data.period');
eq('discovers home score path', d.suggestions.homeScore[0].path, 'data.homeScore');
ok('no suggestion invented for missing bases', !d.suggestions.bases, JSON.stringify(d.suggestions.bases ?? null));

console.log('\n== HUDL per-game ==');
const F = (n) => fs.readFileSync(new URL('./fixtures/' + n, import.meta.url), n.endsWith('.pdf') ? 'latin1' : 'utf8');
const perGame = F('hudl-pergame.txt');
eq('format detected', detectStatsFormat(perGame), 'hudl-pergame');
const roster = ['1', '2', '7', '11', '28'];
const hp = parseHudlPerGame(perGame, { rosterNums: roster });
eq('only this team imported', hp.players.length, 5);
ok('other team surfaced, not dropped', hp.unmatched.length === 3, `${hp.unmatched.length} rows`);
const qb = hp.players.find(p => p.number === '11');
eq('QB passing', [qb.stats.pass_comp, qb.stats.pass_att, qb.stats.pass_yds, qb.stats.pass_td], [12, 20, 205, 3]);
eq('QB rushing on the same row', [qb.stats.rush_att, qb.stats.rush_yds], [6, 31]);
const p28 = hp.players.find(p => p.number === '28');
eq('punter', [p28.stats.punts, p28.stats.punt_yds, p28.stats.punt_in20], [4, 152, 2]);
eq('punt long uses max not sum', p28.stats.punt_long, 41);
const wr1 = hp.players.find(p => p.number === '1');
eq('split rows summed', [wr1.stats.rec, wr1.stats.rec_yds, wr1.stats.rec_td], [8, 158, 2]);
eq('long across summed rows is the max', wr1.stats.rec_long, 44);
ok('totals row ignored', !hp.players.some(p => /total/i.test(p.number)));
const collide = parseHudlPerGame(F('hudl-pergame-collision.txt'));
ok('shared jersey numbers are flagged, not silently merged',
  collide.warnings.some(x => /more than one row/.test(x)), collide.warnings[0]?.slice(0, 60));
const sep = parseHudlPerGame(perGame, { rosterNums: roster, merge: false });
ok('merge can be turned off', sep.players.length > hp.players.length, `${sep.players.length} rows unmerged`);

console.log('\n== HUDL season page ==');
const season = F('hudl-season.html');
eq('format detected', detectStatsFormat(season), 'hudl-season');
const hs = parseHudlSeasonHTML(season);
eq('all eight sections found', hs.sections.length, 8);
const man = hs.players.find(p => p.name === 'R. Riverton');
eq('passing line', [man.stats.pass_comp, man.stats.pass_att, man.stats.pass_yds, man.stats.pass_td, man.stats.pass_int], [113, 203, 1595, 20, 1]);
eq('thousands separator parsed', man.stats.pass_yds, 1595);
const con = hs.players.find(p => p.name === 'B. Cornell');
eq('"7 / 11" split into made/attempted', [con.stats.fgm, con.stats.fga], [7, 11]);
eq('XP split', [con.stats.xpm, con.stats.xpa], [34, 34]);
const cj = hs.players.find(p => p.name === 'C. Jameson');
eq('kickoff vs punt returns kept apart', [cj.stats.kr, cj.stats.kr_yds, cj.stats.pr, cj.stats.pr_yds], [10, 209, 4, 8]);
ok('"Rest of team" rows skipped', !hs.players.some(p => /rest of team|total/i.test(p.name)));
ok('"-" read as absent, not zero-filled', hs.players.every(p => !Object.values(p.stats).some(v => typeof v === 'string')));

console.log('\n== MaxPreps PDF is refused, with a reason ==');
const pdf = F('maxpreps-sample.pdf');
eq('detected as pdf', detectStatsFormat(pdf), 'pdf');
try { importStatsAuto(pdf, 'football'); ok('refuses PDF', false); }
catch (e) { ok('refuses PDF with guidance', /CSV|copy/i.test(e.message), e.message.slice(0, 60) + '…'); }

console.log('\n== season history per team ==');
store.saveRoster('fairfield-prep', 'football', [{ number: '11', name: 'R. Riverton' }], 'replace');
store.saveRoster('visitor', 'football', [{ number: '9', name: 'Opp QB' }], 'replace');
const pid = store.getRoster('fairfield-prep', 'football')[0].id;
for (const date of ['2026-09-11', '2026-11-07']) {
  const fg = store.createGame({ sport: 'football', homeTeamId: 'fairfield-prep', awayTeamId: 'visitor', date });
  store.appendEvent(fg.id, { type: 'stat', team: 'home', action: 'pass_complete', period: 1, clockMs: 600000,
    data: { passer: pid, receiver: pid, yards: 40, td: true } });
  store.commitSeasonStats(fg.id, deriveGame(store, fg.id));
}
const team = store.getTeam('fairfield-prep');
const bucket = team.sports.football.season[Object.keys(team.sports.football.season)[0]];
eq('both games retained on the team record', Object.keys(bucket.games).length, 2);
const first = bucket.games['2026-09-11_football_visitor-at-fairfield-prep'];
ok('opponent recorded', first.opponent === 'Visitor', first.opponent);
ok('home/away recorded', first.homeAway === 'H');
ok('team line kept', first.teamStats.score === 6, `score ${first.teamStats.score}`);
ok('per-player numbers kept', first.players.some(p => p.name === 'R. Riverton' && p.pass_yds === 40));

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${'='.repeat(52)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(52)}\n`);
process.exit(fail ? 1 : 0);
