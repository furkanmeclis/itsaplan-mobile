"""Simulator-only signing and bounded startup diagnostics; no Apple identity."""
import plistlib
import re
import subprocess
import time
from pathlib import Path


def verify_simulator_test_app(app):
    app = Path(app).resolve()
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    bundle = info['CFBundleIdentifier']
    if not bundle.endswith(('.contracttest', '.fonttest')):
        raise AssertionError('Refusing simulator contract execution for a pilot application')
    executable = app / info['CFBundleExecutable']
    if not executable.is_file():
        raise AssertionError('Simulator test executable is missing')
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True, capture_output=True)
    sections = subprocess.check_output(['xcrun', 'otool', '-l', str(executable)], text=True)
    if '__entitlements' not in sections and '__ents_der' not in sections:
        raise AssertionError('Xcode did not embed simulator-specific Keychain entitlements')


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
