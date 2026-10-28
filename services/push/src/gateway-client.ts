import { HttpError, uuid, type Event, type Preferences, type Provider } from './protocol';
import { httpsEndpoint } from './security';

export class GatewayClient {
  private url: string;
  constructor(url: string, private key: string, private fetcher: typeof fetch = fetch) { this.url = httpsEndpoint(url); }
  private async send(path: string, body: unknown): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.url}/v1${path}`, { method: 'POST', credentials: 'omit', redirect: 'error', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    } catch { throw new HttpError(503, 'gateway_unavailable'); }
    if (response.status === 410) throw new HttpError(410, 'device_retired');
    if (!response.ok) throw new HttpError(response.status === 429 || response.status >= 500 ? 503 : 502, `gateway_${response.status}`);
    return response;
  }
  async register(id: string, provider: Provider, token: string, prefs: Preferences): Promise<{ accountId: string }> {
    const response = await this.send('/devices', { id, provider, token, ...prefs });
    const text = await response.text();
    if (text.length > 1024) throw new HttpError(502, 'invalid_gateway_response');
    try { const value = JSON.parse(text) as { accountId?: string }; return { accountId: uuid(value.accountId) }; }
    catch { throw new HttpError(502, 'invalid_gateway_response'); }
  }
  async preferences(id: string, prefs: Preferences) { const response = await this.send(`/devices/${id}/preferences`, prefs); await response.body?.cancel(); }
  async revoke(id: string) { const response = await this.send(`/devices/${id}/revoke`, {}); await response.body?.cancel(); }
  async deliver(id: string, deviceId: string, notificationId: string, event: Event) { const response = await this.send('/deliveries', { id, deviceId, notificationId, event }); await response.body?.cancel(); }
}
