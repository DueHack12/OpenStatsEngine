import fs from 'node:fs';
import os from 'node:os';
import { isNewer, checkForUpdate, checkUpdates, getChannel, setChannel, defaultChannel } from '../src/update.js';
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

console.log('\n== channels ==');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ose-up-'));
process.env.OSE_SETTINGS = path.join(tmp, 'settings.json');
ok('default follows this build', getChannel() === defaultChannel() && defaultChannel() === (VERSION.includes('-') ? 'beta' : 'stable'));
setChannel('beta');
ok('choice is remembered', getChannel() === 'beta' && JSON.parse(fs.readFileSync(process.env.OSE_SETTINGS, 'utf8')).updateChannel === 'beta');
let threw = false; try { setChannel('nightly'); } catch { threw = true; }
ok('unknown channel refused', threw && getChannel() === 'beta');

// GitHub, as far as these tests are concerned: one finished release far in the
// future, and an even newer beta. /latest leaves the beta out, as GitHub does.
const STABLE = { tag_name: 'v99.0.0', html_url: 'u-stable', prerelease: false };
const BETA = { tag_name: 'v99.1.0-beta1', html_url: 'u-beta', prerelease: true };
const DRAFT = { tag_name: 'v100.0.0', draft: true };
let calls = [];
globalThis.fetch = async (url) => {
  calls.push(url);
  return { ok: true, status: 200, json: async () => (url.endsWith('/latest') ? STABLE : [DRAFT, BETA, STABLE]) };
};
let r = await checkUpdates({ channel: 'stable' });
ok('stable is offered the finished release', r.checked && r.update?.version === '99.0.0' && !r.update.prerelease, JSON.stringify(r.update));
ok('stable asks for the latest release', calls.at(-1).endsWith('/releases/latest'));
r = await checkUpdates({ channel: 'beta' });
ok('beta is offered the newer beta', r.update?.version === '99.1.0-beta1' && r.update.prerelease, JSON.stringify(r.update));
ok('drafts never offered', r.update?.version !== '100.0.0');
const n = calls.length;
await checkUpdates({ channel: 'beta' });
ok('answer is kept until asked again', calls.length === n);
await checkUpdates({ channel: 'beta', force: true });
ok('Check Now asks again', calls.length === n + 1);

globalThis.fetch = async () => { throw new Error('offline'); };
r = await checkUpdates({ channel: 'stable', force: true });
ok('offline is "could not check", not "up to date"', r.checked === false && r.update === null);
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
r = await checkUpdates({ channel: 'stable', force: true });
ok('no stable release yet is "up to date"', r.checked === true && r.update === null);
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
