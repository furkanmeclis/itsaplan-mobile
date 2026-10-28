"""Exercise the real Android UI with local demo data; never enroll an account."""
import json
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

PACKAGE = "software.technowide.itsaplan.mobile"
OUTPUT = Path("test-results/android-ui")
RECOVERIES = []


def adb(*args, timeout=30):
    return subprocess.run(["adb", *args], check=True, capture_output=True, timeout=timeout).stdout


def hierarchy():
    # A failed dump can exit successfully while leaving a previous window file behind.
    adb("shell", "rm", "-f", "/sdcard/ipm-window.xml")
    adb("shell", "uiautomator", "dump", "/sdcard/ipm-window.xml")
    data = adb("exec-out", "cat", "/sdcard/ipm-window.xml")
    return ET.fromstring(data), data


def text_values(root):
    return [node.get(key, "") for node in root.iter("node") for key in ("text", "content-desc")]


def wait_ui(labels, timeout=180, ready=None):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            root, data = hierarchy()
            # Hosted emulators occasionally show a launcher ANR over a healthy app.
            # Handle only this exact system dialog once; app ANRs must still fail.
            if recover_launcher(root, data):
                continue
            values = text_values(root)
            if all(any(label in value for value in values) for label in labels) and (ready is None or ready(root)):
                return root, data
        except (subprocess.SubprocessError, ET.ParseError):
            pass
        time.sleep(3)
    raise AssertionError("Native UI did not expose the expected labels: " + ", ".join(labels))


def recover_launcher(root, data):
    title = next((node for node in root.iter("node")
                  if node.get("resource-id") == "android:id/alertTitle"
                  and node.get("package") == "android"), None)
    if title is None or title.get("text") != "Pixel Launcher isn't responding" or RECOVERIES:
        return False
    capture("launcher-anr", data)
    tap(root, "Close app")
    RECOVERIES.append("closed Pixel Launcher system ANR dialog once")
    return True


def capture(name, data):
    time.sleep(1)  # Allow the matching native frame to finish drawing.
    (OUTPUT / (name + ".xml")).write_bytes(data)
    (OUTPUT / (name + ".png")).write_bytes(adb("exec-out", "screencap", "-p"))


def tap(root, label):
    parents = {child: parent for parent in root.iter() for child in parent}
    target = next((node for node in root.iter("node") if any(label in node.get(key, "") for key in ("text", "content-desc"))), None)
    if target is None:
        raise AssertionError("Missing control: " + label)
    current = target
    while current is not None:
        if current.get("clickable") == "true":
            target = current
            break
        current = parents.get(current)
    values = [int(value) for value in re.findall(r"\d+", target.get("bounds", ""))]
    if len(values) != 4 or values[2] <= values[0] or values[3] <= values[1]:
        raise AssertionError("Control has no visible touch bounds: " + label)
    adb("shell", "input", "tap", str((values[0] + values[2]) // 2), str((values[1] + values[3]) // 2))


def label_size(root, label):
    node = next(node for node in root.iter("node") if label in node.get("text", "") or label in node.get("content-desc", ""))
    values = [int(value) for value in re.findall(r"-?\d+", node.get("bounds", ""))]
    if len(values) != 4:
        raise AssertionError("Missing text bounds: " + label)
    return values[2] - values[0], values[3] - values[1]


def label_height(root, label):
    return label_size(root, label)[1]


def text_grew(root, label, baseline):
    width, height = label_size(root, label)
    # Android 14+ scales text nonlinearly: larger headings grow less than body text.
    # Check real growth in both dimensions, not an assumed percentage of font_scale.
    return width > baseline[0] and height > baseline[1]


def launch():
    adb("shell", "am", "force-stop", PACKAGE)
    adb("shell", "am", "start", "-n", PACKAGE + "/.MainActivity")


def main(apk_path):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {"platform": "android-emulator", "data": "explicitly labeled local demo", "checks": [],
              "realAuthentication": False, "providerDelivery": False, "physicalDevice": False}
    try:
        apk = Path(apk_path).resolve()
        if not apk.is_file():
            raise AssertionError("Standalone APK missing")
        with zipfile.ZipFile(apk) as archive:
            if archive.getinfo("assets/index.android.bundle").file_size <= 0:
                raise AssertionError("Standalone APK has no embedded JavaScript")
            if not any(name.startswith("lib/x86_64/") for name in archive.namelist()):
                raise AssertionError("Standalone APK has no emulator-native libraries")
        adb("install", "-r", str(apk), timeout=120)
        adb("shell", "settings", "put", "system", "font_scale", "1.0")
        launch()
        root, data = wait_ui(["Sunucu hesapları", "Demoyu incele", "Sunucuya bağlan"])
        baseline = label_size(root, "Sunucuya bağlan")
        capture("01-account-entry", data)
        report["checks"].append("native account-entry screen rendered")
        tap(root, "Demoyu incele")
        root, data = wait_ui(["Örnek veriler", "ETKİLEŞİMLİ DEMO", "Gerçek hesaplara dön"])
        capture("02-labeled-demo", data)
        report["checks"].append("demo notice and native navigation rendered")
        tap(root, "Gerçek hesaplara dön")
        root, data = wait_ui(["Sunucu hesapları", "Sunucuya bağlan"])
        capture("03-return-to-accounts", data)
        report["checks"].append("returned to real account entry without enrolling a server")
        adb("shell", "settings", "put", "system", "font_scale", "1.3")
        launch()
        root, data = wait_ui(["Sunucu hesapları", "Demoyu incele", "Sunucuya bağlan"],
                             ready=lambda root: text_grew(root, "Sunucuya bağlan", baseline))
        observed_scale = float(adb("shell", "settings", "get", "system", "font_scale").decode().strip())
        scaled = label_size(root, "Sunucuya bağlan")
        if observed_scale < 1.29 or not text_grew(root, "Sunucuya bağlan", baseline):
            raise AssertionError("Large-font screen did not expose fresh, scaled text bounds")
        report["fontScale"] = observed_scale
        report["textHeightPx"] = {"normal": baseline[1], "large": scaled[1]}
        report["textWidthPx"] = {"normal": baseline[0], "large": scaled[0]}
        capture("04-large-font-entry", data)
        report["checks"].append("account entry rendered at system font scale 1.3")
        report["status"] = "passed"
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        try:
            root, data = hierarchy()
            capture("failure", data)
        except Exception:
            pass
        raise
    finally:
        try:
            pid = adb("shell", "pidof", PACKAGE).decode().strip().split()[0]
            if pid.isdigit():
                (OUTPUT / "app-logcat.txt").write_bytes(adb("logcat", "-d", "--pid=" + pid))
            adb("shell", "settings", "put", "system", "font_scale", "1.0")
        except Exception:
            pass
        report["emulatorRecoveries"] = list(RECOVERIES)
        (OUTPUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main(sys.argv[1])
