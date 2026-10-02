import fs from 'node:fs';
import { isNewer, checkForUpdate } from '../src/update.js';
import { VERSION, packaged, defaultDataDir, ROOT } from '../src/runtime.js';
import path from 'node:path';
let pass=0, fail=0;
const ok=(l,c,x='')=>{console.log(`${c?'  ok  ':'  FAIL'} ${l}${x?' — '+x:''}`);c?pass++:fail++;};

console.log('\n== runtime ==');
ok('version comes from package.json', VERSION === JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url),'utf8')).version, VERSION);
ok('not packaged when run from source', packaged === false);
ok('source install keeps data in the checkout', defaultDataDir() === path.join(ROOT, 'data'));

console.log('\n== update check ==');
ok('patch is newer', isNewer('1.4.3', '1.4.2'));
ok('compared numerically, not as text', isNewer('1.4.10', '1.4.9'));
ok('minor beats patch', isNewer('1.5.0', '1.4.99'));
ok('leading v ignored', !isNewer('v1.4.2', '1.4.2'));
ok('older is not newer', !isNewer('1.4.1', '1.4.2'));
ok('missing part counts as 0', !isNewer('1.5', '1.5.0'));
ok('release beats its beta', isNewer('2.0.0', '2.0.0-beta1'));
ok('beta is not newer than its release', !isNewer('2.0.0-beta1', '2.0.0'));
ok('beta of the next major beats the current release', isNewer('v2.0.0-beta1', '1.4.2'));
ok('next beta is newer', isNewer('2.0.0-beta2', '2.0.0-beta1'));
ok('beta numbers compared numerically', isNewer('2.0.0-beta10', '2.0.0-beta9'));
ok('dotted pre-release works too', isNewer('2.0.0-beta.2', '2.0.0-beta.1'));
ok('rc beats beta', isNewer('2.0.0-rc1', '2.0.0-beta3'));
ok('same beta is not newer', !isNewer('2.0.0-beta1', 'v2.0.0-beta1'));
ok('disabled check makes no request', (await checkForUpdate({ enabled: false })) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
