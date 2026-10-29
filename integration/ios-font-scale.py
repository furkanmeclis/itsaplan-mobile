"""Measure the shared universal Text in a disposable iOS simulator."""
import json
import plistlib
import subprocess
import sys
import time
import uuid
from pathlib import Path
from ios_simulator import sign_simulator_test_app

OUTPUT = Path('test-results/ios-font-scale')
KEY = 'itsaplan.font-probe.v1'


def command(*args):
    return subprocess.check_output(args, text=True).strip()


def measurement(storage, large):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            manifest = json.loads((storage / 'manifest.json').read_text())
            value = json.loads(manifest[KEY])
            if set(value) != {'marker', 'platform', 'fontScale', 'width', 'height'} or value['marker'] != 'IPM_FONT_PROBE' or value['platform'] != 'ios':
                raise AssertionError('Unexpected public font measurement')
            if all(type(value[k]) in [int, float] and value[k] > 0 for k in ['fontScale', 'width', 'height']):
                if (large and value['fontScale'] > 1.5) or (not large and 0.99 <= value['fontScale'] <= 1.01):
                    return value
        except (FileNotFoundError, KeyError, TypeError, json.JSONDecodeError):
            pass
        time.sleep(2)
    raise AssertionError('Native text measurement did not reflect the requested content size')


def main(app):
    app = Path(app).resolve()
    bundle = plistlib.loads((app / 'Info.plist').read_bytes())['CFBundleIdentifier']
    if not bundle.endswith('.fonttest') or b'IPM_FONT_PROBE' not in (app / 'main.jsbundle').read_bytes():
        raise AssertionError('Font probe requires its isolated test application')
    types = json.loads(command('xcrun', 'simctl', 'list', 'devicetypes', '--json'))['devicetypes']
    model = next(d['identifier'] for d in types if d['name'].startswith('iPhone 17') and 'Pro' not in d['name'])
    runtimes = json.loads(command('xcrun', 'simctl', 'list', 'runtimes', '--json'))['runtimes']
    runtime = next(r['identifier'] for r in reversed(runtimes) if r['isAvailable'] and '.iOS-' in r['identifier'])
    sign_simulator_test_app(app)
    simulator = command('xcrun', 'simctl', 'create', 'IPM-font-' + uuid.uuid4().hex[:8], model, runtime)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {'status': 'failed', 'physicalDevice': False, 'screenReaderTested': False, 'fullScreenLayoutTested': False}
    try:
        command('xcrun', 'simctl', 'boot', simulator)
        command('xcrun', 'simctl', 'bootstatus', simulator, '-b')
        command('xcrun', 'simctl', 'install', simulator, str(app))
        command('xcrun', 'simctl', 'ui', simulator, 'content_size', 'large')
        command('xcrun', 'simctl', 'launch', simulator, bundle)
        container = Path(command('xcrun', 'simctl', 'get_app_container', simulator, bundle, 'data'))
        storage = container / 'Library/Application Support' / bundle / 'RCTAsyncLocalStorage_V1'
        normal = measurement(storage, False)
        command('xcrun', 'simctl', 'io', simulator, 'screenshot', str(OUTPUT / '01-normal.png'))
        command('xcrun', 'simctl', 'terminate', simulator, bundle)
        command('xcrun', 'simctl', 'ui', simulator, 'content_size', 'accessibility-extra-extra-extra-large')
        command('xcrun', 'simctl', 'launch', simulator, bundle)
        large = measurement(storage, True)
        if large['width'] <= normal['width'] or large['height'] <= normal['height']:
            raise AssertionError('Shared universal text did not grow in both native dimensions')
        command('xcrun', 'simctl', 'io', simulator, 'screenshot', str(OUTPUT / '02-accessibility-maximum.png'))
        report.update(status='passed', normal=normal, accessibilityMaximum=large)
    finally:
        if report['status'] != 'passed':
            subprocess.run(['xcrun', 'simctl', 'io', simulator, 'screenshot', str(OUTPUT / 'failure.png')], capture_output=True)
        (OUTPUT / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        subprocess.run(['xcrun', 'simctl', 'shutdown', simulator], capture_output=True)
        subprocess.run(['xcrun', 'simctl', 'delete', simulator], capture_output=True)


if __name__ == '__main__':
    main(sys.argv[1])
