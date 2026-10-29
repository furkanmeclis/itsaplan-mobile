import plistlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from ios_simulator import sign_simulator_test_app


class SimulatorSigningBoundary(unittest.TestCase):
    def test_only_test_apps_receive_an_ad_hoc_keychain_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            app = Path(temporary) / 'test.app'
            app.mkdir()
            info = app / 'Info.plist'
            info.write_bytes(plistlib.dumps({'CFBundleIdentifier': 'software.example.mobile'}))
            with patch('ios_simulator.subprocess.run') as run:
                with self.assertRaises(AssertionError):
                    sign_simulator_test_app(app)
                run.assert_not_called()
            info.write_bytes(plistlib.dumps({'CFBundleIdentifier': 'software.example.mobile.contracttest'}))
            entitlements = []
            def signing(args, **kwargs):
                if '--entitlements' in args:
                    file = Path(args[args.index('--entitlements') + 1])
                    entitlements.append(plistlib.loads(file.read_bytes()))
                self.assertNotIn('--keychain', args)
            with patch('ios_simulator.subprocess.run', side_effect=signing) as run:
                sign_simulator_test_app(app)
                self.assertEqual(run.call_count, 3)
            identity = 'IPMTEST001.software.example.mobile.contracttest'
            self.assertEqual(entitlements[0]['application-identifier'], identity)
            self.assertEqual(entitlements[0]['keychain-access-groups'], [identity])
