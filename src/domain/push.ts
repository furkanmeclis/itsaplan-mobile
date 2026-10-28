import { accountKey, resolvePushRoute } from './accounts';
import { type ConnectedAccount, type Credential, type PlannerClient, type PushPreferences, type PushRegistration } from '../api/client';

export class PushSetupError extends Error {
  constructor(readonly code: 'unavailable' | 'permission' | 'native-build' | 'token' | 'route-collision') { super(code); }
}
export interface PushStore {
  read(account: ConnectedAccount): Promise<PushRegistration | null>;
  write(account: ConnectedAccount, registration: PushRegistration): Promise<void>;
  remove(account: ConnectedAccount): Promise<void>;
  installationId(): Promise<string>;
}
export interface PushToken { provider: 'apns' | 'fcm'; token: string }

export class PushManager {
  private pending = new Map<string, Promise<unknown>>();
  private registrationWrite: Promise<unknown> = Promise.resolve();
  constructor(private client: PlannerClient, private store: PushStore,
    private credential: (account: ConnectedAccount) => Promise<Credential>, private obtainToken: () => Promise<PushToken>) {}

  private exclusive<T>(account: ConnectedAccount, work: () => Promise<T>): Promise<T> {
    const key = accountKey(account); const previous = this.pending.get(key) ?? Promise.resolve();
    const result = previous.then(work, work); const settled = result.catch(() => {});
    this.pending.set(key, settled);
    void settled.finally(() => { if (this.pending.get(key) === settled) this.pending.delete(key); });
    return result;
  }
  registration(account: ConnectedAccount) { return this.store.read(account); }

  private async register(account: ConnectedAccount, accounts: readonly ConnectedAccount[], credential: Credential, token: PushToken) {
    const registration = await this.client.registerPush(account, credential, await this.store.installationId(), token.provider, token.token);
    try {
      const persist = this.registrationWrite.then(async () => {
        for (const other of accounts) {
          if (accountKey(other) !== accountKey(account) && (await this.store.read(other))?.accountId === registration.accountId) throw new PushSetupError('route-collision');
        }
        await this.store.write(account, registration);
      });
      this.registrationWrite = persist.catch(() => {}); await persist;
    } catch (error) { await this.client.unregisterPush(account, credential, registration.deviceId).catch(() => {}); throw error; }
  }

  enable(account: ConnectedAccount, accounts: readonly ConnectedAccount[]): Promise<PushPreferences> {
    return this.exclusive(account, async () => {
      const credential = await this.credential(account);
      const capability = await this.client.pushCapabilities(account, credential);
      if (!capability?.push) throw new PushSetupError('unavailable');
      const token = await this.obtainToken();
      await this.register(account, accounts, credential, token);
      const prefs = await this.client.pushPreferences(account, credential);
      return this.client.setPushPreferences(account, credential, { ...prefs, enabled: true });
    });
  }
  refreshToken(account: ConnectedAccount, accounts: readonly ConnectedAccount[], token: PushToken): Promise<void> {
    return this.exclusive(account, async () => {
      if (!(await this.store.read(account))) return;
      await this.register(account, accounts, await this.credential(account), token);
    });
  }
  unregister(account: ConnectedAccount): Promise<void> {
    return this.exclusive(account, async () => {
      const registration = await this.store.read(account);
      if (!registration) return;
      await this.client.unregisterPush(account, await this.credential(account), registration.deviceId);
      await this.store.remove(account);
    });
  }
  async route(data: unknown, accounts: readonly ConnectedAccount[]) {
    if (!data || typeof data !== 'object' || ![1,'1'].includes((data as { v?: string | number }).v ?? '')) return null;
    const registrations = new Map<string, ConnectedAccount>();
    const ambiguous = new Set<string>();
    for (const account of accounts) {
      const registration = await this.store.read(account);
      if (!registration) continue;
      if (registrations.has(registration.accountId)) ambiguous.add(registration.accountId);
      else registrations.set(registration.accountId, account);
    }
    for (const id of ambiguous) registrations.delete(id);
    const route = resolvePushRoute(data, registrations);
    if (!route) return null;
    const account = route.account as ConnectedAccount;
    const resolved = await this.client.resolvePush(account, await this.credential(account), route.notificationId);
    const registration = await this.store.read(account);
    if (!registration || registration.accountId !== resolved.accountId || registrations.get(registration.accountId) !== account) return null;
    return { account, issueId: resolved.issueId, notificationId: resolved.notificationId };
  }
}
