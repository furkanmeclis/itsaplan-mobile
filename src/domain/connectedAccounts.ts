import { accountKey } from './accounts';
import { normalizeWebOrigin, storedCredential, type ConnectedAccount, type Credential, type PlannerClient } from '../api/client';
import type { SessionVault } from './sessionVault';

export interface AccountIndex {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

export class ConnectedAccounts {
  private mutation: Promise<unknown> = Promise.resolve();
  constructor(private index: AccountIndex, private vault: SessionVault, private client: PlannerClient, private beforeDisconnect: (account: ConnectedAccount) => Promise<void> = async () => {}) {}

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(work, work);
    this.mutation = result.catch(() => {});
    return result;
  }

  async list(): Promise<ConnectedAccount[]> {
    const raw = await this.index.read();
    if (raw === null) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error('Invalid account index.');
    const keys = new Set<string>();
    return value.map((entry) => {
      if (!entry || typeof entry !== 'object') throw new Error('Invalid account index.');
      const account = entry as ConnectedAccount;
      if (typeof account.label !== 'string' || typeof account.webOrigin !== 'string') throw new Error('Invalid account index.');
      const key = accountKey(account);
      if (keys.has(key)) throw new Error('Duplicate account index.');
      keys.add(key);
      return { server: JSON.parse(key)[0] as string, userId: account.userId, label: account.label, webOrigin: normalizeWebOrigin(account.webOrigin) };
    });
  }

  async credential(account: ConnectedAccount): Promise<Credential> {
    return storedCredential(await this.vault.read(account));
  }

  signIn(server: string, webOrigin: string, identifier: string, password: string): Promise<ConnectedAccount> {
    return this.exclusive(async () => {
      const accounts = await this.list();
      const { account, credential } = await this.client.signIn(server, webOrigin, identifier, password);
      const key = accountKey(account);
      const previous = accounts.find((item) => accountKey(item) === key);
      const previousCredential = previous ? await this.vault.read(previous) : null;
      try {
        await this.vault.save(account, JSON.stringify(credential));
        await this.index.write(JSON.stringify([...accounts.filter((item) => accountKey(item) !== key), account]));
      } catch (error) {
        try {
          if (previousCredential) await this.vault.save(account, previousCredential);
          else await this.vault.disconnect(account, async () => {});
        } catch {
          // Local storage can remain unavailable during rollback. Still revoke
          // the new remote session and preserve the original persistence error.
        }
        await this.client.signOut(account, credential).catch(() => {});
        throw error;
      }
      return account;
    });
  }

  disconnect(account: ConnectedAccount): Promise<void> {
    return this.exclusive(async () => {
      const accounts = await this.list();
      const credential = await this.credential(account);
      await this.beforeDisconnect(account);
      await this.client.signOut(account, credential);
      await this.index.write(JSON.stringify(accounts.filter((item) => accountKey(item) !== accountKey(account))));
      await this.vault.disconnect(account, async () => {});
    });
  }
}
