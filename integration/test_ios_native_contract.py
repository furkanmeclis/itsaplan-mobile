"""Regressions for scoped iOS report extraction; no device or credentials needed."""
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('ios_contract', Path(__file__).with_name('ios-native-contract.py'))
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)


class IosEvidenceBoundary(unittest.TestCase):
    def test_large_report_uses_async_storage_spill_file_and_index_is_not_exported(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'manifest.json').write_text(json.dumps({contract.PHASE: 'stored', contract.REPORT: None,
                                                         'private-account-index': 'must-not-be-exported'}))
            public_report = '{"publicReport":"' + 'x' * 1100 + '"}'
            (root / hashlib.md5(contract.REPORT.encode()).hexdigest()).write_text(public_report)
            self.assertEqual(contract.stored_value(root, contract.PHASE), 'stored')
            self.assertEqual(contract.stored_value(root, contract.REPORT), public_report)
            with self.assertRaises(AssertionError):
                contract.stored_value(root, 'private-account-index')

    def test_android_or_physical_delivery_claims_are_rejected(self):
        report = {'formatVersion': 1, 'platform': 'ios', 'nativeTransport': 'expo/fetch',
                  'secureStorage': 'expo-secure-store', 'nativeAuthentication': True,
                  'physicalDevice': False, 'providerDelivery': False, 'checks': ['safe native check'] * 8}
        self.assertEqual(contract.validated_report(json.dumps(report)), report)
        for key, value in [('platform', 'android'), ('physicalDevice', True), ('providerDelivery', True),
                           ('nativeAuthentication', False), ('cookie', 'not-a-real-secret')]:
            with self.subTest(key=key), self.assertRaises(AssertionError):
                contract.validated_report(json.dumps({**report, key: value}))
