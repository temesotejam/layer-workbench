import tempfile
import unittest
from pathlib import Path

from verify_native_nozzle_temperature import first_positive_targets, verify


def fixture(temp, target, suffix=""):
    path = Path(temp) / f"native-{target}{suffix}.gcode"
    path.write_text(
        "M140 S55\n; M104 S999 is a comment\n"
        f"M104 S{target} ;initial heat\nM109 S{target} ;wait for heat\n"
        "G90\nM82\nG1 X1 Y1 E1 F1200\n"
        "M104 S220 ;normal subsequent layer\nM104 S0 ;shutdown\n", encoding="utf-8")
    return path


class NativeNozzleTemperatureTests(unittest.TestCase):
    def test_real_command_override_and_followup_temperature(self):
        with tempfile.TemporaryDirectory() as temp:
            a, b = fixture(temp, 220), fixture(temp, 235)
            report = verify(a, b)
            self.assertEqual(report["baseline_initial_targets_c"], {"M104": "220", "M109": "220"})
            self.assertEqual(report["altered_initial_targets_c"], {"M104": "235", "M109": "235"})
            self.assertFalse(report["wasm_parity"])

    def test_line_numbers_decimals_and_shutdown_are_supported(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "sample.gcode"
            path.write_text("N10 M104 S0\nN11 M104 S2.35e2 T0\nM109 S235.00\n", encoding="utf-8")
            self.assertEqual(first_positive_targets(path), {"M104": 235, "M109": 235})

    def test_unchanged_target_fails_even_when_paths_differ(self):
        with tempfile.TemporaryDirectory() as temp:
            a, b = fixture(temp, 220), fixture(temp, 220, "-variant")
            b.write_text(b.read_text() + "G1 X99 E2\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "target not updated"):
                verify(a, b)

    def test_missing_wait_command_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            a, b = fixture(temp, 220), fixture(temp, 235)
            b.write_text(b.read_text().replace("M109 S235", "M190 S235"), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "missing positive"):
                verify(a, b)

    def test_invalid_heater_words_fail_closed(self):
        for command in ("M104 S235 S240", "M109 S235 BAD", "M104 S-3"):
            with self.subTest(command=command), tempfile.TemporaryDirectory() as temp:
                path = Path(temp) / "sample.gcode"
                path.write_text(command + "\n", encoding="utf-8")
                with self.assertRaises(ValueError):
                    first_positive_targets(path)


if __name__ == "__main__":
    unittest.main()
