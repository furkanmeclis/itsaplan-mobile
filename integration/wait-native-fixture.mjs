import { readFile } from 'node:fs/promises';
const file = process.argv[2];
let ready = false;
for (let attempt = 0; attempt < 120; attempt++) {
  try { ready = JSON.parse(await readFile(file, 'utf8')).ready === true; }
  catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  if (ready) break;
  await new Promise((done) => setTimeout(done, 1000));
}
if (!ready) throw new Error('Disposable native fixtures did not become ready');
console.log('Disposable native fixtures are ready.');
