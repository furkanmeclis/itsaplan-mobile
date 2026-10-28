import AsyncStorage from '@react-native-async-storage/async-storage';
import { ConnectedAccounts } from '../domain/connectedAccounts';
import { plannerClient } from '../api/nativeClient';
import { secureSessionVault } from './secureSessionVault';

const indexKey = 'itsaplan.accounts.v1';
export const connectedAccounts = new ConnectedAccounts({
  read: () => AsyncStorage.getItem(indexKey),
  write: (value) => AsyncStorage.setItem(indexKey, value),
}, secureSessionVault, plannerClient);
