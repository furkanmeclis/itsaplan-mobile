import { mkdtempSync, rmSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const root = resolve(process.env.UPSTREAM_ROOT ?? '/tmp/itsaplan-upstream');
const bun = process.env.BUN_BINARY ?? 'bun';
const temporary = mkdtempSync(join(tmpdir(), 'ipm-upstream-'));
const servers = [];
const certificate = join(temporary, 'cert.pem');
const key = join(temporary, 'key.pem');
const database = process.env.UPSTREAM_DB_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres';
if (!['localhost', '127.0.0.1'].includes(new URL(database).hostname)) throw new Error('Integration tests require a disposable loopback PostgreSQL server.');
const names = ['a', 'b'].map((suffix) => `ipm_${randomBytes(6).toString('hex')}_${suffix}`);
const postgresModule = spawnSync(bun, ['-e', `console.log(require.resolve('postgres', { paths: [${JSON.stringify(join(root, 'packages/db'))}] }))`], { encoding: 'utf8' });
if (postgresModule.status !== 0) throw new Error('Upstream dependencies are not installed.');
const postgresPath = postgresModule.stdout.trim();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error('Integration prerequisite failed.');
}
function sql(statement) {
  const script = join(temporary, 'database.mjs');
  writeFileSync(script, `import postgres from ${JSON.stringify(postgresPath)}; const sql=postgres(process.env.UPSTREAM_DB_URL);try{await sql.unsafe(${JSON.stringify(statement)});}finally{await sql.end();}`);
  run(bun, [script], { env: { ...process.env, UPSTREAM_DB_URL: database } });
}

try {
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', certificate, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  for (let index = 0; index < 2; index++) {
    sql(`CREATE DATABASE ${names[index]}`);
    const db = new URL(database); db.pathname = `/${names[index]}`;
    const port = 34561 + index;
    const environment = {
      ...process.env, UPSTREAM_ROOT: root, DATABASE_URL: db.href,
      API_URL: `https://localhost:${port}`, APP_URL: 'https://localhost:3400', API_PORT: String(port),
      BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      SKIP_PRE_MIGRATION_BACKUP: '1', TEST_CERT: certificate, TEST_KEY: key,
    };
    run(bun, ['packages/db/src/migrate.ts'], { cwd: root, env: environment });
    const log = openSync(join(temporary, `server-${index}.log`), 'w', 0o600);
    const server = spawn(bun, [resolve('integration/server.mjs')], { cwd: root, env: environment, stdio: ['ignore', log, log] });
    closeSync(log); servers.push(server);
  }
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-isolation=none', 'integration/upstream.test.ts'], {
    stdio: 'inherit', env: { ...process.env, NODE_EXTRA_CA_CERTS: certificate },
  });
  process.exitCode = result.status ?? 1;
} finally {
  for (const server of servers) server.kill('SIGTERM');
  await Promise.all(servers.map((server) => new Promise((done) => { if (server.exitCode !== null) done(); else server.once('exit', done); })));
  for (const name of names) { try { sql(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); } catch { process.exitCode = 1; } }
  rmSync(temporary, { recursive: true, force: true });
}
