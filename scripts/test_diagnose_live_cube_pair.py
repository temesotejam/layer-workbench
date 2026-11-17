#!/usr/bin/env python3
"""Fail-closed regressions for real-output native/WASM numerical diagnostics."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).parent))
from diagnose_live_cube_pair import CUBE_SHA256, diagnostic


class PairTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.native = root / "native.gcode"
        self.wasm = root / "wasm.gcode"
        self.summary = root / "summary.json"
        self.source = root / "cube.stl"
        self.source.write_bytes(b"fixture bytes")
        # The source size/hash logic is tested by patching sha256 for the
        # synthetic 684-byte fixture, not by weakening production constants.
        self.source.write_bytes(b"x" * 684)
        self.gcode = "G21\nG90\nM82\n" + "".join(
            f"G1 X{i} Y{i} E{i/100:.3f}\n" for i in range(1, 125))
        self.gcode += ";" + "diagnostic-only\n" * 500
        self.native.write_text(self.gcode, encoding="utf-8")
        self.wasm.write_text(self.gcode.replace("G1 X50 Y50", "G1 X51 Y50"),
                             encoding="utf-8")
        self.reset_summary()

    def reset_summary(self, legacy=False):
        data = {
            "engine": "OrcaSlicer WASM candidate",
            "version": "2.5.0", "api": "0.7.0",
            "source_stl_sha256": CUBE_SHA256,
            "gcode_sha256": hashlib.sha256(self.wasm.read_bytes()).hexdigest(),
            "bytes": self.wasm.stat().st_size, "layers": 102
        }
        self.summary.write_text(json.dumps(data) + ("\\n" if legacy else "\n"),
                                encoding="utf-8")

    def run_diagnostic(self):
        real_sha = hashlib.sha256
        def fake_sha(path):
            if path == self.source:
                return CUBE_SHA256
            return real_sha(path.read_bytes()).hexdigest()
        with patch("diagnose_live_cube_pair.sha256", side_effect=fake_sha):
            return diagnostic(self.native, self.wasm, self.summary,
                              self.source, minimum=100)

    def test_real_command_difference_is_diagnostic_only(self):
        result = self.run_diagnostic()
        self.assertEqual(result["status"], "DIAGNOSTIC_ONLY")
        self.assertIs(result["parity_pass"], False)
        self.assertFalse(result["ordered_commands_equal"])
        self.assertGreater(result["metrics"]["mismatched_commands"], 0)
        self.assertNotIn("first_differences", json.dumps(result))
        self.assertNotIn("G1 X", json.dumps(result))

    def test_identical_gcode_is_still_not_profile_parity(self):
        self.wasm.write_text(self.gcode, encoding="utf-8")
        self.reset_summary()
        result = self.run_diagnostic()
        self.assertTrue(result["ordered_commands_equal"])
        self.assertFalse(result["parity_pass"])

    def test_corrupt_wasm_summary_fails(self):
        data = json.loads(self.summary.read_text())
        data["gcode_sha256"] = "0" * 64
        self.summary.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "provenance"):
            self.run_diagnostic()

    def test_wrong_source_fails_without_patch(self):
        with self.assertRaisesRegex(ValueError, "shared byte-pinned"):
            diagnostic(self.native, self.wasm, self.summary, self.source, 100)

    def test_legacy_browser_summary_suffix(self):
        self.reset_summary(legacy=True)
        self.assertFalse(self.run_diagnostic()["parity_pass"])

    def test_malformed_summary_rejected(self):
        self.summary.write_text("{} not JSON", encoding="utf-8")
        with self.assertRaises(json.JSONDecodeError):
            self.run_diagnostic()

    def test_fails_without_extrusion(self):
        self.wasm.write_text("G1 X1\n" * 2000, encoding="utf-8")
        self.reset_summary()
        with self.assertRaisesRegex(ValueError, "deposition gate"):
            self.run_diagnostic()


if __name__ == "__main__":
    unittest.main()
