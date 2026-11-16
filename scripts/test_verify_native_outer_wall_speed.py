import tempfile
import unittest
from pathlib import Path
from verify_native_outer_wall_speed import outer_wall_feedrates, verify


def fixture(temp, feed, suffix=""):
    path = Path(temp) / f"fixture-{feed}{suffix}.gcode"
    lines = ["G21", "G90", "M83", "G1 F6000", ";TYPE:Inner wall", "G1 X1 Y1 E0.2 F6000", ";TYPE:Outer wall"]
    for i in range(30):
        lines.extend([f"G1 X{i+2} Y1 E0.1 F{feed}" if i == 0 else f"G1 X{i+2} Y1 E0.1",
                      "G1 E-0.2", "G0 X1 Y1 F6000", f"G1 X{i+2} Y1 E0.3 F{feed}"])
    path.write_text("\n".join(lines)+"\n", encoding="utf-8")
    return path


class NativeOuterWallSpeedTests(unittest.TestCase):
    def test_real_wall_feed_override(self):
        with tempfile.TemporaryDirectory() as t:
            result = verify(fixture(t, 2400), fixture(t, 120))
            self.assertEqual(result["altered_median_outer_wall_feed_mm_min"], "120")
            self.assertFalse(result["wasm_parity"])

    def test_no_feature_or_only_priming_cannot_pass(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / "a.gcode"
            p.write_text("G90\nM83\nG1 F120\nG1 X10 E1\n;TYPE:Inner wall\nG1 X11 E1\n;TYPE:Outer wall\nG1 E2\n", encoding="utf-8")
            self.assertEqual(outer_wall_feedrates(p), (0, []))

    def test_feature_reset_and_modal_relative_e(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / "a.gcode"
            p.write_text("G90\nM83\nG1 F120\n;FEATURE:External perimeter\nG1 X1 E0.1\n;TYPE: \nG1 X2 E0.1\n;TYPE:Outer wall\nG1 X3 E-0.2\nG92 E0\nG1 X4 E0.1\n", encoding="utf-8")
            self.assertEqual(outer_wall_feedrates(p), (2, [120, 120]))

    def test_unchanged_or_wrong_target_fails(self):
        with tempfile.TemporaryDirectory() as t:
            with self.assertRaisesRegex(ValueError, "F120"):
                verify(fixture(t, 2400), fixture(t, 180))
            with self.assertRaisesRegex(ValueError, "unexpectedly slow baseline"):
                verify(fixture(t, 120, "-base"), fixture(t, 120, "-new"))

    def test_ambiguous_duplicate_or_unsupported_motion_fails(self):
        for move in ("G1 X1 X2 E1 F120", "G1 X1 BAD E1", "G1 X1 E1 F120 F130"):
            with self.subTest(move=move), tempfile.TemporaryDirectory() as t:
                p = Path(t) / "bad.gcode"
                p.write_text(";TYPE:Outer wall\n"+move+"\n", encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "ambiguous"):
                    outer_wall_feedrates(p)


if __name__ == "__main__":
    unittest.main()
