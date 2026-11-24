import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from gcode_lexical_attribution import (compare_lexical, summarize,
                                       unique_insertion_index, numeric_word_delta_buckets)


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



    def test_e_anchor_diagnostic_localizes_extra_xyz_windows(self):
        a = ["G1 X0 Y0 Z1 F900", "G1 X1 E1", "G1 X2 E2", "G1 Z2"]
        b = ["G1 X0 Y0 Z1 F900", "G1 X1 E1", "G1 X1 Y0 Z2",
             "G1 X2 E3", "G1 Z2"]
        g = summarize(a, b)["g1_e_anchor_diagnostics"]
        self.assertEqual(g["word_mask_deltas"], [
            {"mask": "XYZ", "native": 0, "wasm": 1}])
        o = g["ordinal_comparison"]
        self.assertEqual(o["e_word_axis_counts"]["E"]["value_mismatches_when_present_in_both"], 1)
        self.assertEqual(o["window_count_mismatches"], 1)
        self.assertEqual(o["windows_with_more_wasm_commands"], 1)
        self.assertEqual(o["max_wasm_extra_commands_in_one_window"], 1)
        self.assertFalse(g["semantic_equivalence_verified"])

    def test_e_anchor_detects_equal_length_different_windows_and_masks(self):
        g = summarize(["G1 E1", "G1 Z2", "G1 X1 E2"],
                      ["G1 E1", "G1 Z3", "G1 Y1 E2"])["g1_e_anchor_diagnostics"]
        o = g["ordinal_comparison"]
        self.assertEqual(o["window_count_mismatches"], 0)
        self.assertEqual(o["exact_window_mismatches"], 1)
        self.assertEqual(o["e_word_mask_mismatches"], 1)
        self.assertEqual(o["e_word_axis_counts"]["X"]["presence_mismatches"], 1)

    def test_e_anchor_refuses_unaligned_or_empty_anchors(self):
        for a, b in ((["G1 E1"], ["G1 E1", "G1 E2"]),
                     (["G1 X1"], ["G1 X2"])):
            g = summarize(a, b)["g1_e_anchor_diagnostics"]
            self.assertIsNone(g["ordinal_comparison"])

    def test_e_anchor_does_not_leak_opaque_commands(self):
        g = summarize(["G1 E1"], ["G1 E1 secret/path"])["g1_e_anchor_diagnostics"]
        self.assertFalse(g["projection_complete"])
        self.assertNotIn("ordinal_comparison", g)
        self.assertNotIn("secret", str(g))


    def test_unique_insertion_refuses_ambiguous_and_changed_windows(self):
        self.assertEqual(unique_insertion_index(["a", "b"], ["a", "c", "b"]), 1)
        self.assertEqual(unique_insertion_index([], ["a"]), 0)
        self.assertIsNone(unique_insertion_index(["a"], ["a", "a"]))
        self.assertIsNone(unique_insertion_index(["a"], ["b", "c"]))
        self.assertIsNone(unique_insertion_index(["a"], ["a"]))

    def test_anchor_word_magnitude_buckets(self):
        a = ["G1 X0 E1", "G1 X1 E1", "G1 X2 E1", "G1 X3 E1", "G1 X4 E1"]
        b = ["G1 X0 E1", "G1 X1.001 E1", "G1 X1.99 E1", "G1 X3.1 E1", "G1 X4.2 E1"]
        g = summarize(a, b)["g1_e_anchor_diagnostics"]["ordinal_comparison"]
        self.assertEqual(g["e_word_axis_counts"]["X"]["absolute_word_delta_buckets"],
                         {"equal": 1, "le_0_001": 1, "le_0_01": 1,
                          "le_0_1": 1, "gt_0_1": 1})
        self.assertIsNone(numeric_word_delta_buckets([("1E+99", "2")]))
        self.assertIsNone(numeric_word_delta_buckets([("1E-99", "2")]))

    def test_source_comment_attribution_is_bounded_and_exact(self):
        with tempfile.TemporaryDirectory() as directory:
            a, b = Path(directory) / "a", Path(directory) / "b"
            a.write_text("G1 E1\nG1 X1 Y2 Z3\nG1 E2\nG1 X2 Y3 Z4\nG1 E3\n")
            b.write_text("G1 E1\nG1 X1 Y2 Z3\nG1 X1 Y2 Z4 ; restore layer Z\n"
                         "G1 E2\nG1 X9 Y9 Z9 ; secret/path\nG1 X8 Y8 Z8\nG1 E3\n")
            report = compare_lexical(a, b)
            g = report["g1_e_anchor_diagnostics"]["single_extra_window_attribution"]
            self.assertEqual(g["windows"], 2)
            self.assertEqual(g["exact_unique_insertion_windows"], 1)
            self.assertEqual(g["unresolved_windows"], 1)
            self.assertEqual(g["uniquely_inserted_comment_labels"], {"restore-layer": 1})
            self.assertEqual(g["all_wasm_xyz_only_labels_in_these_windows"],
                             {"absent": 2, "other": 1, "restore-layer": 1})
            self.assertNotIn("secret", str(report))
            self.assertFalse(report["semantic_equivalence_verified"])

    def test_xy_anchor_offsets_distinguish_translation_and_reordering(self):
        a = ["G1 X1 Y2 E1", "G1 X3 Y4 E1", "G1 X5 Y6 E1"]
        b = ["G1 X11 Y22 E1", "G1 X13 Y24 E1", "G1 X15 Y26 E1"]
        g = summarize(a, b)["g1_e_anchor_diagnostics"]["xy_anchor_offset_diagnostics"]
        self.assertEqual(g["exact_xy_endpoint_multiset_overlap"], 0)
        self.assertEqual(g["largest_nonzero_offset_group"], 3)
        self.assertEqual(g["longest_consecutive_same_nonzero_offset"], 3)
        self.assertFalse(g["semantic_equivalence_verified"])
        g = summarize(a, list(reversed(a)))["g1_e_anchor_diagnostics"]["xy_anchor_offset_diagnostics"]
        self.assertEqual(g["exact_xy_endpoint_multiset_overlap"], 3)
        self.assertEqual(g["ordinal_equal_xy"], 1)
        self.assertEqual(g["distinct_nonzero_ordinal_offsets"], 2)

    def test_xy_anchor_offset_runs_break_at_missing_xy_and_bound_numbers(self):
        a = ["G1 X1 Y2 E1", "G1 E-1", "G1 X3 Y4 E1"]
        b = ["G1 X11 Y22 E1", "G1 E-1", "G1 X13 Y24 E1"]
        g = summarize(a, b)["g1_e_anchor_diagnostics"]["xy_anchor_offset_diagnostics"]
        self.assertEqual(g["largest_nonzero_offset_group"], 2)
        self.assertEqual(g["longest_consecutive_same_nonzero_offset"], 1)
        g = summarize(["G1 X1E+99 Y2 E1"], ["G1 X1 Y2 E1"])
        self.assertEqual(g["g1_e_anchor_diagnostics"]["xy_anchor_offset_diagnostics"]["status"],
                         "numeric-bound")

    def test_extra_windows_distinguish_empty_native_from_changed_travel(self):
        a = ["G1 E1", "G1 E2", "G1 Z2", "G1 E3"]
        b = ["G1 E1", "G1 X1 Y2 Z3", "G1 E2", "G1 Z3",
             "G1 X2 Y3 Z4", "G1 E3"]
        g = summarize(a, b)["g1_e_anchor_diagnostics"]["single_extra_window_attribution"]
        self.assertEqual(g["empty_native_windows"], 1)
        self.assertEqual(g["nonempty_native_windows"], 1)
        self.assertEqual(g["exact_unique_insertion_windows"], 1)

if __name__ == "__main__":
    unittest.main()
