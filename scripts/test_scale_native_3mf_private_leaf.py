"""Regression tests for private Core mesh vertex edits after leaf copy-on-write."""
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from audit_native_3mf_instance_placement import inspect_placements
from clone_native_3mf_shared_leaf import clone_shared_leaf
from compare_3mf_metadata import inventory
from scale_native_3mf_private_leaf import scale_private_leaf
from test_verify_native_3mf_edit_effect import shared_nested_parts

MAIN = "3D/3dmodel.model"
LEAF = "3D/Objects/first.model"


class PrivateCoreMeshScaleTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.source = Path(folder.name) / "source.3mf"
        self.private = Path(folder.name) / "private.3mf"
        self.scaled = Path(folder.name) / "scaled.3mf"
        with ZipFile(self.source, "w") as archive:
            archive.comment = b"preserve private fixture zip comment"
            for name, payload in shared_nested_parts().items():
                archive.writestr(name, payload)

    def clone(self):
        clone_shared_leaf(self.source, self.private, 1, 0)

    def test_private_leaf_vertex_scale_preserves_other_build_and_opaque_payloads(self):
        self.clone()
        baseline_bytes = self.private.read_bytes()
        before = inspect_placements(self.private)
        report = scale_private_leaf(self.private, self.scaled, 1, 0, 1.2)
        after = inspect_placements(self.scaled)
        self.assertTrue(report["sibling_unchanged"])
        self.assertTrue(report["opaque_zip_members_preserved"])
        self.assertEqual(report["changed_model_parts"], [LEAF])
        self.assertEqual(before["per_build_world_bounds_mm"][0],
                         after["per_build_world_bounds_mm"][0])
        self.assertNotEqual(before["per_build_world_bounds_mm"][1],
                            after["per_build_world_bounds_mm"][1])
        self.assertEqual(self.private.read_bytes(), baseline_bytes)
        old_members, new_members = inventory(self.private), inventory(self.scaled)
        self.assertEqual({name for name in old_members
                          if old_members[name] != new_members[name]}, {LEAF})
        with ZipFile(self.private) as a, ZipFile(self.scaled) as b:
            self.assertEqual(a.comment, b.comment)
            self.assertEqual(a.read(MAIN), b.read(MAIN))
            for name in old_members:
                if name != LEAF:
                    self.assertEqual(a.read(name), b.read(name))

    def test_uncloned_shared_leaf_fails_without_creating_output(self):
        with self.assertRaisesRegex(ValueError, "private external clone"):
            scale_private_leaf(self.source, self.scaled)
        self.assertFalse(self.scaled.exists())

    def test_invalid_scales_and_output_protection(self):
        self.clone()
        for factor in (0, 1, -1, 0.49, 1.51, float("nan"),
                       float("inf"), True, "1.1"):
            with self.subTest(factor=factor), self.assertRaises(ValueError):
                scale_private_leaf(self.private, self.scaled, 1, 0, factor)
            self.assertFalse(self.scaled.exists())
        self.scaled.write_bytes(b"never overwrite")
        with self.assertRaisesRegex(ValueError, "nonexistent"):
            scale_private_leaf(self.private, self.scaled)
        self.assertEqual(self.scaled.read_bytes(), b"never overwrite")

    def test_wrong_target_and_occurrence_rejected(self):
        self.clone()
        for build, edge in ((0, 0), (1, 1), (2, 0), (True, 0), (1, True)):
            with self.subTest(build=build, edge=edge), self.assertRaises(ValueError):
                scale_private_leaf(self.private, self.scaled, build, edge, 1.2)
            self.assertFalse(self.scaled.exists())

    def test_unsupported_raw_vertex_markup_rejected(self):
        self.clone()
        with ZipFile(self.private) as original:
            with ZipFile(self.scaled, "w") as modified:
                for info in original.infolist():
                    payload = original.read(info)
                    if info.filename == LEAF:
                        payload = payload.replace(b"</resources>",
                                                  b"<!-- ambiguous -->\n</resources>")
                    modified.writestr(info, payload)
        tampered = self.scaled
        output = tampered.with_name("refused.3mf")
        with self.assertRaisesRegex(ValueError, "comment"):
            scale_private_leaf(tampered, output)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
