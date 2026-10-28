import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database } from '../src/database';
import { hashKey } from '../src/security';
import { PlannerClient, sessionCookie } from '../../../src/api/client';

const client = new PlannerClient((url, init) => fetch(url, init));
const urls = ['https://localhost:34561','https://localhost:34562'];
const origin = 'https://localhost:3400';
const sqlA = database(process.env.PUSH_TEST_DB_A!);
const sqlB = database(process.env.PUSH_TEST_DB_B!);
const gatewayDb = database(process.env.PUSH_TEST_GATEWAY_DB!);
const password = 'Disposable-push-test-password-123';
const control = { Authorization: `Bearer ${process.env.TEST_CONTROL_KEY}` };

async function api(server: string, path: string, cookie?: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${server}${path}`, { method, redirect: 'error', credentials: 'omit', headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(response.ok, true, `${path} returned ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function tick(server: string, path: string) {
  const response = await fetch(`${server}${path}`, { method: 'POST', headers: control });
  assert.equal(response.status, 200);
}
async function seed(server: string, suffix: string) {
  async function user(name: string) {
    const email = `push-${name}-${suffix}@example.test`;
    const response = await fetch(`${server}/api/auth/sign-up/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ email, password, name }) });
    assert.equal(response.ok, true);
    const cookie = sessionCookie(response.headers); const data = await response.json();
    return { email, cookie, id: data.user.id };
  }
  const owner = await user('owner'); const actor = await user('actor');
  const workspaces = await api(server, '/workspaces', owner.cookie);
  const workspace = workspaces.find((entry: { role: string }) => entry.role === 'owner');
  const team = await api(server, '/teams', owner.cookie, { name: 'Push test', slug: `push-${suffix}`, workspaceId: workspace.id });
  const project = await api(server, `/teams/${team.id}/projects`, owner.cookie, { key: 'PUSH', name: 'PRIVATE PROJECT TITLE' });
  const invite = await api(server, `/projects/${project.ref}/invites`, owner.cookie, { email: actor.email, role: 'member' });
  await api(server, `/invites/${invite.token}/accept`, actor.cookie, {});
  const scaffold = await api(server, `/projects/${project.ref}`, owner.cookie);
  const issue = await api(server, `/projects/${project.ref}/issues`, owner.cookie, { title: 'PRIVATE TASK TITLE', columnId: scaffold.columns[0].id, assigneeUserId: owner.id });
  const actorLogin = await client.signIn(server, origin, actor.email, password);
  return { server, owner, actor, actorLogin, project, issue,
    comment: () => client.addComment(actorLogin.account, actorLogin.credential, issue.id, 'PRIVATE COMMENT CONTENT'),
  };
}

test('upstream event → durable mobile queue → gateway → provider boundary, retries and revocation', async () => {
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      try { if ((await fetch('https://localhost:34563/health')).ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const a = await seed(urls[0], 'alpha'); const b = await seed(urls[1], 'beta');
    const installation = randomUUID();
    const tokenA = `test-fcm-${randomUUID()}`; const tokenB = `test-fcm-${randomUUID()}`;
    const aDevice = await api(a.server, '/mobile/devices', a.owner.cookie, { installationId: installation, provider: 'fcm', token: tokenA });
    const bDevice = await api(b.server, '/mobile/devices', b.owner.cookie, { installationId: installation, provider: 'fcm', token: tokenB });
    assert.notEqual(aDevice.accountId, bDevice.accountId);
    const repeated = await api(a.server, '/mobile/devices', a.owner.cookie, { installationId: installation, provider: 'fcm', token: tokenA });
    assert.deepEqual(repeated, aDevice);
    const prefs = { enabled: true, events: ['assigned','mentioned','commented','state_changed'] };
    await api(a.server, '/mobile/preferences', a.owner.cookie, prefs, 'PUT');
    await api(b.server, '/mobile/preferences', b.owner.cookie, prefs, 'PUT');
    assert.equal((await fetch(`${a.server}/mobile/devices/${aDevice.deviceId}`, { method: 'DELETE', headers: { Cookie: a.actor.cookie, Origin: origin } })).status, 404);
    assert.equal((await fetch(`${a.server}/mobile/devices`, { method: 'POST', headers: { Cookie: a.owner.cookie, Origin: 'https://untrusted.example', 'Content-Type':'application/json' }, body: '{}' })).status, 403);
    await a.comment(); await b.comment();
    const [aEvent] = await sqlA`SELECT * FROM mobile_delivery WHERE device_id=${aDevice.deviceId}`;
    const [bEvent] = await sqlB`SELECT * FROM mobile_delivery WHERE device_id=${bDevice.deviceId}`;
    assert.ok(aEvent); assert.ok(bEvent); assert.notEqual(aEvent.id, bEvent.id);
    const gatewayRequest = (key: string, body: unknown) => fetch('https://localhost:34563/v1/deliveries', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    const delivery = { id: aEvent.id, deviceId: aDevice.deviceId, notificationId: aEvent.id, event: 'commented' };
    assert.equal((await gatewayRequest('invalid-synthetic-key', delivery)).status, 401);
    assert.equal((await gatewayRequest(process.env.TEST_TENANT_KEY_B!, delivery)).status, 410);

    const route = await api(a.server, `/mobile/notifications/${aEvent.id}`, a.owner.cookie);
    assert.equal(route.accountId, aDevice.accountId); assert.equal(route.issueId, a.issue.id);
    assert.equal((await fetch(`${a.server}/mobile/notifications/${aEvent.id}`, { headers: { Cookie: a.actor.cookie } })).status, 404);
    await Promise.all([tick(a.server, '/__test/mobile-tick'), tick(a.server, '/__test/mobile-tick')]);
    await tick(b.server, '/__test/mobile-tick');
    assert.equal((await sqlA`SELECT status FROM mobile_delivery WHERE id=${aEvent.id}`)[0].status, 'accepted');
    assert.equal((await gatewayDb`SELECT count(*)::int AS count FROM push_delivery`)[0].count, 2);
    assert.equal((await gatewayRequest(process.env.TEST_TENANT_KEY_A!, { ...delivery, notificationId: randomUUID() })).status, 409);
    assert.equal((await gatewayRequest(process.env.TEST_TENANT_KEY_A!, { ...delivery, title: 'PRIVATE' })).status, 400);

    await Promise.all([tick('https://localhost:34563', '/__test/tick'), tick('https://localhost:34563', '/__test/tick')]);
    const sent = await gatewayDb`SELECT * FROM push_test_sent`;
    assert.equal(sent.length, 2);
    assert.deepEqual(sent.find((entry) => entry.id === aEvent.id)!.data, { v: 1, accountId: aDevice.accountId, notificationId: aEvent.id });
    assert.equal(sent.find((entry) => entry.id === aEvent.id)!.token_hash, hashKey(tokenA));
    assert.equal(sent.find((entry) => entry.id === bEvent.id)!.token_hash, hashKey(tokenB));
    assert.equal(JSON.stringify(await gatewayDb`SELECT * FROM push_delivery`).includes('PRIVATE'), false);
    assert.equal(JSON.stringify(await sqlA`SELECT token_encrypted FROM mobile_device`).includes(tokenA), false);
    assert.equal(JSON.stringify(await gatewayDb`SELECT token_encrypted FROM push_device`).includes(tokenA), false);
    await sqlA`UPDATE mobile_delivery SET status='pending',next_attempt_at=now() WHERE id=${aEvent.id}`;
    await tick(a.server, '/__test/mobile-tick'); await tick('https://localhost:34563', '/__test/tick');
    assert.equal((await gatewayDb`SELECT count(*)::int AS count FROM push_test_sent`)[0].count, 2);

    await a.comment(); await tick(a.server, '/__test/mobile-tick');
    await gatewayDb`UPDATE push_test_control SET mode='retry'`;
    await tick('https://localhost:34563', '/__test/tick');
    const [retry] = await gatewayDb`SELECT * FROM push_delivery WHERE status='pending'`;
    assert.ok(retry); assert.equal(retry.attempts, 1); assert.ok(new Date(retry.next_attempt_at).getTime() > Date.now());
    await tick('https://localhost:34563', '/__test/tick');
    assert.equal((await gatewayDb`SELECT attempts FROM push_delivery WHERE id=${retry.id}`)[0].attempts, 1);
    await gatewayDb`UPDATE push_delivery SET next_attempt_at=now() WHERE id=${retry.id}`;
    await gatewayDb`UPDATE push_test_control SET mode='sent'`;
    await tick('https://localhost:34563', '/__test/tick');
    assert.equal((await gatewayDb`SELECT status,attempts FROM push_delivery WHERE id=${retry.id}`)[0].status, 'sent');

    await a.comment(); await tick(a.server, '/__test/mobile-tick');
    const beforeDisable = (await gatewayDb`SELECT count(*)::int AS count FROM push_test_sent`)[0].count;
    await api(a.server, '/mobile/preferences', a.owner.cookie, { ...prefs, enabled: false }, 'PUT');
    await tick('https://localhost:34563', '/__test/tick');
    assert.equal((await gatewayDb`SELECT count(*)::int AS count FROM push_test_sent`)[0].count, beforeDisable);
    const beforeComment = (await sqlA`SELECT count(*)::int AS count FROM mobile_delivery`)[0].count;
    await a.comment();
    assert.equal((await sqlA`SELECT count(*)::int AS count FROM mobile_delivery`)[0].count, beforeComment);

    await api(a.server, '/mobile/preferences', a.owner.cookie, prefs, 'PUT');
    await a.comment(); await tick(a.server, '/__test/mobile-tick');
    await gatewayDb`UPDATE push_test_control SET mode='retired'`;
    await tick('https://localhost:34563', '/__test/tick');
    const [retired] = await gatewayDb`SELECT retired,token_encrypted FROM push_device WHERE route_id=${aDevice.accountId}`;
    assert.equal(retired.retired, true); assert.equal(retired.token_encrypted, '');
    await a.comment(); await tick(a.server, '/__test/mobile-tick');
    assert.equal((await sqlA`SELECT active FROM mobile_device WHERE id=${aDevice.deviceId}`)[0].active, false);

    await api(a.server, '/mobile/devices', a.owner.cookie, { installationId: installation, provider: 'fcm', token: `new-test-fcm-${randomUUID()}` });
    await gatewayDb`UPDATE push_test_control SET mode='sent'`;
    await a.comment(); await tick(a.server, '/__test/mobile-tick');
    const beforeLogout = (await gatewayDb`SELECT count(*)::int AS count FROM push_test_sent`)[0].count;
    await api(a.server, `/mobile/devices/${aDevice.deviceId}`, a.owner.cookie, undefined, 'DELETE');
    await tick('https://localhost:34563', '/__test/tick'); await a.comment(); await tick(a.server, '/__test/mobile-tick');
    assert.equal((await gatewayDb`SELECT count(*)::int AS count FROM push_test_sent`)[0].count, beforeLogout);
    assert.equal((await fetch(`${a.server}/mobile/notifications/${aEvent.id}`, { headers: { Cookie: a.owner.cookie } })).status, 404);
    // Simulate a successful enrolment response lost before the client stored deviceId.
    await api(a.server, '/mobile/devices', a.owner.cookie, { installationId: installation, provider: 'fcm', token: `lost-response-test-${randomUUID()}` });
    await api(a.server, `/mobile/installations/${installation}`, a.actor.cookie, undefined, 'DELETE');
    assert.equal((await sqlA`SELECT active FROM mobile_device WHERE id=${aDevice.deviceId}`)[0].active, true);
    await a.comment(); await tick(a.server, '/__test/mobile-tick');
    const beforeLostResponseLogout = (await gatewayDb`SELECT count(*)::int AS count FROM push_test_sent`)[0].count;
    await api(a.server, `/mobile/installations/${installation}`, a.owner.cookie, undefined, 'DELETE');
    await api(a.server, `/mobile/installations/${installation}`, a.owner.cookie, undefined, 'DELETE');
    await tick('https://localhost:34563', '/__test/tick');
    assert.equal((await gatewayDb`SELECT count(*)::int AS count FROM push_test_sent`)[0].count, beforeLostResponseLogout);
    assert.equal((await sqlA`SELECT active FROM mobile_device WHERE id=${aDevice.deviceId}`)[0].active, false);
    // Crash recovery: an unexpired final lease is untouched; an expired one
    // becomes terminal without a ninth send. Earlier expired leases can recover.
    await api(a.server, '/mobile/devices', a.owner.cookie, { installationId: installation, provider: 'fcm', token: `crash-recovery-test-${randomUUID()}` });
    await a.comment();
    const [crashedMobile] = await sqlA`SELECT id FROM mobile_delivery WHERE device_id=${aDevice.deviceId} AND status='pending' ORDER BY created_at DESC,id DESC LIMIT 1`;
    await sqlA`UPDATE mobile_delivery SET attempts=8,lease_token=gen_random_uuid(),next_attempt_at=now()+interval '1 hour' WHERE id=${crashedMobile.id}`;
    await tick(a.server, '/__test/mobile-tick');
    assert.equal((await sqlA`SELECT status FROM mobile_delivery WHERE id=${crashedMobile.id}`)[0].status, 'pending');
    await sqlA`UPDATE mobile_delivery SET next_attempt_at=now() WHERE id=${crashedMobile.id}`;
    await Promise.all([tick(a.server, '/__test/mobile-tick'),tick(a.server, '/__test/mobile-tick')]);
    const [exhaustedMobile] = await sqlA`SELECT status,attempts,lease_token,last_error FROM mobile_delivery WHERE id=${crashedMobile.id}`;
    assert.deepEqual({ ...exhaustedMobile }, { status:'failed',attempts:8,lease_token:null,last_error:'attempts_exhausted' });
    assert.equal((await gatewayDb`SELECT count(*)::int AS n FROM push_delivery WHERE id=${crashedMobile.id}`)[0].n,0);

    await a.comment();
    const [recoveringMobile] = await sqlA`SELECT id FROM mobile_delivery WHERE device_id=${aDevice.deviceId} AND status='pending' ORDER BY created_at DESC,id DESC LIMIT 1`;
    await sqlA`UPDATE mobile_delivery SET attempts=7,lease_token=gen_random_uuid(),next_attempt_at=now() WHERE id=${recoveringMobile.id}`;
    await Promise.all([tick(a.server, '/__test/mobile-tick'),tick(a.server, '/__test/mobile-tick')]);
    const [recoveredMobile] = await sqlA`SELECT status,attempts FROM mobile_delivery WHERE id=${recoveringMobile.id}`;
    assert.equal(recoveredMobile.status,'accepted'); assert.equal(recoveredMobile.attempts,8);
    await gatewayDb`UPDATE push_delivery SET attempts=8,lease_token=gen_random_uuid(),next_attempt_at=now()+interval '1 hour' WHERE id=${recoveringMobile.id}`;
    await tick('https://localhost:34563','/__test/tick');
    assert.equal((await gatewayDb`SELECT status FROM push_delivery WHERE id=${recoveringMobile.id}`)[0].status,'pending');
    await gatewayDb`UPDATE push_delivery SET next_attempt_at=now() WHERE id=${recoveringMobile.id}`;
    await Promise.all([tick('https://localhost:34563','/__test/tick'),tick('https://localhost:34563','/__test/tick')]);
    const [exhaustedGateway] = await gatewayDb`SELECT status,attempts,lease_token,last_error FROM push_delivery WHERE id=${recoveringMobile.id}`;
    assert.deepEqual({ ...exhaustedGateway }, { status:'failed',attempts:8,lease_token:null,last_error:'attempts_exhausted' });
    assert.equal((await gatewayDb`SELECT count(*)::int AS n FROM push_test_sent WHERE id=${recoveringMobile.id}`)[0].n,0);

    await a.comment(); await tick(a.server,'/__test/mobile-tick');
    const [recoveringGateway] = await gatewayDb`SELECT id FROM push_delivery WHERE status='pending' LIMIT 1`;
    await gatewayDb`UPDATE push_delivery SET attempts=7,lease_token=gen_random_uuid(),next_attempt_at=now() WHERE id=${recoveringGateway.id}`;
    await Promise.all([tick('https://localhost:34563','/__test/tick'),tick('https://localhost:34563','/__test/tick')]);
    const [recoveredGateway] = await gatewayDb`SELECT status,attempts FROM push_delivery WHERE id=${recoveringGateway.id}`;
    assert.equal(recoveredGateway.status,'sent'); assert.equal(recoveredGateway.attempts,8);
    assert.equal((await gatewayDb`SELECT count(*)::int AS n FROM push_test_sent WHERE id=${recoveringGateway.id}`)[0].n,1);
    await b.comment();
    await sqlB`UPDATE "user" SET active=false WHERE id=${b.owner.id}`;
    await tick(b.server, '/__test/mobile-tick');
    assert.equal((await sqlB`SELECT status FROM mobile_delivery WHERE device_id=${bDevice.deviceId} ORDER BY created_at DESC LIMIT 1`)[0].status, 'cancelled');
  } finally { await Promise.all([sqlA.end(), sqlB.end(), gatewayDb.end()]); }
});
