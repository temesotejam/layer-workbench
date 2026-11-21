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

    def test_one_private_leaf_part_id_remapped_without_touching_other_parts(self):
        for edge in (0, 1):
            with self.subTest(edge=edge):
                self.make(edge=edge)
                original_bytes, core_bytes = self.original.read_bytes(), self.core.read_bytes()
                info = copy_bounded_root_settings(self.original, self.core, self.restored)
                self.assertFalse(info["semantic_vendor_parity_proven"])
                self.assertEqual(self.original.read_bytes(), original_bytes)
                self.assertEqual(self.core.read_bytes(), core_bytes)
                self.assertEqual({k for k in inventory(self.core)
                                  if inventory(self.core)[k] != inventory(self.restored)[k]},
                                 {SETTINGS})
                metadata = inspect_metadata_refs(self.restored)
                self.assertEqual(metadata["settings_object_ids"], ["1", "3"])
                clone_parts = metadata["settings_part_inventory"]["3"]
                original_parts = metadata["settings_part_inventory"]["1"]
                self.assertEqual([p["id"] for p in original_parts], ["101", "102"])
                changed = [p["id"] for p in clone_parts]
                self.assertEqual(changed, ["103", "102"] if edge == 0 else ["101", "103"])
                self.assertEqual([p["metadata_keys"] for p in clone_parts],
                                 [p["metadata_keys"] for p in original_parts])
                with ZipFile(self.restored) as z:
                    settings = z.read(SETTINGS)
                self.assertEqual(settings.count(b'SENSITIVE_PART_NAME'), 2)
                self.assertEqual(settings.count(b'value="999"'), 2)
                self.assertNotIn('SENSITIVE_PART_NAME', str(info))
                self.restored.unlink()
                self.core.unlink()
                self.original.unlink()

    def test_opaque_vendor_metadata_refuses_without_output(self):
        parts = native_fixture()
        parts[SETTINGS] = parts[SETTINGS].replace(b'key="name"', b'key="custom_uuid"', 1)
        self.make(parts)
        with self.assertRaisesRegex(ValueError, "Unknown vendor metadata"):
            copy_bounded_root_settings(self.original, self.core, self.restored)
        self.assertFalse(self.restored.exists())

    def test_nonmatching_native_part_label_refuses(self):
        parts = native_fixture()
        parts[SETTINGS] = parts[SETTINGS].replace(b'<part id="101"', b'<part id="999"')
        self.make(parts)
        with self.assertRaisesRegex(ValueError, "one-to-one"):
            copy_bounded_root_settings(self.original, self.core, self.restored)
        self.assertFalse(self.restored.exists())

    def test_original_and_output_collision_refused_without_rewrite(self):
        self.make()
        before = self.original.read_bytes()
        with self.assertRaisesRegex(ValueError, "distinct"):
            copy_bounded_root_settings(self.original, self.core, self.original)
        self.assertEqual(before, self.original.read_bytes())

    def test_candidate_must_be_unchanged_vendor_settings(self):
        self.make()
        # A no-op baseline is not a COW root clone and must not be accepted.
        with self.assertRaisesRegex(ValueError, "root clone"):
            copy_bounded_root_settings(self.original, self.original, self.restored)
        self.assertFalse(self.restored.exists())


if __name__ == "__main__":
    unittest.main()
