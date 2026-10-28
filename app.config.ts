import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'It’s a Plan', slug: config.slug ?? 'itsaplan-mobile',
  android: { ...config.android, ...(process.env.GOOGLE_SERVICES_FILE ? { googleServicesFile: process.env.GOOGLE_SERVICES_FILE } : {}) },
  plugins: [...(config.plugins ?? []), ['expo-notifications', { defaultChannel: 'default', enableRemoteNotifications: true }]],
});
