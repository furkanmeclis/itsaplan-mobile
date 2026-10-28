import { pathToFileURL } from 'node:url';
import { database, migrate } from './database';
import { encryptionKey } from './security';
import { GatewayClient } from './gateway-client';
import { mobileHandler } from './server';
import { mobileTick } from './server-worker';

export async function upstreamRuntime(root: string) {
  const load = (path: string) => import(pathToFileURL(`${root}/${path}`).href);
  const [{ app }, { requestUser }, { getProjectAccess }, { hasPermission }] = await Promise.all([
    load('apps/api/src/app.ts'), load('apps/api/src/shared/auth-context.ts'), load('apps/api/src/shared/access.ts'), load('packages/db/src/permissions.ts'),
  ]);
  const url = process.env.DATABASE_URL;
  if (!url || !process.env.MOBILE_ENCRYPTION_KEY) throw new Error('Mobile database and encryption configuration required.');
  const sql = database(url);
  await migrate(sql, 'server');
  const gateway = process.env.MOBILE_GATEWAY_URL && process.env.MOBILE_GATEWAY_KEY ? new GatewayClient(process.env.MOBILE_GATEWAY_URL, process.env.MOBILE_GATEWAY_KEY) : undefined;
  const canRead = async (userId: string, projectId: number) => {
    const [user] = await sql`SELECT active FROM "user" WHERE id=${userId}`;
    if (!user || user.active === false) return false;
    const access = await getProjectAccess(projectId, userId);
    return Boolean(access && hasPermission(access.permissions, 'work_items', 'read'));
  };
  const trustedOrigins = [...(process.env.APP_URL ?? '').split(',').map((url: string) => url.trim()).filter(Boolean), new URL(process.env.API_URL ?? '').origin];
  const handler = mobileHandler({ sql, key: encryptionKey(process.env.MOBILE_ENCRYPTION_KEY), gateway, canRead, trustedOrigins,
    authenticate: async (request) => { const user = await requestUser(request); return user && user.active !== false ? { id: user.id } : null; },
  });
  return { app, sql, canRead, handler, tick: async () => { if (gateway) await mobileTick(sql, gateway, canRead); } };
}
