import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { database, migrate } from './database';
import { hashKey } from './security';

const output = process.argv[2];
if (!output || !process.env.GATEWAY_DATABASE_URL) throw new Error('Provide a new credential output file and GATEWAY_DATABASE_URL.');
const sql = database(process.env.GATEWAY_DATABASE_URL);
try {
  await migrate(sql, 'gateway');
  const id = randomUUID(); const key = randomBytes(32).toString('base64url');
  await writeFile(output, JSON.stringify({ tenantId: id, key }), { flag: 'wx', mode: 0o600 });
  try { await sql`INSERT INTO push_tenant(id,key_hash) VALUES(${id},${hashKey(key)})`; }
  catch { await unlink(output); throw new Error('Tenant provisioning failed.'); }
  console.log(`Tenant ${id} created; credential saved to the requested file.`);
} finally { await sql.end(); }
