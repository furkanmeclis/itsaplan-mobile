import { pathToFileURL } from 'node:url';
import { database, migrate } from './database';
import { GatewayClient } from './gateway-client';
import { mobileTick } from './server-worker';

export async function workerRuntime(root: string) {
  const { defaultMemberPermissions, normalizePermissions, hasPermission } = await import(pathToFileURL(`${root}/packages/db/src/permissions.ts`).href);
  if (!process.env.DATABASE_URL || !process.env.MOBILE_GATEWAY_URL || !process.env.MOBILE_GATEWAY_KEY) throw new Error('Mobile worker database and gateway configuration required.');
  const sql = database(process.env.DATABASE_URL);
  await migrate(sql, 'server');
  const gateway = new GatewayClient(process.env.MOBILE_GATEWAY_URL, process.env.MOBILE_GATEWAY_KEY);
  const canRead = async (userId: string, projectId: number): Promise<boolean> => {
    const [row] = await sql`SELECT m.role,r.permissions,u.active,
      EXISTS(SELECT 1 FROM workspace_manager w JOIN team t ON t.workspace_id=w.workspace_id JOIN project p ON p.team_id=t.id
        WHERE p.id=m.project_id AND w.user_id=m.user_id AND w.role IN ('owner','admin')) AS workspace_read
      FROM project_member m JOIN "user" u ON u.id=m.user_id LEFT JOIN team_role r ON r.id=m.role_id
      WHERE m.user_id=${userId} AND m.project_id=${projectId}`;
    if (!row || row.active === false) return false;
    return row.role === 'owner' || row.workspace_read || hasPermission(row.permissions ? normalizePermissions(row.permissions) : defaultMemberPermissions(), 'work_items', 'read');
  };
  return { sql, gateway, canRead, tick: () => mobileTick(sql, gateway, canRead) };
}
