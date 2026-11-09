/* StatPop unit tests: stat matching, composing title fields, vMix XML parsing. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCatalog, search, tokens } from '../lib/catalog.js';
import { compose, defaultSettings, mergeSettings, normalizeUrl, hex, contrastText } from '../lib/compose.js';
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
const F = Object.fromEntries(c.fields.filter((f) => f.fn === 'SetText').map((f) => [f.field, f.value]));
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

t('OSE on another computer: bare IP gets http:// and port 8080', () => {
  assert.equal(normalizeUrl('192.168.1.50', 8080), 'http://192.168.1.50:8080');
  assert.equal(normalizeUrl('ose-laptop:9000/', 8080), 'http://ose-laptop:9000');
  assert.equal(mergeSettings(defaultSettings(), { ose: { url: '10.0.0.7' } }).ose.url, 'http://10.0.0.7:8080');
});

console.log('\n== colours ==');
t('hex colours are tidied', () => {
  assert.equal(hex('1e40af'), '#1E40AF'); assert.equal(hex('#ff0'), '#FFFF00');
  assert.equal(hex('#80FF0000'), '#80FF0000'); assert.equal(hex('red'), '');
});
t('auto text is white on dark, black on light', () => {
  assert.equal(contrastText('#1E40AF'), '#FFFFFF'); assert.equal(contrastText('#991B1B'), '#FFFFFF');
  assert.equal(contrastText('#FFFFFF'), '#000000'); assert.equal(contrastText('#FACC15'), '#000000');
});
const withBoxes = mergeSettings(base, { fields: { boxA: 'BoxA.Fill.Color', boxB: 'BoxB.Fill.Color' } });
const colourCalls = (st) => compose(st, game, cat).fields.filter((f) => f.fn !== 'SetText');
t('no box names: no colour calls for boxes', () => {
  assert.ok(!compose(base, game, cat).fields.some((f) => f.fn === 'SetColor'));
});
t('team colour from OSE goes to the box, contrasting text to the score', () => {
  const calls = colourCalls(withBoxes);
  const box = calls.find((f) => f.field === 'BoxA.Fill.Color');
  assert.equal(box.fn, 'SetColor'); assert.equal(box.value, hex(game.teams.away.primaryColor));
  const txt = calls.find((f) => f.field === 'TeamAScore.Text');
  assert.equal(txt.fn, 'SetTextColour'); assert.equal(txt.value, contrastText(box.value));
});
t('custom colours override, and follow the team on swap', () => {
  const st = mergeSettings(withBoxes, { colors: { home: { box: 'custom', boxColor: '#00aa44', text: 'custom', textColor: '#ff0' } } });
  assert.equal(colourCalls(st).find((f) => f.field === 'BoxB.Fill.Color').value, '#00AA44');
  assert.equal(colourCalls(st).find((f) => f.field === 'TeamBScore.Text').value, '#FFFF00');
  const swapped = mergeSettings(st, { teamA: 'home' });
  assert.equal(colourCalls(swapped).find((f) => f.field === 'BoxA.Fill.Color').value, '#00AA44');
});
t("\"don't change\" sends nothing", () => {
  const st = mergeSettings(withBoxes, { colors: { home: { box: 'off', text: 'off' }, away: { box: 'off', text: 'off' } } });
  assert.equal(colourCalls(st).length, 0);
});
t('bad colour values are ignored', () => {
  const st = mergeSettings(withBoxes, { colors: { away: { box: 'purple', boxColor: 'nope' } } });
  assert.equal(st.colors.away.box, 'team'); assert.equal(st.colors.away.boxColor, '');
});

console.log('\n== vMix XML ==');
const xml = `<vmix><version>29.0.0.49</version><inputs>
<input key="k1" number="1" type="Colour" title="Black" shortTitle="Black" state="Paused">Black</input>
<input key="k2" number="2" type="GT" title="stats pop 1.gtzip" shortTitle="stats pop 1.gtzip" state="Paused">x
<text index="0" name="HeaderTitle.Text">HELLO &amp; WELCOME</text><text index="1" name="Row1Label.Text"/>
<color index="0" name="ScoreBoxA.Fill.Color">#FFFFFFFF</color></input>
</inputs><overlays><overlay number="1">2</overlay><overlay number="2" /></overlays></vmix>`;
const st = parseState(xml);
t('parses inputs and text fields', () => {
  assert.equal(st.inputs.length, 2);
  assert.deepEqual(st.inputs[1].fields.map((f) => f.name), ['HeaderTitle.Text', 'Row1Label.Text', 'ScoreBoxA.Fill.Color']);
  assert.equal(st.inputs[1].fields[2].kind, 'color');
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
