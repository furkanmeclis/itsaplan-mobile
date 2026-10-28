"""Regression checks for stale UI evidence after a native restart."""
import importlib.util
import subprocess
import unittest
import xml.etree.ElementTree as ET
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


class NonlinearFontScaling(unittest.TestCase):
    def test_android_15_heading_growth_does_not_require_ten_percent_height(self):
        import xml.etree.ElementTree as ET
        # Sanitized bounds observed at font_scale 1.0 and 1.3 in the native APK.
        normal = ET.fromstring('<hierarchy><node text="Heading" bounds="[45,307][229,335]"/></hierarchy>')
        large = ET.fromstring('<hierarchy><node text="Heading" bounds="[45,319][248,349]"/></hierarchy>')
        baseline = smoke.label_size(normal, "Heading")
        self.assertFalse(smoke.text_grew(normal, "Heading", baseline))
        self.assertTrue(smoke.text_grew(large, "Heading", baseline))
        self.assertLess(smoke.label_height(large, "Heading"), baseline[1] * 1.1)


class LauncherRecovery(unittest.TestCase):
    def test_only_system_launcher_anr_is_recovered_once(self):
        import xml.etree.ElementTree as ET
        for package, title, expected in [
            ("android", "Pixel Launcher isn't responding", True),
            ("android", "It's a Plan isn't responding", False),
            (smoke.PACKAGE, "Pixel Launcher isn't responding", False),
        ]:
            root = ET.Element("hierarchy")
            ET.SubElement(root, "node", {"package": package, "resource-id": "android:id/alertTitle", "text": title})
            with self.subTest(package=package, title=title), patch.object(smoke, "RECOVERIES", []), patch.object(smoke, "capture"), patch.object(smoke, "tap") as tap:
                self.assertEqual(smoke.recover_launcher(root, b"xml"), expected)
                if expected:
                    self.assertFalse(smoke.recover_launcher(root, b"xml"))
                    tap.assert_called_once_with(root, "Close app")
                else:
                    tap.assert_not_called()


class FormEvidence(unittest.TestCase):
    def test_offscreen_or_empty_bounds_cannot_prove_reachable_control(self):
        for bounds, expected in [("[0,0][0,0]", False), ("[20,650][140,700]", False),
                                 ("[-10,30][140,80]", False), ("[20,400][140,450]", True)]:
            root = ET.Element("hierarchy")
            ET.SubElement(root, "node", {"text": "Giriş yap", "bounds": bounds})
            with self.subTest(bounds=bounds):
                self.assertEqual(smoke.visible_label(root, "Giriş yap", (320, 640)), expected)

    def test_current_keyboard_window_ignores_historical_show_flags(self):
        for visible in [True, False]:
            state = ("WINDOW MANAGER WINDOWS\n  Window #0 Window{abc u0 App}:\n"
                     "    isVisible=true\n  Window #1 Window{def u0 InputMethod}:\n"
                     "    mGivenContentInsets=[0,0][0,0]\n"
                     "    Frames: parent=[0,0][320,640] frame=[0,380][320,640]\n"
                     f"    isVisible={str(visible).lower()}\n    mInputShown=true\n").encode()
            with self.subTest(visible=visible), patch.object(smoke, "adb", return_value=state):
                self.assertEqual(smoke.keyboard_frame(), (0, 380, 320, 640) if visible else None)

    def test_transparent_ime_region_is_excluded_using_recorded_android_15_insets(self):
        state = b"""WINDOW MANAGER WINDOWS
  Window #0 Window{def u0 InputMethod}:
    mGivenContentInsets=[0,357][0,0] mGivenVisibleInsets=[0,357][0,0]
    Frames: parent=[0,24][320,640] frame=[0,24][320,640]
    isVisible=true
"""
        root = ET.fromstring('<hierarchy><node text="https://mobile.invalid" bounds="[61,325][259,357]"/></hierarchy>')
        with patch.object(smoke, "adb", return_value=state):
            self.assertEqual(smoke.keyboard_frame(), (0, 381, 320, 640))
            self.assertTrue(smoke.input_above_keyboard(root, "https://mobile.invalid", (320, 640)))

    def test_unrecognized_window_dump_cannot_prove_keyboard_dismissal(self):
        with patch.object(smoke, "adb", return_value=b"mInputShown=true"):
            with self.assertRaises(AssertionError):
                smoke.keyboard_frame()

    def test_field_behind_visible_keyboard_cannot_pass_even_with_screen_bounds(self):
        for bounds, expected in [("[45,400][250,450]", False), ("[45,300][250,350]", True)]:
            root = ET.Element("hierarchy")
            ET.SubElement(root, "node", {"text": "https://mobile.invalid", "bounds": bounds})
            with self.subTest(bounds=bounds), patch.object(smoke, "keyboard_frame", return_value=(0, 380, 320, 640)):
                self.assertTrue(smoke.visible_label(root, "https://mobile.invalid", (320, 640)))
                self.assertEqual(smoke.input_above_keyboard(root, "https://mobile.invalid", (320, 640)), expected)

    def test_scroll_waits_for_visible_bounds_instead_of_matching_offscreen_text(self):
        hidden = '<hierarchy><node text="Giriş yap" bounds="[0,0][0,0]"/></hierarchy>'.encode()
        visible = '<hierarchy><node text="Giriş yap" bounds="[20,400][140,450]"/></hierarchy>'.encode()
        frames = [(ET.fromstring(data), data) for data in (hidden, visible)]
        with patch.object(smoke, "hierarchy", side_effect=frames), patch.object(smoke, "adb") as adb, patch.object(smoke.time, "sleep"):
            root, data = smoke.scroll_to_label("Giriş yap", (320, 640))
        self.assertEqual(data, visible)
        adb.assert_called_once()
        self.assertTrue(smoke.visible_label(root, "Giriş yap", (320, 640)))


if __name__ == "__main__":
    unittest.main()
