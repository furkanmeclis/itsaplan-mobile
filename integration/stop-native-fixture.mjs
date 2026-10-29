import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const file = process.argv[2];
let state;
try { state = JSON.parse(await readFile(file, 'utf8')); }
catch (error) { if (error.code === 'ENOENT') process.exit(0); throw error; }
if (!Number.isSafeInteger(state.controllerPid) || state.controllerPid <= 1) throw new Error('Invalid fixture controller');
const processInfo = spawnSync('ps', ['-p', String(state.controllerPid), '-o', 'args='], { encoding: 'utf8' });
if (processInfo.status !== 0) process.exit(0);
if (!processInfo.stdout.trim().endsWith('integration/run.mjs --serve-native')) throw new Error('Refusing to stop an unrelated process');
try { process.kill(state.controllerPid, 'SIGTERM'); }
catch (error) { if (error.code === 'ESRCH') process.exit(0); throw error; }
for (let attempt = 0; attempt < 60; attempt++) {
  try { await access(file); }
  catch (error) { if (error.code === 'ENOENT') { console.log('Disposable native fixtures cleaned up.'); process.exit(0); } throw error; }
  await new Promise((done) => setTimeout(done, 1000));
}
throw new Error('Disposable native fixture cleanup did not finish');
