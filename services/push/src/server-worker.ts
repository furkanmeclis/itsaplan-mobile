import type { Database } from './database';
import { GatewayClient } from './gateway-client';
import { HttpError, retryDelay, type Event } from './protocol';

export async function mobileTick(sql: Database, gateway: GatewayClient, canRead: (userId: string, projectId: number) => Promise<boolean>): Promise<void> {
  const claimed = await sql`UPDATE mobile_delivery d SET attempts=d.attempts+1,next_attempt_at=now()+interval '120 seconds',lease_token=gen_random_uuid()
    WHERE d.id IN (SELECT id FROM mobile_delivery WHERE status='pending' AND next_attempt_at<=now() ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 10) RETURNING *`;
  await Promise.all(claimed.map(async (delivery) => {
    await sql.begin(async (tx) => {
      const [device] = await tx`SELECT v.*,p.enabled,p.events,u.active AS user_active FROM mobile_device v
        JOIN mobile_preferences p ON p.user_id=v.user_id JOIN "user" u ON u.id=v.user_id WHERE v.id=${delivery.device_id} FOR UPDATE OF v`;
      const [notification] = await tx`SELECT * FROM notification WHERE id=${delivery.notification_id}`;
      const [current] = await tx`SELECT id FROM mobile_delivery WHERE id=${delivery.id} AND status='pending' AND lease_token=${delivery.lease_token}`;
      if (!current) return;
      if (!device || !device.active || !device.enabled || device.user_active === false || !notification || notification.user_id !== device.user_id || !device.events.includes(notification.type) || !(await canRead(device.user_id, notification.project_id))) {
        await tx`UPDATE mobile_delivery SET status='cancelled',lease_token=NULL WHERE id=${delivery.id} AND lease_token=${delivery.lease_token}`; return;
      }
      try {
        await gateway.deliver(delivery.id, device.id, delivery.id, notification.type as Event);
        await tx`UPDATE mobile_delivery SET status='accepted',lease_token=NULL,last_error=NULL WHERE id=${delivery.id} AND lease_token=${delivery.lease_token}`;
      } catch (error) {
        const retired = error instanceof HttpError && error.status === 410;
        const retry = !retired && error instanceof HttpError && error.status === 503 && delivery.attempts < 8;
        const status = retired ? 'retired' : retry ? 'pending' : 'failed';
        const delay = retryDelay(delivery.attempts);
        await tx`UPDATE mobile_delivery SET status=${status},next_attempt_at=now()+${delay}*interval '1 millisecond',last_error=${retired ? 'device_retired' : 'gateway_delivery_failed'},lease_token=NULL WHERE id=${delivery.id} AND lease_token=${delivery.lease_token}`;
        if (retired) await tx`UPDATE mobile_device SET active=false,token_encrypted='' WHERE id=${device.id}`;
      }
    });
  }));
}
