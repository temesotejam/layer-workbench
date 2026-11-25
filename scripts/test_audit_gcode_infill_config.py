import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from audit_gcode_infill_config import (compare_infill_config, parse_config,
                                     embedded_skip_config_status)


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

    def test_unavailable_reason_is_bounded(self):
        good = block("; infill_direction = 45")
        cases = (
            ("; infill_direction = secret", "no-delimiters"),
            (good + good, "repeated-start"),
            ("; CONFIG_BLOCK_END", "unexpected-end"),
            (good.replace("; CONFIG_BLOCK_END\n", ""), "missing-end"),
            (good.replace("; CONFIG_BLOCK_END", ""), "noncomment-in-block"),
            (block("; infill_direction = 45", "; infill_direction = 46"),
             "duplicate-allowlisted-key"),
            (block("; infill_direction = "), "invalid-allowlisted-value"),
            (block("; infill_direction=secret"), "malformed-allowlisted-line"),
            (block("G1 X1"), "noncomment-in-block"),
            (block("; unknown = secret"), "no-allowlisted-values"),
        )
        for raw, status in cases:
            with self.subTest(status=status):
                r = self.compare(good, raw)
                self.assertEqual(r["native_block_status"], "available")
                self.assertEqual(r["wasm_block_status"], status)
                self.assertIsNone(r["equal_keys"])
                self.assertNotIn("secret", json.dumps(r))

    def test_embedded_skip_flag_does_not_prove_effective_setting(self):
        p = Path(self.tmp.name) / "fixture.3mf"
        def fixture(raw):
            with zipfile.ZipFile(p, "w") as z:
                z.writestr("[Content_Types].xml", "<Types/>")
                z.writestr("3D/3dmodel.model", "<model/>")
                if raw is not None:
                    z.writestr("Metadata/project_settings.config", raw)
        for raw, expected in (
            ('{"gcode_skip_config_block":"0"}', "explicit-disabled"),
            ('{"gcode_skip_config_block":true}', "explicit-enabled"),
            ('{"gcode_skip_config_block":"1"}', "explicit-enabled"),
            ('{"gcode_skip_config_block":"secret"}', "unrecognized-value"),
            ('{"other":"secret"}', "missing-key"),
            (None, "missing-project-config"),
            ('{"gcode_skip_config_block":"0","gcode_skip_config_block":"1"}',
             "invalid-archive-or-config"),
        ):
            with self.subTest(expected=expected):
                fixture(raw)
                self.assertEqual(embedded_skip_config_status(p), expected)
        fixture('{"gcode_skip_config_block":"0"}')
        self.native.write_text("G1 X1", encoding="utf-8")
        self.wasm.write_text("G1 X2", encoding="utf-8")
        r = compare_infill_config(self.native, self.wasm, archive=p)
        self.assertEqual(r["source_skip_config_block_status"], "explicit-disabled")
        self.assertEqual(r["native_block_status"], "no-delimiters")
        self.assertFalse(r["effective_full_profile_equivalence_verified"])
        self.assertFalse(r["usable_for_printing"])

    def test_new_infill_geometry_keys(self):
        r = self.compare(block("; internal_solid_infill_pattern = monotonic",
                               "; separated_infills = 0",
                               "; align_infill_direction_to_model = 1"),
                         block("; internal_solid_infill_pattern = rectilinear",
                               "; separated_infills = 0",
                               "; align_infill_direction_to_model = 0"))
        self.assertEqual(r["different_keys"],
                         ["align_infill_direction_to_model", "internal_solid_infill_pattern"])
        self.assertEqual(r["equal_keys"], ["separated_infills"])

    def test_invalid_utf8_and_oversized_file(self):
        for raw in (b"\xff", b"x" * 12_000_001):
            self.wasm.write_bytes(raw)
            self.assertIsNone(parse_config(self.wasm))


if __name__ == "__main__":
    unittest.main()
