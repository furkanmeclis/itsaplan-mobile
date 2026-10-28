"""Regression checks for stale UI evidence after a native restart."""
import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("android_ui_smoke", Path(__file__).with_name("android-ui-smoke.py"))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
OLD = b'<hierarchy><node text="Screen ready" bounds="[0,0][100,28]"/></hierarchy>'
FRESH = b'<hierarchy><node text="Screen ready" bounds="[0,0][100,36]"/></hierarchy>'


class VirtualDevice:
    def __init__(self, fresh_on=None, frames=None):
        self.files = {"/sdcard/ipm-window.xml": OLD}
        self.dumps = 0
        self.fresh_on = fresh_on
        self.frames = frames

    def adb(self, *args, **kwargs):
        if args[:3] == ("shell", "rm", "-f"):
            self.files.pop(args[3], None)
        elif args[:3] == ("shell", "uiautomator", "dump"):
            self.dumps += 1
            if self.frames:
                self.files[args[3]] = self.frames[min(self.dumps - 1, len(self.frames) - 1)]
            elif self.fresh_on is not None and self.dumps >= self.fresh_on:
                self.files[args[3]] = FRESH
            # Android's dump can return zero without creating a file.
            return b""
        elif args[:2] == ("exec-out", "cat"):
            if args[2] not in self.files:
                raise subprocess.CalledProcessError(1, ["adb", *args])
            return self.files[args[2]]
        return b""


class EvidenceFreshness(unittest.TestCase):
    def test_stale_matching_labels_cannot_pass_when_new_dump_is_missing(self):
        device = VirtualDevice()
        with patch.object(smoke, "adb", device.adb), patch.object(smoke.time, "sleep"), patch.object(smoke.time, "monotonic", side_effect=[0, 0, 2]):
            with self.assertRaises(AssertionError):
                smoke.wait_ui(["Screen ready"], timeout=1)

    def test_waits_for_fresh_hierarchy_instead_of_old_matching_labels(self):
        device = VirtualDevice(fresh_on=2)
        with patch.object(smoke, "adb", device.adb), patch.object(smoke.time, "sleep"):
            root, data = smoke.wait_ui(["Screen ready"])
        self.assertEqual(data, FRESH)
        self.assertEqual(smoke.label_height(root, "Screen ready"), 36)
        self.assertEqual(device.dumps, 2)

    def test_waits_for_scaled_text_even_when_matching_labels_are_fresh(self):
        device = VirtualDevice(frames=[OLD, FRESH])
        with patch.object(smoke, "adb", device.adb), patch.object(smoke.time, "sleep"):
            root, data = smoke.wait_ui(["Screen ready"], ready=lambda root: smoke.label_height(root, "Screen ready") > 28)
        self.assertEqual(data, FRESH)
        self.assertEqual(device.dumps, 2)


if __name__ == "__main__":
    unittest.main()
