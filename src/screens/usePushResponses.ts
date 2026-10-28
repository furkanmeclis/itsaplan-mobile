import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { ConnectedAccount } from '../api/client';
import { pushManager, refreshRegisteredPushTokens } from '../storage/push';

type Route = NonNullable<Awaited<ReturnType<typeof pushManager.route>>>;
export function usePushResponses(accounts: ConnectedAccount[], ready: boolean, open: (route: Route) => Promise<boolean>, onError: (error: unknown) => void, refresh: () => void) {
  const latest = useRef({ accounts, ready, open, onError, refresh });
  latest.current = { accounts, ready, open, onError, refresh };
  const pending = useRef<Notifications.NotificationResponse | null>(null);
  const processing = useRef(new Set<string>());
  const handle = useRef<(response: Notifications.NotificationResponse) => Promise<void>>(async () => {});
  useEffect(() => {
    if (!['android','ios'].includes(Platform.OS)) return;
    let live = true;
    Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
    handle.current = async (response) => {
      if (!live || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      if (!latest.current.ready) { pending.current = response; return; }
      const key = response.notification.request.identifier;
      if (processing.current.has(key)) return;
      processing.current.add(key);
      if (processing.current.size > 128) processing.current.delete(processing.current.values().next().value!);
      try {
        const route = await pushManager.route(response.notification.request.content.data, latest.current.accounts);
        if (!live) return;
        if (route && !(await latest.current.open(route))) { processing.current.delete(key); return; }
        await Notifications.clearLastNotificationResponseAsync();
      } catch (error) { processing.current.delete(key); if (live) latest.current.onError(error); }
    };
    const responses = Notifications.addNotificationResponseReceivedListener((response) => void handle.current(response));
    const incoming = Notifications.addNotificationReceivedListener(() => latest.current.refresh());
    const tokens = Notifications.addPushTokenListener((token) => {
      if (typeof token.data !== 'string') return;
      const accounts = latest.current.accounts;
      void Promise.allSettled(accounts.map((account) => pushManager.refreshToken(account, accounts, { provider: Platform.OS === 'ios' ? 'apns' : 'fcm', token: token.data as string })))
        .then((results) => { const failed = results.find((result) => result.status === 'rejected'); if (live && failed?.status === 'rejected') latest.current.onError(failed.reason); });
    });
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') {
      void refreshRegisteredPushTokens(latest.current.accounts).catch((error) => { if (live) latest.current.onError(error); });
      void Notifications.getLastNotificationResponseAsync().then((response) => { if (response) return handle.current(response); }).catch((error) => { if (live) latest.current.onError(error); }); } });
    return () => { live = false; responses.remove(); incoming.remove(); tokens.remove(); appState.remove(); };
  }, []);
  useEffect(() => {
    if (!ready || !['ios','android'].includes(Platform.OS)) return;
    void refreshRegisteredPushTokens(accounts).catch(onError);
    const response = pending.current; pending.current = null;
    if (response) void handle.current(response);
    else void Notifications.getLastNotificationResponseAsync().then((value) => { if (value) return handle.current(value); }).catch(onError);
  }, [ready, accounts]);
}
