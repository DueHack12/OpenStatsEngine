import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { Store } from '../src/store.js';
let pass=0, fail=0;
const ok=(l,c,x='')=>{console.log(`${c?'  ok  ':'  FAIL'} ${l}${x?' — '+x:''}`);c?pass++:fail++;};
const eq=(l,g,w)=>ok(l+`: ${JSON.stringify(g)}`, JSON.stringify(g)===JSON.stringify(w), g===w?'':`want ${JSON.stringify(w)}`);

const root = fs.mkdtempSync(path.join(os.tmpdir(),'ose-bk-'));
let s = new Store(root);
console.log('\n== backup ==');
ok('no backup when there is nothing to lose', s.backup() === null);
s.saveTeam({ name: 'Newtown', abbrev: 'NHS' });
s.saveRoster('newtown','football',[{number:'7',name:'QB One'}],'replace');
s.saveTeam({ name: 'Bethel', abbrev: 'BET' });
const g = s.createGame({ sport:'football', homeTeamId:'newtown', awayTeamId:'bethel', date:'2026-10-02' });
s.appendEvent(g.id, { type:'stat', team:'home', action:'rush', period:1, clockMs:600000, data:{ yards: 12 } });

const b1 = s.backup();
ok('backup created', !!b1, b1);
ok('teams copied', fs.existsSync(path.join(b1,'teams','newtown.json')));
ok('event log copied', fs.existsSync(path.join(b1,'games',g.id,'events.jsonl')));
ok('config copied', fs.existsSync(path.join(b1,'config.json')));
const ev = fs.readFileSync(path.join(b1,'games',g.id,'events.jsonl'),'utf8');
ok('event log content intact', ev.includes('"action":"rush"'));
ok('vmix not copied (regenerable)', !fs.existsSync(path.join(b1,'vmix')));

console.log('\n== restore after a wipe ==');
fs.rmSync(path.join(root,'teams'), { recursive:true, force:true });
fs.rmSync(path.join(root,'games'), { recursive:true, force:true });
s = new Store(root);
eq('data really gone', s.listTeams().length, 0);
fs.cpSync(path.join(b1,'teams'), path.join(root,'teams'), { recursive:true });
fs.cpSync(path.join(b1,'games'), path.join(root,'games'), { recursive:true });
s = new Store(root);
eq('teams restored', s.listTeams().length, 2);
eq('games restored', s.listGames().length, 1);
eq('roster restored', s.getRoster('newtown','football').length, 1);
eq('events restored', s.readEvents(g.id).filter(e=>e.action==='rush').length, 1);

console.log('\n== pruning ==');
const bdir = path.join(root,'_backups');
for (let i=0;i<14;i++) fs.mkdirSync(path.join(bdir, `2026-01-${String(i+1).padStart(2,'0')}-00-00-00`), { recursive:true });
s.backup({ keep: 5 });
const left = fs.readdirSync(bdir).filter(d=>/^\d{4}-/.test(d)).sort();
eq('keeps only the newest N', left.length, 5);
ok('oldest pruned first', !left.includes('2026-01-01-00-00-00'), left[0]);

ok('dataSize reports something', s.dataSize() > 0, s.dataSize()+' bytes');
fs.rmSync(root,{recursive:true,force:true});
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
