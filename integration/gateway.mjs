import { readFileSync } from 'node:fs';
import { database, migrate } from '../services/push/src/database.ts';
import { encryptionKey, hashKey } from '../services/push/src/security.ts';
import { gatewayHandler } from '../services/push/src/gateway.ts';
import { gatewayTick } from '../services/push/src/gateway-worker.ts';

const sql = database(process.env.GATEWAY_DATABASE_URL);
await migrate(sql, 'gateway');
await sql`CREATE TABLE push_test_control(mode text NOT NULL)`;
await sql`INSERT INTO push_test_control(mode) VALUES('sent')`;
await sql`CREATE TABLE push_test_sent(id uuid PRIMARY KEY,provider text,data jsonb,token_hash text)`;
for (const suffix of ['A', 'B']) await sql`INSERT INTO push_tenant(id,key_hash) VALUES(${process.env[`TEST_TENANT_${suffix}`]},${hashKey(process.env[`TEST_TENANT_KEY_${suffix}`])})`;
const key = encryptionKey(process.env.GATEWAY_ENCRYPTION_KEY);
const handler = gatewayHandler(sql, key);
const send = async (provider, token, data, id) => {
  const [control] = await sql`SELECT mode FROM push_test_control`;
  if (control.mode !== 'sent') return { status: control.mode, code: 'test_provider_result' };
  await sql`INSERT INTO push_test_sent(id,provider,data,token_hash) VALUES(${id},${provider},${sql.json(data)},${hashKey(token)}) ON CONFLICT DO NOTHING`;
  return { status: 'sent' };
};
const server = Bun.serve({ hostname: '127.0.0.1', port: 34563,
  tls: { cert: readFileSync(process.env.TEST_CERT), key: readFileSync(process.env.TEST_KEY) },
  fetch: async (request) => {
    if (new URL(request.url).pathname === '/__test/tick' && request.method === 'POST' && request.headers.get('authorization') === `Bearer ${process.env.TEST_CONTROL_KEY}`) {
      await gatewayTick(sql, key, send); return Response.json({ ok: true });
    }
    return handler(request);
  },
});
process.on('SIGTERM', () => { server.stop(true); process.exit(0); });
