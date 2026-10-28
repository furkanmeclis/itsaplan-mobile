import { database, migrate } from './database';
import { encryptionKey } from './security';
import { gatewayTick } from './gateway-worker';
import { configuredSender } from './providers';

if (!process.env.GATEWAY_DATABASE_URL || !process.env.GATEWAY_ENCRYPTION_KEY) throw new Error('Gateway database and encryption configuration required.');
const sql = database(process.env.GATEWAY_DATABASE_URL);
await migrate(sql, 'gateway');
const key = encryptionKey(process.env.GATEWAY_ENCRYPTION_KEY);
const send = await configuredSender();
let lastCleanup = 0;
let running = false; let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined;
async function tick() {
  running = true;
  try {
    if (Date.now() - lastCleanup > 3600000) { await sql`DELETE FROM push_rate WHERE bucket < now()-interval '2 days'`; lastCleanup = Date.now(); }
    await gatewayTick(sql, key, send);
  } catch { console.error('gateway_tick_failed'); }
  running = false;
  if (!stopped) timer = setTimeout(tick, 1000); else await sql.end();
}
async function stop() { stopped = true; clearTimeout(timer); if (!running) await sql.end(); }
process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
void tick();
