import postgres, { type Sql } from 'postgres';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export type Database = Sql;
export function database(url: string): Database { return postgres(url, { max: 5, prepare: false, onnotice: () => {} }); }
export async function migrate(sql: Database, scope: 'server' | 'gateway'): Promise<void> {
  const source = await readFile(new URL(`../migrations/${scope}.sql`, import.meta.url), 'utf8');
  const digest = createHash('sha256').update(source).digest('hex');
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`mobile-migrate-${scope}`}))`;
    await tx`CREATE TABLE IF NOT EXISTS mobile_migration(scope text PRIMARY KEY, digest text NOT NULL)`;
    const [entry] = await tx`SELECT digest FROM mobile_migration WHERE scope=${scope}`;
    if (entry) { if (entry.digest !== digest) throw new Error('Applied mobile migration checksum differs.'); return; }
    await tx.unsafe(source);
    await tx`INSERT INTO mobile_migration(scope,digest) VALUES(${scope},${digest})`;
  });
}
