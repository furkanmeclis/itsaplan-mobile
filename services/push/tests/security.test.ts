import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { encrypt, decrypt, encryptionKey, httpsEndpoint } from '../src/security';
import { bodyJson, payload, preferences, providerToken, retryDelay } from '../src/protocol';

test('encrypted tokens cannot move between tenants or devices and reject tampering', () => {
  const key = randomBytes(32); const token = 'synthetic-test-token';
  const cipher = encrypt(token, key, 'tenant-a:device-a');
  assert.equal(decrypt(cipher, key, 'tenant-a:device-a'), token);
  assert.notEqual(cipher, encrypt(token, key, 'tenant-a:device-a'));
  assert.throws(() => decrypt(cipher, key, 'tenant-b:device-a'));
  assert.throws(() => decrypt(cipher, randomBytes(32), 'tenant-a:device-a'));
  const altered = Buffer.from(cipher, 'base64'); altered[28] ^= 1;
  assert.throws(() => decrypt(altered.toString('base64'), key, 'tenant-a:device-a'));
  assert.throws(() => encryptionKey('short'));
});
test('gateway endpoints reject plaintext, credentials and query-string secrets', () => {
  for (const url of ['http://example.com', 'https://user:password@example.com', 'https://example.com?key=secret', 'https://example.com#secret']) assert.throws(() => httpsEndpoint(url));
  assert.equal(httpsEndpoint('https://example.com/gateway/'), 'https://example.com/gateway');
});
test('protocol rejects arbitrary content and oversized requests', async () => {
  assert.throws(() => preferences({ enabled: true, events: ['commented'], title: 'private' }));
  assert.throws(() => providerToken('apns', 'short'));
  assert.throws(() => providerToken('fcm', 'newline\nnot-allowed'));
  const data = payload(randomUUID(), randomUUID());
  assert.deepEqual(Object.keys(data), ['v', 'accountId', 'notificationId']);
  const req = new Request('https://example.com', { method: 'POST', body: JSON.stringify({ token: 'x'.repeat(17000) }) });
  await assert.rejects(bodyJson(req), { status: 413 });
  assert.equal(retryDelay(1, () => 0), 1000);
  assert.ok(retryDelay(20, () => 1) <= 1800000);
});
