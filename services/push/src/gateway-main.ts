import { database, migrate } from './database';
import { encryptionKey } from './security';
import { gatewayHandler } from './gateway';
import { serve } from './http';

if (!process.env.GATEWAY_DATABASE_URL || !process.env.GATEWAY_ENCRYPTION_KEY) throw new Error('Gateway database and encryption configuration required.');
const sql = database(process.env.GATEWAY_DATABASE_URL);
await migrate(sql, 'gateway');
const server = serve(gatewayHandler(sql, encryptionKey(process.env.GATEWAY_ENCRYPTION_KEY)), Number(process.env.PORT ?? 8080));
process.on('SIGTERM', () => server.close(async () => { await sql.end(); process.exit(0); }));
