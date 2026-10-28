import { accountKey, type Account } from './accounts';

export type AccountResult<T> =
  | { account: Account; status: 'ready'; value: T }
  | { account: Account; status: 'unavailable' };

export async function loadAccounts<T>(
  accounts: readonly Account[],
  load: (account: Account, signal: AbortSignal) => Promise<T>,
  timeoutMs = 8000,
): Promise<AccountResult<T>[]> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid timeout.');
  return Promise.all(accounts.map(async (account): Promise<AccountResult<T>> => {
    accountKey(account);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Account request timed out.'));
        }, timeoutMs);
      });
      return { account, status: 'ready', value: await Promise.race([load(account, controller.signal), timeout]) };
    } catch {
      return { account, status: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }));
}
