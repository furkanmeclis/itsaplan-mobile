import { accountKey, type Account } from './accounts';

export interface SecretStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class SessionVault {
  constructor(
    private storage: SecretStorage,
    private digest: (value: string) => Promise<string>,
  ) {}

  private async key(account: Account): Promise<string> {
    return `itsaplan.session.v1.${await this.digest(accountKey(account))}`;
  }

  async read(account: Account): Promise<string | null> {
    return this.storage.get(await this.key(account));
  }

  async save(account: Account, credential: string): Promise<void> {
    if (!credential) throw new Error('Empty credentials cannot be stored.');
    await this.storage.set(await this.key(account), credential);
  }

  async disconnect(account: Account, revokeDevice: () => Promise<void>): Promise<void> {
    // Keep the credential available for retry when server-side revocation fails.
    await revokeDevice();
    await this.storage.remove(await this.key(account));
  }
}
