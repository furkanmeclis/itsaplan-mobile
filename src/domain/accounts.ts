export interface Account {
  server: string;
  userId: string;
  label: string;
}

export function normalizeServer(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTPS server URL without credentials, query, or fragment.');
  }
  if (/%2f|%5c/i.test(url.pathname)) throw new Error('Encoded path separators are not supported.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function accountKey(account: Pick<Account, 'server' | 'userId'>): string {
  if (!account.userId.trim()) throw new Error('An account needs a user ID.');
  return JSON.stringify([normalizeServer(account.server), account.userId]);
}

export function resourceKey(account: Account, kind: string, id: string | number): string {
  return JSON.stringify([accountKey(account), kind, String(id)]);
}

export class AccountCache<T> {
  private values = new Map<string, Map<string, T>>();

  get(account: Account, kind: string, id: string | number): T | undefined {
    return this.values.get(accountKey(account))?.get(JSON.stringify([kind, String(id)]));
  }

  set(account: Account, kind: string, id: string | number, value: T): void {
    const key = accountKey(account);
    const values = this.values.get(key) ?? new Map<string, T>();
    values.set(JSON.stringify([kind, String(id)]), value);
    this.values.set(key, values);
  }

  clear(account: Account): void {
    this.values.delete(accountKey(account));
  }
}

export interface PushRoute {
  accountId: string;
  notificationId: string;
}

export function resolvePushRoute(
  payload: unknown,
  registrations: ReadonlyMap<string, Account>,
): { account: Account; notificationId: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const route = payload as Partial<PushRoute>;
  if (typeof route.accountId !== 'string' || typeof route.notificationId !== 'string' ||
    !route.notificationId || route.notificationId.length > 256) return null;
  const account = registrations.get(route.accountId);
  return account ? { account, notificationId: route.notificationId } : null;
}
