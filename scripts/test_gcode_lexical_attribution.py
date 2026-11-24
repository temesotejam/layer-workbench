import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from gcode_lexical_attribution import compare_lexical, summarize


class LexicalAttributionTests(unittest.TestCase):
    def test_inserted_nonmotion_does_not_hide_strict_difference(self):
        a = ["M83", "G1 X1 E1", "G1 X2 E1"]
        b = ["M83", "M73 P1", "G1 X1 E1", "G1 X2 E1"]
        report = summarize(a, b)
        self.assertEqual(report["exact_multiset_shared"], 3)
        self.assertEqual(report["native_multiset_unmatched"], 0)
        self.assertEqual(report["wasm_multiset_unmatched"], 1)
        self.assertEqual(report["exact_common_prefix"], 1)
        self.assertEqual(report["exact_common_suffix"], 2)
        self.assertTrue(report["motion_subsequence_equal"])
        self.assertFalse(report["nonmotion_subsequence_equal"])
        self.assertFalse(report["semantic_equivalence_verified"])
        self.assertEqual(report["category_deltas"], [{
            "category": "M73", "native": 0, "wasm": 1,
            "exact_shared": 0, "native_unmatched": 0, "wasm_unmatched": 1,
        }])

    def test_reordered_duplicate_motion_is_not_equal(self):
        a = ["G1 X1", "G1 X2", "G1 X1"]
        b = ["G1 X1", "G1 X1", "G1 X2"]
        report = summarize(a, b)
        self.assertEqual(report["exact_multiset_shared"], 3)
        self.assertFalse(report["motion_subsequence_equal"])
        self.assertEqual(report["category_deltas"], [])

    def test_opaque_commands_and_changed_motion(self):
        a = ["CUSTOM secret/path", "N10 G1 X1", "G1 X2"]
        b = ["OTHER secret/path", "N10 G1 X3", "G1 X2"]
        report = summarize(a, b)
        self.assertNotIn("secret", str(report))
        self.assertNotIn("CUSTOM", str(report))
        self.assertEqual(report["native_multiset_unmatched"], 2)
        self.assertEqual(report["wasm_multiset_unmatched"], 2)
        self.assertEqual([r["category"] for r in report["category_deltas"]],
                         ["G1", "other"])

    def test_identical_prefix_and_suffix_do_not_double_count(self):
        report = summarize(["G1 X1"], ["G1 X1"])
        self.assertEqual(report["exact_common_prefix"], 1)
        self.assertEqual(report["exact_common_suffix"], 0)
        self.assertEqual(summarize([], [])["exact_multiset_shared"], 0)

    def test_bounds_and_canonical_file_comparison(self):
        with tempfile.TemporaryDirectory() as directory:
            a, b = Path(directory) / "native", Path(directory) / "wasm"
            a.write_text("G1 X1.00 ; comment\nM83\n")
            b.write_text("G1 X1\nM83\n")
            self.assertEqual(compare_lexical(a, b)["exact_multiset_shared"], 2)
            with patch("gcode_lexical_attribution.MAX_BYTES", 1):
                self.assertEqual(compare_lexical(a, b)["status"], "byte-limit")
            with patch("gcode_lexical_attribution.MAX_COMMANDS", 1):
                self.assertEqual(compare_lexical(a, b)["status"], "command-limit")


if __name__ == "__main__":
    unittest.main()
