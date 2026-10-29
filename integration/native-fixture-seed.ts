import assert from 'node:assert/strict';
import { PlannerClient } from '../src/api/client';
import { servers, webOrigin, password, request, seed, waitForServers } from './fixture-api';

async function main(): Promise<void> {
  await waitForServers();
  const first = await seed(servers[0], 'First', 'first@example.test');
  await seed(servers[0], 'Other', 'other@example.test');
  const second = await seed(servers[1], 'Second', 'first@example.test');
  await seed(servers[1], 'Partner', 'partner@example.test');
  assert.equal(first.issueId, second.issueId, 'Disposable servers must reuse the task ID');
  const client = new PlannerClient((url, init) => fetch(url, init));
  const a = await client.signIn(servers[0], webOrigin, 'first@example.test', password);
  const c = await client.signIn(servers[0], webOrigin, 'other@example.test', password);
  const b = await client.signIn(servers[1], webOrigin, 'first@example.test', password);
  const d = await client.signIn(servers[1], webOrigin, 'partner@example.test', password);
  for (const [owner, actor, project, issueId, email] of [
    [a, c, first.project, first.issueId, 'other@example.test'],
    [b, d, second.project, second.issueId, 'partner@example.test'],
  ] as const) {
    const invite = await request(owner.account.server, `/projects/${encodeURIComponent(project.ref)}/invites`, owner.credential, { email, role: 'member' });
    await request(actor.account.server, `/invites/${encodeURIComponent(invite.token)}/accept`, actor.credential, {});
    await client.addComment(actor.account, actor.credential, issueId, 'Native notification fixture');
  }
  for (const entry of [a, b, c, d]) await client.signOut(entry.account, entry.credential);
  console.log('Disposable native account and inbox fixtures prepared.');
}

void main().catch(() => {
  console.error('Native fixture preparation failed.');
  process.exitCode = 1;
});
