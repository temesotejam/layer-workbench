"""Offline regressions for repeated native G-code command fingerprints."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from verify_native_gcode_repeatability import audit


def fixture():
    # Every X change is a real XY deposition, not just a positive E word.
    return "G90\nM82\n" + "".join(
        f"G1 X{i} Y1 E{i} F1200\n" for i in range(1, 121)
    )


class NativeRepeatabilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.first = Path(self.temp.name) / "first.gcode"
        self.repeat = Path(self.temp.name) / "repeat.gcode"
        self.first.write_text("; created 01:01\n" + fixture(), encoding="utf-8")
        self.repeat.write_text("; created 02:02\n" + fixture(), encoding="utf-8")

    def test_metadata_changes_keep_ordered_commands_reproducible(self):
        report = audit(self.first, self.repeat)
        self.assertTrue(report["pass"], report)
        self.assertFalse(report["raw_sha256_equal"])
        self.assertTrue(report["ordered_command_sha256_equal"])
        self.assertTrue(report["raw_differs_but_ordered_commands_match"])
        self.assertEqual(report["first_positive_xy_extrusion_moves"], 120)
        self.assertFalse(report["native_vs_wasm_compared"])

    def test_identical_bytes_also_pass(self):
        self.repeat.write_bytes(self.first.read_bytes())
        result = audit(self.first, self.repeat)
        self.assertTrue(result["pass"])
        self.assertTrue(result["raw_sha256_equal"])

    def test_real_motion_difference_fails(self):
        self.repeat.write_text(
            self.repeat.read_text().replace("G1 X30 Y1", "G1 X30.25 Y1"),
            encoding="utf-8")
        result = audit(self.first, self.repeat)
        self.assertFalse(result["pass"])
        self.assertGreater(result["ordered_command_mismatches"], 0)
        self.assertFalse(result["ordered_command_sha256_equal"])
        self.assertTrue(result["first_differences"])

    def test_gcode_with_no_deposition_is_not_reproducibility_proof(self):
        travel = "G90\n" + "".join(f"G0 X{i}\n" for i in range(1, 210))
        self.first.write_text(travel, encoding="utf-8")
        self.repeat.write_text(travel, encoding="utf-8")
        result = audit(self.first, self.repeat)
        self.assertFalse(result["pass"])
        self.assertTrue(result["input_issues"])

    def test_missing_or_small_file_rejected(self):
        self.repeat.write_text("G1 X1 E1\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "size outside"):
            audit(self.first, self.repeat)

    def test_invalid_threshold_rejected(self):
        with self.assertRaisesRegex(ValueError, "positive extrusion"):
            audit(self.first, self.repeat, minimum_extrusion=0)

    def test_cli_json_and_nonzero_on_command_mismatch(self):
        cmd = [sys.executable, str(Path(__file__).with_name("verify_native_gcode_repeatability.py")),
               "--first", str(self.first), "--repeat", str(self.repeat),
               "--report", str(Path(self.temp.name) / "audit.json")]
        success = subprocess.run(cmd, check=False, capture_output=True, text=True)
        self.assertEqual(success.returncode, 0, success.stdout + success.stderr)
        self.assertTrue(json.loads(success.stdout)["pass"])
        self.repeat.write_text(self.repeat.read_text().replace("G1 X50 ", "G1 X50.5 "),
                               encoding="utf-8")
        failed = subprocess.run(cmd, check=False, capture_output=True, text=True)
        self.assertEqual(failed.returncode, 1)
        self.assertFalse(json.loads(failed.stdout)["pass"])


if __name__ == "__main__":
    unittest.main()
