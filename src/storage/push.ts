import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { PushManager, PushSetupError, type PushStore, type PushToken } from '../domain/push';
import { accountKey } from '../domain/accounts';
import { plannerClient } from '../api/nativeClient';
import { storedCredential, type PushRegistration } from '../api/client';
import { secureSessionVault } from './secureSessionVault';

const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const registrationKey = async (account: Parameters<PushStore['read']>[0]) => `itsaplan.push.v1.${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, accountKey(account))}`;
let installation: Promise<string> | undefined;
export const pushStore: PushStore = {
  async read(account) {
    const value = await SecureStore.getItemAsync(await registrationKey(account));
    if (!value) return null;
    const registration = JSON.parse(value) as PushRegistration;
    const valid = (value: unknown) => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
    if (!valid(registration.deviceId) || !valid(registration.accountId)) throw new PushSetupError('unavailable');
    return registration;
  },
  async write(account, registration) { await SecureStore.setItemAsync(await registrationKey(account), JSON.stringify(registration), options); },
  async remove(account) { await SecureStore.deleteItemAsync(await registrationKey(account)); },
  installationId() {
    if (!installation) installation = (async () => {
      const existing = await SecureStore.getItemAsync('itsaplan.installation.v1');
      if (existing) return existing;
      const id = Crypto.randomUUID();
      await SecureStore.setItemAsync('itsaplan.installation.v1', id, options);
      return id;
    })().catch((error) => { installation = undefined; throw error; });
    return installation;
  },
};
let tokenRequest: Promise<PushToken> | undefined;
async function deviceToken(): Promise<PushToken> {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient || !['ios','android'].includes(Platform.OS)) throw new PushSetupError('native-build');
  if (!tokenRequest) tokenRequest = (async (): Promise<PushToken> => {
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'It’s a Plan', importance: Notifications.AndroidImportance.DEFAULT });
    let permissions = await Notifications.getPermissionsAsync();
    if (!permissions.granted) permissions = await Notifications.requestPermissionsAsync();
    if (!permissions.granted && permissions.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) throw new PushSetupError('permission');
    try {
      const token = await Notifications.getDevicePushTokenAsync();
      if (typeof token.data !== 'string' || !token.data) throw new Error('No token.');
      return { provider: Platform.OS === 'ios' ? 'apns' : 'fcm', token: token.data };
    } catch { throw new PushSetupError('token'); }
  })().finally(() => { tokenRequest = undefined; });
  return tokenRequest;
}

export const pushManager = new PushManager(plannerClient, pushStore,
  async (account) => storedCredential(await secureSessionVault.read(account)), deviceToken);

// Refresh enrolled installations on launch/resume without prompting for OS permission.
export async function refreshRegisteredPushTokens(accounts: import('../api/client').ConnectedAccount[]) {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient || !['ios','android'].includes(Platform.OS)) return;
  const enrolled = await Promise.allSettled(accounts.map(async (account) => (await pushManager.registration(account)) ? account : null));
  const active = enrolled.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []);
  if (!active.length) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) return;
  const token = await Notifications.getDevicePushTokenAsync();
  if (typeof token.data !== 'string' || !token.data) throw new PushSetupError('token');
  const results = await Promise.allSettled(active.map((account) => pushManager.refreshToken(account, accounts, { provider: Platform.OS === 'ios' ? 'apns' : 'fcm', token: token.data as string })));
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
