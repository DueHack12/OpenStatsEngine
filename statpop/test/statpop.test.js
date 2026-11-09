/* StatPop unit tests: stat matching, composing title fields, vMix XML parsing. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCatalog, search, tokens } from '../lib/catalog.js';
import { compose, defaultSettings, mergeSettings } from '../lib/compose.js';
import { parseState, findInput } from '../lib/vmix.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));
const game = read('football-state.json');
const manifest = read('football-manifest.json');
const cat = buildCatalog(game, manifest);

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '—', e.message); }
}
const best = (q) => search(cat, q, 1)[0]?.entry.id;

console.log('\n== matching ==');
const cases = {
  'Total Yards': 'total_yards', 'total yds': 'total_yards', 'TOTAL OFFENSE': 'total_yards',
  'Yards dropped': 'players.drops', 'drops': 'players.drops', 'dropped passes': 'players.drops',
  'rushing yards': 'rush_yds', 'Rush Yds': 'rush_yds', 'yards rushing': 'rush_yds',
  'passing yards': 'pass_yds', 'pass_yds': 'pass_yds',
  'third down': 'third_line', '3rd down %': 'third_pct', '3rd Down Conversions': 'third_line',
  'time of possession': 'top', 'TOP': 'top',
  'penalties': 'penalty_line', 'penalty yards': 'penalty_yds',
  'turnovers': 'turnovers', 'first downs': 'first_downs', '1st downs': 'first_downs',
  'sacks': 'players.sacks', 'sacks allowed': 'sacks_allowed',
  'tackles': 'players.tackles_total', 'tackels': 'players.tackles_total',
  'tackles for loss': 'players.tfl', 'yards per play': 'yards_per_play', 'yds/play': 'yards_per_play',
  'completion %': 'comp_pct', 'interceptions thrown': 'int_thrown', 'longest run': 'players.rush_long',
  'red zone': 'redzone_line', 'punts': 'punt_line'
};
for (const [q, id] of Object.entries(cases)) t(`"${q}" -> ${id}`, () => assert.equal(best(q), id));
t('nonsense finds nothing confident', () => {
  const r = search(cat, 'banana xylophone', 1)[0];
  assert.ok(!r || r.score < 0.34);
});
t('tokens fold synonyms and plurals', () => {
  assert.deepEqual(tokens('Yds Dropped'), tokens('yards drops'));
});

console.log('\n== compose ==');
const base = mergeSettings(defaultSettings(), {
  header: '{A} at {B}',
  rows: [{ query: 'Total Yards' }, { query: 'Yards dropped', label: 'Drops' }, { query: 'penalties', pick: 'penalties' },
    { query: 'Kanye', a: '7', b: '9' }, {}]
});
const c = compose(base, game, cat);
const F = Object.fromEntries(c.fields.map((f) => [f.field, f.value]));
t('away is on the left by default', () => {
  assert.equal(F['Row1ValA.Text'], String(game.teams.away.total_yards));
  assert.equal(F['Row1ValB.Text'], String(game.teams.home.total_yards));
});
t('header tokens', () => assert.equal(F['HeaderTitle.Text'], `${game.teams.away.abbrev} at ${game.teams.home.abbrev}`));
t('label defaults to what was typed', () => assert.equal(F['Row1Label.Text'], 'Total Yards'));
t('label can be edited', () => assert.equal(F['Row2Label.Text'], 'Drops'));
t('pick overrides the best match', () => assert.equal(c.rows[2].match.id, 'penalties'));
t('manual values win', () => { assert.equal(F['Row4ValA.Text'], '7'); assert.equal(F['Row4ValB.Text'], '9'); });
t('empty row clears its fields', () => {
  assert.equal(F['Row5Label.Text'], ''); assert.equal(F['Row5ValA.Text'], ''); assert.equal(F['Row5ValB.Text'], '');
});
t('scores go to both score fields per team', () => {
  assert.equal(F['TeamAScore.Text'], String(game.teams.away.points));
  assert.equal(F['TeamAScore1.Text'], String(game.teams.away.points));
  assert.equal(F['TeamBScore.Text'], String(game.teams.home.points));
});
t('swap puts home on the left', () => {
  const s = compose({ ...base, teamA: 'home' }, game, cat);
  assert.equal(s.rows[0].valA, String(game.teams.home.total_yards));
});
t('percent stats get a % sign', () => {
  const s = compose(mergeSettings(base, { rows: [{ query: '3rd down %' }] }), game, cat);
  assert.match(s.rows[0].valB, /%$/);
});
t('works without OSE (manual values still go out)', () => {
  const s = compose(base, null, null);
  assert.equal(s.rows[3].valA, '7');
  assert.equal(s.rows[0].valA, '');
});

console.log('\n== vMix XML ==');
const xml = `<vmix><version>29.0.0.49</version><inputs>
<input key="k1" number="1" type="Colour" title="Black" shortTitle="Black" state="Paused">Black</input>
<input key="k2" number="2" type="GT" title="stats pop 1.gtzip" shortTitle="stats pop 1.gtzip" state="Paused">x
<text index="0" name="HeaderTitle.Text">HELLO &amp; WELCOME</text><text index="1" name="Row1Label.Text"/></input>
</inputs><overlays><overlay number="1">2</overlay><overlay number="2" /></overlays></vmix>`;
const st = parseState(xml);
t('parses inputs and text fields', () => {
  assert.equal(st.inputs.length, 2);
  assert.deepEqual(st.inputs[1].fields.map((f) => f.name), ['HeaderTitle.Text', 'Row1Label.Text']);
  assert.equal(st.inputs[1].fields[0].value, 'HELLO & WELCOME');
});
t('finds input by title, number or key', () => {
  assert.equal(findInput(st, 'stats pop 1.gtzip').number, '2');
  assert.equal(findInput(st, '2').key, 'k2');
  assert.equal(findInput(st, 'k2').number, '2');
});
t('reads overlays', () => assert.equal(st.overlays.find((o) => o.number === 1).input, '2'));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
