import hashlib
import json
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from check_parity_pair import PIN, verify

class PairTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for role in ("native", "wasm"):
            directory = self.root / role
            directory.mkdir()
            files = {}
            for kind in ("model", "machine", "filament", "process", "gcode"):
                data = (kind + " synthetic fixture").encode() if kind != "gcode" else b"G1 X1 E0.1\nG1 X2 E0.2\n"
                (directory / (kind + ".txt")).write_bytes(data)
                files[kind] = {"path": kind + ".txt", "sha256": hashlib.sha256(data).hexdigest()}
            (directory / "manifest.json").write_text(json.dumps(
                {"engine": role, "upstream_commit": PIN, "files": files}))

    def manifest(self, role):
        return self.root / role / "manifest.json"

    def change(self, role, fn):
        path = self.manifest(role)
        data = json.loads(path.read_text())
        fn(data)
        path.write_text(json.dumps(data))

    def test_identical_synthetic_inputs_pass(self):
        self.assertTrue(verify(self.manifest("native"), self.manifest("wasm"))["match"])

    def test_mismatched_model_rejects_before_gcode_compare(self):
        value = b"other model"
        (self.root / "wasm" / "model.txt").write_bytes(value)
        self.change("wasm", lambda m: m["files"]["model"].update(sha256=hashlib.sha256(value).hexdigest()))
        report = verify(self.manifest("native"), self.manifest("wasm"))
        self.assertFalse(report["match"])
        self.assertEqual(report["different_inputs"], ["model"])
        self.assertNotIn("gcode_comparison", report)

    def test_tampered_profile_rejected(self):
        (self.root / "native" / "machine.txt").write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "SHA256 mismatch"):
            verify(self.manifest("native"), self.manifest("wasm"))

    def test_unpinned_revision_rejected(self):
        self.change("wasm", lambda m: m.update(upstream_commit="wrong"))
        with self.assertRaisesRegex(ValueError, "unpinned"):
            verify(self.manifest("native"), self.manifest("wasm"))

    def test_path_traversal_rejected(self):
        self.change("native", lambda m: m["files"]["model"].update(path="../wasm/model.txt"))
        with self.assertRaisesRegex(ValueError, "outside-fixture"):
            verify(self.manifest("native"), self.manifest("wasm"))

    def test_travel_only_gcode_rejected(self):
        data = b"G0 X1\n"
        for role in ("native", "wasm"):
            (self.root / role / "gcode.txt").write_bytes(data)
            self.change(role, lambda m: m["files"]["gcode"].update(sha256=hashlib.sha256(data).hexdigest()))
        self.assertFalse(verify(self.manifest("native"), self.manifest("wasm"))["match"])


    def test_gcode_difference_reported_after_same_input_hashes(self):
        data = b"G1 X1 E0.1\nG1 X2 E0.3\n"
        side = self.root / "wasm"
        (side / "gcode.txt").write_bytes(data)
        self.change("wasm", lambda m: m["files"]["gcode"].update(
            sha256=hashlib.sha256(data).hexdigest()))
        report = verify(self.manifest("native"), self.manifest("wasm"))
        self.assertFalse(report["match"])
        self.assertTrue(report["input_hashes_match"])
        self.assertEqual(report["different_inputs"], [])
        self.assertEqual(report["gcode_comparison"]["mismatched_commands"], 1)

    def test_cli_exit_codes_and_json_report(self):
        tool = Path(__file__).with_name("check_parity_pair.py")
        args = [sys.executable, str(tool),
                "--native-manifest", str(self.manifest("native")),
                "--wasm-manifest", str(self.manifest("wasm")),
                "--min-extrusion-moves", "2"]
        passed = subprocess.run(args, capture_output=True, text=True, check=False)
        self.assertEqual(passed.returncode, 0, passed.stderr + passed.stdout)
        self.assertTrue(json.loads(passed.stdout)["match"])
        (self.root / "wasm" / "filament.txt").write_bytes(b"modified")
        failed = subprocess.run(args, capture_output=True, text=True, check=False)
        self.assertEqual(failed.returncode, 1, failed.stderr + failed.stdout)
        self.assertFalse(json.loads(failed.stdout)["match"])
        self.assertIn("SHA256 mismatch", json.loads(failed.stdout)["error"])

if __name__ == "__main__":
    unittest.main()
