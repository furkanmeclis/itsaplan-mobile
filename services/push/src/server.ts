import { randomUUID } from 'node:crypto';
import type { Database } from './database';
import { GatewayClient } from './gateway-client';
import { apiError, bodyJson, events, HttpError, json, preferences, providerToken, record, uuid, type Preferences } from './protocol';
import { encrypt } from './security';

export interface ServerDependencies {
  sql: Database;
  key: Buffer;
  gateway?: GatewayClient;
  authenticate(request: Request): Promise<{ id: string } | null>;
  canRead(userId: string, projectId: number): Promise<boolean>;
  trustedOrigins: string[];
}

export function mobileHandler(deps: ServerDependencies) {
  const { sql, key, gateway } = deps;
  return async (request: Request): Promise<Response> => {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/mobile/capabilities' && request.method === 'GET') return json({ protocol: 1, push: Boolean(gateway), events });
      const user = await deps.authenticate(request);
      if (!user) throw new HttpError(401, 'unauthorized');
      if (!['GET','HEAD'].includes(request.method)) {
        const origin = request.headers.get('origin'); const site = request.headers.get('sec-fetch-site');
        if ((origin !== null && !deps.trustedOrigins.includes(origin)) || (origin === null && site !== null && !['same-origin','none'].includes(site))) throw new HttpError(403, 'invalid_origin');
      }
      if (path === '/mobile/preferences' && request.method === 'GET') {
        const [row] = await sql`SELECT enabled,events FROM mobile_preferences WHERE user_id=${user.id}`;
        return json(row ?? { enabled: false, events });
      }
      if (!gateway) throw new HttpError(503, 'gateway_not_configured');
      if (path === '/mobile/preferences' && request.method === 'PUT') {
        const prefs = preferences(await bodyJson(request));
        const applied = await sql.begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(hashtext(${`mobile:${user.id}`}))`;
          await tx`INSERT INTO mobile_preferences(user_id,enabled,events) VALUES(${user.id},${prefs.enabled},${tx.array(prefs.events)}) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,events=excluded.events`;
          await tx`UPDATE mobile_delivery d SET status='cancelled',lease_token=NULL FROM mobile_device v,notification n
            WHERE d.device_id=v.id AND d.notification_id=n.id AND v.user_id=${user.id} AND d.status='pending' AND (NOT ${prefs.enabled} OR NOT(n.type=ANY(${tx.array(prefs.events)}::text[])))`;
          const devices = await tx`SELECT id FROM mobile_device WHERE user_id=${user.id} AND active`;
          const results = await Promise.allSettled(devices.map((device) => gateway.preferences(device.id, prefs)));
          return results.every((result) => result.status === 'fulfilled');
        });
        return applied ? json(prefs) : json({ error: 'gateway_sync_pending' }, 503);
      }
      if (path === '/mobile/devices' && request.method === 'POST') {
        const body = record(await bodyJson(request), ['installationId','provider','token']);
        const installationId = uuid(body.installationId); const deviceToken = providerToken(body.provider, body.token);
        return await sql.begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(hashtext(${`mobile:${user.id}`}))`;
          const [existing] = await tx`SELECT id FROM mobile_device WHERE user_id=${user.id} AND installation_id=${installationId}`;
          const [count] = await tx`SELECT count(*)::int AS count FROM mobile_device WHERE user_id=${user.id}`;
          if (!existing && count.count >= 16) throw new HttpError(429, 'device_limit');
          const id = existing?.id ?? randomUUID();
          const token = encrypt(deviceToken.token, key, id);
          await tx`INSERT INTO mobile_device(id,user_id,installation_id,provider,token_encrypted) VALUES(${id},${user.id},${installationId},${deviceToken.provider},${token})
            ON CONFLICT(user_id,installation_id) DO UPDATE SET provider=excluded.provider,token_encrypted=excluded.token_encrypted,active=false,updated_at=now()`;
          const [saved] = await tx`SELECT enabled,events FROM mobile_preferences WHERE user_id=${user.id}`;
          const prefs: Preferences = saved ? { enabled: saved.enabled, events: saved.events } : { enabled: false, events: [...events] };
          let accountId: string;
          try { accountId = (await gateway.register(id, deviceToken.provider, deviceToken.token, prefs)).accountId; }
          catch { return json({ error: 'gateway_sync_pending' }, 503); }
          await tx`UPDATE mobile_device SET active=true,gateway_account_id=${accountId} WHERE id=${id}`;
          return json({ deviceId: id, accountId }, 201);
        });
      }
      const deviceMatch = path.match(/^\/mobile\/(devices|installations)\/([^/]+)$/);
      if (deviceMatch && request.method === 'DELETE') {
        const lookupId = uuid(deviceMatch[2]);
        return await sql.begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(hashtext(${`mobile:${user.id}`}))`;
          const [device] = deviceMatch[1] === 'installations'
            ? await tx`SELECT id FROM mobile_device WHERE installation_id=${lookupId} AND user_id=${user.id} FOR UPDATE`
            : await tx`SELECT id FROM mobile_device WHERE id=${lookupId} AND user_id=${user.id} FOR UPDATE`;
          if (!device) { if (deviceMatch[1] === 'installations') return new Response(null, { status: 204 }); throw new HttpError(404, 'not_found'); }
          const id = device.id;
          await tx`UPDATE mobile_device SET active=false,token_encrypted='' WHERE id=${id}`;
          await tx`UPDATE mobile_delivery SET status='cancelled',lease_token=NULL WHERE device_id=${id} AND status='pending'`;
          try { await gateway.revoke(id); } catch { return json({ error: 'gateway_sync_pending' }, 503); }
          return new Response(null, { status: 204 });
        });
      }
      const routeMatch = path.match(/^\/mobile\/notifications\/([^/]+)$/);
      if (routeMatch && request.method === 'GET') {
        const id = uuid(routeMatch[1]);
        const [route] = await sql`SELECT n.id,n.issue_id,n.project_id,v.gateway_account_id FROM mobile_delivery d JOIN notification n ON n.id=d.notification_id JOIN mobile_device v ON v.id=d.device_id
          WHERE d.id=${id} AND n.user_id=${user.id} AND v.user_id=${user.id} AND v.active`;
        if (!route || !(await deps.canRead(user.id, route.project_id))) throw new HttpError(404, 'not_found');
        return json({ notificationId: route.id, issueId: route.issue_id, projectId: route.project_id, accountId: route.gateway_account_id });
      }
      throw new HttpError(404, 'not_found');
    } catch (error) { return apiError(error); }
  };
}
