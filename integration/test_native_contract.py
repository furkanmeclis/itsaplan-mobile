"""Check test-only TLS/material isolation before native build jobs."""
import hashlib
import importlib.util
import json
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile
from unittest.mock import patch
from pathlib import Path

PREPARE = Path(__file__).with_name("prepare-native-contract.mjs").resolve()


class IsolatedContractBuild(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.certificates = tempfile.TemporaryDirectory()
        cls.certificate = Path(cls.certificates.name) / "cert.pem"
        cls.key = Path(cls.certificates.name) / "key.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(cls.key),
                        "-out", str(cls.certificate), "-days", "1", "-subj", "/CN=localhost", "-addext",
                        "subjectAltName=DNS:localhost,IP:127.0.0.1"], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.certificates.cleanup()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        app = self.root / "android/app"
        (app / "src/main").mkdir(parents=True)
        (app / "src/main/AndroidManifest.xml").write_text('<manifest><application/></manifest>')
        (app / "build.gradle").write_text("// generated pilot project\n")
        (app / "build/outputs/apk/release").mkdir(parents=True)
        self.pilot = app / "build/outputs/apk/release/app-release.apk"
        with zipfile.ZipFile(self.pilot, "w") as archive:
            archive.writestr("assets/index.android.bundle", b"pilot entry only")
        (self.root / "app.json").write_text(json.dumps({"expo": {"android": {"package": "software.example.mobile"}}}))
        self.fixture = self.root / "state.json"

    def prepare(self, certificate):
        self.fixture.write_text(json.dumps({"ready": True, "certificate": str(certificate)}))
        return subprocess.run(["node", str(PREPARE), str(self.fixture), str(self.root)], capture_output=True)

    def test_public_certificate_is_localhost_only_and_pilot_bytes_remain_unchanged(self):
        before = self.pilot.read_bytes()
        result = self.prepare(self.certificate)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        metadata = json.loads((self.root / "build.json").read_text())
        self.assertEqual(metadata["applicationId"], "software.example.mobile.contracttest")
        self.assertEqual(hashlib.sha256(before).hexdigest(), metadata["pilotApkSha256"])
        self.assertEqual(Path(metadata["pilotApk"]).read_bytes(), before)
        self.assertEqual(self.pilot.read_bytes(), before)
        policy = ET.parse(self.root / "android/app/src/main/res/xml/ipm_ci_network_security.xml").getroot()
        self.assertEqual([node.text for node in policy.iter("domain")], ["localhost"])
        self.assertEqual(policy.find("base-config").get("cleartextTrafficPermitted"), "false")
        manifest = ET.parse(self.root / "android/app/src/release/AndroidManifest.xml").getroot()
        self.assertEqual(manifest.find("application").get("{http://schemas.android.com/apk/res/android}testOnly"), "true")

    def test_private_key_and_certificate_with_appended_private_key_cannot_enter_apk(self):
        combined = self.root / "combined.pem"
        combined.write_bytes(self.certificate.read_bytes() + self.key.read_bytes())
        for material in [self.key, combined]:
            with self.subTest(material=material.name):
                result = self.prepare(material)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn(b"BEGIN PRIVATE KEY", result.stdout + result.stderr)
                self.assertFalse((self.root / "android/app/src/main/res/raw/ipm_ci_ca.pem").exists())
        self.assertEqual((self.root / "android/app/build.gradle").read_text(), "// generated pilot project\n")


class OptimizedResourceBoundary(unittest.TestCase):
    def test_renamed_certificate_is_found_by_bytes_and_tampered_material_is_not(self):
        spec = importlib.util.spec_from_file_location('artifact_boundary', Path(__file__).with_name('check-native-artifacts.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temporary:
            apk = Path(temporary) / 'optimized.apk'
            certificate = b'public disposable test certificate fixture'
            digest = hashlib.sha256(certificate).hexdigest()
            with zipfile.ZipFile(apk, 'w') as archive:
                archive.writestr('res/Ab.pem', certificate)
                archive.writestr('res/raw/ipm_ci_ca.pem', b'different certificate')
            with zipfile.ZipFile(apk) as archive:
                self.assertEqual(module.matching_resources(archive, digest), ['res/Ab.pem'])
                self.assertEqual(module.matching_resources(archive, hashlib.sha256(b'tampered').hexdigest()), [])


class FixtureCredentialBoundary(unittest.TestCase):
    def test_operator_and_provider_configuration_are_removed_without_changing_proxy_or_parent(self):
        module = Path(__file__).with_name("fixture-environment.mjs").resolve().as_uri()
        script = """
import assert from 'node:assert/strict';
const { fixtureEnvironment, assertNoOperatorCredentials } = await import(process.argv[1]);
const original = { ITSAPLAN_API_KEY:'test-only-value', APNS_KEY_FILE:'/test-only/key',
  DATABASE_URL:'postgres://not-a-fixture', HTTP_PROXY:'http://proxy:8080', NODE_EXTRA_CA_CERTS:'/test-only/public-ca' };
const child = fixtureEnvironment(original);
assertNoOperatorCredentials(child);
assert.equal(child.DATABASE_URL, undefined);
assert.equal(child.HTTP_PROXY, original.HTTP_PROXY);
assert.equal(child.NODE_EXTRA_CA_CERTS, original.NODE_EXTRA_CA_CERTS);
assert.equal(original.ITSAPLAN_API_KEY, 'test-only-value');
assert.throws(() => assertNoOperatorCredentials(original));
"""
        result = subprocess.run(["node", "--input-type=module", "-e", script, module], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())


if __name__ == "__main__":
    unittest.main()


class FocusedKeyboardField(unittest.TestCase):
    def test_observed_clipped_password_field_is_not_treated_as_fully_visible(self):
        spec = importlib.util.spec_from_file_location('native_driver', Path(__file__).with_name('android-native-contract.py'))
        driver = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(driver)
        clipped = ET.fromstring('<hierarchy><node class="android.widget.EditText" focused="true" bounds="[61,325][259,357]"/></hierarchy>')
        complete = ET.fromstring('<hierarchy><node class="android.widget.EditText" focused="true" bounds="[61,325][259,373]"/></hierarchy>')
        with patch.object(driver.smoke, 'keyboard_frame', return_value=(0,381,320,640)):
            self.assertFalse(driver.focused_field_is_visible(clipped, 48))
            self.assertTrue(driver.focused_field_is_visible(complete, 48))
