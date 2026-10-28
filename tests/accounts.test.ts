import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { AccountCache, accountKey, normalizeServer, resolvePushRoute, resourceKey, type Account } from '../src/domain/accounts';
import { loadAccounts } from '../src/domain/loadAccounts';
import { SessionVault } from '../src/domain/sessionVault';
import { createDemoData, demoAccounts } from '../src/demo/data';

const first = demoAccounts[0];
const second = demoAccounts[1];
const otherUser: Account = { ...first, userId: 'another-user' };
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');

function makeVault() {
  const values = new Map<string, string>();
  const vault = new SessionVault({
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    remove: async (key) => { values.delete(key); },
  }, digest);
  return { vault, values };
}

test('equivalent server origins share a scope while deployment paths stay distinct', () => {
  assert.equal(normalizeServer(' HTTPS://STUDIO.EXAMPLE:443/planner/// '), 'https://studio.example/planner');
  assert.equal(accountKey(first), accountKey({ ...first, server: `${first.server}/` }));
  assert.notEqual(accountKey(first), accountKey({ ...first, server: `${first.server}/api` }));
  assert.notEqual(accountKey(first), accountKey({ ...first, server: `${first.server}/API` }));
});

test('URLs cannot contain secrets or insecure transport', () => {
  for (const value of ['http://studio.example', 'https://user:secret@studio.example', 'https://studio.example?key=example', 'https://studio.example#token', 'file:///tmp/api', 'https://studio.example/a%2fb']) {
    assert.throws(() => normalizeServer(value));
  }
  assert.throws(() => accountKey({ ...first, userId: ' ' }));
});

test('same remote IDs on two servers and two users never collide', () => {
  const cache = new AccountCache<string>();
  cache.set(first, 'task', 1, 'first server');
  cache.set(second, 'task', 1, 'second server');
  cache.set(otherUser, 'task', 1, 'other user');
  cache.set(first, 'notification', 1, 'notification');
  assert.equal(cache.get(first, 'task', 1), 'first server');
  assert.equal(cache.get(second, 'task', 1), 'second server');
  assert.equal(cache.get(otherUser, 'task', 1), 'other user');
  assert.equal(cache.get(first, 'notification', 1), 'notification');
  assert.notEqual(resourceKey(first, 'task', 1), resourceKey(second, 'task', 1));
  cache.clear(first);
  assert.equal(cache.get(first, 'task', 1), undefined);
  assert.equal(cache.get(first, 'notification', 1), undefined);
  assert.equal(cache.get(second, 'task', 1), 'second server');
  assert.equal(cache.get(otherUser, 'task', 1), 'other user');
});

test('tuple encoding prevents delimiter collisions in identities and resource keys', () => {
  assert.notEqual(accountKey({ ...first, userId: 'a|b' }), accountKey({ ...first, server: `${first.server}/a`, userId: 'b' }));
  assert.notEqual(resourceKey(first, 'task|1', '2'), resourceKey(first, 'task', '1|2'));
});

test('vault separates credentials by server and user and uses valid non-secret storage keys', async () => {
  const { vault, values } = makeVault();
  await vault.save(first, 'test-session-a');
  await vault.save(second, 'test-session-b');
  await vault.save(otherUser, 'test-session-c');
  assert.equal(await vault.read(first), 'test-session-a');
  assert.equal(await vault.read(second), 'test-session-b');
  assert.equal(await vault.read(otherUser), 'test-session-c');
  assert.equal(values.size, 3);
  for (const key of values.keys()) assert.match(key, /^itsaplan\.session\.v1\.[a-f0-9]{64}$/);
  await assert.rejects(vault.save(first, ''));
});

test('disconnect revokes the device before deleting only its own credential', async () => {
  const { vault } = makeVault();
  await vault.save(first, 'test-session-a');
  await vault.save(second, 'test-session-b');
  await vault.disconnect(first, async () => assert.equal(await vault.read(first), 'test-session-a'));
  assert.equal(await vault.read(first), null);
  assert.equal(await vault.read(second), 'test-session-b');
});

test('failed revocation keeps the credential available for an explicit retry', async () => {
  const { vault } = makeVault();
  await vault.save(first, 'test-session-a');
  await assert.rejects(vault.disconnect(first, async () => { throw new Error('Offline'); }));
  assert.equal(await vault.read(first), 'test-session-a');
});

test('notification routes use a local opaque registration, ignoring supplied URLs and user IDs', () => {
  const registrations = new Map([['opaque-a', first], ['opaque-b', second]]);
  const route = resolvePushRoute({ accountId: 'opaque-b', notificationId: 'n-1', server: first.server, userId: otherUser.userId }, registrations);
  assert.deepEqual(route, { account: second, notificationId: 'n-1' });
  registrations.delete('opaque-b');
  assert.equal(resolvePushRoute({ accountId: 'opaque-b', notificationId: 'n-1' }, registrations), null);
});

test('malformed and unknown notification routes cannot select an account', () => {
  const registrations = new Map([['opaque-a', first]]);
  for (const payload of [null, [], 'opaque-a', {}, { accountId: 'unknown', notificationId: '1' }, { accountId: 'opaque-a', notificationId: 1 }, { accountId: 'opaque-a', notificationId: '' }, { accountId: 'opaque-a', notificationId: 'a'.repeat(257) }]) {
    assert.equal(resolvePushRoute(payload, registrations), null);
  }
});

test('unreachable accounts do not discard successful results', async () => {
  const results = await loadAccounts([first, second], async (account) => {
    if (accountKey(account) === accountKey(first)) throw new Error('Server unreachable');
    return [{ id: 1, title: 'Available' }];
  });
  assert.equal(results[0].status, 'unavailable');
  assert.deepEqual(results[1], { account: second, status: 'ready', value: [{ id: 1, title: 'Available' }] });
});

test('a hanging account times out and aborts even when its loader ignores cancellation', async () => {
  let failedSignal: AbortSignal | undefined;
  const results = await loadAccounts([first, second], async (account, signal) => {
    if (accountKey(account) === accountKey(first)) {
      failedSignal = signal;
      return new Promise<string>(() => {});
    }
    return 'Available';
  }, 25);
  assert.equal(failedSignal?.aborted, true);
  assert.equal(results[0].status, 'unavailable');
  assert.deepEqual(results[1], { account: second, status: 'ready', value: 'Available' });
});

test('an invalid account does not prevent another account from loading', async () => {
  const invalid = { ...first, server: 'not-a-server-url' };
  const loaded: Account[] = [];
  const results = await loadAccounts([invalid, second], async (account) => {
    loaded.push(account);
    return 'Available';
  });
  assert.equal(results[0].status, 'unavailable');
  assert.deepEqual(results[1], { account: second, status: 'ready', value: 'Available' });
  assert.deepEqual(loaded, [second]);
});

test('demo fixtures are fresh and deliberately contain colliding remote IDs', () => {
  const data = createDemoData();
  assert.equal(data[0].tasks[0].id, data[1].tasks[0].id);
  data[0].tasks[0].comments.push('Local demo edit');
  assert.equal(data[1].tasks[0].comments.includes('Local demo edit'), false);
  assert.equal(createDemoData()[0].tasks[0].comments.includes('Local demo edit'), false);
});
