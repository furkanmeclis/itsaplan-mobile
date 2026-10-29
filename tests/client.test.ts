import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { PlannerClient, ApiError, sessionCookie, type ConnectedAccount, type Fetcher } from '../src/api/client';
import { ConnectedAccounts } from '../src/domain/connectedAccounts';
import { SessionVault } from '../src/domain/sessionVault';

const first: ConnectedAccount = { server: 'https://first.example/planner', webOrigin: 'https://web.first.example', userId: 'same-user-id', label: 'First' };
const second = { ...first, server: 'https://second.example' };
const credential = { cookie: '__Host-better-auth.session_token=test-session' };
const user = { id: first.userId, name: 'First', email: 'first@example.test' };
const project = { id: 1, ref: 'team.MOB', name: 'Mobile' };
const json = (value: unknown, headers?: Record<string, string>) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json', ...headers } });
const failure = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;

function loginFetcher(): { fetcher: Fetcher; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  return { calls, fetcher: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth-config')) return json({ emailPassword: true });
    if (url.endsWith('/')) return json({ name: "It's a Plan api", status: 'ok' });
    if (url.includes('/api/auth/sign-in/')) return json({ user }, { 'Set-Cookie': `${credential.cookie}; Path=/; Secure; HttpOnly` });
    if (url.endsWith('/me')) return json({ authenticated: true, user });
    if (url.endsWith('/api/auth/sign-out')) return json({ success: true });
    return json([]);
  } };
}

test('login verifies the server and current user before returning an isolated session', async () => {
  const { fetcher, calls } = loginFetcher();
  const result = await new PlannerClient(fetcher).signIn(first.server, first.webOrigin, 'first@example.test', 'test-password');
  assert.equal(result.account.server, first.server);
  assert.equal(result.account.userId, first.userId);
  assert.deepEqual(result.credential, credential);
  assert.equal(calls[2].url, `${first.server}/api/auth/sign-in/email`);
  assert.equal(calls[3].url, `${first.server}/me`);
  for (const { init } of calls) {
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('cache-control'), 'no-store, no-cache');
  }
  assert.equal(new Headers(calls[2].init.headers).has('cookie'), false);
  assert.equal(new Headers(calls[2].init.headers).get('origin'), first.webOrigin);
  assert.equal(new Headers(calls[3].init.headers).get('cookie'), credential.cookie);
});

test('username login selects the upstream username endpoint', async () => {
  const { fetcher, calls } = loginFetcher();
  await new PlannerClient(fetcher).signIn(first.server, first.webOrigin, 'first-user', 'test-password');
  assert.equal(calls[2].url.endsWith('/sign-in/username'), true);
  assert.deepEqual(JSON.parse(calls[2].init.body as string), { username: 'first-user', password: 'test-password' });
});

test('server discovery rejects unrelated services and disabled password login', async () => {
  await assert.rejects(new PlannerClient(async () => json({ status: 'ok' })).discover(first.server), failure('unsupported'));
  const client = new PlannerClient(async (url) => url.endsWith('/auth-config') ? json({ emailPassword: false }) : json({ name: "It's a Plan api", status: 'ok' }));
  await assert.rejects(client.signIn(first.server, first.webOrigin, 'name', 'test-password'), failure('unsupported'));
});

test('sessions are sent only to the explicitly selected server and user is verified', async () => {
  const calls: { url: string; cookie: string | null }[] = [];
  const client = new PlannerClient(async (url, init) => {
    calls.push({ url, cookie: new Headers(init.headers).get('cookie') });
    return url.endsWith('/me') ? json({ authenticated: true, user: { ...user, id: 'another-user' } }) : json([]);
  });
  await client.projects(first, credential);
  await client.projects(second, { cookie: '__Host-better-auth.session_token=second-session' });
  assert.deepEqual(calls, [{ url: `${first.server}/projects`, cookie: credential.cookie }, { url: `${second.server}/projects`, cookie: '__Host-better-auth.session_token=second-session' }]);
  await assert.rejects(client.me(first, credential), failure('expired'));
});

test('untrusted redirects and server bodies cannot become credential-bearing navigation or errors', async () => {
  await assert.rejects(new PlannerClient(async () => new Response(null, { status: 302, headers: { Location: 'https://untrusted.example' } })).projects(first, credential), failure('redirect'));
  const client = new PlannerClient(async () => new Response('private-server-body', { status: 401 }));
  await assert.rejects(client.projects(first, credential), (error: unknown) => failure('expired')(error) && !(error as Error).message.includes('private-server-body'));
});

test('cookie extraction handles combined Expires headers and excludes cache/foreign cookies', () => {
  const headers = { get: () => `unrelated=x; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Secure, ${credential.cookie}; Secure; HttpOnly; Path=/` } as unknown as Headers;
  assert.equal(sessionCookie(headers), credential.cookie);
  for (const cookie of [
    'another.session_token=value; Secure; HttpOnly',
    `${credential.cookie}; HttpOnly`, `${credential.cookie}; Secure`, `${credential.cookie}; Secure; HttpOnly; Max-Age=0`,
    `${credential.cookie}; Secure; HttpOnly; Max-Age=-1`, `${credential.cookie}; Secure; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    `${credential.cookie}; Secure; HttpOnly, ${credential.cookie}; Secure; HttpOnly`,
  ]) assert.throws(() => sessionCookie(new Headers({ 'Set-Cookie': cookie })), failure('unsupported'));
});

test('invalid JSON, HTML, oversized data and invalid IDs fail the API contract', async () => {
  for (const response of [new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }), new Response('not json', { headers: { 'Content-Type': 'application/json' } }), json([{ id: 0, name: 'Wrong', ref: 'team.MOB' }]), json('a'.repeat(2_000_001))]) {
    await assert.rejects(new PlannerClient(async () => response).projects(first, credential), failure('invalid-response'));
  }
});

test('deadlines abort the transport even if a fetch implementation ignores cancellation', async () => {
  let signal: AbortSignal | null | undefined;
  const client = new PlannerClient(async (_url, init) => { signal = init.signal; return new Promise(() => {}); }, 20);
  await assert.rejects(client.projects(first, credential), failure('timeout'));
  assert.equal(signal?.aborted, true);
});

test('filtered issue lists use the actual upstream summary shape and the authenticated user ID', async () => {
  let requested = '';
  const client = new PlannerClient(async (url) => { requested = url; return json([{ id: 1, identifier: 'MOB-1', title: 'Task', columnId: 2 }]); });
  assert.deepEqual(await client.issues(first, credential, project), [{ id: 1, identifier: 'MOB-1', title: 'Task', columnId: 2, projectId: 1 }]);
  assert.equal(new URL(requested).searchParams.get('assigneeUserId'), first.userId);
});

function repository(beforeDisconnect: ConstructorParameters<typeof ConnectedAccounts>[3] = async () => {}) {
  let index: string | null = null;
  let indexFails = false;
  let signOutFails = false;
  const secrets = new Map<string, string>();
  const { fetcher, calls } = loginFetcher();
  const vault = new SessionVault({ get: async (key) => secrets.get(key) ?? null, set: async (key, value) => { secrets.set(key, value); }, remove: async (key) => { secrets.delete(key); } }, async (key) => createHash('sha256').update(key).digest('hex'));
  const accounts = new ConnectedAccounts({ read: async () => index, write: async (value) => { if (indexFails) throw new Error('Disk full'); index = value; } }, vault, new PlannerClient(async (url, init) => {
    if (signOutFails && url.endsWith('/sign-out')) return new Response(null, { status: 503 });
    return fetcher(url, init);
  }), beforeDisconnect);
  return { accounts, secrets, calls, readIndex: () => index, failIndex: () => { indexFails = true; }, failSignOut: () => { signOutFails = true; } };
}

test('concurrent account additions preserve both index entries and separate secrets', async () => {
  const { accounts, secrets, readIndex } = repository();
  await Promise.all([accounts.signIn(first.server, first.webOrigin, 'first@example.test', 'test-password'), accounts.signIn(second.server, first.webOrigin, 'first@example.test', 'test-password')]);
  assert.equal((await accounts.list()).length, 2); assert.equal(secrets.size, 2);
  assert.equal(readIndex()?.includes('test-session'), false);
  assert.equal(readIndex()?.includes('test-password'), false);
});

test('index persistence failure removes the new credential and revokes the unretained session', async () => {
  const { accounts, secrets, calls, failIndex } = repository();
  failIndex();
  await assert.rejects(accounts.signIn(first.server, first.webOrigin, 'first@example.test', 'test-password'));
  assert.equal(secrets.size, 0); assert.equal(calls.at(-1)?.url.endsWith('/sign-out'), true);
});

test('disconnect removes only the selected account after successful server sign-out', async () => {
  const { accounts, secrets, calls } = repository();
  const a = await accounts.signIn(first.server, first.webOrigin, 'first@example.test', 'test-password');
  const b = await accounts.signIn(second.server, first.webOrigin, 'first@example.test', 'test-password');
  await accounts.disconnect(a);
  assert.deepEqual(await accounts.list(), [b]); assert.equal(secrets.size, 1);
  assert.equal(calls.at(-1)?.url, `${first.server}/api/auth/sign-out`);
  assert.deepEqual(await accounts.credential(b), credential);
});

test('failed server logout preserves the account and secret for retry', async () => {
  const { accounts, secrets, failSignOut } = repository();
  const account = await accounts.signIn(first.server, first.webOrigin, 'first@example.test', 'test-password');
  failSignOut();
  await assert.rejects(accounts.disconnect(account));
  assert.deepEqual(await accounts.list(), [account]);
  assert.equal(secrets.size, 1);
  assert.deepEqual(await accounts.credential(account), credential);
});


test('push revocation is awaited before sign-out and failure retains the session for retry', async () => {
  let fail = true;
  const { accounts, calls } = repository(async (account) => {
    assert.deepEqual(await accounts.credential(account), credential);
    assert.equal(calls.some((call) => call.url.endsWith('/sign-out')), false);
    if (fail) throw new Error('Gateway unavailable');
  });
  const account = await accounts.signIn(first.server, first.webOrigin, 'first@example.test', 'test-password');
  await assert.rejects(accounts.disconnect(account));
  assert.deepEqual(await accounts.list(), [account]);
  fail = false; await accounts.disconnect(account);
  assert.equal(calls.at(-1)?.url.endsWith('/sign-out'), true);
  assert.deepEqual(await accounts.list(), []);
});

test('failed vault rollback still attempts server logout and preserves the original storage error', async () => {
  for (const remoteUnavailable of [false, true]) {
    const primary = new Error('Native secret storage is unavailable');
    const { fetcher, calls } = loginFetcher();
    const vault = new SessionVault({
      get: async () => null,
      set: async () => { throw primary; },
      remove: async () => { throw new Error('Native rollback is also unavailable'); },
    }, async (value) => createHash('sha256').update(value).digest('hex'));
    const client = new PlannerClient(async (url, init) => {
      const response = await fetcher(url, init);
      return remoteUnavailable && url.endsWith('/sign-out') ? new Response(null, { status: 503 }) : response;
    });
    const accounts = new ConnectedAccounts({ read: async () => null, write: async () => assert.fail('Failed login must not persist an index entry') }, vault, client);
    let caught: unknown;
    try { await accounts.signIn(first.server, first.webOrigin, 'first@example.test', 'test-password'); }
    catch (error) { caught = error; }
    assert.equal(calls.filter((call) => call.url.endsWith('/sign-out')).length, 1);
    assert.equal(caught, primary);
    assert.deepEqual(await accounts.list(), []);
  }
});
