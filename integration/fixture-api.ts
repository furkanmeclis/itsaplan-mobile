import assert from 'node:assert/strict';
import { sessionCookie, type Credential, type Project } from '../src/api/client';

export const servers = ['https://localhost:34561', 'https://localhost:34562'];
export const webOrigin = 'https://localhost:3400';
export const password = 'Disposable-test-password-123';

export async function waitForServers(): Promise<void> {
  for (const server of servers) {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { ready = (await fetch(`${server}/`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
      if (ready) break;
      await new Promise((done) => setTimeout(done, 500));
    }
    assert.equal(ready, true, 'Disposable upstream server did not become ready');
  }
}

export async function request(server: string, path: string, credential?: Credential, body?: unknown): Promise<any> {
  const response = await fetch(`${server}${path}`, { method: body ? 'POST' : 'GET', credentials: 'omit', redirect: 'error',
    headers: { 'Content-Type': 'application/json', Origin: webOrigin, ...(credential ? { Cookie: credential.cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  assert.equal(response.ok, true, `Upstream request returned ${response.status}`);
  return response.json();
}

export async function seed(server: string, name: string, email: string): Promise<{ project: Project; issueId: number }> {
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
