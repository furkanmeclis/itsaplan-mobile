"""Execute the shared native account contract on a newly created iOS simulator.

Only the two public contract status/report keys are exported from AsyncStorage.
The Keychain and account index are never read by this driver.
"""
import hashlib
import json
import plistlib
import subprocess
import sys
import time
import uuid
from pathlib import Path

PHASE = 'itsaplan.native-contract.phase.v1'
REPORT = 'itsaplan.native-contract.report.v1'
OUTPUT = Path('test-results/ios-native-contract')


def command(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def stored_value(directory, key):
    if key not in [PHASE, REPORT]:
        raise AssertionError('Only public contract keys may be read')
    try:
        manifest = json.loads((directory / 'manifest.json').read_text())
        if key not in manifest:
            return None
        value = manifest[key]
        if value is None:
            value = (directory / hashlib.md5(key.encode()).hexdigest()).read_text()
        if not isinstance(value, str) or len(value) > 12000:
            raise AssertionError('Invalid contract status value')
        return value
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def validated_report(raw):
    report = json.loads(raw)
    fields = {'formatVersion', 'platform', 'nativeTransport', 'secureStorage', 'nativeAuthentication',
              'physicalDevice', 'providerDelivery', 'checks'}
    if set(report) != fields or report['formatVersion'] != 1 or report['platform'] != 'ios':
        raise AssertionError('Unexpected iOS native report schema')
    if report['nativeTransport'] != 'expo/fetch' or report['secureStorage'] != 'expo-secure-store':
        raise AssertionError('Native adapters were not exercised')
    if report['nativeAuthentication'] is not True or report['physicalDevice'] is not False or report['providerDelivery'] is not False:
        raise AssertionError('Native evidence scope mismatch')
    if not isinstance(report['checks'], list) or len(report['checks']) != 8 or any(not isinstance(c, str) or len(c) > 200 for c in report['checks']):
        raise AssertionError('Incomplete native account checks')
    if any(term in raw.lower() for term in ['session_token=', '"password":', '"cookie":', '"token":']):
        raise AssertionError('Sensitive material is not permitted in native evidence')
    return report


def await_value(directory, key, expected=None, timeout=180):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = stored_value(directory, key)
        if value is not None and (expected is None or value == expected):
            return value
        time.sleep(2)
    raise AssertionError('Native iOS phase timed out; inspect scoped simulator screenshot')


def main(app, fixture_file):
    fixture = json.loads(Path(fixture_file).read_text())
    if fixture.get('ready') is not True:
        raise AssertionError('Disposable native fixtures are not ready')
    app = Path(app).resolve()
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    bundle = info['CFBundleIdentifier']
    if not bundle.endswith('.contracttest'):
        raise AssertionError('Refusing to drive a pilot app as a contract test')
    if b'NATIVE_CONTRACT_STORAGE_READY' not in (app / 'main.jsbundle').read_bytes():
        raise AssertionError('Contract bundle is not embedded')
    devices = json.loads(command('xcrun', 'simctl', 'list', 'devicetypes', '--json'))['devicetypes']
    model = next(d['identifier'] for d in devices if d['name'].startswith('iPhone 17') and 'Pro' not in d['name'])
    runtimes = json.loads(command('xcrun', 'simctl', 'list', 'runtimes', '--json'))['runtimes']
    runtime = next(r['identifier'] for r in reversed(runtimes) if r['isAvailable'] and '.iOS-' in r['identifier'])
    # A new simulator is the sole trust/data boundary. Never target a user's booted device.
    simulator = command('xcrun', 'simctl', 'create', 'IPM-contract-' + uuid.uuid4().hex[:8], model, runtime)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    result = {'status': 'failed', 'physicalDevice': False, 'providerDelivery': False,
              'testApplicationId': bundle, 'productUiInteraction': False}
    try:
        command('xcrun', 'simctl', 'boot', simulator)
        command('xcrun', 'simctl', 'bootstatus', simulator, '-b')
        command('xcrun', 'simctl', 'keychain', simulator, 'add-root-cert', fixture['certificate'])
        command('xcrun', 'simctl', 'install', simulator, str(app))
        command('xcrun', 'simctl', 'launch', simulator, bundle)
        container = Path(command('xcrun', 'simctl', 'get_app_container', simulator, bundle, 'data')).resolve()
        directory = container / 'Library/Application Support' / bundle / 'RCTAsyncLocalStorage_V1'
        await_value(directory, PHASE, 'stored')
        command('xcrun', 'simctl', 'io', simulator, 'screenshot', str(OUTPUT / '01-sessions-stored.png'))
        command('xcrun', 'simctl', 'terminate', simulator, bundle)
        command('xcrun', 'simctl', 'launch', simulator, bundle)
        raw = await_value(directory, REPORT)
        result.update(validated_report(raw))
        await_value(directory, PHASE, 'interactive')
        command('xcrun', 'simctl', 'io', simulator, 'screenshot', str(OUTPUT / '02-native-session-contract.png'))
        # Launch the actual product app after contract completion; this screenshot
        # is an observation, not an assertion of UI interaction/accessibility.
        command('xcrun', 'simctl', 'terminate', simulator, bundle)
        command('xcrun', 'simctl', 'launch', simulator, bundle)
        time.sleep(5)
        command('xcrun', 'simctl', 'io', simulator, 'screenshot', str(OUTPUT / '03-product-app-observation.png'))
        result['status'] = 'passed'
    finally:
        if result['status'] != 'passed':
            try:
                command('xcrun', 'simctl', 'io', simulator, 'screenshot', str(OUTPUT / 'failure.png'))
            except subprocess.SubprocessError:
                pass
        (OUTPUT / 'report.json').write_text(json.dumps(result, indent=2) + '\n')
        subprocess.run(['xcrun', 'simctl', 'shutdown', simulator], capture_output=True)
        subprocess.run(['xcrun', 'simctl', 'delete', simulator], capture_output=True)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
