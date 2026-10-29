import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { nativePushConfig } from '../build/native-push-config';

const base = { name: 'Test', slug: 'test', android: { package: 'software.example.mobile' }, plugins: ['expo-secure-store'] };
test('native notification config excludes gateway provider credentials', () => {
  const configuration = nativePushConfig(base, { APNS_KEY_FILE: '/not-a-client-key.p8', FCM_SERVICE_ACCOUNT_FILE: '/not-a-client-account.json', ITSAPLAN_API_KEY: 'fixture-never-embed' });
  assert.equal(configuration.android?.googleServicesFile, undefined);
  assert.ok(!JSON.stringify(configuration).includes('fixture-never-embed'));
  assert.deepEqual(configuration.plugins?.[1], ['expo-notifications', { mode: 'development', enableRemoteNotifications: true, enableBackgroundRemoteNotifications: false, defaultChannel: 'default', color: '#315B40' }]);
  assert.throws(() => nativePushConfig(base, { MOBILE_APNS_ENVIRONMENT: 'invalid' }));
});

test('Firebase client must match application ID; provider account and file details stay out of errors', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ipm-client-config-'));
  const path = join(directory, 'google-services.json');
  try {
    for (const fixture of [{ type: 'service_account', private_key: 'fixture-not-a-real-key' },
      { project_info: { project_id: 'fixture' }, client: [{ client_info: { android_client_info: { package_name: 'other.app' } } }] }]) {
      writeFileSync(path, JSON.stringify(fixture));
      assert.throws(() => nativePushConfig(base, { GOOGLE_SERVICES_FILE: path }), error => {
        assert.ok(error instanceof Error && !error.message.includes(directory) && !error.message.includes('fixture-not-a-real-key'));
        return true;
      });
    }
    writeFileSync(path, JSON.stringify({ project_info: { project_id: 'fixture' }, client: [{ client_info: { android_client_info: { package_name: base.android.package } } }] }));
    const config = nativePushConfig(base, { GOOGLE_SERVICES_FILE: path, MOBILE_APNS_ENVIRONMENT: 'production' });
    assert.equal(config.android?.googleServicesFile, path);
    assert.equal((config.plugins?.[1] as [string, { mode: string }])[1].mode, 'production');
    assert.equal(base.android.package, 'software.example.mobile');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
