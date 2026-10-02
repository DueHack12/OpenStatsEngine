import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ose-dd-'));
process.env.OSE_SETTINGS = path.join(tmp, 'cfg', 'settings.json');
const { resolveDataDir, inspectDataDir, chooseDataDir, readSettings, normalizePath } = await import('../src/datadir.js');
const { defaultDataDir } = await import('../src/runtime.js');
const { Store } = await import('../src/store.js');
let pass=0, fail=0;
const ok=(l,c,x='')=>{console.log(`${c?'  ok  ':'  FAIL'} ${l}${x?' — '+x:''}`);c?pass++:fail++;};
const throws=(l,fn,re)=>{try{fn();ok(l,false,'did not throw');}catch(e){ok(l,re.test(e.message),e.message);}};

// A data folder in use, with a team and a game in it.
const current = path.join(tmp, 'current');
const s = new Store(current);
s.saveTeam({ name: 'Newtown', abbrev: 'NHS' });
s.saveTeam({ name: 'Bethel', abbrev: 'BET' });
s.createGame({ sport: 'football', homeTeamId: 'newtown', awayTeamId: 'bethel', date: '2026-10-02' });

// A synced folder that already holds data from an earlier version.
const drive = path.join(tmp, 'My Drive', 'OpenStatsEngine');
new Store(drive).saveTeam({ name: 'Weston', abbrev: 'WES' });

console.log('\n== resolve ==');
ok('nothing set → default', resolveDataDir({}).source === 'default' && resolveDataDir({}).dir === defaultDataDir());
ok('--data wins', resolveDataDir({ flag: '/x/flag', env: '/x/env' }).source === 'flag');
ok('OSE_DATA next', resolveDataDir({ env: '/x/env' }).source === 'env');

console.log('\n== inspect ==');
let i = inspectDataDir(current);
ok('counts teams and games', i.exists && i.hasData && i.teams === 2 && i.games === 1, JSON.stringify(i));
i = inspectDataDir(path.join(tmp, 'nope'));
ok('missing folder', !i.exists && !i.hasData);

console.log('\n== choose ==');
throws('relative path refused', () => chooseDataDir('relative/folder', { current }), /full path/);
throws('copying over existing data refused', () => chooseDataDir(drive, { current, copy: true }), /already has OpenStatsEngine data/);
ok('…and nothing was written', inspectDataDir(drive).teams === 1);
let r = chooseDataDir(drive, { current });
ok('a folder with data is used as it is', r.dir === drive && !r.copied && r.found?.teams === 1);
ok('remembered in settings', readSettings().dataDir === drive);
ok('picked folder now resolves', resolveDataDir({}).source === 'setting' && resolveDataDir({}).dir === drive);
ok('but --data still wins', resolveDataDir({ flag: current }).dir === current);

const empty = path.join(tmp, 'fresh');
r = chooseDataDir(`"${empty}"`, { current, copy: true });
i = inspectDataDir(empty);
ok('pasted quotes are stripped', r.dir === empty);
ok('copied into an empty folder', r.copied && i.teams === 2 && i.games === 1, JSON.stringify(i));
ok('config came along', fs.existsSync(path.join(empty, 'config.json')));
ok('vmix left behind', !fs.existsSync(path.join(empty, 'vmix')));
ok('source untouched', inspectDataDir(current).teams === 2);

throws('copy into itself refused', () => chooseDataDir(current, { current, copy: true }), /already the folder/);
throws('copy into a subfolder refused', () => chooseDataDir(path.join(current, 'sub'), { current, copy: true }), /inside/);

r = chooseDataDir('', { current });
ok('empty path resets to default', r.reset && !readSettings().dataDir && resolveDataDir({}).source === 'default');

ok('~ expands to home', normalizePath('~/x') === path.join(os.homedir(), 'x'));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
