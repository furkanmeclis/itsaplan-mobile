import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PlannerClient, type ConnectedAccount, type PushRegistration } from '../src/api/client';
import { PushManager, type PushStore } from '../src/domain/push';
import { accountKey } from '../src/domain/accounts';
const a: ConnectedAccount = { server: 'https://a.example', webOrigin: 'https://a.example', userId: 'same', label: 'A' };
const b = { ...a, server: 'https://b.example', label: 'B' };
const credential = async () => ({ cookie: '__Host-better-auth.session_token=synthetic' });
function fixture() {
  const values = new Map<string, PushRegistration>();
  const installationId = randomUUID();
  const store: PushStore = { read: async (a) => values.get(accountKey(a)) ?? null, write: async (a,r) => { values.set(accountKey(a),r); }, remove: async (a) => { values.delete(accountKey(a)); }, installationId: async () => installationId };
  return { values, store };
}
test('notification routing trusts local registrations, selects the original server and rejects unknown or removed accounts', async () => {
  const { values, store } = fixture(); const routeA = randomUUID(), routeB = randomUUID();
  values.set(accountKey(a), { deviceId: randomUUID(), accountId: routeA });
  values.set(accountKey(b), { deviceId: randomUUID(), accountId: routeB });
  let calls = 0;
  const client = new PlannerClient(async (url) => { calls++; assert.ok(url.startsWith(b.server)); return Response.json({ accountId: routeB, issueId: 1, notificationId: 1, projectId: 1 }); });
  const manager = new PushManager(client, store, credential, async () => { throw Error('must not prompt'); });
  const data = { v: 1, accountId: routeB, notificationId: randomUUID(), server: a.server, userId: 'attacker' };
  assert.deepEqual(await manager.route(data, [a,b]), { account: b, issueId: 1, notificationId: 1 });
  assert.equal(await manager.route({ ...data, accountId: randomUUID() }, [a,b]), null);
  assert.equal(await manager.route({ ...data, v: 2 }, [a,b]), null);
  values.delete(accountKey(b));
  assert.equal(await manager.route(data, [a,b]), null);
  assert.equal(calls, 1);
});
test('a revoked registration during route lookup cannot open a late task', async () => {
  const { values, store } = fixture(); const accountId = randomUUID();
  values.set(accountKey(a), { deviceId: randomUUID(), accountId });
  const manager = new PushManager(new PlannerClient(async () => { values.delete(accountKey(a)); return Response.json({ accountId, issueId: 1, projectId: 1, notificationId: 1 }); }), store, credential, async () => { throw Error(); });
  assert.equal(await manager.route({ v: '1', accountId, notificationId: randomUUID() }, [a]), null);
});
test('duplicate gateway routing IDs fail closed without making any server request', async () => {
  const { values, store } = fixture(); const accountId = randomUUID();
  for (const account of [a,b]) values.set(accountKey(account), { deviceId: randomUUID(), accountId });
  const manager = new PushManager(new PlannerClient(async () => { throw Error('must not fetch'); }), store, credential, async () => { throw Error(); });
  assert.equal(await manager.route({ v: 1, accountId, notificationId: randomUUID() }, [a,b]), null);
});
test('token refresh preserves disabled preferences and skips unregistered accounts', async () => {
  const { values, store } = fixture(); const deviceId = randomUUID(), accountId = randomUUID();
  values.set(accountKey(a), { deviceId, accountId }); const calls: string[] = [];
  const client = new PlannerClient(async (url, init) => { calls.push(url); assert.equal(init.method, 'POST'); assert.ok(url.endsWith('/mobile/devices')); return Response.json({ deviceId, accountId }); });
  const manager = new PushManager(client, store, credential, async () => { throw Error('must not prompt'); });
  await Promise.all([manager.refreshToken(a,[a,b],{ provider:'fcm', token:'synthetic-token' }), manager.refreshToken(b,[a,b],{ provider:'fcm', token:'synthetic-token' })]);
  assert.equal(calls.length, 1); assert.equal(calls[0], `${a.server}/mobile/devices`);
});
test('failed remote revocation retains the mapping for retry; success removes only its own account', async () => {
  const { values, store } = fixture();
  for (const account of [a,b]) values.set(accountKey(account), { deviceId: randomUUID(), accountId: randomUUID() });
  let available = false;
  const manager = new PushManager(new PlannerClient(async () => new Response(null, { status: available ? 204 : 503 })), store, credential, async () => { throw Error(); });
  await assert.rejects(manager.unregister(a)); assert.equal(values.size,2);
  available = true; await manager.unregister(a);
  assert.equal(values.has(accountKey(a)), false); assert.equal(values.has(accountKey(b)), true);
});


test('logout can revoke a registration whose successful response was lost before local persistence', async () => {
  const { values, store } = fixture(); const installationId = await store.installationId();
  const calls: string[] = []; let available = false;
  const manager = new PushManager(new PlannerClient(async (url) => { calls.push(url); return new Response(null, { status: available ? 204 : 503 }); }), store, credential, async () => { throw Error(); });
  await assert.rejects(manager.unregister(a));
  available = true; await manager.unregister(a);
  assert.deepEqual(calls, [`${a.server}/mobile/installations/${installationId}`, `${a.server}/mobile/installations/${installationId}`]);
  assert.equal(values.size,0);
});

test('servers without the mobile extension allow logout when installation revocation returns 404', async () => {
  const { store } = fixture();
  const manager = new PushManager(new PlannerClient(async (url, init) => {
    assert.ok(url.startsWith(`${a.server}/mobile/installations/`));
    assert.equal(init.method,'DELETE');
    return new Response('Not found',{status:404});
  }),store,credential,async()=>{throw Error('must not ask for a token');});
  await manager.unregister(a);
});
