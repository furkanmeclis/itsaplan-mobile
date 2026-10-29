"""Simulator-only signing; no Apple identity or provider credentials are used."""
import plistlib
import subprocess
import tempfile
from pathlib import Path


def sign_simulator_test_app(app):
    app = Path(app).resolve()
    bundle = plistlib.loads((app / 'Info.plist').read_bytes())['CFBundleIdentifier']
    if not bundle.endswith(('.contracttest', '.fonttest')):
        raise AssertionError('Refusing CI simulator signing for a pilot application')
    # A disposable simulator accepts an ad-hoc signature. SecureStore still needs
    # an application identity/keychain group, which CODE_SIGNING_ALLOWED=NO omits.
    team = 'IPMTEST001'
    identifier = team + '.' + bundle
    entitlements = {'application-identifier': identifier, 'com.apple.developer.team-identifier': team,
                    'keychain-access-groups': [identifier]}
    with tempfile.TemporaryDirectory(prefix='ipm-sim-sign-') as temporary:
        file = Path(temporary) / 'entitlements.plist'
        file.write_bytes(plistlib.dumps(entitlements))
        file.chmod(0o600)
        subprocess.run(['codesign', '--force', '--deep', '--sign', '-', str(app)], check=True, capture_output=True)
        subprocess.run(['codesign', '--force', '--sign', '-', '--entitlements', str(file), str(app)], check=True, capture_output=True)
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True, capture_output=True)
