import json
import tempfile
import unittest
from pathlib import Path

from audit_gcode_infill_config import compare_infill_config, parse_config


def block(*lines):
    return "\n".join(("; CONFIG_BLOCK_START", *lines, "; CONFIG_BLOCK_END", ""))


class InfillConfigTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.native = Path(self.tmp.name) / "native.gcode"
        self.wasm = Path(self.tmp.name) / "wasm.gcode"

    def compare(self, a, b):
        self.native.write_text(a, encoding="utf-8")
        self.wasm.write_text(b, encoding="utf-8")
        return compare_infill_config(self.native, self.wasm)

    def test_exact_strings_and_missing_keys(self):
        r = self.compare(
            block("; sparse_infill_pattern = grid", "; infill_direction = 45",
                  "; wall_loops = 2"),
            block("; sparse_infill_pattern = grid", "; infill_direction = 45.0",
                  "; sparse_infill_density = 15%"),
        )
        self.assertEqual(r["equal_keys"], ["sparse_infill_pattern"])
        self.assertEqual(r["different_keys"], ["infill_direction"])
        self.assertEqual(r["native_only_keys"], ["wall_loops"])
        self.assertEqual(r["wasm_only_keys"], ["sparse_infill_density"])
        self.assertIn("layer_height", r["absent_both_keys"])
        self.assertFalse(r["effective_full_profile_equivalence_verified"])

    def test_privacy_and_outside_comments(self):
        r = self.compare("; infill_direction = secretOutside\n" + block(
            "; sparse_infill_pattern = secretA", "; private_key = secretB"),
            block("; sparse_infill_pattern = secretC", "; private_key = secretD"))
        self.assertEqual(r["different_keys"], ["sparse_infill_pattern"])
        self.assertNotIn("secret", json.dumps(r))
        self.assertNotIn("private_key", json.dumps(r))
        self.assertIn("infill_direction", r["absent_both_keys"])

    def test_ambiguous_missing_and_noncomment_blocks(self):
        good = block("; infill_direction = 45")
        for bad in ("; infill_direction = 45\n", good + good,
                    good.replace("; CONFIG_BLOCK_END", ""),
                    block("; infill_direction = 45", "; infill_direction = 45"),
                    block("; infill_direction=45"),
                    block("; infill_direction = "),
                    block("; infill_direction = 45", "G1 X1"),
                    block("; unknown = ignored")):
            with self.subTest(bad=bad):
                r = self.compare(good, bad)
                self.assertTrue(r["native_block_available"])
                self.assertFalse(r["wasm_block_available"])
                self.assertIsNone(r["equal_keys"])

    def test_invalid_utf8_and_oversized_file(self):
        for raw in (b"\xff", b"x" * 12_000_001):
            self.wasm.write_bytes(raw)
            self.assertIsNone(parse_config(self.wasm))


if __name__ == "__main__":
    unittest.main()
