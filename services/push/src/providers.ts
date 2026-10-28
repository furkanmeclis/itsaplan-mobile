import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { connect } from 'node:http2';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import type { SendResult, Sender } from './gateway-worker';
import type { PushPayload } from './protocol';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function jwt(header: object, claims: object, key: KeyObject, algorithm: 'RSA-SHA256' | 'SHA256'): string {
  const input = `${encode(header)}.${encode(claims)}`;
  return `${input}.${sign(algorithm, Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
export function retryAfter(value: string | null): number {
  if (!value) return 0;
  const result = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(result) ? Math.max(0, Math.min(result, 86400000)) : 0;
}
export interface FcmCredentials { client_email: string; private_key: string; project_id: string }

export function fcmSender(credentials: FcmCredentials, fetcher: typeof fetch = fetch): Sender {
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(credentials.project_id) || !/^[^\s@]+@[^\s@]+$/.test(credentials.client_email)) throw new Error('Invalid FCM service account metadata.');
  const key = createPrivateKey(credentials.private_key);
  if (key.asymmetricKeyType !== 'rsa') throw new Error('FCM requires an RSA service account key.');
  let cached: { token: string; until: number } | null = null;
  let obtaining: Promise<string> | null = null;
  async function authorization(): Promise<string> {
    if (cached && cached.until > Date.now()) return cached.token;
    if (obtaining) return obtaining;
    obtaining = (async () => {
      const now = Math.floor(Date.now() / 1000);
      const assertion = jwt({ alg: 'RS256', typ: 'JWT' }, { iss: credentials.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }, key, 'RSA-SHA256');
      const response = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', credentials: 'omit', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }), signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('FCM authorization failed.');
      const value = await response.json() as { access_token?: string; expires_in?: number };
      if (typeof value.access_token !== 'string' || !value.access_token || value.access_token.length > 8192 || typeof value.expires_in !== 'number') throw new Error('FCM authorization failed.');
      cached = { token: value.access_token, until: Date.now() + Math.min(3300, Math.max(0, value.expires_in - 60)) * 1000 };
      return value.access_token;
    })();
    try { return await obtaining; } finally { obtaining = null; }
  }
  return async (_provider, token, data, id) => {
    try {
      const accessToken = await authorization();
      const response = await fetcher(`https://fcm.googleapis.com/v1/projects/${credentials.project_id}/messages:send`, {
        method: 'POST', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token, notification: { title: 'It’s a Plan', body: 'Yeni bir bildirimin var.' }, data: { v: String(data.v), accountId: data.accountId, notificationId: data.notificationId }, android: { ttl: '3600s' } } }),
      });
      if (response.ok) { await response.body?.cancel(); return { status: 'sent' }; }
      if (response.status === 401) cached = null;
      if (response.status === 429 || response.status >= 500 || response.status === 401) return { status: 'retry', code: `fcm_${response.status}`, retryAfterMs: retryAfter(response.headers.get('retry-after')) };
      const error = await response.json().catch(() => null) as { error?: { details?: { errorCode?: string }[] } } | null;
      if (error?.error?.details?.some((detail) => ['UNREGISTERED','SENDER_ID_MISMATCH'].includes(detail.errorCode ?? ''))) return { status: 'retired', code: 'fcm_token_invalid' };
      return { status: 'failed', code: `fcm_${response.status}` };
    } catch { return { status: 'retry', code: 'fcm_unavailable' }; }
  };
}

async function apnsSocket(host: string): Promise<TLSSocket> {
  const proxyValue = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxyValue) return new Promise((resolve, reject) => {
    const socket = tlsConnect({ host, port: 443, servername: host, ALPNProtocols: ['h2'] });
    socket.setTimeout(8000, () => socket.destroy(new Error('APNs connection timed out.')));
    socket.once('secureConnect', () => resolve(socket)); socket.once('error', reject);
  });
  const proxy = new URL(proxyValue);
  if (!['http:', 'https:'].includes(proxy.protocol)) throw new Error('Unsupported HTTPS proxy.');
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Host: `${host}:443` };
    if (proxy.username || proxy.password) headers['Proxy-Authorization'] = `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`;
    const connectRequest = (proxy.protocol === 'https:' ? httpsRequest : httpRequest)({ hostname: proxy.hostname, port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80), method: 'CONNECT', path: `${host}:443`, headers });
    connectRequest.setTimeout(8000, () => connectRequest.destroy(new Error('Proxy connection timed out.')));
    connectRequest.once('error', reject);
    connectRequest.once('connect', (response, socket, head) => {
      if (response.statusCode !== 200) { socket.destroy(); reject(new Error('Proxy CONNECT failed.')); return; }
      if (head.length) socket.unshift(head);
      const secure = tlsConnect({ socket, servername: host, ALPNProtocols: ['h2'] });
      secure.setTimeout(8000, () => secure.destroy(new Error('APNs connection timed out.')));
      secure.once('secureConnect', () => resolve(secure)); secure.once('error', reject);
    });
    connectRequest.end();
  });
}
export interface ApnsCredentials { key: KeyObject; keyId: string; teamId: string; topic: string; sandbox: boolean }
export type ApnsTransport = (host: string, token: string, headers: Record<string, string>, body: string) => Promise<{ status: number; reason?: string; retryAfter?: string }>;

export const apnsTransport: ApnsTransport = async (host, token, headers, body) => {
  const socket = await apnsSocket(host);
  return new Promise((resolve, reject) => {
    const session = connect(`https://${host}`, { createConnection: () => socket });
    const timer = setTimeout(() => { session.destroy(); reject(new Error('APNs timed out.')); }, 8000);
    session.once('error', (error) => { clearTimeout(timer); session.destroy(); reject(error); });
    const request = session.request({ ':method': 'POST', ':path': `/3/device/${token}`, ...headers });
    let status = 0; let retryAfterValue: string | undefined; let result = '';
    request.on('response', (response) => { status = Number(response[':status']); retryAfterValue = response['retry-after'] as string | undefined; });
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => { if (result.length < 8192) result += chunk; });
    request.once('error', (error) => { clearTimeout(timer); session.destroy(); reject(error); });
    request.once('end', () => { clearTimeout(timer); session.close(); let reason: string | undefined;
      try { reason = (JSON.parse(result) as { reason?: string }).reason; } catch {}
      resolve({ status, reason, retryAfter: retryAfterValue }); });
    request.end(body);
  });
};

export function apnsSender(credentials: ApnsCredentials, transport: ApnsTransport = apnsTransport): Sender {
  if (!/^[A-Z0-9]{10}$/.test(credentials.keyId) || !/^[A-Z0-9]{10}$/.test(credentials.teamId) || !/^[A-Za-z0-9.-]{3,200}$/.test(credentials.topic)) throw new Error('Invalid APNs configuration.');
  if (credentials.key.asymmetricKeyType !== 'ec' || credentials.key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('APNs requires a P-256 signing key.');
  let cachedAuthorization: { token: string; until: number } | null = null;
  return async (_provider, token, data, id) => {
    try {
      if (!cachedAuthorization || cachedAuthorization.until <= Date.now()) cachedAuthorization = { token: jwt({ alg: 'ES256', kid: credentials.keyId }, { iss: credentials.teamId, iat: Math.floor(Date.now() / 1000) }, credentials.key, 'SHA256'), until: Date.now() + 50 * 60000 };
      const authorization = cachedAuthorization.token;
      const response = await transport(credentials.sandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com', token,
        { authorization: `bearer ${authorization}`, 'apns-topic': credentials.topic, 'apns-push-type': 'alert', 'apns-id': id, 'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600) },
        JSON.stringify({ aps: { alert: { title: 'It’s a Plan', body: 'Yeni bir bildirimin var.' }, sound: 'default' }, ...data }));
      if (response.reason === 'ExpiredProviderToken') cachedAuthorization = null;
      if (response.status === 200) return { status: 'sent' };
      if (response.status === 410 || (response.status === 400 && ['BadDeviceToken','DeviceTokenNotForTopic'].includes(response.reason ?? ''))) return { status: 'retired', code: 'apns_token_invalid' };
      if (response.status === 429 || response.status >= 500 || response.reason === 'ExpiredProviderToken') return { status: 'retry', code: `apns_${response.status}`, retryAfterMs: retryAfter(response.retryAfter ?? null) };
      return { status: 'failed', code: `apns_${response.status}` };
    } catch { return { status: 'retry', code: 'apns_unavailable' }; }
  };
}

export async function configuredSender(): Promise<Sender> {
  let apns: Sender | undefined; let fcm: Sender | undefined;
  try {
  if (process.env.APNS_KEY_FILE) {
    apns = apnsSender({ key: createPrivateKey(await readFile(process.env.APNS_KEY_FILE)), keyId: process.env.APNS_KEY_ID ?? '', teamId: process.env.APNS_TEAM_ID ?? '', topic: process.env.APNS_TOPIC ?? '', sandbox: process.env.APNS_ENVIRONMENT === 'development' });
  }
  if (process.env.FCM_SERVICE_ACCOUNT_FILE) fcm = fcmSender(JSON.parse(await readFile(process.env.FCM_SERVICE_ACCOUNT_FILE, 'utf8')) as FcmCredentials);
  } catch { throw new Error('Invalid push provider configuration; check mounted credential files and metadata.'); }
  if (!apns && !fcm) throw new Error('At least one push provider must be configured.');
  return (provider, token, data, id) => {
    const send = provider === 'apns' ? apns : fcm;
    return send ? send(provider, token, data, id) : Promise.resolve({ status: 'retry', code: 'provider_not_configured' });
  };
}
