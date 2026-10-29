import type { ConfigContext, ExpoConfig } from 'expo/config';
import { nativePushConfig } from './build/native-push-config.ts';
import { sourceRevision } from './src/domain/source.ts';

export default ({ config }: ConfigContext): ExpoConfig => {
  if (!config.name || !config.slug) throw new Error('Application name and slug are required.');
  const revision = sourceRevision(process.env.GITHUB_SHA);
  const extra: Record<string, unknown> = { ...config.extra };
  delete extra.sourceRevision;
  if (revision) extra.sourceRevision = revision;
  return nativePushConfig({ ...config, name: config.name, slug: config.slug, extra }, process.env);
};
