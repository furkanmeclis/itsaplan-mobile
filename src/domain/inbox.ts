import { resourceKey } from './accounts';
import type { ConnectedAccount, InboxItem, Page } from '../api/client';

export interface InboxSource { account: ConnectedAccount; page: Page<InboxItem> }
export interface SourcedNotification { account: ConnectedAccount; item: InboxItem; key: string }

export function mergeInbox(sources: readonly InboxSource[], unreadOnly = false): SourcedNotification[] {
  const entries = new Map<string, SourcedNotification>();
  for (const { account, page } of sources) {
    for (const item of page.items) {
      const key = resourceKey(account, 'notification', item.id);
      if (!entries.has(key)) entries.set(key, { account, item, key });
    }
  }
  return [...entries.values()]
    .filter((entry) => !unreadOnly || entry.item.readAt === null)
    .sort((a, b) => Date.parse(b.item.createdAt) - Date.parse(a.item.createdAt) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function appendInboxPage(current: Page<InboxItem>, next: Page<InboxItem>): Page<InboxItem> {
  const ids = new Set(current.items.map((item) => item.id));
  return { items: [...current.items, ...next.items.filter((item) => {
    if (ids.has(item.id)) return false;
    ids.add(item.id); return true;
  })], nextCursor: next.nextCursor };
}

export function acknowledgeRead(current: Page<InboxItem>, id: number, read: boolean, acknowledgedAt: string): Page<InboxItem> {
  return { ...current, items: current.items.map((item) => item.id === id ? { ...item, readAt: read ? item.readAt ?? acknowledgedAt : null } : item) };
}

export function notificationLabel(type: string): string {
  switch (type) {
    case 'assigned': return 'Sana atandı';
    case 'mentioned': return 'Senden bahsedildi';
    case 'commented': return 'Yeni yorum';
    case 'state_changed': return 'Durum değişti';
    default: return 'Yeni bildirim';
  }
}

