import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, verify } from 'node:crypto';
import { apnsSender, fcmSender, retryAfter } from '../src/providers';
import { payload } from '../src/protocol';
const data = payload(randomUUID(), randomUUID()); const id = randomUUID();

test('FCM uses signed OAuth, fixed Google endpoints, generic content and caches authorization', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let auth = 0; let sends = 0;
  const send = fcmSender({ client_email: 'sender@test-project.iam.gserviceaccount.com', project_id: 'test-project', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }, async (input, init) => {
    assert.equal(init?.redirect, 'error');
    if (String(input) === 'https://oauth2.googleapis.com/token') {
      auth++;
      const assertion = new URLSearchParams(init?.body as URLSearchParams).get('assertion')!;
      const [header, body, signature] = assertion.split('.');
      assert.equal(JSON.parse(Buffer.from(header, 'base64url').toString()).alg, 'RS256');
      assert.equal(JSON.parse(Buffer.from(body, 'base64url').toString()).aud, 'https://oauth2.googleapis.com/token');
      assert.ok(verify('RSA-SHA256', Buffer.from(`${header}.${body}`), publicKey, Buffer.from(signature, 'base64url')));
      return Response.json({ access_token: 'test-access', expires_in: 3600 });
    }
    sends++;
    assert.equal(String(input), 'https://fcm.googleapis.com/v1/projects/test-project/messages:send');
    const body = JSON.parse(init?.body as string);
    assert.deepEqual(body.message.data, { ...data, v: '1' });
    assert.deepEqual(body.message.notification, { title: 'It’s a Plan', body: 'Yeni bir bildirimin var.' });
    assert.equal(body.message.android.collapse_key, undefined);
    return Response.json({ name: 'test' });
  });
  assert.deepEqual(await send('fcm', 'test-token', data, id), { status: 'sent' });
  await send('fcm', 'test-token', data, id);
  assert.equal(auth, 1); assert.equal(sends, 2);
});
test('APNs selects its environment, signs ES256, preserves idempotency and retires invalid tokens', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  let calls = 0;
  const send = apnsSender({ key: privateKey, keyId: 'ABCDEFGHIJ', teamId: '0123456789', topic: 'software.technowide.itsaplan', sandbox: true }, async (host, _token, headers, body) => {
    assert.equal(host, 'api.sandbox.push.apple.com');
    assert.equal(headers['apns-id'], id);
    const [header, claims, signature] = headers.authorization.slice(7).split('.');
    assert.equal(JSON.parse(Buffer.from(header, 'base64url').toString()).alg, 'ES256');
    assert.ok(verify('SHA256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
    assert.deepEqual(Object.keys(JSON.parse(body)).sort(), ['accountId','aps','notificationId','v']);
    calls++;
    return calls === 1 ? { status: 503, retryAfter: '60' } : { status: 410 };
  });
  assert.deepEqual(await send('apns', 'f'.repeat(64), data, id), { status: 'retry', code: 'apns_503', retryAfterMs: 60000 });
  assert.deepEqual(await send('apns', 'f'.repeat(64), data, id), { status: 'retired', code: 'apns_token_invalid' });
  assert.equal(retryAfter('9999999999'), 86400000);
  assert.equal(retryAfter('invalid'), 0);
});
