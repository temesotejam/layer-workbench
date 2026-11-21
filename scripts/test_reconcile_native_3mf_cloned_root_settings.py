"""Offline guarded Part-settings remap: only one known two-leaf root clone."""
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from clone_native_3mf_branched_root import clone_branched_root
from compare_3mf_metadata import inventory
from reconcile_native_3mf_cloned_root_settings import copy_bounded_root_settings
from audit_native_3mf_metadata_object_refs import inspect_metadata_refs
from test_clone_native_3mf_branched_root import distinct_branched_parts

SETTINGS = "Metadata/model_settings.config"


def native_fixture():
    parts = distinct_branched_parts()
    parts[SETTINGS] = (
        b'<config><object id="1"><part id="101" subtype="normal_part">'
        b'<metadata key="name" value="SENSITIVE_PART_NAME"/>'
        b'<metadata key="source_file" value="/private/provenance/sample.stl"/>'
        b'<metadata key="source_object_id" value="999"/>'
        b'<metadata key="source_volume_id" value="888"/>'
        b'</part><part id="102" subtype="normal_part">'
        b'<metadata key="source_offset_x" value="2"/>'
        b'</part></object></config>'
    )
    return parts


class BoundedCOWSettingsRemapTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.original = Path(tmp.name) / "source.3mf"
        self.core = Path(tmp.name) / "core-only.3mf"
        self.restored = Path(tmp.name) / "settings-mapped.3mf"

    def make(self, parts=None, edge=0):
        with ZipFile(self.original, "w") as z:
            for name, raw in (parts if parts is not None else native_fixture()).items():
                z.writestr(name, raw)
        clone_branched_root(self.original, self.core, edge_index=edge)

    def test_one_unique_private_leaf_part_id_remapped_without_touching_sibling(self):
        # Clone edge 1: new Part 103 is unique. Cloning edge 0 instead
        # makes a new leaf 102, colliding with the other model-part's ID.
        self.make(edge=1)
        original_bytes, core_bytes = self.original.read_bytes(), self.core.read_bytes()
        info = copy_bounded_root_settings(self.original, self.core, self.restored)
        self.assertFalse(info["semantic_vendor_parity_proven"])
        self.assertEqual(self.original.read_bytes(), original_bytes)
        self.assertEqual(self.core.read_bytes(), core_bytes)
        before, after = inventory(self.core), inventory(self.restored)
        self.assertEqual({key for key in before if before[key] != after[key]}, {SETTINGS})
        metadata = inspect_metadata_refs(self.restored)
        self.assertEqual(metadata["settings_object_ids"], ["1", "3"])
        clone_parts = metadata["settings_part_inventory"]["3"]
        original_parts = metadata["settings_part_inventory"]["1"]
        self.assertEqual([p["id"] for p in original_parts], ["101", "102"])
        self.assertEqual([p["id"] for p in clone_parts], ["101", "103"])
        self.assertEqual([p["metadata_keys"] for p in clone_parts],
                         [p["metadata_keys"] for p in original_parts])
        with ZipFile(self.restored) as z:
            settings = z.read(SETTINGS)
        self.assertEqual(settings.count(b'SENSITIVE_PART_NAME'), 2)
        self.assertEqual(settings.count(b'/private/provenance/sample.stl'), 2)
        self.assertEqual(settings.count(b'value="999"'), 2)
        self.assertNotIn('SENSITIVE_PART_NAME', str(info))
        self.assertNotIn('/private/provenance/', str(info))

    def test_cross_model_part_numeric_collision_refuses(self):
        self.make(edge=0)
        with self.assertRaisesRegex(ValueError, "one unique private leaf ID"):
            copy_bounded_root_settings(self.original, self.core, self.restored)
        self.assertFalse(self.restored.exists())

    def test_opaque_vendor_metadata_refuses_without_output(self):
        parts = native_fixture()
        parts[SETTINGS] = parts[SETTINGS].replace(b'key="name"', b'key="custom_uuid"', 1)
        self.make(parts, edge=1)
        with self.assertRaisesRegex(ValueError, "Unknown vendor metadata"):
            copy_bounded_root_settings(self.original, self.core, self.restored)
        self.assertFalse(self.restored.exists())

    def test_nonmatching_native_part_label_refuses(self):
        parts = native_fixture()
        parts[SETTINGS] = parts[SETTINGS].replace(b'<part id="101"', b'<part id="999"')
        self.make(parts)
        with self.assertRaisesRegex(ValueError, "root clone"):
            copy_bounded_root_settings(self.original, self.core, self.restored)
        self.assertFalse(self.restored.exists())

    def test_original_and_output_collision_refused_without_rewrite(self):
        self.make()
        before = self.original.read_bytes()
        with self.assertRaisesRegex(ValueError, "distinct"):
            copy_bounded_root_settings(self.original, self.core, self.original)
        self.assertEqual(before, self.original.read_bytes())

    def test_candidate_must_be_unchanged_vendor_settings(self):
        self.make(edge=1)
        with ZipFile(self.core) as original:
            parts = {name: original.read(name) for name in original.namelist()}
        parts[SETTINGS] = parts[SETTINGS].replace(b'888', b'777')
        with ZipFile(self.core, "w") as rewritten:
            for name, raw in parts.items():
                rewritten.writestr(name, raw)
        with self.assertRaisesRegex(ValueError, "root clone"):
            copy_bounded_root_settings(self.original, self.core, self.restored)
        self.assertFalse(self.restored.exists())


if __name__ == "__main__":
    unittest.main()
