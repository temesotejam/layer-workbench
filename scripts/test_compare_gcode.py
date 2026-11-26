import tempfile
import unittest
from pathlib import Path
from compare_gcode import compare

class ComparatorTests(unittest.TestCase):
    def run_compare(self, native, wasm, **kwargs):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / 'native.gcode'
            second = Path(directory) / 'wasm.gcode'
            first.write_text(native, encoding='utf-8')
            second.write_text(wasm, encoding='utf-8')
            return compare(first, second, **kwargs)



    def test_numeric_canonicalization_does_not_round_distinct_words(self):
        first = 'M900 K0.12345678901234567890123456781\n'
        second = 'M900 K0.12345678901234567890123456782\n'
        result = self.run_compare(first, second)
        self.assertFalse(result['match'])
        self.assertEqual(result['mismatched_commands'], 1)

    def test_numeric_canonicalization_preserves_exact_aliases(self):
        first = 'M900 K0.1234567890123456789012345678100\n'
        second = 'M900 K12345678901234567890123456781e-29\n'
        self.assertTrue(self.run_compare(first, second)['match'])
        self.assertTrue(self.run_compare('M900 K-0.000\n', 'M900 K-0\n')['match'])

    def test_absolute_e_tool_change_requires_explicit_g92_reanchor(self):
        # Two identical files must not pass solely because a global absolute
        # E register was silently carried across distinct physical tools.
        ambiguous = ('G90\nM82\nT0\nG1 X10 E10\n'
                     'T1\nG1 X20 E11\nG1 X30 E12\n')
        report = self.run_compare(ambiguous, ambiguous, min_extrusion_moves=2)
        self.assertFalse(report['match'], report)
        self.assertEqual(report['mismatched_commands'], 0)
        self.assertIsNone(report['native_counted_positive_e_mm'])
        self.assertIn('unsupported or malformed stateful geometry',
                      ' '.join(report['input_issues']))

        explicit = ('G90\nM82\nT0\nG1 X10 E10\n'
                    'T1\nG92 E0\nG1 X20 E1\n')
        accepted = self.run_compare(explicit, explicit, min_extrusion_moves=2)
        self.assertTrue(accepted['match'], accepted)
        self.assertEqual(accepted['native_extrusion_moves'], 2)
        self.assertEqual(accepted['native_counted_positive_e_mm'], '11')

    def test_first_and_repeated_tool_selection_are_not_false_changes(self):
        before_extrusion = ('G90\nM82\nT0\nG1 X10 E1\n'
                            'T0\nG1 X20 E2\n')
        report = self.run_compare(before_extrusion, before_extrusion,
                                  min_extrusion_moves=2)
        self.assertTrue(report['match'], report)

        # First explicit selector AFTER extrusion may change the E register.
        late_selector = 'M82\nG1 X10 E5\nT0\nG1 X20 E6\n'
        self.assertFalse(self.run_compare(
            late_selector, late_selector, min_extrusion_moves=2)['match'])

    def test_relative_e_tool_switch_and_absolute_resume(self):
        relative = ('M83\nT0\nG1 X10 E1\nT1\nG1 X20 E2\n')
        allowed = self.run_compare(relative, relative, min_extrusion_moves=2)
        self.assertTrue(allowed['match'], allowed)
        self.assertEqual(allowed['native_counted_positive_e_mm'], '3')

        # M82 after an unanchored tool change cannot reuse the previous E.
        unknown = relative + 'M82\nG1 X30 E5\n'
        self.assertFalse(self.run_compare(
            unknown, unknown, min_extrusion_moves=3)['match'])
        repaired = relative + 'M82\nG92 E0\nG1 X30 E1\n'
        self.assertTrue(self.run_compare(
            repaired, repaired, min_extrusion_moves=3)['match'])

    def test_vendor_tool_selector_requires_reanchor_for_absolute_e(self):
        vendor = 'M82\nG1 X10 E1\nT255\nG1 X20 E2\n'
        self.assertFalse(self.run_compare(
            vendor, vendor, min_extrusion_moves=2)['match'])
        reanchored = 'M82\nG1 X10 E1\nT1000\nG92 E0\nG1 X20 E2\n'
        self.assertTrue(self.run_compare(
            reanchored, reanchored, min_extrusion_moves=2)['match'])

    def test_unsupported_stateful_words_fail_closed(self):
        # These lines have plausible XY/E words but contain unsupported axes,
        # extra arc revolutions, or vendor parameters. A matching G-code pair
        # cannot be marked valid by silently dropping those words.
        motions = (
            'G1 X10 E1 A90', 'G1 X10 E1 U2', 'G1 X10 E1 I5',
            'G1 X10 E1 R5', 'G1 X10 E1 P2', 'G1 X10 E1 S100',
            'G92 E0 F100',
            'G2 X11 Y0 I5 J0 P2 E1',
            'G2 X11 Y0 I5 J0 K1 E1',
            'G2 X11 Y0 I5 J0 S10 E1',
        )
        for motion in motions:
            with self.subTest(motion=motion):
                code = 'M83\nG1 X1 E1\n' + motion + '\nG1 X30 E1\n'
                report = self.run_compare(code, code, min_extrusion_moves=2)
                self.assertFalse(report['match'], report)
                self.assertEqual(report['mismatched_commands'], 0)
                self.assertIsNone(report['native_counted_linear_xy_mm'])
                self.assertIsNone(report['native_counted_positive_e_mm'])
                self.assertIn('malformed stateful geometry',
                              ' '.join(report['input_issues']))

    def test_supported_motion_words_still_count(self):
        code = ('G21\nG90\nM83\nG92 X0 Y0 Z0.2 E0\n'
                'G1 X10 F1800 E1\n'
                'G2 X20 Y0 I5 J0 F1500 E1\n')
        report = self.run_compare(code, code, min_extrusion_moves=2)
        self.assertTrue(report['match'], report)
        self.assertEqual(report['native_extrusion_moves'], 2)
        self.assertEqual(report['native_counted_linear_xy_mm'], '10')

    def test_invalid_g17_arc_does_not_allow_later_deposition_to_pass(self):
        # Previously an impossible arc was silently skipped but mutated XY,
        # allowing surrounding valid G1 moves to satisfy the minimum gate.
        for arc in ("G2 X2 E1", "G2 X2", "G3 X2 R0 E-1"):
            with self.subTest(arc=arc):
                gcode = "M83\nG1 X1 E1\n" + arc + "\nG1 X3 E1\n"
                result = self.run_compare(gcode, gcode, min_extrusion_moves=2)
                self.assertFalse(result["match"], result)
                self.assertIsNone(result["native_counted_planar_z_levels"])
                self.assertIsNone(result["native_counted_positive_e_mm"])
                self.assertIn("malformed stateful geometry", " ".join(result["input_issues"]))

    def test_identical_malformed_stateful_gcode_fails_even_without_minimum(self):
        result = self.run_compare("M83\nG1 X1 E1 X2\n",
                                  "M83\nG1 X1 E1 X2\n")
        self.assertFalse(result["match"], result)
        self.assertEqual(result["mismatched_commands"], 0)
        self.assertIsNone(result["native_counted_planar_z_levels"])
        self.assertEqual(len(result["input_issues"]), 2)

    def test_counted_planar_z_levels_track_g0_g92_and_relative_z(self):
        # Count real XY deposition at a constant Z. An XY+Z extrusion
        # changes height and must not masquerade as an ordinary layer.
        code = ('G21\nM83\nG0 Z0.2\nG1 X10 E1\n'
                'G1 X20 Z0.4 E1\nG1 X30 E1\n'
                'G91\nG0 Z0.2\nG1 X10 E1\n'
                'G90\nG92 Z1\nG1 X50 E1\n')
        report = self.run_compare(code, code, min_extrusion_moves=5)
        self.assertTrue(report['match'], report)
        self.assertEqual(report['native_extrusion_moves'], 5)
        self.assertEqual(report['native_counted_planar_z_levels'], 4)
        self.assertEqual(report['wasm_counted_planar_z_levels'], 4)
        self.assertEqual(report['native_counted_nonplanar_deposition_moves'], 1)
        self.assertEqual(report['wasm_counted_nonplanar_deposition_moves'], 1)
        self.assertEqual(report['first_counted_planar_z_differences'], [])
        self.assertEqual(report['native_only_counted_planar_z_levels'], 0)
        self.assertEqual(report['wasm_only_counted_planar_z_levels'], 0)

    def test_counted_planar_z_differences_report_height_and_move_counts(self):
        native = 'M83\nG0 Z0.2\nG1 X1 E1\nG0 Z0.4\nG1 X2 E1\n'
        wasm = 'M83\nG0 Z0.2\nG1 X1 E1\nG0 Z0.6\nG1 X2 E1\n'
        report = self.run_compare(native, wasm, min_extrusion_moves=2)
        self.assertFalse(report['match'])
        self.assertEqual(report['native_counted_planar_z_levels'], 2)
        self.assertEqual(report['wasm_counted_planar_z_levels'], 2)
        self.assertEqual(report['first_counted_planar_z_differences'], [
            {'z_mm': '0.4', 'native_moves': 1, 'wasm_moves': 0},
            {'z_mm': '0.6', 'native_moves': 0, 'wasm_moves': 1},
        ])
        self.assertEqual(report['native_only_counted_planar_z_levels'], 1)
        self.assertEqual(report['wasm_only_counted_planar_z_levels'], 1)
        self.assertEqual(report['first_native_only_counted_planar_z_mm'], ['0.4'])
        self.assertEqual(report['first_wasm_only_counted_planar_z_mm'], ['0.6'])

    def test_shared_z_footprint_detects_geometry_change_with_equal_move_counts(self):
        native = ('M83\nG0 Z0.2\nG1 X3 Y4 E1\nG1 X6 Y8 E1\n')
        wasm = ('M83\nG0 Z0.2\nG1 X3 Y4 E1\nG1 X6 Y9 E1\n')
        report = self.run_compare(native, wasm, min_extrusion_moves=2)
        self.assertEqual(report['first_counted_planar_z_differences'], [])
        self.assertEqual(report['native_only_counted_planar_z_levels'], 0)
        self.assertEqual(report['shared_counted_planar_z_footprint_difference_count'], 1)
        sample = report['first_shared_counted_planar_z_footprint_differences'][0]
        self.assertEqual(sample['z_mm'], '0.2')
        self.assertEqual(sample['native']['deposition_moves'], 2)
        self.assertEqual(sample['wasm']['deposition_moves'], 2)
        self.assertEqual(sample['native']['linear_xy_mm'], '10')
        self.assertEqual(sample['wasm']['linear_xy_mm'], '10.830952')
        self.assertEqual(sample['wasm_minus_native_linear_xy_mm'], '0.830952')
        self.assertEqual(sample['wasm_minus_native_linear_positive_e_mm'], '0')
        self.assertEqual(sample['wasm']['linear_xy_endpoint_bounds_mm'],
                         ['0', '0', '6', '9'])
        self.assertFalse(report['match'])

    def test_shared_z_footprint_detects_positive_e_change_with_equal_shape(self):
        native = 'M83\nG0 Z0.2\nG1 X1 E1\n'
        wasm = 'M83\nG0 Z0.2\nG1 X1 E2\n'
        report = self.run_compare(native, wasm, min_extrusion_moves=1)
        self.assertEqual(report['shared_counted_planar_z_footprint_difference_count'], 1)
        sample = report['first_shared_counted_planar_z_footprint_differences'][0]
        self.assertEqual(sample['native']['linear_xy_mm'], '1')
        self.assertEqual(sample['wasm']['linear_xy_mm'], '1')
        self.assertEqual(sample['wasm_minus_native_linear_positive_e_mm'], '1')

    def test_shared_z_footprint_full_count_and_bounded_examples(self):
        native = 'M83\n' + ''.join(
            f'G0 Z{i / 10}\nG0 X0\nG1 X10 E1\n' for i in range(1, 20))
        wasm = 'M83\n' + ''.join(
            f'G0 Z{i / 10}\nG0 X0\nG1 X11 E1\n' for i in range(1, 20))
        report = self.run_compare(native, wasm)
        self.assertEqual(report['shared_counted_planar_z_footprint_difference_count'], 19)
        samples = report['first_shared_counted_planar_z_footprint_differences']
        self.assertEqual(len(samples), 15)
        self.assertEqual(samples[0]['z_mm'], '0.1')
        self.assertEqual(samples[-1]['z_mm'], '1.5')
        same = self.run_compare(native, native)
        self.assertEqual(same['shared_counted_planar_z_footprint_difference_count'], 0)
        self.assertEqual(same['first_shared_counted_planar_z_footprint_differences'], [])

    def test_missing_z_membership_count_is_not_truncated_to_15(self):
        native = 'M83\n' + ''.join(
            f'G0 Z{i / 10}\nG1 X{i} E1\n' for i in range(1, 22))
        wasm = 'M83\nG0 Z0.1\nG1 X1 E1\n'
        report = self.run_compare(native, wasm)
        self.assertEqual(report['native_only_counted_planar_z_levels'], 20)
        self.assertEqual(report['wasm_only_counted_planar_z_levels'], 0)
        self.assertEqual(len(report['first_native_only_counted_planar_z_mm']), 15)
        self.assertEqual(report['first_native_only_counted_planar_z_mm'][0], '0.2')
        self.assertEqual(report['first_native_only_counted_planar_z_mm'][-1], '1.6')
        self.assertEqual(report['first_wasm_only_counted_planar_z_mm'], [])
        self.assertEqual(len(report['first_counted_planar_z_differences']), 15)
        self.assertFalse(report['match'])

    def test_planar_z_metrics_preserve_inch_units_and_g17_arcs(self):
        code = ('G20\nM83\nG0 Z0.01\n'
                'G2 I1 J0 E0.1\nG21\nG3 X50.8 R25.4 E1\n')
        report = self.run_compare(code, code, min_extrusion_moves=2)
        self.assertTrue(report['match'], report)
        self.assertEqual(report['native_counted_planar_z_levels'], 1)
        self.assertEqual(report['native_counted_nonplanar_deposition_moves'], 0)

    def test_invalid_motion_does_not_create_a_false_planar_layer(self):
        gcode = 'M83\nG1 X1 E1 X2\n'
        report = self.run_compare(gcode, gcode, min_extrusion_moves=1)
        self.assertFalse(report['match'])
        self.assertIsNone(report['native_counted_planar_z_levels'])
        self.assertIsNone(report['wasm_counted_nonplanar_deposition_moves'])
        self.assertIsNone(report['first_counted_planar_z_differences'])
        self.assertIsNone(report['shared_counted_planar_z_footprint_difference_count'])
        self.assertIsNone(report['first_shared_counted_planar_z_footprint_differences'])
        self.assertIsNone(report['native_only_counted_planar_z_levels'])
        self.assertIsNone(report['wasm_only_counted_planar_z_levels'])
        self.assertIsNone(report['first_native_only_counted_planar_z_mm'])
        self.assertIsNone(report['first_wasm_only_counted_planar_z_mm'])

    def test_counted_linear_xy_length_excludes_arcs_priming_and_stationary_moves(self):
        code = ('M83\nG1 X3 Y4 E1\nG1 X3 Y4 E1\n'
                'G2 I1 J0 E1\nG1 X6 Y8 E1\n'
                'G91\nG1 X0 Y-12 E1\n')
        report = self.run_compare(code, code, min_extrusion_moves=4)
        self.assertTrue(report['match'], report)
        self.assertEqual(report['native_extrusion_moves'], 4)
        self.assertEqual(report['native_counted_linear_xy_moves'], 3)
        self.assertEqual(report['native_counted_linear_xy_mm'], '22')
        self.assertEqual(report['wasm_counted_linear_xy_mm'], '22')
        self.assertEqual(report['counted_linear_xy_delta_mm'], '0')

    def test_linear_xy_delta_detects_geometry_change_even_when_e_total_matches(self):
        native = 'M83\nG1 X3 Y4 E1\nG1 X6 Y8 E1\n'
        wasm = 'M83\nG1 X3 Y4 E1\nG1 X6 Y9 E1\n'
        report = self.run_compare(native, wasm, min_extrusion_moves=2)
        self.assertFalse(report['match'])
        self.assertEqual(report['counted_positive_e_delta_mm'], '0')
        self.assertEqual(report['native_counted_linear_xy_mm'], '10')
        self.assertEqual(report['wasm_counted_linear_xy_mm'], '10.830952')
        self.assertEqual(report['counted_linear_xy_delta_mm'], '0.830952')

    def test_linear_xy_length_respects_unit_switches(self):
        code = 'G20\nM83\nG1 X1 E0.1\nG21\nG1 X25.4 E0.1\nG1 Y10 E0.1\n'
        report = self.run_compare(code, code, min_extrusion_moves=2)
        self.assertTrue(report['match'], report)
        self.assertEqual(report['native_counted_linear_xy_moves'], 2)
        self.assertEqual(report['native_counted_linear_xy_mm'], '35.4')

    def test_malformed_modal_geometry_reports_unknown_linear_length(self):
        code = 'G92 E0 E1\nG1 X10 E2\n'
        report = self.run_compare(code, code, min_extrusion_moves=1)
        self.assertFalse(report['match'])
        self.assertIsNone(report['native_counted_linear_xy_mm'])
        self.assertIsNone(report['counted_linear_xy_delta_mm'])

    def test_counted_positive_e_mm_excludes_priming_and_retractions(self):
        # Absolute E, an explicit G92 reset, relative E and G20 inches.
        # E-only priming and XY retraction are never counted as deposition.
        code = ('M82\nG1 E6\nG92 E0\nG1 X10 E1.25\n'
                'G1 X20 E0.75\nM83\nG1 Y10 E0.5\n'
                'G20\nG1 X1 E0.1\n')
        report = self.run_compare(code, code, min_extrusion_moves=3)
        self.assertTrue(report['match'], report)
        self.assertEqual(report['native_extrusion_moves'], 3)
        self.assertEqual(report['native_counted_positive_e_mm'], '4.29')
        self.assertEqual(report['wasm_counted_positive_e_mm'], '4.29')
        self.assertEqual(report['counted_positive_e_delta_mm'], '0')

    def test_leading_zero_m083_is_relative_not_absolute(self):
        # The previous M083 branch incorrectly set absolute E. That made
        # an E0 move after a relative retraction look like deposited plastic.
        gcode = ('G90\nM083\nG1 X1 E1\nG1 X2 E-0.5\n'
                 'G1 X3 E0\nG1 X4 E1\n')
        report = self.run_compare(gcode, gcode, min_extrusion_moves=2)
        self.assertTrue(report['match'], report)
        self.assertEqual(report['native_extrusion_moves'], 2)
        self.assertEqual(report['native_counted_positive_e_mm'], '2')
        self.assertFalse(self.run_compare(
            gcode, gcode, min_extrusion_moves=3)['match'])

    def test_leading_zero_m082_restores_absolute_e(self):
        # Starting in relative E, M082 must make E0.5 a retraction from E1.
        gcode = ('M83\nG1 X1 E1\nM082\n'
                 'G1 X2 E0.5\nG1 X3 E1.5\n')
        report = self.run_compare(gcode, gcode, min_extrusion_moves=2)
        self.assertTrue(report['match'], report)
        self.assertEqual(report['native_extrusion_moves'], 2)
        self.assertEqual(report['native_counted_positive_e_mm'], '2')
        # Ordered-command comparison remains strict despite equivalent mode.
        distinct = self.run_compare(
            'M082\nG1 X1 E1\n', 'M82\nG1 X1 E1\n',
            min_extrusion_moves=1)
        self.assertFalse(distinct['match'])
        self.assertEqual(distinct['mismatched_commands'], 1)
        self.assertEqual(distinct['native_extrusion_moves'], 1)

    def test_counted_positive_e_delta_is_diagnostic_not_a_parity_override(self):
        native = 'M83\nG1 X10 E1\nG1 X20 E1\n'
        wasm = 'M83\nG1 X10 E1\nG1 X20 E2\n'
        report = self.run_compare(native, wasm, min_extrusion_moves=2)
        self.assertFalse(report['match'])
        self.assertEqual(report['native_counted_positive_e_mm'], '2')
        self.assertEqual(report['wasm_counted_positive_e_mm'], '3')
        self.assertEqual(report['counted_positive_e_delta_mm'], '1')

    def test_invalid_deposition_syntax_has_unknown_e_total(self):
        code = 'G92 E0 E1\nG1 X10 E2\n'
        report = self.run_compare(code, code, min_extrusion_moves=1)
        self.assertFalse(report['match'])
        self.assertIsNone(report['native_counted_positive_e_mm'])
        self.assertIsNone(report['counted_positive_e_delta_mm'])

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


    def test_identical_header_only_files_are_not_parity(self):
        report = self.run_compare('; generated by slicer A\n', '; generated by slicer B\n')
        self.assertFalse(report['match'])
        self.assertEqual(report['mismatched_commands'], 0)
        self.assertEqual(len(report['input_issues']), 2)

    def test_identical_arbitrary_text_is_not_gcode_parity(self):
        report = self.run_compare('SLICER ERROR\n', 'SLICER ERROR\n')
        self.assertFalse(report['match'])
        self.assertEqual(report['native_motion_commands'], 0)

    def test_numbered_motion_commands_are_accepted(self):
        report = self.run_compare('N1 G01 X1 E0.5\n', 'N1 G01 X1.0 E.500\n')
        self.assertTrue(report['match'])
        self.assertEqual(report['native_motion_commands'], 1)

    def test_numeric_deltas_and_all_mismatch_counts(self):
        report = self.run_compare(
            'G1 X1 E0.500\n' * 16,
            'G1 X1 E0.501\n' * 16,
        )
        self.assertFalse(report['match'])
        self.assertEqual(report['mismatched_commands'], 16)
        self.assertEqual(len(report['first_differences']), 15)
        self.assertEqual(report['first_differences'][0]['parameter_deltas'],
                         [{'parameter': 'E', 'wasm_minus_native': '0.001'}])

    def test_invalid_utf8_rejected_instead_of_replacement_equivalence(self):
        with tempfile.TemporaryDirectory() as directory:
            native = Path(directory) / 'native.gcode'
            wasm = Path(directory) / 'wasm.gcode'
            native.write_bytes(b'G1 X1\n\xff\n')
            wasm.write_bytes(b'G1 X1\n\xfe\n')
            with self.assertRaises(UnicodeDecodeError):
                compare(native, wasm)


    def test_optional_extrusion_gate_rejects_identical_travel_only(self):
        report = self.run_compare('G0 X1\nG1 X2\n', 'G0 X1\nG1 X2\n', min_extrusion_moves=1)
        self.assertFalse(report['match'])
        self.assertEqual(report['mismatched_commands'], 0)
        self.assertEqual(len(report['input_issues']), 2)

    def test_optional_gate_accepts_positive_xy_extrusion(self):
        gcode = 'N1 G01 X1 E0.5\nG1 Y2 E1.0\n'
        report = self.run_compare(gcode, gcode, min_extrusion_moves=2)
        self.assertTrue(report['match'])
        self.assertEqual(report['native_extrusion_moves'], 2)

    def test_optional_gate_rejects_priming_retraction_and_negative_e(self):
        gcode = 'G1 E10\nG1 X1 E-0.5\nG0 X3 E5\nG1 X4 E0\n'
        report = self.run_compare(gcode, gcode, min_extrusion_moves=1)
        self.assertFalse(report['match'])
        self.assertEqual(report['native_extrusion_moves'], 0)

    def test_optional_gate_requires_threshold_on_both_inputs(self):
        report = self.run_compare('G1 X1 E1\nG1 X2 E2\n',
                                  'G1 X1 E1\n', min_extrusion_moves=2)
        self.assertFalse(report['match'])
        self.assertEqual(report['native_extrusion_moves'], 2)
        self.assertEqual(report['wasm_extrusion_moves'], 1)

    def test_optional_gate_accepts_arc_extrusion(self):
        gcode = 'G2 I1 J0 E1\n'
        self.assertTrue(self.run_compare(gcode, gcode, min_extrusion_moves=1)['match'])

    def test_arc_fixture_gate_rejects_missing_or_impossible_geometry(self):
        # Positive E and an X/Y word cannot substitute for a valid arc.
        invalid_arcs = [
            'G2 X1 E1',          # no center or radius
            'G2 I0 J0 E1',      # zero-radius full circle
            'G3 X1 R0 E1',      # zero radius
            'G2 X3 R1 E1',      # chord exceeds diameter
            'G2 R1 E1',         # R full circle is undefined
            'G2 X2 I0 J0 E1',   # center coincides with starting point
            'G2 X2 I1 J0 R1 E1', # conflicting definitions
            'G2 X2 I0.5 J0.5 E1',   # different start/end radii
        ]
        for arc in invalid_arcs:
            with self.subTest(arc=arc):
                report = self.run_compare(arc + '\n', arc + '\n', min_extrusion_moves=1)
                self.assertFalse(report['match'], report)
                self.assertEqual(report['native_extrusion_moves'], 0)

    def test_arc_fixture_gate_accepts_center_and_radius_g17_paths(self):
        gcode = ('G17\nM83\nG2 I1 J0 E0.3\n'
                 'G3 X2 R1 E0.3\n')
        report = self.run_compare(gcode, gcode, min_extrusion_moves=2)
        self.assertTrue(report['match'], report)
        self.assertEqual(report['native_extrusion_moves'], 2)

    def test_arc_fixture_gate_tracks_plane_and_absolute_arc_centers(self):
        gcode = ('G90\nG17\nG90.1\nG0 X2 Y0\n'
                 'G2 X0 Y2 I0 J0 E1\n'
                 'G18\nG2 X1 I0 K1 E2\n'
                 'G17\nG91.1\nG3 X3 Y2 I1 J0 E3\n')
        report = self.run_compare(gcode, gcode, min_extrusion_moves=2)
        self.assertEqual(report['native_extrusion_moves'], 2)
        self.assertTrue(report['match'], report)
        self.assertFalse(self.run_compare(gcode, gcode, min_extrusion_moves=3)['match'])

    def test_arc_fixture_gate_converts_radius_and_centers_from_inches(self):
        gcode = ('G20\nM83\nG2 X2 I1 J0 E0.1\n'
                 'G21\nG3 X76.2 R25.4 E0.1\n')
        report = self.run_compare(gcode, gcode, min_extrusion_moves=2)
        self.assertEqual(report['native_extrusion_moves'], 2)
        self.assertTrue(report['match'], report)

    def test_negative_gate_rejected(self):
        with self.assertRaises(ValueError):
            self.run_compare('G1 X1 E1\n', 'G1 X1 E1\n', min_extrusion_moves=-1)


    def test_absolute_e_retraction_is_not_positive_deposition(self):
        gcode = 'M82\nG1 X1 E1\nG1 X2 E0.5\nG1 X3 E0.8\n'
        report = self.run_compare(gcode, gcode, min_extrusion_moves=2)
        self.assertTrue(report['match'])
        self.assertEqual(report['native_extrusion_moves'], 2)

    def test_relative_e_and_g92_reset(self):
        gcode = 'M82\nG1 X1 E1\nG92 E0\nG1 X2 E0.4\nM83\nG1 X3 E-0.2\nG1 X4 E0.1\n'
        report = self.run_compare(gcode, gcode, min_extrusion_moves=3)
        self.assertTrue(report['match'])
        self.assertEqual(report['native_extrusion_moves'], 3)

    def test_e_only_priming_updates_absolute_baseline(self):
        gcode = 'M82\nG1 E4\nG1 X1 E3\nG1 X2 E4.5\n'
        report = self.run_compare(gcode, gcode, min_extrusion_moves=1)
        self.assertTrue(report['match'])
        self.assertEqual(report['native_extrusion_moves'], 1)

    def test_relative_retraction_is_not_deposition(self):
        gcode = 'M83\nG1 X1 E0.4\nG1 X2 E-0.3\nG1 X3 E0.2\n'
        report = self.run_compare(gcode, gcode, min_extrusion_moves=2)
        self.assertTrue(report['match'])
        self.assertEqual(report['native_extrusion_moves'], 2)

    def test_compact_motion_matches_spaced_numeric_words(self):
        report = self.run_compare(
            'G90\nM82\nG1X1Y2E0.5F1200\nG2X2Y2I0.5J0E1\n',
            'G90\nM82\nG1 X1.00 Y2.0 E.500 F1200\nG2 X2 Y2 I0.50 J0 E1.00\n',
            min_extrusion_moves=2,
        )
        self.assertTrue(report['match'], report)
        self.assertEqual(report['native_motion_commands'], 2)
        self.assertEqual(report['native_extrusion_moves'], 2)

    def test_compact_numbered_motion_and_exponent(self):
        report = self.run_compare(
            'N15G01X1E0.5\nG1 X1E+2 Y1 E1\n',
            'N15 G01 X1.00 E.500\nG1 X100 Y1 E1\n',
        )
        self.assertTrue(report['match'], report)
        self.assertEqual(report['native_motion_commands'], 2)

    def test_compact_numeric_difference_is_reported(self):
        report = self.run_compare(
            'G1X10Y20E0.5\n',
            'G1 X10 Y21 E0.5\n',
        )
        self.assertFalse(report['match'])
        self.assertEqual(report['first_differences'][0]['parameter_deltas'],
                         [{'parameter': 'Y', 'wasm_minus_native': '1'}])

    def test_malformed_compact_motion_and_checksum_do_not_normalize(self):
        for malformed in ['G1X10oopsY20E1', 'G1X10Y20E1*99',
                          'G1X10Y20E1?', 'G1X10XerrY20E1']:
            with self.subTest(malformed=malformed):
                report = self.run_compare(malformed + '\n', 'G1 X10 Y20 E1\n')
                self.assertFalse(report['match'])
        # The compact tokenizer must not change unrelated opaque vendor syntax.
        self.assertFalse(self.run_compare('M900K0.1\nG1X1E1\n',
                                          'M900 K0.1\nG1 X1 E1\n')['match'])

    def test_stationary_xy_words_are_not_deposition(self):
        gcode = ('M82\nG1 X0 E1\nG1 Y0 E2\n'
                 'G1 X1 E3\nG1 X1 E4\nG1 Y1 E5\n')
        report = self.run_compare(gcode, gcode, min_extrusion_moves=3)
        self.assertEqual(report['native_extrusion_moves'], 2)
        self.assertFalse(report['match'])
        self.assertTrue(self.run_compare(gcode, gcode, min_extrusion_moves=2)['match'])

    def test_relative_zero_displacement_and_g92_xy_reset(self):
        gcode = ('G91\nM83\nG1 X0 Y0 E0.2\n'
                 'G1 X1 E0.2\nG1 Y-1 E0.3\n'
                 'G90\nG92 X0 Y0\nG1 X0 E0.2\n')
        report = self.run_compare(gcode, gcode, min_extrusion_moves=3)
        self.assertEqual(report['native_extrusion_moves'], 2)
        self.assertFalse(report['match'])

    def test_inch_to_mm_transition_does_not_create_phantom_move(self):
        gcode = ('G20\nG90\nM82\nG1 X1 E1\n'
                 'G21\nG1 X25.4 E26\nG1 X26 E27\n')
        report = self.run_compare(gcode, gcode, min_extrusion_moves=3)
        self.assertEqual(report['native_extrusion_moves'], 2)
        self.assertFalse(report['match'])

    def test_stationary_primer_fails_provenance_gate(self):
        report = self.run_compare('G1 X0 E1\n', 'G1 X0 E1\n',
                                  min_extrusion_moves=1)
        self.assertFalse(report['match'])
        self.assertEqual(report['mismatched_commands'], 0)
        self.assertEqual(report['native_extrusion_moves'], 0)

    def test_opcodes_are_not_normalized_as_numeric_parameters(self):
        for native, wasm in [('G20', 'G2E+1'), ('G90', 'G9E+1'),
                             ('M100', 'M1E+2'), ('T200', 'T2E+2'),
                             ('N20', 'N2E+1')]:
            with self.subTest(native=native):
                report = self.run_compare(native + '\nG1 X1 E1\n',
                                          wasm + '\nG1 X1 E1\n')
                self.assertFalse(report['match'])
                self.assertEqual(report['mismatched_commands'], 1)

    def test_fixture_gate_rejects_malformed_and_duplicate_motion_words(self):
        invalid = [
            'G1 X1 E1 X2',        # last duplicate X used to appear printable
            'G1 X1 E1 E2',        # conflicting extrusion words
            'G1 X1 E1 BAD',       # unknown suffix
            'G1 X1 E1*42',       # unsupported checksum syntax
            'G1 X1 E1 G91',      # embedded second opcode
            'G0 X2 BAD\nG1 X3 E1',  # unknown previous coordinate
        ]
        for gcode in invalid:
            with self.subTest(gcode=gcode):
                code = gcode + '\n'
                report = self.run_compare(code, code, min_extrusion_moves=1)
                self.assertFalse(report['match'], report)
                self.assertEqual(report['native_extrusion_moves'], 0)
                self.assertEqual(report['wasm_extrusion_moves'], 0)

    def test_fixture_gate_rejects_ambiguous_g92_before_valid_move(self):
        gcode = 'G92 E0 E1\nG1 X1 E2\n'
        report = self.run_compare(gcode, gcode, min_extrusion_moves=1)
        self.assertFalse(report['match'])
        self.assertEqual(report['native_extrusion_moves'], 0)

    def test_fixture_gate_keeps_valid_feed_and_arc_words(self):
        gcode = 'M83\nG1 X1 Y0 F1200 E0.3\nG2 X3 Y0 I1 J0 E0.2\n'
        report = self.run_compare(gcode, gcode, min_extrusion_moves=2)
        self.assertTrue(report['match'], report)
        self.assertEqual(report['native_extrusion_moves'], 2)

    def test_line_number_tens_still_counts_motion(self):
        report = self.run_compare('N20 G1 X1 E1\n', 'N20 G1 X1 E1\n',
                                  min_extrusion_moves=1)
        self.assertTrue(report['match'], report)
        self.assertEqual(report['native_extrusion_moves'], 1)

    def test_switch_back_to_absolute_mode_prevents_false_xy_move(self):
        gcode = 'G91\nM82\nG1 X1 E1\nG90\nG1 X1 E2\n'
        report = self.run_compare(gcode, gcode, min_extrusion_moves=2)
        self.assertEqual(report['native_extrusion_moves'], 1)
        self.assertFalse(report['match'])

    def test_native_only_z_footprint_uses_actual_g1_geometry(self):
        native = ('M83\nG0 Z0.28\nG1 X1 Y1 E0.1\n'
                  'G1 X3 Y1 E0.2\nG0 Z0.4\nG1 X4 Y1 E0.3\n')
        wasm = 'M83\nG0 Z0.4\nG1 X4 Y1 E0.3\n'
        report = self.run_compare(native, wasm, min_extrusion_moves=1)
        self.assertFalse(report['match'])
        self.assertEqual(report['native_only_counted_planar_z_levels'], 1)
        self.assertEqual(report['first_native_only_counted_planar_z_footprints'], [{
            'z_mm': '0.28', 'deposition_moves': 2,
            'linear_moves': 2, 'g17_arc_moves': 0,
            'linear_xy_mm': '3.414214', 'linear_positive_e_mm': '0.3',
            'linear_xy_endpoint_bounds_mm': ['0', '0', '3', '1'],
        }])
        self.assertEqual(report['first_wasm_only_counted_planar_z_footprints'], [])

    def test_arc_is_not_mistaken_for_straight_line_footprint(self):
        native = ('M83\nG0 Z0.28\nG2 I1 J0 E0.5\n'
                  'G1 X2 E0.25\nG0 Z0.4\nG1 X3 E0.1\n')
        wasm = 'M83\nG0 Z0.4\nG1 X3 E0.1\n'
        report = self.run_compare(native, wasm, min_extrusion_moves=1)
        detail = report['first_native_only_counted_planar_z_footprints'][0]
        self.assertEqual(detail['deposition_moves'], 2)
        self.assertEqual(detail['linear_moves'], 1)
        self.assertEqual(detail['g17_arc_moves'], 1)
        self.assertEqual(detail['linear_xy_mm'], '2')
        self.assertEqual(detail['linear_positive_e_mm'], '0.25')
        self.assertEqual(detail['linear_xy_endpoint_bounds_mm'], ['0', '0', '2', '0'])

    def test_invalid_arc_has_no_invented_z_footprint(self):
        code = 'M83\nG0 Z0.28\nG2 X9 R1 E1\nG1 X10 E1\n'
        report = self.run_compare(code, code, min_extrusion_moves=0)
        self.assertFalse(report['match'])
        self.assertIsNone(report['first_native_only_counted_planar_z_footprints'])
        self.assertIsNone(report['first_wasm_only_counted_planar_z_footprints'])


    def test_feature_census_separates_tagged_wall_infill_and_unknown(self):
        # Tags do NOT enter canonical ordered equality, but expose numeric
        # feature-level attribution when the slicer emits explicit comments.
        native = ('M83\nG0 Z0.2\n;TYPE:Outer wall\n'
                  'G1 X3 Y4 E1\n; FEATURE: Sparse infill\n'
                  'G1 X6 Y8 E2\n;TYPE:customer secret /tmp/private.gcode\n'
                  'G1 X7 Y8 E1\n')
        wasm = native.replace(';TYPE:Outer wall', ';TYPE:Inner wall')
        report = self.run_compare(native, wasm, min_extrusion_moves=3)
        self.assertTrue(report['match'], 'Comment tags are not G-code commands')
        self.assertEqual(report['mismatched_commands'], 0)
        n = report['native_feature_tagged_planar_g1']
        w = report['wasm_feature_tagged_planar_g1']
        self.assertEqual(n['known_tagged_moves'], 2)
        self.assertEqual(n['unclassified_moves'], 1)
        self.assertEqual(n['by_feature']['outer wall'],
                         {'moves': 1, 'linear_xy_mm': '5', 'positive_e_mm': '1'})
        self.assertEqual(n['by_feature']['sparse infill'],
                         {'moves': 1, 'linear_xy_mm': '5', 'positive_e_mm': '2'})
        self.assertEqual(w['by_feature']['inner wall']['moves'], 1)
        self.assertEqual(report['feature_category_differences'],
                         ['inner wall', 'outer wall'])
        self.assertNotIn('customer secret', str(n))
        self.assertNotIn('/tmp/private.gcode', str(report['feature_category_differences']))

    def test_malformed_and_inline_feature_tags_cannot_inherit_or_invent_labels(self):
        gcode = ('M83\n;TYPE:Outer wall\nG1 X1 E1\n'
                 ';TYPE: ;malformed\nG1 X2 E1 ;TYPE:Outer wall\n'
                 '; random text saying TYPE:Outer wall\nG1 X3 E1\n'
                 ';FEATURE:Gap infill\nG1 X4 E1\n')
        report = self.run_compare(gcode, gcode)
        census = report['native_feature_tagged_planar_g1']
        self.assertEqual(census['known_tagged_moves'], 2)
        self.assertEqual(census['unclassified_moves'], 2)
        self.assertEqual(census['by_feature']['outer wall']['moves'], 1)
        self.assertEqual(census['by_feature']['gap infill']['moves'], 1)

    def test_feature_census_rejects_nonplanar_arc_and_stationary_prime(self):
        gcode = ('M83\n;TYPE:Bridge\nG1 X1 E1\n'
                 'G1 X2 Z1 E1\nG2 I1 J0 E1\n'
                 'G1 X2 E1\nG1 X3 E1\n')
        report = self.run_compare(gcode, gcode)
        self.assertTrue(report['match'], report)
        census = report['native_feature_tagged_planar_g1']
        self.assertEqual(census['by_feature']['bridge'],
                         {'moves': 2, 'linear_xy_mm': '2', 'positive_e_mm': '2'})
        self.assertEqual(report['feature_category_differences'], [])

    def test_invalid_stateful_geometry_has_unknown_feature_census(self):
        code = 'M83\n;TYPE:Inner wall\nG1 X1 X2 E1\n'
        report = self.run_compare(code, code)
        self.assertFalse(report['match'])
        self.assertIsNone(report['native_feature_tagged_planar_g1'])
        self.assertIsNone(report['wasm_feature_tagged_planar_g1'])
        self.assertIsNone(report['feature_category_differences'])



    def test_feature_category_deltas_are_signed_and_ranked_by_xy_gap(self):
        native = ('M83\n;TYPE:Outer wall\nG1 X3 Y4 E1\n'
                  ';TYPE:Sparse infill\nG1 X6 Y8 E2\n')
        wasm = ('M83\n;TYPE:Outer wall\nG1 X6 Y8 E1.5\n'
                ';TYPE:Inner wall\nG1 X9 Y12 E1\n')
        report = self.run_compare(native, wasm, min_extrusion_moves=2)
        self.assertFalse(report['match'])
        rows = report['feature_category_deltas']
        self.assertEqual([r['feature'] for r in rows],
                         ['inner wall', 'outer wall', 'sparse infill'])
        by_tag = {r['feature']: r for r in rows}
        self.assertEqual(by_tag['outer wall']['wasm_minus_native_linear_xy_mm'], '5')
        self.assertEqual(by_tag['outer wall']['wasm_minus_native_positive_e_mm'], '0.5')
        self.assertEqual(by_tag['outer wall']['wasm_minus_native_moves'], 0)
        self.assertEqual(by_tag['inner wall']['native_moves'], 0)
        self.assertEqual(by_tag['inner wall']['wasm_minus_native_linear_xy_mm'], '5')
        self.assertEqual(by_tag['sparse infill']['wasm_moves'], 0)
        self.assertEqual(by_tag['sparse infill']['wasm_minus_native_linear_xy_mm'], '-5')
        self.assertEqual(by_tag['sparse infill']['wasm_minus_native_positive_e_mm'], '-2')
        self.assertEqual(self.run_compare(native, native)['feature_category_deltas'], [])

    def test_feature_category_deltas_are_unknown_for_invalid_stateful_gcode(self):
        bad = 'M83\n;TYPE:Inner wall\nG1 X1 X2 E1\n'
        report = self.run_compare(bad, bad)
        self.assertIsNone(report['feature_category_deltas'])
        self.assertFalse(report['match'])



    def test_feature_z_deltas_rank_geometry_before_e_only_difference(self):
        native = ('M83\nG0 Z0.2\n;TYPE:Internal solid infill\n'
                  'G1 X3 Y4 E1\nG0 Z0.4\n;TYPE:Internal solid infill\n'
                  'G1 X6 Y8 E1\n')
        wasm = ('M83\nG0 Z0.2\n;TYPE:Internal solid infill\n'
                'G1 X6 Y8 E1\nG0 Z0.4\n;TYPE:Internal solid infill\n'
                'G1 X9 Y12 E2\n')
        report = self.run_compare(native, wasm)
        self.assertEqual(report['feature_z_difference_count'], 2)
        self.assertEqual([x['z_mm'] for x in report['first_feature_z_differences']],
                         ['0.2', '0.4'])
        first, second = report['first_feature_z_differences']
        self.assertEqual(first['feature'], 'internal solid infill')
        self.assertEqual(first['wasm_minus_native_linear_xy_mm'], '5')
        self.assertEqual(first['wasm_minus_native_positive_e_mm'], '0')
        self.assertEqual(second['wasm_minus_native_linear_xy_mm'], '0')
        self.assertEqual(second['wasm_minus_native_positive_e_mm'], '1')
        self.assertEqual(self.run_compare(native, native)['feature_z_difference_count'], 0)

    def test_feature_z_deltas_are_bounded_and_count_all_heights(self):
        native = 'M83\n' + ''.join(
            f'G0 Z{i / 10}\nG0 X0\n;TYPE:Internal solid infill\nG1 X10 E1\n'
            for i in range(1, 22))
        wasm = native.replace('G1 X10 E1', 'G1 X11 E1')
        report = self.run_compare(native, wasm)
        self.assertEqual(report['feature_z_difference_count'], 21)
        samples = report['first_feature_z_differences']
        self.assertEqual(len(samples), 15)
        self.assertEqual(samples[0]['z_mm'], '0.1')
        self.assertEqual(samples[-1]['z_mm'], '1.5')
        self.assertTrue(all(x['wasm_minus_native_linear_xy_mm'] == '1'
                            for x in samples))

    def test_feature_z_deltas_never_echo_untrusted_tags_or_count_arcs(self):
        native = ('M83\nG0 Z0.2\n;TYPE:secret /tmp/unsafe.gcode\n'
                  'G1 X3 E1\nG2 I1 J0 E1\n')
        wasm = native.replace('G1 X3 E1', 'G1 X4 E1')
        report = self.run_compare(native, wasm)
        self.assertEqual(report['feature_z_difference_count'], 1)
        self.assertEqual(report['first_feature_z_differences'][0]['feature'],
                         'unclassified')
        self.assertNotIn('secret', str(report['first_feature_z_differences']))
        self.assertNotIn('/tmp/', str(report['first_feature_z_differences']))

    def test_feature_z_deltas_unknown_on_malformed_stateful_input(self):
        invalid = 'M83\n;TYPE:Internal solid infill\nG1 X1 X2 E1\n'
        result = self.run_compare(invalid, invalid)
        self.assertFalse(result['match'])
        self.assertIsNone(result['feature_z_difference_count'])
        self.assertIsNone(result['first_feature_z_differences'])


    def test_heater_setpoint_delta_is_reported_without_overriding_match(self):
        native = ('M104 S200 T0\nM140 S60\nM109 R205 T0\nM190 R60\n'
                  'M83\nG1 X10 E1\n')
        wasm = native.replace('M104 S200', 'M104 S215').replace('M190 R60', 'M190 R65')
        report = self.run_compare(native, wasm, min_extrusion_moves=1)
        self.assertFalse(report['match'])
        self.assertEqual(report['native_heater_setpoint_events'], 4)
        self.assertEqual(report['wasm_heater_setpoint_events'], 4)
        self.assertEqual(report['heater_setpoint_difference_count'], 2)
        first, second = report['first_heater_setpoint_differences']
        self.assertEqual(first['native']['heater'], 'nozzle')
        self.assertEqual(first['native']['tool'], 0)
        self.assertEqual(first['wasm_minus_native_setpoint_c'], '15')
        self.assertEqual(second['native']['heater'], 'bed')
        self.assertEqual(second['wasm_minus_native_setpoint_c'], '5')
        self.assertEqual(
            self.run_compare(native, native)['heater_setpoint_difference_count'], 0)

    def test_heater_mode_tool_and_missing_event_are_not_collapsed(self):
        native = 'M109 S210 T0\nM140 S60\nG1 X1 E1\n'
        wasm = 'M109 R210 T1\nG1 X1 E1\n'
        report = self.run_compare(native, wasm)
        self.assertFalse(report['match'])
        self.assertEqual(report['heater_setpoint_difference_count'], 2)
        self.assertNotIn('wasm_minus_native_setpoint_c',
                         report['first_heater_setpoint_differences'][0])
        self.assertIsNone(report['first_heater_setpoint_differences'][1]['wasm'])

    def test_opaque_heater_requests_are_unknown_not_fake_zero(self):
        for command in ('M104 S{temperature}', 'M104S220',
                        'M109 S200 R210', 'M140 S60 P1',
                        'M104 S-5', 'M104 S200 T999'):
            with self.subTest(command=command):
                report = self.run_compare(command + '\nG1 X1 E1\n',
                                          command + '\nG1 X1 E1\n')
                self.assertIsNone(report['heater_setpoint_difference_count'])
                self.assertIsNone(report['first_heater_setpoint_differences'])
                self.assertEqual(report['mismatched_commands'], 0)

    def test_heater_setpoint_difference_samples_bounded_but_count_complete(self):
        native = ''.join(f'M104 S{200 + i}\n' for i in range(20)) + 'G1 X1 E1\n'
        wasm = ''.join(f'M104 S{201 + i}\n' for i in range(20)) + 'G1 X1 E1\n'
        result = self.run_compare(native, wasm)
        self.assertEqual(result['heater_setpoint_difference_count'], 20)
        self.assertEqual(len(result['first_heater_setpoint_differences']), 15)
        self.assertEqual(result['first_heater_setpoint_differences'][0]
                         ['wasm_minus_native_setpoint_c'], '1')


    def test_chamber_heater_setpoints_are_distinct_from_bed_and_nozzle(self):
        # Marlin M141 sets chamber heat; M191 sets and waits.
        native = 'M141 S40\nM191 R45\nM140 S60\nG1 X1 E1\n'
        wasm = 'M141 S45\nM191 R40\nM140 S60\nG1 X1 E1\n'
        report = self.run_compare(native, wasm)
        self.assertFalse(report['match'])
        self.assertEqual(report['native_heater_setpoint_events'], 3)
        self.assertEqual(report['heater_setpoint_difference_count'], 2)
        first, second = report['first_heater_setpoint_differences']
        self.assertEqual(first['native']['heater'], 'chamber')
        self.assertEqual(first['native']['command'], 'M141')
        self.assertEqual(first['wasm_minus_native_setpoint_c'], '5')
        self.assertEqual(second['native']['heater'], 'chamber')
        self.assertEqual(second['native']['command'], 'M191')
        self.assertEqual(second['native']['mode'], 'R')
        self.assertEqual(second['wasm_minus_native_setpoint_c'], '-5')

    def test_unsupported_heater_dialects_are_unknown_not_zero_difference(self):
        # R is only a waiting command mode in this Marlin-bounded parser;
        # extra chamber indices/tools cannot be guessed from plain M141/M191.
        unsupported = ('M104 R200', 'M140 R60', 'M141 R40',
                       'M141 P1 S40', 'M191 T0 S40', 'M191S40')
        for command in unsupported:
            with self.subTest(command=command):
                report = self.run_compare(command + '\nG1 X1 E1\n',
                                          command + '\nG1 X1 E1\n')
                self.assertIsNone(report['heater_setpoint_difference_count'])
                self.assertIsNone(report['first_heater_setpoint_differences'])



    def test_explicit_fan_request_deltas_are_diagnostic_only(self):
        native = 'M106 S128\nM106 P2 S255\nM107 P3\nG1 X1 E1\n'
        wasm = 'M106 S64\nM106 P2 S200\nM107 P3\nG1 X1 E1\n'
        result = self.run_compare(native, wasm)
        self.assertFalse(result['match'])
        self.assertEqual(result['native_fan_request_events'], 3)
        self.assertEqual(result['wasm_fan_request_events'], 3)
        self.assertEqual(result['fan_request_difference_count'], 2)
        a, b = result['first_fan_request_differences']
        self.assertIsNone(a['native']['fan_index'])
        self.assertEqual(a['wasm_minus_native_pwm_word'], '-64')
        self.assertEqual(b['native']['fan_index'], 2)
        self.assertEqual(b['wasm_minus_native_pwm_word'], '-55')
        self.assertEqual(self.run_compare(native, native)['fan_request_difference_count'], 0)

    def test_fan_command_and_selector_identity_are_not_collapsed(self):
        result = self.run_compare('M106 S0\nM106 P2 S100\nM107 P1\n',
                                  'M107\nM106 P3 S100\n')
        self.assertEqual(result['fan_request_difference_count'], 3)
        for entry in result['first_fan_request_differences']:
            self.assertNotIn('wasm_minus_native_pwm_word', entry)
        self.assertIsNone(result['first_fan_request_differences'][-1]['wasm'])
        result = self.run_compare('M106 S100\n', 'M106 P0 S100\n')
        self.assertEqual(result['fan_request_difference_count'], 1)
        self.assertNotIn('wasm_minus_native_pwm_word', result['first_fan_request_differences'][0])

    def test_unknown_fan_dialects_and_invalid_requests_are_not_zero_differences(self):
        for cmd in ('M106', 'M106 P128', 'M126', 'M127', 'M106S128',
                    'M106 S256', 'M106 S-1', 'M106 S1 P0.5',
                    'M106 S100 S200', 'M106 S100 T1', 'M107 S1',
                    'M106 S{fan_speed}'):
            with self.subTest(cmd=cmd):
                result = self.run_compare(cmd + '\n', 'M106 S0\n')
                self.assertIsNone(result['native_fan_request_events'])
                self.assertEqual(result['wasm_fan_request_events'], 1)
                self.assertIsNone(result['fan_request_difference_count'])
                self.assertIsNone(result['first_fan_request_differences'])

    def test_fan_samples_bounded_count_and_padded_numbered_commands(self):
        native = 'N10 M0106 P2 S10.0\n' * 20
        wasm = 'N10 M0106 P2 S20\n' * 20
        result = self.run_compare(native, wasm)
        self.assertEqual(result['fan_request_difference_count'], 20)
        self.assertEqual(len(result['first_fan_request_differences']), 15)
        self.assertEqual(result['first_fan_request_differences'][0]
                         ['wasm_minus_native_pwm_word'], '10')

    def test_padded_xyz_mode_commands_preserve_observed_path_length(self):
        code = ('M83\nG090\nG1 X10 E1\nG091\nG1 X-10 E1\n'
                'G090\nG1 X20 E1\n')
        report = self.run_compare(code, code, min_extrusion_moves=3)
        self.assertTrue(report['match'], report)
        self.assertEqual(report['native_counted_linear_xy_mm'], '40')
        self.assertEqual(report['native_extrusion_moves'], 3)

    def test_padded_units_switch_preserves_g20_g21_geometry(self):
        code = 'M83\nG020\nG1 X1 E0.1\nG021\nG1 X10 E0.1\n'
        report = self.run_compare(code, code, min_extrusion_moves=2)
        self.assertTrue(report['match'], report)
        self.assertEqual(report['native_counted_linear_xy_mm'], '40.8')
        self.assertEqual(report['native_counted_positive_e_mm'], '2.64')

    def test_padded_g92_reset_reanchors_absolute_e(self):
        code = 'M82\nG1 X1 E1\nG092 E0\nG1 X2 E0.5\n'
        report = self.run_compare(code, code, min_extrusion_moves=2)
        self.assertTrue(report['match'], report)
        self.assertEqual(report['native_extrusion_moves'], 2)
        self.assertEqual(report['native_counted_positive_e_mm'], '1.5')

    def test_padded_absolute_and_relative_arc_center_modes(self):
        code = ('M83\nG0 X2 Y0\nG090.1\nG2 X0 Y2 I0 J0 E1\n'
                'G091.1\nG3 X2 Y0 I1 J-1 E1\n')
        report = self.run_compare(code, code, min_extrusion_moves=2)
        self.assertTrue(report['match'], report)
        self.assertEqual(report['native_extrusion_moves'], 2)

    def test_padded_modes_are_not_silently_equalized_in_strict_comparison(self):
        native = 'M83\nG091\nG1 X1 E1\n'
        wasm = 'M83\nG91\nG1 X1 E1\n'
        report = self.run_compare(native, wasm, min_extrusion_moves=1)
        self.assertFalse(report['match'])
        self.assertEqual(report['mismatched_commands'], 1)
        self.assertEqual(report['counted_linear_xy_delta_mm'], '0')


if __name__ == '__main__':
    unittest.main()
