"""Check the production/test APK boundary before any native contract scenario."""
import hashlib
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path


def matching_resources(archive, expected_hash):
    # AAPT resource optimization shortens filenames (for example res/Ab.pem).
    # Verify the certificate bytes, independently of their packaged filename.
    return [entry.filename for entry in archive.infolist()
            if entry.filename.startswith("res/") and entry.file_size <= 65536
            and hashlib.sha256(archive.read(entry)).hexdigest() == expected_hash]


def inspect(metadata_file, contract_apk):
    metadata = json.loads(Path(metadata_file).read_text())
    pilot = Path(metadata["pilotApk"])
    if hashlib.sha256(pilot.read_bytes()).hexdigest() != metadata["pilotApkSha256"]:
        raise AssertionError("Preserved pilot APK changed")
    marker = b"NATIVE_CONTRACT_STORAGE_READY"
    with zipfile.ZipFile(pilot) as archive:
        if marker in archive.read("assets/index.android.bundle") or matching_resources(archive, metadata["testCaSha256"]):
            raise AssertionError("Pilot APK includes native contract code or test CA")
    with zipfile.ZipFile(contract_apk) as archive:
        if marker not in archive.read("assets/index.android.bundle"):
            raise AssertionError("Contract APK has no contract entry")
        if len(matching_resources(archive, metadata["testCaSha256"])) != 1:
            raise AssertionError("Contract APK CA does not match this disposable fixture")
    aapt = Path(os.environ["ANDROID_HOME"]) / "build-tools/37.0.0/aapt2"
    for apk, expected, test_only in [(pilot, metadata["pilotApplicationId"], False),
                                     (Path(contract_apk), metadata["applicationId"], True)]:
        xml = subprocess.check_output([str(aapt), "dump", "xmltree", str(apk), "--file", "AndroidManifest.xml"], text=True)
        if not re.search(r'\bpackage="' + re.escape(expected) + '"', xml):
            raise AssertionError("APK application identifier mismatch")
        actual_test_only = bool(re.search(r"android:testOnly[^\n]*(?:0xffffffff|\btrue\b)", xml))
        if actual_test_only != test_only:
            raise AssertionError("APK testOnly boundary mismatch")
    output = Path("test-results/native-contract")
    output.mkdir(parents=True, exist_ok=True)
    (output / "artifact-boundary.json").write_text(json.dumps({"status": "passed", "sourceCommit": metadata["sourceCommit"],
        "pilotApkSha256": metadata["pilotApkSha256"], "testApkSha256": hashlib.sha256(Path(contract_apk).read_bytes()).hexdigest(),
        "testApplicationId": metadata["applicationId"], "testOnly": True, "pilotContainsContractEntry": False,
        "pilotContainsTestCa": False}, indent=2) + "\n")
    print("Pilot APK and isolated test-only contract APK boundaries verified.")


if __name__ == "__main__":
    inspect(sys.argv[1], sys.argv[2])
