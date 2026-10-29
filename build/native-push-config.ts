import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExpoConfig } from 'expo/config';
import { sakinTheme } from '../src/theme.ts';

type Environment = Record<string, string | undefined>;

/** Build-time client settings only. Provider private keys belong to the gateway. */
export function nativePushConfig(config: ExpoConfig, environment: Environment): ExpoConfig {
  const mode = environment.MOBILE_APNS_ENVIRONMENT ?? 'development';
  if (mode !== 'development' && mode !== 'production') throw new Error('MOBILE_APNS_ENVIRONMENT must be development or production.');
  const output: ExpoConfig = { ...config, plugins: [...(config.plugins ?? []), ['expo-notifications', {
    mode, enableRemoteNotifications: true, enableBackgroundRemoteNotifications: false,
    defaultChannel: 'default', color: sakinTheme.colors.primary,
  }]] };
  const configuredFile = environment.GOOGLE_SERVICES_FILE;
  if (configuredFile) {
    const path = resolve(configuredFile);
    try {
      if (!statSync(path).isFile() || statSync(path).size > 1024 * 1024) throw new Error();
      const firebase = JSON.parse(readFileSync(path, 'utf8'));
      if (typeof firebase.project_info?.project_id !== 'string' || !Array.isArray(firebase.client) ||
          !firebase.client.some((client: { client_info?: { android_client_info?: { package_name?: string } } }) =>
            client.client_info?.android_client_info?.package_name === config.android?.package)) throw new Error();
    } catch { throw new Error('Invalid Firebase Android client configuration; provide google-services.json for this application ID.'); }
    output.android = { ...config.android, googleServicesFile: path };
  }
  return output;
}
