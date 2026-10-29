import config from './native-contract-config.json';
export const { servers, webOrigin, password } = config;
export const nativeAccounts = config.nativeAccounts.map(({ serverIndex, ...account }) => ({ ...account, server: servers[serverIndex] }));
