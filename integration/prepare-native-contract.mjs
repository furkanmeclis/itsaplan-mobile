import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash, X509Certificate } from 'node:crypto';

async function main() {
  const fixtureFile = resolve(process.argv[2]);
  const root = resolve(process.argv[3] ?? process.cwd());
  const fixture = JSON.parse(await readFile(fixtureFile, 'utf8'));
  if (fixture.ready !== true) throw new Error('Native fixtures are not ready');
  const app = JSON.parse(await readFile(join(root, 'app.json'), 'utf8'));
  const originalId = app.expo.android.package;
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(originalId)) throw new Error('Invalid application identifier');
  const certificateBytes = await readFile(fixture.certificate);
  if (!/^-----BEGIN CERTIFICATE-----[\r\n]+[A-Za-z0-9+/=\r\n]+[\r\n]+-----END CERTIFICATE-----$/.test(certificateBytes.toString('ascii').trim())) throw new Error('Expected one public test certificate');
  const certificate = new X509Certificate(certificateBytes);
  if (!certificate.ca || !certificate.checkHost('localhost') || !certificate.verify(certificate.publicKey) || Date.parse(certificate.validTo) <= Date.now()) throw new Error('Invalid localhost test CA');
  const appRoot = join(root, 'android/app');
  const gradleFile = join(appRoot, 'build.gradle');
  const gradle = await readFile(gradleFile, 'utf8');
  if (gradle.includes('IPM_NATIVE_CONTRACT_ONLY')) throw new Error('Contract build was already prepared');
  await access(join(appRoot, 'src/main/AndroidManifest.xml'));
  const pilotApk = join(appRoot, 'build/outputs/apk/release/app-release.apk');
  const pilotBytes = await readFile(pilotApk);
  const pilotCopy = join(dirname(fixtureFile), 'pilot.apk');
  await copyFile(pilotApk, pilotCopy);
  const raw = join(appRoot, 'src/main/res/raw');
  const xml = join(appRoot, 'src/main/res/xml');
  const overlay = join(appRoot, 'src/release');
  for (const path of [raw, xml, overlay]) await mkdir(path, { recursive: true });
  await writeFile(join(raw, 'ipm_ci_ca.pem'), certificateBytes, { flag: 'wx' });
  await writeFile(join(xml, 'ipm_ci_network_security.xml'), `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors><certificates src="system" /></trust-anchors>
  </base-config>
  <domain-config cleartextTrafficPermitted="false">
    <domain includeSubdomains="false">localhost</domain>
    <trust-anchors><certificates src="@raw/ipm_ci_ca" /></trust-anchors>
  </domain-config>
</network-security-config>
`, { flag: 'wx' });
  await writeFile(join(overlay, 'AndroidManifest.xml'), `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:testOnly="true" android:networkSecurityConfig="@xml/ipm_ci_network_security" />
</manifest>
`, { flag: 'wx' });
  const applicationId = `${originalId}.contracttest`;
  await writeFile(gradleFile, `${gradle}
// IPM_NATIVE_CONTRACT_ONLY
react { entryFile = file("../../integration/native-contract-entry.tsx") }
android { defaultConfig { applicationId "${applicationId}" } }
`);
  const metadata = { formatVersion: 1, kind: 'CI contract test only', applicationId,
    activity: `${originalId}.MainActivity`, pilotApplicationId: originalId, pilotApk: pilotCopy,
    pilotApkSha256: createHash('sha256').update(pilotBytes).digest('hex'),
    testCaSha256: createHash('sha256').update(certificateBytes).digest('hex'),
    sourceCommit: process.env.GITHUB_SHA ?? 'local-draft' };
  await writeFile(join(dirname(fixtureFile), 'build.json'), JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600 });
  console.log('Isolated localhost-only contract build prepared after preserving the pilot APK.');
}

main().catch(() => { console.error('Native contract build preparation failed.'); process.exitCode = 1; });
