"""Guard the pilot/test boundary in generated Xcode configuration."""
import json
import plistlib
import subprocess
import tempfile
import unittest
from pathlib import Path

PREPARE = Path(__file__).with_name('prepare-ios-contract.mjs').resolve()
REPOSITORY = PREPARE.parent.parent
PROJECT = '''// !$*UTF8*$!
{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {
/* Begin PBXNativeTarget section */
BBBBBBBBBBBBBBBBBBBBBBBB = { isa = PBXNativeTarget; name = Fixture; productName = Fixture; productType = "com.apple.product-type.application"; buildConfigurationList = DDDDDDDDDDDDDDDDDDDDDDDD; };
CCCCCCCCCCCCCCCCCCCCCCCC = { isa = PBXNativeTarget; name = Framework; productType = "com.apple.product-type.framework"; buildConfigurationList = EEEEEEEEEEEEEEEEEEEEEEEE; };
/* End PBXNativeTarget section */
/* Begin PBXProject section */
AAAAAAAAAAAAAAAAAAAAAAAA = { isa = PBXProject; targets = (BBBBBBBBBBBBBBBBBBBBBBBB /* Fixture */, CCCCCCCCCCCCCCCCCCCCCCCC /* Framework */); buildConfigurationList = FFFFFFFFFFFFFFFFFFFFFFFF; };
/* End PBXProject section */
/* Begin XCBuildConfiguration section */
A11111111111111111111111 = { isa = XCBuildConfiguration; name = Debug; buildSettings = { PRODUCT_BUNDLE_IDENTIFIER = software.example.mobile; CODE_SIGNING_ALLOWED = NO; }; };
A22222222222222222222222 = { isa = XCBuildConfiguration; name = Release; buildSettings = { PRODUCT_BUNDLE_IDENTIFIER = software.example.mobile; CODE_SIGNING_ALLOWED = NO; }; };
A33333333333333333333333 = { isa = XCBuildConfiguration; name = Release; buildSettings = { PRODUCT_BUNDLE_IDENTIFIER = software.example.framework; CODE_SIGNING_ALLOWED = NO; }; };
A44444444444444444444444 = { isa = XCBuildConfiguration; name = Release; buildSettings = { CODE_SIGNING_ALLOWED = NO; }; };
/* End XCBuildConfiguration section */
/* Begin XCConfigurationList section */
DDDDDDDDDDDDDDDDDDDDDDDD = { isa = XCConfigurationList; buildConfigurations = (A11111111111111111111111 /* Debug */, A22222222222222222222222 /* Release */); };
EEEEEEEEEEEEEEEEEEEEEEEE = { isa = XCConfigurationList; buildConfigurations = (A33333333333333333333333 /* Release */); };
FFFFFFFFFFFFFFFFFFFFFFFF = { isa = XCConfigurationList; buildConfigurations = (A44444444444444444444444 /* Release */); };
/* End XCConfigurationList section */
}; rootObject = AAAAAAAAAAAAAAAAAAAAAAAA; }
'''


class SimulatorSigningBoundary(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'ios/Fixture.xcodeproj').mkdir(parents=True)
        self.project = self.root / 'ios/Fixture.xcodeproj/project.pbxproj'
        self.project.write_text(PROJECT)
        (self.root / 'integration').mkdir()
        for entry in ['native-contract-entry.tsx', 'font-scale-entry.tsx']:
            (self.root / 'integration' / entry).write_text('// disposable test entry')
        (self.root / 'app.json').write_text(json.dumps({'expo': {'ios': {'bundleIdentifier': 'software.example.mobile'}}}))
        (self.root / 'dist/native').mkdir(parents=True)
        self.pilot = self.root / 'dist/native/itsaplan-ios-simulator.zip'
        self.pilot.write_bytes(b'preserved pilot artifact')

    def prepare(self, kind):
        return subprocess.run(['node', str(PREPARE), kind, str(self.root)], capture_output=True)

    def test_only_application_release_gets_simulated_keychain_settings(self):
        result = self.prepare('contract')
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        script = "const p=require('expo/config-plugins').IOSConfig.XcodeUtils.getPbxproj(process.argv[1]); console.log(JSON.stringify(p.pbxXCBuildConfigurationSection()));"
        data = json.loads(subprocess.check_output(['node', '-e', script, str(self.root)], cwd=REPOSITORY, text=True))
        debug = data['A11111111111111111111111']['buildSettings']
        release = data['A22222222222222222222222']['buildSettings']
        framework = data['A33333333333333333333333']['buildSettings']
        self.assertEqual(debug['PRODUCT_BUNDLE_IDENTIFIER'], 'software.example.mobile')
        self.assertEqual(debug['CODE_SIGNING_ALLOWED'], 'NO')
        self.assertEqual(framework['PRODUCT_BUNDLE_IDENTIFIER'], 'software.example.framework')
        self.assertEqual(framework['CODE_SIGNING_ALLOWED'], 'NO')
        self.assertEqual(release['PRODUCT_BUNDLE_IDENTIFIER'].strip('"'), 'software.example.mobile.contracttest')
        self.assertEqual(release['CODE_SIGNING_ALLOWED'], 'YES')
        self.assertEqual(release['CODE_SIGN_IDENTITY'].strip('"'), '-')
        entitlements = plistlib.loads((self.root / 'ios/.ipm-contract.entitlements').read_bytes())
        self.assertEqual(entitlements['application-identifier'], 'software.example.mobile.contracttest')
        self.assertEqual(entitlements['keychain-access-groups'], ['software.example.mobile.contracttest'])
        self.assertNotIn('com.apple.developer.team-identifier', entitlements)
        self.assertEqual(self.pilot.read_bytes(), b'preserved pilot artifact')
        self.assertIn('$PROJECT_DIR/../integration/native-contract-entry.tsx', (self.root / 'ios/.xcode.env.local').read_text())

    def test_missing_pilot_artifact_or_unknown_mode_cannot_modify_generated_project(self):
        self.pilot.unlink()
        self.assertNotEqual(self.prepare('contract').returncode, 0)
        self.assertNotEqual(self.prepare('production').returncode, 0)
        self.assertEqual(self.project.read_text(), PROJECT)
