import tempfile
import unittest
from pathlib import Path

from verify_native_layer_height import extruded_layers, verify, cadence


def fixture(step, layers, absolute_e=True):
    code = ["G21", "G90", "M82" if absolute_e else "M83"]
    e = 0
    for i in range(1, layers + 1):
        z = step * i
        code.append(f"G0 Z{z:.3f}")
        for j in range(2):
            e += 0.1
            code.append(f"G1 X{i+j} Y{i+j+1} E{e:.3f}" if absolute_e else
                        "G1 X1 Y1 E0.1")
    return "\n".join(code) + "\n"


class NativeLayerAuditTests(unittest.TestCase):
    def test_actual_xy_extrusion_z_and_modal_e(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "sample.gcode"
            path.write_text("G21\nG90\nM83\nG1 E5\nG0 Z0.2\n"
                            "G1 X1 E0.1\nG1 E-1\nG0 Z0.4\n"
                            "G1 X2 E0.1\nG92 E0\nG91\nG1 Z0.2\n"
                            "G1 X1 E0.1\n", encoding="utf-8")
            heights, count = extruded_layers(path)
            self.assertEqual(heights, [0.2, 0.4, 0.6])
            self.assertEqual(count, 3)

    def test_real_layer_height_change_passes(self):
        with tempfile.TemporaryDirectory() as temp:
            a, b = Path(temp) / "a.gcode", Path(temp) / "b.gcode"
            a.write_text(fixture(0.2, 100), encoding="utf-8")
            b.write_text(fixture(0.25, 80, False), encoding="utf-8")
            report = verify(a, b)
            self.assertEqual(report["baseline_layers"], 100)
            self.assertEqual(report["altered_layers"], 80)
            self.assertEqual(report["baseline_median_layer_step_mm"], "0.200")
            self.assertEqual(report["altered_median_layer_step_mm"], "0.250")

    def test_same_effective_height_cannot_pass(self):
        with tempfile.TemporaryDirectory() as temp:
            a, b = Path(temp) / "a.gcode", Path(temp) / "b.gcode"
            a.write_text(fixture(0.2, 100), encoding="utf-8")
            b.write_text(fixture(0.2, 100), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "did not sufficiently reduce"):
                verify(a, b)

    def test_only_z_moves_and_priming_are_not_layers(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "sample.gcode"
            path.write_text("G90\nM82\nG1 Z0.2 E1\nG1 X1 E0\nG0 Z1\n", encoding="utf-8")
            self.assertEqual(extruded_layers(path), ([], 0))

    def test_ambiguous_movement_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "sample.gcode"
            path.write_text("G90\nG1 X1 X2 E1\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "ambiguous"):
                extruded_layers(path)


if __name__ == "__main__":
    unittest.main()
