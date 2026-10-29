"""Simulator-only signing and bounded startup diagnostics; no Apple identity."""
import plistlib
import re
import subprocess
import tempfile
import time
from pathlib import Path


def sign_simulator_test_app(app):
    app = Path(app).resolve()
    bundle = plistlib.loads((app / 'Info.plist').read_bytes())['CFBundleIdentifier']
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{1,150}', bundle) or not bundle.endswith(('.contracttest', '.fonttest')):
        raise AssertionError('Refusing CI simulator signing for a pilot application')
    # No pretend Developer Team: the ad-hoc simulator identity is the test bundle.
    # DER entitlements are required by modern simulator signature validation.
    entitlements = {'application-identifier': bundle, 'keychain-access-groups': [bundle], 'get-task-allow': True}
    with tempfile.TemporaryDirectory(prefix='ipm-sim-sign-') as temporary:
        file = Path(temporary) / 'entitlements.plist'
        file.write_bytes(plistlib.dumps(entitlements))
        file.chmod(0o600)
        subprocess.run(['codesign', '--force', '--deep', '--sign', '-', str(app)], check=True, capture_output=True)
        subprocess.run(['codesign', '--force', '--sign', '-', '--generate-entitlement-der', '--entitlements', str(file), str(app)], check=True, capture_output=True)
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True, capture_output=True)


def launch_simulator_app(simulator, bundle):
    for attempt in range(3):
        result = subprocess.run(['xcrun', 'simctl', 'launch', simulator, bundle], capture_output=True, text=True)
        if result.returncode == 0:
            return
        if attempt < 2:
            time.sleep(5)
    raise AssertionError('Simulator refused test application launch after bounded startup retries')


def capture_launch_diagnostics(simulator, bundle, output):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{1,150}', bundle):
        return
    # Only system launch/signature messages from this disposable simulator;
    # application/network logs and credential storage are never collected.
    predicate = '(process == "amfid" OR process == "runningboardd" OR process == "SpringBoard") AND '
    predicate += '(eventMessage CONTAINS[c] "' + bundle + '" OR eventMessage CONTAINS[c] "signature" OR eventMessage CONTAINS[c] "entitlement")'
    try:
        result = subprocess.run(['xcrun', 'simctl', 'spawn', simulator, 'log', 'show', '--last', '2m', '--style', 'compact', '--predicate', predicate],
                                capture_output=True, text=True, timeout=25)
        lines = [line[:500] for line in result.stdout.splitlines()[-100:]]
        (Path(output) / 'system-launch-diagnostics.txt').write_text('\n'.join(lines) + '\n')
    except subprocess.SubprocessError:
        pass
