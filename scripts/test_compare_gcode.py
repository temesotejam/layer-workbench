import tempfile
import unittest
from pathlib import Path
from compare_gcode import compare

class ComparatorTests(unittest.TestCase):
    def run_compare(self, native, wasm):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / 'native.gcode'
            second = Path(directory) / 'wasm.gcode'
            first.write_text(native, encoding='utf-8')
            second.write_text(wasm, encoding='utf-8')
            return compare(first, second)

    def test_comments_and_numeric_format_are_ignored(self):
        self.assertTrue(self.run_compare(
            '; at 12:00\nG1 X1.00 Y2.0 E.500 ; original\n',
            '; at 12:01\nG1 X1 Y2 E0.5\n')['match'])

    def test_extrusion_mismatch_fails(self):
        self.assertFalse(self.run_compare('G1 X1 E0.500\n', 'G1 X1 E0.501\n')['match'])

    def test_order_mismatch_fails(self):
        self.assertFalse(self.run_compare('G0 X1\nG0 X2\n', 'G0 X2\nG0 X1\n')['match'])

    def test_printer_command_mismatch_fails(self):
        self.assertFalse(self.run_compare('M900 K0.1\n', 'M900 K0.2\n')['match'])

    def test_missing_commands_fail(self):
        self.assertFalse(self.run_compare('G1 X1\n', 'G1 X1\nG1 X2\n')['match'])

if __name__ == '__main__':
    unittest.main()
