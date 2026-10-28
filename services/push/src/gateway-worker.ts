import type { Database } from './database';
import { decrypt } from './security';
import { payload, retryDelay, type Provider, type PushPayload } from './protocol';

export interface SendResult { status: 'sent' | 'retry' | 'retired' | 'failed'; code?: string; retryAfterMs?: number }
export type Sender = (provider: Provider, token: string, payload: PushPayload, id: string) => Promise<SendResult>;

export async function gatewayTick(sql: Database, key: Buffer, send: Sender): Promise<void> {
  const claimed = await sql`UPDATE push_delivery d SET attempts=d.attempts+1,next_attempt_at=now()+interval '120 seconds',lease_token=gen_random_uuid()
    WHERE (d.tenant_id,d.id) IN (SELECT tenant_id,id FROM push_delivery WHERE status='pending' AND next_attempt_at<=now() ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 10)
    RETURNING *`;
  await Promise.all(claimed.map(async (delivery) => {
    await sql.begin(async (tx) => {
      const [device] = await tx`SELECT d.* FROM push_device d JOIN push_tenant t ON t.id=d.tenant_id WHERE d.tenant_id=${delivery.tenant_id} AND d.id=${delivery.device_id} AND t.active FOR UPDATE OF d`;
      const [current] = await tx`SELECT id FROM push_delivery WHERE tenant_id=${delivery.tenant_id} AND id=${delivery.id} AND lease_token=${delivery.lease_token} AND status='pending'`;
      if (!current) return;
      if (!device || !device.enabled || device.retired || !device.events.includes(delivery.event)) {
        await tx`UPDATE push_delivery SET status='cancelled',lease_token=NULL WHERE tenant_id=${delivery.tenant_id} AND id=${delivery.id} AND lease_token=${delivery.lease_token}`; return;
      }
      let result: SendResult;
      try { result = await send(device.provider, decrypt(device.token_encrypted, key, `${device.tenant_id}:${device.id}`), payload(device.route_id, delivery.notification_id), delivery.id); }
      catch { result = { status: 'retry', code: 'provider_unavailable' }; }
      const retry = result.status === 'retry' && delivery.attempts < 8;
      const status = retry ? 'pending' : result.status === 'retry' ? 'failed' : result.status;
      const delay = Math.max(retryDelay(delivery.attempts), Math.min(result.retryAfterMs ?? 0, 86400000));
      // Provider bodies and token values never enter error records.
      const code = result.code && /^[a-z0-9_]{1,64}$/.test(result.code) ? result.code : null;
      await tx`UPDATE push_delivery SET status=${status},next_attempt_at=now()+${delay}*interval '1 millisecond',last_error=${code},lease_token=NULL WHERE tenant_id=${delivery.tenant_id} AND id=${delivery.id} AND lease_token=${delivery.lease_token}`;
      if (result.status === 'retired') {
        await tx`UPDATE push_device SET retired=true,enabled=false,token_encrypted='' WHERE tenant_id=${delivery.tenant_id} AND id=${delivery.device_id}`;
        await tx`UPDATE push_delivery SET status='retired',lease_token=NULL WHERE tenant_id=${delivery.tenant_id} AND device_id=${delivery.device_id} AND status='pending'`;
      }
    });
  }));
}
