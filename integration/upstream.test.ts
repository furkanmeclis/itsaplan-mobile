import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlannerClient, sessionCookie, ApiError, type ConnectedAccount, type Credential, type Project } from '../src/api/client';

const servers = ['https://localhost:34561', 'https://localhost:34562'];
const webOrigin = 'https://localhost:3400';
const password = 'Disposable-test-password-123';
const client = new PlannerClient((url, init) => fetch(url, init), 10000);

async function request(server: string, path: string, credential?: Credential, body?: unknown): Promise<any> {
  const response = await fetch(`${server}${path}`, { method: body ? 'POST' : 'GET', credentials: 'omit', redirect: 'error',
    headers: { 'Content-Type': 'application/json', Origin: webOrigin, ...(credential ? { Cookie: credential.cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  assert.equal(response.ok, true, `Upstream ${path} returned ${response.status}`);
  return response.json();
}

async function seed(server: string, name: string, email: string): Promise<{ project: Project; issueId: number }> {
  const response = await fetch(`${server}/api/auth/sign-up/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: webOrigin }, body: JSON.stringify({ email, password, name }) });
  assert.equal(response.ok, true, `Sign-up returned ${response.status}`);
  const credential = { cookie: sessionCookie(response.headers) };
  const user = (await response.json()).user;
  const workspaces = await request(server, '/workspaces', credential);
  const workspace = workspaces.find((item: { role: string }) => item.role === 'owner');
  assert.ok(workspace);
  const team = await request(server, '/teams', credential, { name: `${name} team`, slug: name.toLowerCase(), workspaceId: workspace.id });
  const project = await request(server, `/teams/${team.id}/projects`, credential, { key: 'MOB', name: `${name} project` });
  const scaffold = await request(server, `/projects/${encodeURIComponent(project.ref)}`, credential);
  const issue = await request(server, `/projects/${encodeURIComponent(project.ref)}/issues`, credential, { title: `${name} task`, columnId: scaffold.columns[0].id, assigneeUserId: user.id });
  return { project, issueId: issue.id };
}

test('real upstream HTTPS login, two-server isolation, same-host accounts, mutations and logout', async () => {
  for (const server of servers) {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { ready = (await fetch(`${server}/`)).ok; } catch {}
      if (ready) break;
      await new Promise((done) => setTimeout(done, 500));
    }
    assert.equal(ready, true, 'Upstream server did not become ready');
  }
  const first = await seed(servers[0], 'First', 'first@example.test');
  const other = await seed(servers[0], 'Other', 'other@example.test');
  const second = await seed(servers[1], 'Second', 'first@example.test');
  assert.equal(first.issueId, second.issueId, 'Independent databases deliberately reuse the task ID');
  const a = await client.signIn(servers[0], webOrigin, 'first@example.test', password);
  const b = await client.signIn(servers[1], webOrigin, 'first@example.test', password);
  const c = await client.signIn(servers[0], webOrigin, 'other@example.test', password);
  assert.notEqual(a.account.userId, c.account.userId);
  assert.equal((await client.me(a.account, a.credential)).name, 'First');
  assert.equal((await client.me(c.account, c.credential)).name, 'Other');
  assert.equal((await client.me(b.account, b.credential)).name, 'Second');
  assert.equal((await client.detail(a.account, a.credential, first.issueId)).title, 'First task');
  assert.equal((await client.detail(b.account, b.credential, second.issueId)).title, 'Second task');
  assert.equal((await client.projects(c.account, c.credential))[0].name, 'Other project');
  assert.equal((await client.issues(a.account, a.credential, first.project))[0].id, first.issueId);
  const columns = await client.columns(a.account, a.credential, first.project);
  const target = columns.find((item) => item.id !== (columns[0].id))!;
  assert.ok(target);
  const changed = await client.updateState(a.account, a.credential, first.issueId, target.id);
  assert.equal(changed.columnId, target.id);
  await client.addComment(a.account, a.credential, first.issueId, 'Mobile integration comment');
  const comments = await client.comments(a.account, a.credential, first.issueId);
  assert.equal(comments.items.some((item) => item.body?.includes('Mobile integration comment')), true);
  assert.equal((await client.comments(b.account, b.credential, second.issueId)).items.length, 0);
  assert.ok(Array.isArray((await client.inbox(a.account, a.credential)).items));
  await assert.rejects(client.me({ ...a.account, userId: c.account.userId }, a.credential), (error: unknown) => error instanceof ApiError && error.code === 'expired');
  await client.signOut(a.account, a.credential);
  await assert.rejects(client.me(a.account, a.credential), (error: unknown) => error instanceof ApiError && error.code === 'expired');
  assert.equal((await client.me(c.account, c.credential)).name, 'Other');
  assert.equal((await client.me(b.account, b.credential)).name, 'Second');
  await client.signOut(c.account, c.credential);
  await client.signOut(b.account, b.credential);
  assert.ok(other.issueId);
});
