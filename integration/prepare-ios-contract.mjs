import { createRequire } from 'node:module';
import { readFile, writeFile, appendFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const require = createRequire(import.meta.url);
const { IOSConfig } = require('expo/config-plugins');

async function main() {
  const kind = process.argv[2];
  if (!['contract', 'font'].includes(kind)) throw new Error('Expected a simulator-only contract/font build');
  const root = resolve(process.argv[3] ?? process.cwd());
  await access(join(root, 'dist/native/itsaplan-ios-simulator.zip'));
  const base = JSON.parse(await readFile(join(root, 'app.json'), 'utf8')).expo.ios.bundleIdentifier;
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{1,140}$/.test(base) || /\.(?:contracttest|fonttest)$/.test(base)) throw new Error('Invalid pilot application identifier');
  const bundle = `${base}.${kind === 'contract' ? 'contracttest' : 'fonttest'}`;
  const entry = kind === 'contract' ? 'native-contract-entry.tsx' : 'font-scale-entry.tsx';
  await access(join(root, 'integration', entry));
  const project = IOSConfig.XcodeUtils.getPbxproj(root);
  const target = project.getTarget('com.apple.product-type.application');
  if (!target) throw new Error('Application target missing');
  const [, configuration] = IOSConfig.XcodeUtils.getBuildConfigurationForListIdAndName(project, {
    configurationListId: target.target.buildConfigurationList, buildConfiguration: 'Release',
  });
  const entitlements = join(root, 'ios', `.ipm-${kind}.entitlements`);
  await writeFile(entitlements, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>application-identifier</key><string>${bundle}</string>
<key>keychain-access-groups</key><array><string>${bundle}</string></array>
</dict></plist>\n`, { mode: 0o600 });
  Object.assign(configuration.buildSettings, {
    PRODUCT_BUNDLE_IDENTIFIER: JSON.stringify(bundle), CODE_SIGN_ENTITLEMENTS: JSON.stringify(entitlements),
    CODE_SIGNING_ALLOWED: 'YES', CODE_SIGNING_REQUIRED: 'YES', CODE_SIGN_IDENTITY: '"-"',
    AD_HOC_CODE_SIGNING_ALLOWED: 'YES', CODE_SIGN_INJECT_BASE_ENTITLEMENTS: 'YES',
    CODE_SIGN_STYLE: 'Manual', DEVELOPMENT_TEAM: '""', PROVISIONING_PROFILE_SPECIFIER: '""',
  });
  await writeFile(project.filepath, project.writeSync());
  // Static entry names; Xcode supplies PROJECT_DIR. No shell interpolation of paths.
  await appendFile(join(root, 'ios/.xcode.env.local'), `\nexport ENTRY_FILE="$PROJECT_DIR/../integration/${entry}"\n`);
  console.log('Simulator-only Release target prepared; Xcode will generate simulated entitlements and its local signature.');
}
main().catch(() => { console.error('Simulator-only Xcode target preparation failed.'); process.exitCode = 1; });
