import type { ConfigContext, ExpoConfig } from 'expo/config';
import { nativePushConfig } from './build/native-push-config.ts';

export default ({ config }: ConfigContext): ExpoConfig => {
  if (!config.name || !config.slug) throw new Error('Application name and slug are required.');
  return nativePushConfig({ ...config, name: config.name, slug: config.slug }, process.env);
};
