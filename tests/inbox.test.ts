import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acknowledgeRead, appendInboxPage, mergeInbox, notificationLabel } from '../src/domain/inbox';
import { PlannerClient, ApiError, type ConnectedAccount, type InboxItem, type Page } from '../src/api/client';

const a: ConnectedAccount = { server: 'https://a.example', webOrigin: 'https://a.example', userId: 'same-id', label: 'A' };
const b: ConnectedAccount = { ...a, server: 'https://b.example', label: 'B' };
const other: ConnectedAccount = { ...a, userId: 'another-user' };
function item(id: number, createdAt: string, readAt: string | null = null): InboxItem {
  return { id, projectId: 1, projectName: 'Project', issueId: 1, issueTitle: 'Task', documentTitle: null, type: 'commented', createdAt, readAt };
}
const page = (...items: InboxItem[]): Page<InboxItem> => ({ items, nextCursor: null });
const old = item(1, '2026-10-27T10:00:00Z');
const recent = item(2, '2026-10-28T10:00:00Z');

test('merged inbox sorts by instant across accounts without confusing equal remote IDs', () => {
  const merged = mergeInbox([{ account: a, page: page(old) }, { account: b, page: page({ ...recent, id: 1 }) }, { account: other, page: page(old) }]);
  assert.equal(merged.length, 3);
  assert.equal(new Set(merged.map((entry) => entry.key)).size, 3);
  assert.equal(merged[0].account.server, b.server);
  assert.equal(merged[1].item.issueId, merged[2].item.issueId);
});

test('equal timestamps have deterministic ordering independent of account load order', () => {
  const sources = [{ account: a, page: page(old) }, { account: b, page: page(old) }];
  assert.deepEqual(mergeInbox(sources), mergeInbox([...sources].reverse()));
});

test('unread filtering uses read state and empty or offline sources do not remove ready sources', () => {
  const read = { ...old, readAt: '2026-10-28T11:00:00Z' };
  const result = mergeInbox([{ account: a, page: page(read, recent) }, { account: b, page: page() }], true);
  assert.deepEqual(result.map((entry) => entry.item.id), [2]);
  assert.deepEqual(mergeInbox([]), []);
});

test('pagination deduplicates overlap without reverting an acknowledged read', () => {
  const read = { ...recent, readAt: '2026-10-28T11:00:00Z' };
  const cursor = { id: 1, ts: old.createdAt };
  const current = { items: [read], nextCursor: cursor };
  const next = { items: [recent, old, old], nextCursor: null };
  const result = appendInboxPage(current, next);
  assert.deepEqual(result.items, [read, old]);
  assert.equal(result.nextCursor, null);
  assert.equal(current.items.length, 1);
});

test('unread filtering deduplicates before considering a stale unread duplicate', () => {
  const acknowledged = { ...old, readAt: '2026-10-28T11:00:00Z' };
  assert.deepEqual(mergeInbox([{ account: a, page: page(acknowledged, old) }], true), []);
});

test('read acknowledgements change only one notification and preserve the page cursor', () => {
  const initial = { items: [old, recent], nextCursor: { id: 1, ts: old.createdAt } };
  const changed = acknowledgeRead(initial, 1, true, '2026-10-28T11:00:00Z');
  assert.equal(changed.items[0].readAt, '2026-10-28T11:00:00Z');
  assert.equal(changed.items[1], recent);
  assert.equal(changed.nextCursor, initial.nextCursor);
  assert.equal(initial.items[0].readAt, null);
  assert.equal(acknowledgeRead(changed, 1, false, '2026-10-28T12:00:00Z').items[0].readAt, null);
});

test('inbox API preserves source credentials and posts explicit read/unread state', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const client = new PlannerClient(async (url, init) => {
    calls.push({ url, init });
    return init.method === 'POST' ? new Response(null, { status: 204 }) : Response.json(page(old));
  });
  const credential = { cookie: '__Host-better-auth.session_token=account-a' };
  assert.equal((await client.inbox(a, credential)).items[0].createdAt, old.createdAt);
  await client.setNotificationRead(a, credential, 1, false);
  assert.equal(calls[1].url, 'https://a.example/notifications/1/read');
  assert.deepEqual(JSON.parse(calls[1].init.body as string), { read: false });
  assert.equal(new Headers(calls[1].init.headers).get('cookie'), credential.cookie);
  assert.equal(calls[1].init.credentials, 'omit');
});

test('malformed notification timestamps fail closed and unknown types have a usable label', async () => {
  const client = new PlannerClient(async () => Response.json(page({ ...old, createdAt: 'not-a-date' })));
  await assert.rejects(client.inbox(a, { cookie: '__Host-better-auth.session_token=test' }), (error: unknown) => error instanceof ApiError && error.code === 'invalid-response');
  assert.equal(notificationLabel('assigned'), 'Sana atandı');
  for (const type of ['future-event', '__proto__', 'toString']) assert.equal(notificationLabel(type), 'Yeni bildirim');
});
