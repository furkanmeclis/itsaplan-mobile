import { type Database } from './database';
import { apiError, bodyJson, HttpError, json, preferences, providerToken, record, uuid, events } from './protocol';
import { encrypt, hashKey } from './security';

export function gatewayHandler(sql: Database, key: Buffer) {
  return async (request: Request): Promise<Response> => {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/health' && request.method === 'GET') return json({ status: 'ok' });
      const authorization = request.headers.get('authorization') ?? '';
      if (!authorization.startsWith('Bearer ') || authorization.length > 1024) throw new HttpError(401, 'unauthorized');
      const [tenant] = await sql`SELECT id FROM push_tenant WHERE key_hash=${hashKey(authorization.slice(7))} AND active`;
      if (!tenant) throw new HttpError(401, 'unauthorized');
      if (request.method !== 'POST') throw new HttpError(404, 'not_found');
      const [rate] = await sql`INSERT INTO push_rate(tenant_id,bucket,count) VALUES(${tenant.id},date_trunc('minute',now()),1)
        ON CONFLICT(tenant_id,bucket) DO UPDATE SET count=push_rate.count+1 RETURNING count`;
      if (rate.count > 300) throw new HttpError(429, 'rate_limited');
      const input = await bodyJson(request);
      if (path === '/v1/devices') {
        const body = record(input, ['id','provider','token','enabled','events']);
        const id = uuid(body.id); const device = providerToken(body.provider, body.token);
        const prefs = preferences({ enabled: body.enabled, events: body.events });
        const [count] = await sql`SELECT count(*)::int AS count FROM push_device WHERE tenant_id=${tenant.id}`;
        const [existing] = await sql`SELECT id FROM push_device WHERE tenant_id=${tenant.id} AND id=${id}`;
        if (!existing && count.count >= 10000) throw new HttpError(429, 'device_limit');
        const token = encrypt(device.token, key, `${tenant.id}:${id}`);
        const [registered] = await sql`INSERT INTO push_device(tenant_id,id,provider,token_encrypted,enabled,events) VALUES(${tenant.id},${id},${device.provider},${token},${prefs.enabled},${sql.array(prefs.events)})
          ON CONFLICT(tenant_id,id) DO UPDATE SET provider=excluded.provider,token_encrypted=excluded.token_encrypted,enabled=excluded.enabled,events=excluded.events,retired=false,updated_at=now() RETURNING route_id`;
        return json({ accountId: registered.route_id });
      }
      const match = path.match(/^\/v1\/devices\/([^/]+)\/(preferences|revoke)$/);
      if (match) {
        const id = uuid(match[1]);
        const prefs = match[2] === 'preferences' ? preferences(input) : { enabled: false, events: [] };
        if (match[2] === 'revoke') record(input, []);
        await sql.begin(async (tx) => {
          const [device] = await tx`SELECT id,retired FROM push_device WHERE tenant_id=${tenant.id} AND id=${id} FOR UPDATE`;
          if (!device) { if (match[2] === 'revoke') return; throw new HttpError(410, 'device_retired'); }
          if (device.retired && match[2] === 'preferences') throw new HttpError(410, 'device_retired');
          await tx`UPDATE push_device SET enabled=${prefs.enabled},events=${tx.array(prefs.events)},retired=CASE WHEN ${match[2] === 'revoke'} THEN true ELSE retired END,updated_at=now() WHERE tenant_id=${tenant.id} AND id=${id}`;
          if (match[2] === 'revoke') await tx`UPDATE push_device SET token_encrypted='' WHERE tenant_id=${tenant.id} AND id=${id}`;
          await tx`UPDATE push_delivery SET status='cancelled',lease_token=NULL WHERE tenant_id=${tenant.id} AND device_id=${id} AND status='pending' AND (NOT ${prefs.enabled} OR NOT(event=ANY(${tx.array(prefs.events)}::text[])))`;
        });
        return json({ ok: true });
      }
      if (path === '/v1/deliveries') {
        const body = record(input, ['id','deviceId','notificationId','event']);
        const id = uuid(body.id); const deviceId = uuid(body.deviceId); const notificationId = uuid(body.notificationId);
        if (!events.includes(body.event as never)) throw new HttpError(400, 'invalid_event');
        await sql.begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenant.id}:${id}`},0))`;
          const [device] = await tx`SELECT * FROM push_device WHERE tenant_id=${tenant.id} AND id=${deviceId} FOR UPDATE`;
          if (!device || device.retired) throw new HttpError(410, 'device_retired');
          if (!device.enabled || !device.events.includes(body.event)) throw new HttpError(409, 'preferences_disabled');
          const [existing] = await tx`SELECT device_id,notification_id,event FROM push_delivery WHERE tenant_id=${tenant.id} AND id=${id}`;
          if (existing && (existing.device_id !== deviceId || existing.notification_id !== notificationId || existing.event !== body.event)) throw new HttpError(409, 'idempotency_conflict');
          await tx`INSERT INTO push_delivery(tenant_id,id,device_id,notification_id,event) VALUES(${tenant.id},${id},${deviceId},${notificationId},${body.event as string}) ON CONFLICT DO NOTHING`;
        });
        return json({ accepted: true }, 202);
      }
      throw new HttpError(404, 'not_found');
    } catch (error) { return apiError(error); }
  };
}
