"""Read-only Part-value round-trip audit regressions (no native CLI required)."""
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from clone_native_3mf_branched_root import clone_branched_root
from reconcile_native_3mf_cloned_root_settings import copy_bounded_root_settings
from test_reconcile_native_3mf_cloned_root_settings import native_fixture
from audit_native_3mf_part_value_roundtrip import (
    compare_part_values, _matrix_coefficient_status,
)

SETTINGS = "Metadata/model_settings.config"


class PartValueRoundtripTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.source = Path(temp.name) / "source.3mf"
        self.core = Path(temp.name) / "core.3mf"
        self.restored = Path(temp.name) / "restored.3mf"
        self.changed = Path(temp.name) / "changed.3mf"
        with ZipFile(self.source, "w") as z:
            for name, data in native_fixture().items():
                z.writestr(name, data)
        clone_branched_root(self.source, self.core, edge_index=1)
        copy_bounded_root_settings(self.source, self.core, self.restored)

    def mutate(self, before, after):
        with ZipFile(self.restored) as source:
            with ZipFile(self.changed, "w") as target:
                for info in source.infolist():
                    raw = source.read(info)
                    if info.filename == SETTINGS:
                        raw = raw.replace(before, after)
                    target.writestr(info, raw)

    def test_core_part_id_change_is_not_value_loss(self):
        report = compare_part_values(self.source, self.restored)
        self.assertEqual(report["observed_value_or_inventory_changes"], 0)
        self.assertEqual(report["changed_numeric_part_labels"], 1)
        self.assertEqual(report["status"], "numeric_labels_changed_values_stable")

    def test_changed_value_only_reports_key_and_never_private_value(self):
        self.mutate(b'SENSITIVE_PART_NAME', b'PRIVATE_NEW_VALUE')
        report = compare_part_values(self.restored, self.changed)
        self.assertEqual(report["observed_value_or_inventory_changes"], 2)
        self.assertEqual(report["builds"][0]["part_comparisons"][0]["changed_metadata_value_keys"], ["name"])
        self.assertNotIn("PRIVATE_NEW_VALUE", str(report))
        self.assertNotIn("SENSITIVE_PART_NAME", str(report))
        self.assertNotIn("/private/provenance/", str(report))

    def test_removed_key_is_detected(self):
        self.mutate(
            b'<metadata key="source_offset_x" value="2"/>',
            b'')
        report = compare_part_values(self.restored, self.changed)
        self.assertEqual(report["observed_value_or_inventory_changes"], 2)
        self.assertEqual(
            report["builds"][1]["part_comparisons"][1]["removed_metadata_keys"],
            ["source_offset_x"])

    def test_missing_direct_root_settings_is_reported(self):
        report = compare_part_values(self.restored, self.core)
        self.assertEqual(report["status"], "review_observed_part_metadata_drift")
        self.assertTrue(report["builds"][1]["missing_direct_settings_after"])

    def test_changes_in_part_count_are_detected(self):
        with ZipFile(self.restored) as z:
            raw = z.read(SETTINGS)
        # Only the copied root loses its second Part.
        start = raw.index(b'<object id="3">')
        end = raw.index(b'</object>', start)
        block = raw[start:end]
        cut = block.index(b'<part id="103"')
        block = block[:cut]
        self.mutate(raw[start:end], block)
        report = compare_part_values(self.restored, self.changed)
        self.assertTrue(report["builds"][1]["part_count_changed"])

    def test_duplicate_metadata_keys_are_not_silently_collapsed(self):
        self.mutate(
            b'<metadata key="name" value="SENSITIVE_PART_NAME"/>',
            b'<metadata key="name" value="SENSITIVE_PART_NAME"/>'
            b'<metadata key="name" value="PRIVATE_DUPLICATE"/>')
        report = compare_part_values(self.restored, self.changed)
        self.assertEqual(report["observed_value_or_inventory_changes"], 2)
        self.assertNotIn("PRIVATE_DUPLICATE", str(report))


    def test_matrix_drift_classification_never_reports_raw_values(self):
        base = "1 0 0 123 0 1 0 0 0 0 1 0 0 0 0 1"
        close = "1 0 0 123.0000004 0 1 0 0 0 0 1 0 0 0 0 1"
        far = "1 0 0 124 0 1 0 0 0 0 1 0 0 0 0 1"
        self.assertEqual(
            _matrix_coefficient_status([base], [close]),
            "coefficient_delta_within_1e-6")
        self.assertEqual(
            _matrix_coefficient_status([base], [far]),
            "coefficient_delta_exceeds_1e-6")
        self.assertEqual(
            _matrix_coefficient_status([base], ["  " + base + "  "]),
            "numeric_coefficients_equal")

    def test_matrix_drift_rejects_ambiguous_and_nonfinite_values(self):
        valid = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"
        for malformed in ("1 0 0", "NaN " + "0 " * 14 + "1",
                          "inf " + "0 " * 14 + "1", "x " + "0 " * 14 + "1",
                          "0 " * 2050):
            self.assertEqual(
                _matrix_coefficient_status([valid], [malformed]),
                "not_comparable_invalid_4x4")
        self.assertEqual(
            _matrix_coefficient_status([valid], [valid, valid]),
            "not_comparable_missing_or_duplicate")
        self.assertEqual(
            _matrix_coefficient_status([], [valid]),
            "not_comparable_missing_or_duplicate")

    def test_matrix_report_keeps_original_drift_and_private_values_hidden(self):
        base = "1 0 0 123 0 1 0 0 0 0 1 0 0 0 0 1"
        changed = "1 0 0 124 0 1 0 0 0 0 1 0 0 0 0 1"
        left = Path(self.source.parent) / "matrix-before.3mf"
        right = Path(self.source.parent) / "matrix-after.3mf"

        for output, matrix in ((left, base), (right, changed)):
            with ZipFile(self.restored) as original, ZipFile(output, "w") as target:
                for info in original.infolist():
                    raw = original.read(info)
                    if info.filename == SETTINGS:
                        key = b'<metadata key="source_offset_x" value="2"/>'
                        self.assertIn(key, raw)
                        raw = raw.replace(
                            key, key + b'<metadata key="matrix" value="' +
                            matrix.encode("ascii") + b'"/>')
                    target.writestr(info, raw)

        report = compare_part_values(left, right)
        self.assertEqual(report["status"], "review_observed_part_metadata_drift")
        self.assertEqual(report["observed_value_or_inventory_changes"], 2)
        self.assertEqual(
            report["builds"][1]["part_comparisons"][1][
                "matrix_4x4_coefficient_diagnostic"],
            "coefficient_delta_exceeds_1e-6")
        serialized = str(report)
        self.assertNotIn(base, serialized)
        self.assertNotIn(changed, serialized)
        self.assertNotIn("/private/provenance/", serialized)


if __name__ == "__main__":
    unittest.main()
