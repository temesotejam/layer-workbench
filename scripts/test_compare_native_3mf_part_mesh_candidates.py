"""Offline evidence gates for numeric Part/Core candidate drift; no 3MF rewrite."""
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from clone_native_3mf_branched_root import clone_branched_root
from compare_native_3mf_part_mesh_candidates import compare_candidate_contexts
from test_clone_native_3mf_branched_root import (
    branched_parts, distinct_branched_parts,
)

MAIN = "3D/3dmodel.model"
LEAF = "3D/Objects/first.model"
SETTINGS = "Metadata/model_settings.config"


class NativePartCandidateDriftTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.original = Path(tmp.name) / "before.3mf"
        self.changed = Path(tmp.name) / "after.3mf"

    def write(self, path, parts):
        with ZipFile(path, "w") as z:
            for name, raw in parts.items():
                z.writestr(name, raw)

    def distinct_parts(self):
        parts = distinct_branched_parts()
        parts[SETTINGS] = (b'<config><object id="1">'
                           b'<part id="101" subtype="normal_part"/>'
                           b'<part id="102" subtype="normal_part"/>'
                           b'</object><object id="2"/></config>')
        return parts

    def test_unchanged_native_context_is_not_semantic_mapping_proof(self):
        self.write(self.original, self.distinct_parts())
        report = compare_candidate_contexts(self.original, self.original)
        self.assertEqual(report["status"], "no_observed_numeric_candidate_drift")
        self.assertEqual(report["lost_unique_numeric_candidates"], 0)
        self.assertEqual(report["new_direct_object_settings_gaps"], 0)
        self.assertFalse(report["semantic_part_to_volume_identity_proven"])
        self.assertNotIn("value=", str(report))

    def test_shared_root_clone_reports_new_settings_gap(self):
        parts = branched_parts()
        parts[SETTINGS] = (b'<config><object id="1">'
                           b'<part id="101" subtype="normal_part">'
                           b'<metadata key="name" value="PRIVATE_SECRET"/></part>'
                           b'<part id="101" subtype="normal_part"/>'
                           b'</object></config>')
        self.write(self.original, parts)
        clone_branched_root(self.original, self.changed, edge_index=0)
        report = compare_candidate_contexts(self.original, self.changed)
        self.assertEqual(report["new_direct_object_settings_gaps"], 1)
        self.assertEqual(report["status"], "review_numeric_or_settings_drift")
        self.assertEqual([r["object_settings_entry_missing_after_edit"] for r
                          in report["build_context_changes"]], [False, True])
        self.assertNotIn("PRIVATE_SECRET", str(report))

    def test_leaf_id_relabel_loses_numeric_evidence_without_metadata_change(self):
        parts = self.distinct_parts()
        self.write(self.original, parts)
        # Valid Core-only relabel; the vendor Part's old numeric label remains.
        changed = dict(parts)
        self.assertEqual(changed[MAIN].count(b'objectid="101"'), 1)
        self.assertEqual(changed[LEAF].count(b'<object id="101"'), 1)
        changed[MAIN] = changed[MAIN].replace(
            b'objectid="101"', b'objectid="103"', 1)
        changed[LEAF] = changed[LEAF].replace(
            b'<object id="101"', b'<object id="103"', 1)
        self.write(self.changed, changed)
        report = compare_candidate_contexts(self.original, self.changed)
        self.assertEqual(report["lost_unique_numeric_candidates"], 2)
        self.assertEqual(report["new_direct_object_settings_gaps"], 0)
        self.assertEqual(report["changed_vendor_part_inventories"], 0)
        self.assertEqual(report["status"], "review_numeric_or_settings_drift")
        for row in report["build_context_changes"]:
            self.assertEqual(len(row["lost_unique_numeric_part_id_candidates"]), 1)
            self.assertEqual(row["lost_unique_numeric_part_id_candidates"][0]
                             ["current_numeric_candidate_status"],
                             "no_numeric_core_id_candidate")

    def test_mismatched_core_occurrence_count_refused(self):
        parts = self.distinct_parts()
        self.write(self.original, parts)
        changed = dict(parts)
        # The selected root loses a component edge; cannot compare by index.
        changed[MAIN] = changed[MAIN].replace(
            b'<component objectid="102" '
            b'p:path="/3D/Objects/second.model" '
            b'transform="1 0 0 0 1 0 0 0 1 34 0 0"/>', b'', 1)
        self.assertNotEqual(changed[MAIN], parts[MAIN])
        self.write(self.changed, changed)
        with self.assertRaisesRegex(ValueError, "occurrence count"):
            compare_candidate_contexts(self.original, self.changed)


if __name__ == "__main__":
    unittest.main()
