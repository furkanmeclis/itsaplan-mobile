export const events = ['assigned', 'mentioned', 'commented', 'state_changed'] as const;
export type Event = typeof events[number];
export type Provider = 'apns' | 'fcm';
export interface Preferences { enabled: boolean; events: Event[] }
export class HttpError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw new HttpError(400, 'invalid_id');
  return value.toLowerCase();
}
export function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new HttpError(400, 'invalid_body');
  return value as Record<string, unknown>;
}
export function preferences(value: unknown): Preferences {
  const body = record(value, ['enabled', 'events']);
  if (typeof body.enabled !== 'boolean' || !Array.isArray(body.events) || body.events.length > 4 || body.events.some((event) => !events.includes(event as Event))) throw new HttpError(400, 'invalid_preferences');
  return { enabled: body.enabled, events: [...new Set(body.events)] as Event[] };
}
export function providerToken(provider: unknown, token: unknown): { provider: Provider; token: string } {
  if (!['apns','fcm'].includes(provider as string) || typeof token !== 'string' || token.length < 16 || token.length > 4096 || /[\s\x00-\x1f]/.test(token) || (provider === 'apns' && !/^[a-f0-9]{64}$/i.test(token))) throw new HttpError(400, 'invalid_token');
  return { provider: provider as Provider, token };
}
export async function bodyJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'invalid_body');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length;
      if (size > 16384) { await reader.cancel(); throw new HttpError(413, 'body_too_large'); } chunks.push(chunk.value); }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { throw new HttpError(400, 'invalid_json'); }
}
export function json(value: unknown, status = 200): Response { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } }); }
export function apiError(error: unknown): Response {
  return error instanceof HttpError ? json({ error: error.code }, error.status) : json({ error: 'service_unavailable' }, 503);
}
export interface PushPayload { v: 1; accountId: string; notificationId: string }
export function payload(accountId: string, notificationId: string): PushPayload { return { v: 1, accountId: uuid(accountId), notificationId: uuid(notificationId) }; }
export function retryDelay(attempt: number, random = Math.random): number {
  const limit = Math.min(30 * 60_000, 1000 * 2 ** Math.min(attempt, 12));
  return Math.floor(limit / 2 + random() * limit / 2);
}
