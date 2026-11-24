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



    def test_feed_projection_distinguishes_added_and_inline_feed(self):
        a = ["G1 F6E+2", "G1 X1 E2 F900", "G1 Z3"]
        b = ["G1 F600", "G1 F800", "G1 X1 E2", "G1 Z3 F100"]
        report = summarize(a, b)
        g = report["g1_feed_projection"]
        self.assertTrue(g["projection_complete"])
        self.assertTrue(g["ordered_g1_without_f_equal"])
        self.assertEqual(g["native"]["feed_only"], 1)
        self.assertEqual(g["wasm"]["feed_only"], 2)
        self.assertEqual(g["native"]["coordinate_with_feed"], 1)
        self.assertFalse(report["motion_subsequence_equal"])
        self.assertFalse(g["semantic_equivalence_verified"])

    def test_feed_projection_exposes_xyz_and_e_differences(self):
        g = summarize(["G1 X1 Y2 E3", "G1 X4 E5"],
                      ["G1 X2 Y2 E3 F900", "G1 X4 E6"])["g1_feed_projection"]
        self.assertFalse(g["ordered_g1_without_f_equal"])
        for axis in ("X", "E"):
            self.assertEqual(g["coordinate_word_diagnostics"][axis]["positional_word_mismatches"], 1)
        self.assertTrue(g["coordinate_word_diagnostics"]["Y"]["ordered_words_equal"])

    def test_feed_projection_does_not_equate_reassociated_words(self):
        g = summarize(["G1 X1 Y2", "G1 X3"], ["G1 X1", "G1 X3 Y2"])["g1_feed_projection"]
        self.assertFalse(g["ordered_g1_without_f_equal"])
        self.assertTrue(g["coordinate_word_diagnostics"]["Y"]["ordered_words_equal"])

    def test_feed_projection_rejects_opaque_and_duplicate_words(self):
        for line in ("N10 G1 X1 F2", "G1 X1 X2 F3", "G1 X1 Q2", "G1 secret/path"):
            with self.subTest(line=line):
                g = summarize([line], [line])["g1_feed_projection"]
                self.assertEqual(g["native"]["opaque"], 1)
                self.assertFalse(g["projection_complete"])
                self.assertIsNone(g["ordered_g1_without_f_equal"])
                self.assertIsNone(g["coordinate_word_diagnostics"])
                self.assertNotIn("secret", str(g))

    def test_feed_projection_unequal_coordinate_count(self):
        g = summarize(["G1 X1"], ["G1 X1", "G1 X2"])["g1_feed_projection"]
        self.assertFalse(g["ordered_g1_without_f_equal"])
        self.assertIsNone(g["coordinate_word_diagnostics"]["X"]["positional_word_mismatches"])


if __name__ == "__main__":
    unittest.main()
