import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { SessionVault } from '../domain/sessionVault';

export const secureSessionVault = new SessionVault(
  {
    get: (key) => SecureStore.getItemAsync(key),
    set: (key, value) => SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
    remove: (key) => SecureStore.deleteItemAsync(key),
  },
  (value) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
);
