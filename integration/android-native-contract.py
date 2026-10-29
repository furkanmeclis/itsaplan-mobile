"""Run product account code in an isolated APK against disposable HTTPS servers."""
import importlib.util
import json
import os
import re
import signal
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location("smoke", Path(__file__).with_name("android-ui-smoke.py"))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
OUTPUT = Path("test-results/native-contract")
CONFIG = json.loads(Path(__file__).with_name("native-contract-config.json").read_text())


def safe_capture(name, data):
    if CONFIG["password"].encode() in data or re.search(rb"(?i)better-auth\.session_token=", data):
        return False
    smoke.capture(name, data)
    return True



def scroll_to_top(display):
    for attempt in range(13):
        root, data = smoke.hierarchy()
        if smoke.visible_label(root, "It’s a Plan", display):
            return root, data
        if attempt < 12:
            smoke.adb("shell", "input", "swipe", str(display[0] // 2), str(int(display[1] * .4)),
                      str(display[0] // 2), str(int(display[1] * .8)), "400")
            time.sleep(.5)
    raise AssertionError("Product account list could not return to its top")


def focused_field_is_visible(root, minimum_height):
    frame = smoke.keyboard_frame()
    if frame is None:
        return False
    for node in root.iter("node"):
        if node.get("focused") != "true" or node.get("class") != "android.widget.EditText":
            continue
        bounds = list(map(int, re.findall(r"-?\d+", node.get("bounds", ""))))
        if len(bounds) == 4 and bounds[3] - bounds[1] >= minimum_height and bounds[3] <= frame[1]:
            return True
    return False


def scroll_focused_field(root, data, minimum_height):
    # Native caret auto-scroll can leave the control's padding clipped. Exercise
    # the ordinary in-content swipe and require the whole 48px editing control.
    for attempt in range(4):
        if focused_field_is_visible(root, minimum_height):
            break
        frame = smoke.keyboard_frame()
        parents = {child: parent for parent in root.iter() for child in parent}
        focused = next((node for node in root.iter("node") if node.get("focused") == "true" and node.get("class") == "android.widget.EditText"), None)
        viewport = parents.get(focused)
        while viewport is not None and viewport.get("scrollable") != "true":
            viewport = parents.get(viewport)
        bounds = list(map(int, re.findall(r"-?\d+", viewport.get("bounds", "")))) if viewport is not None else []
        if attempt == 3 or frame is None or len(bounds) != 4:
            raise AssertionError("Focused editing control cannot be scrolled fully above keyboard")
        bottom = min(bounds[3], frame[1])
        start = bottom - 24
        end = max(bounds[1] + 24, start - 96)
        if start <= end:
            raise AssertionError("No content viewport remains above the keyboard")
        x = bounds[0] + 8
        smoke.adb("shell", "input", "swipe", str(x), str(start), str(x), str(end), "300")
        root, data = smoke.hierarchy()
    return root, data


def enter_field(label, value, display, secret=False):
    root, data = smoke.scroll_to_label(label, display, ready=lambda root: smoke.control_within_scroll_view(root, label))
    minimum_height = max(48, smoke.label_height(root, label))
    smoke.tap(root, label)
    root, data = smoke.wait_ui([], ready=lambda root: smoke.keyboard_frame() is not None)
    root, data = scroll_focused_field(root, data, minimum_height)
    try:
        smoke.adb("shell", "input", "text", value)
    except subprocess.SubprocessError:
        raise AssertionError("Native form input command failed") from None
    root, data = smoke.hierarchy()
    root, data = scroll_focused_field(root, data, minimum_height)
    if secret:
        if value.encode() in data or not any(node.get("password") == "true" and node.get("focused") == "true" for node in root.iter("node")):
            raise AssertionError("Native password field did not mask its value")
        safe_capture("06-native-masked-password", data)
    smoke.adb("shell", "input", "keyevent", "KEYCODE_BACK")
    smoke.wait_ui([], ready=lambda root: smoke.keyboard_frame() is None)


def launch(metadata):
    smoke.adb("shell", "am", "force-stop", metadata["applicationId"])
    smoke.adb("shell", "am", "start", "-n", metadata["applicationId"] + "/" + metadata["activity"])


def wait_phase(expected, timeout=180):
    def ready(root):
        if "NATIVE_CONTRACT_FAILED" in smoke.text_values(root):
            raise AssertionError("Native contract failed; inspect safe on-screen stage/code")
        return True
    # Inspect every fresh frame for failure, even before the expected label appears.
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            root, data = smoke.hierarchy()
        except (subprocess.SubprocessError, ET.ParseError):
            time.sleep(2)
            continue
        ready(root)
        if expected in smoke.text_values(root):
            return root, data
        if smoke.recover_launcher(root, data):
            continue
        time.sleep(2)
    raise AssertionError("Native contract phase timed out")


def read_report(root):
    for value in smoke.text_values(root):
        if value.startswith('{"formatVersion":1,"platform":'):
            report = json.loads(value)
            allowed = {"formatVersion", "platform", "nativeTransport", "secureStorage", "nativeAuthentication", "physicalDevice", "providerDelivery", "checks"}
            if set(report) != allowed or report["platform"] != "android" or report["nativeTransport"] != "expo/fetch" or report["secureStorage"] != "expo-secure-store":
                raise AssertionError("Unexpected native report schema")
            if report["physicalDevice"] is not False or report["providerDelivery"] is not False or report["nativeAuthentication"] is not True:
                raise AssertionError("Native evidence scope mismatch")
            if not isinstance(report["checks"], list) or len(report["checks"]) < 7:
                raise AssertionError("Native contract checks incomplete")
            if re.search(r"(?i)session_token=|\"(?:cookie|password|token)\"\s*:", value):
                raise AssertionError("Sensitive material is not allowed in native evidence")
            return report
    raise AssertionError("Native result is missing from accessibility hierarchy")


def main(apk, fixture_file):
    fixture_path = Path(fixture_file)
    fixture = json.loads(fixture_path.read_text())
    if fixture.get("ready") is not True:
        raise AssertionError("Disposable native fixture is not ready")
    metadata = json.loads(fixture_path.with_name("build.json").read_text())
    if not metadata["applicationId"].endswith(".contracttest"):
        raise AssertionError("Refusing to drive a pilot application as a contract test")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    smoke.OUTPUT = OUTPUT
    result = {"status": "failed", "physicalDevice": False, "providerDelivery": False,
              "testApplicationId": metadata["applicationId"], "sourceCommit": metadata["sourceCommit"], "checks": []}
    paused = None
    try:
        if not smoke.adb("get-serialno").decode().strip().startswith("emulator-"):
            raise AssertionError("Native contract driver requires the CI emulator")
        smoke.adb("install", "-t", "-r", str(Path(apk).resolve()), timeout=120)
        for port in [34561, 34562]:
            smoke.adb("reverse", f"tcp:{port}", f"tcp:{port}")
        smoke.adb("shell", "settings", "put", "system", "font_scale", "1.0")
        smoke.adb("shell", "settings", "put", "secure", "show_ime_with_hard_keyboard", "1")
        smoke.adb("shell", "settings", "put", "secure", "autofill_service", "null")
        launch(metadata)
        root, data = wait_phase("NATIVE_CONTRACT_STORAGE_READY")
        safe_capture("01-native-sessions-stored", data)
        launch(metadata)
        root, data = wait_phase("NATIVE_CONTRACT_PASSED")
        result.update(read_report(root))
        safe_capture("02-native-session-contract", data)
        launch(metadata)
        root, data = smoke.wait_ui(["Second project"])
        safe_capture("03-native-connected-projects", data)
        root, data = smoke.scroll_to_label("First project", smoke.display_size(), ready=lambda root: smoke.control_within_scroll_view(root, "First project"))
        smoke.tap(root, "First project")
        root, data = smoke.wait_ui(["First task", "Görevi aç"])
        smoke.tap(root, "Görevi aç")
        root, data = smoke.wait_ui(["First task", "First · https://localhost:34561"])
        safe_capture("04-native-source-task", data)
        result["checks"].append("product UI opens the originating account's task using restored sessions")
        launch(metadata)
        root, data = smoke.wait_ui(["Hesaplar"])
        smoke.tap(root, "Hesaplar")
        display = smoke.display_size()
        account = CONFIG["uiAccount"]
        enter_field("HTTPS API adresi", CONFIG["servers"][account["serverIndex"]], display)
        enter_field("Web giriş adresi", CONFIG["webOrigin"], display)
        enter_field("E-posta veya kullanıcı adı", account["email"], display)
        enter_field("Parola", CONFIG["password"], display, secret=True)
        root, data = smoke.scroll_to_label("Giriş yap", display, ready=lambda root: smoke.control_within_scroll_view(root, "Giriş yap"))
        smoke.tap(root, "Giriş yap")
        scroll_to_top(display)
        root, data = smoke.scroll_to_label("Partner", display)
        safe_capture("07-native-product-login", data)
        result["checks"].append("product login form masks the fixture password and authenticates another same-host account")
        paused = fixture["serverPids"][0]
        command = Path(f"/proc/{paused}/cmdline").read_bytes().split(b"\0")
        if len(command) < 2 or command[1] != str(Path(__file__).with_name("server.mjs").resolve()).encode():
            paused = None
            raise AssertionError("Refusing to pause an unrelated process")
        os.kill(paused, signal.SIGSTOP)
        started = time.monotonic()
        launch(metadata)
        root, data = smoke.wait_ui(["Second project"], timeout=7,
                                   ready=lambda root: smoke.visible_label(root, "Second project", smoke.display_size()))
        result["healthyProjectSeconds"] = round(time.monotonic() - started, 3)
        if result["healthyProjectSeconds"] >= 10:
            raise AssertionError("Healthy account was delayed until another server's request deadline")
        smoke.tap(root, "Second project")
        root, data = smoke.wait_ui(["Second task", "Görevi aç"], timeout=7)
        smoke.tap(root, "Görevi aç")
        root, data = smoke.wait_ui(["Second task", "Second · https://localhost:34562"], timeout=7)
        safe_capture("08-native-unreachable-source-isolation", data)
        result["checks"].append("a paused upstream does not block another account's native project/task UI")
        result["status"] = "passed"
    except Exception:
        result["error"] = "native_contract_failed; inspect redacted phase/PNG/XML evidence"
        try:
            root, data = smoke.hierarchy()
            safe_capture("failure", data)
        except Exception:
            pass
        raise
    finally:
        if paused is not None:
            try: os.kill(paused, signal.SIGCONT)
            except ProcessLookupError: pass
        (OUTPUT / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
