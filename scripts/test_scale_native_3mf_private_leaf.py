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

    def test_y_and_z_axis_scales_are_isolated_and_keep_other_coordinates(self):
        self.clone()
        before = inspect_placements(self.private)
        leaf_id = before["mesh_instances"][1]["mesh_objectid"]
        from clone_native_3mf_shared_leaf import _object_block, _attribute
        from scale_native_3mf_private_leaf import VERTEX_TAG

        def vertex_attrs(raw):
            start, _, end = _object_block(raw, leaf_id)
            return [
                {key: _attribute(m.group(), key).group("value")
                 for key in ("x", "y", "z")}
                for m in VERTEX_TAG.finditer(raw[start:end])
            ]

        with ZipFile(self.private) as original:
            old_vertices = vertex_attrs(original.read(LEAF))
        for axis in ("y", "z"):
            output = self.scaled.with_name("scaled-" + axis + ".3mf")
            report = scale_private_leaf(self.private, output, 1, 0, 1.2, axis)
            self.assertEqual(report["scale_axis"], axis)
            self.assertEqual(report["scale_factor"], 1.2)
            after = inspect_placements(output)
            self.assertEqual(before["per_build_world_bounds_mm"][0],
                             after["per_build_world_bounds_mm"][0])
            self.assertNotEqual(before["per_build_world_bounds_mm"][1],
                                after["per_build_world_bounds_mm"][1])
            with ZipFile(self.private) as original, ZipFile(output) as edited:
                self.assertEqual(original.comment, edited.comment)
                self.assertEqual(original.read(MAIN), edited.read(MAIN))
                for member in inventory(self.private):
                    if member != LEAF:
                        self.assertEqual(original.read(member), edited.read(member))
                new_vertices = vertex_attrs(edited.read(LEAF))
            self.assertEqual(len(old_vertices), len(new_vertices))
            self.assertTrue(any(old[axis] != new[axis]
                                for old, new in zip(old_vertices, new_vertices)))
            for old, new in zip(old_vertices, new_vertices):
                for other in {"x", "y", "z"} - {axis}:
                    self.assertEqual(old[other], new[other])

    def test_invalid_axis_rejected_without_output(self):
        self.clone()
        for axis in (None, "", "X", "w", 0, True, ("z",)):
            with self.subTest(axis=axis), self.assertRaises(ValueError):
                scale_private_leaf(self.private, self.scaled, 1, 0, 1.2, axis)
            self.assertFalse(self.scaled.exists())

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
