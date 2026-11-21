"""Offline regression for one detached branch mesh edit; no printer output."""
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from audit_native_3mf_instance_placement import inspect_placements
from clone_native_3mf_branched_root import clone_branched_root
from compare_3mf_metadata import inventory
from scale_native_3mf_branched_private_leaf import scale_private_branched_leaf
from test_clone_native_3mf_branched_root import distinct_branched_parts


class PrivateBranchedLeafScaleTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        folder = Path(tmp.name)
        self.shared = folder / "shared.3mf"
        self.detached = folder / "detached.3mf"
        self.edited = folder / "edited.3mf"
        with ZipFile(self.shared, "w") as archive:
            archive.comment = b"keep custom ZIP comment"
            for name, data in distinct_branched_parts().items():
                archive.writestr(name, data)

    def test_both_edges_edit_only_selected_private_mesh(self):
        for edge in (0, 1):
            with self.subTest(edge=edge):
                clone_branched_root(self.shared, self.detached, edge_index=edge)
                original_bytes = self.detached.read_bytes()
                before = inspect_placements(self.detached)["mesh_instances"]
                report = scale_private_branched_leaf(
                    self.detached, self.edited, edge_index=edge,
                    scale_factor=1.2, axis="y")
                after = inspect_placements(self.edited)["mesh_instances"]
                self.assertEqual(report["edited_edge_index"], edge)
                self.assertEqual(self.detached.read_bytes(), original_bytes)
                for index, (old, new) in enumerate(zip(before, after)):
                    self.assertEqual(old["mesh_objectid"], new["mesh_objectid"])
                    self.assertEqual(old["triangle_count"], new["triangle_count"])
                    self.assertEqual(old["world_transform3mf"], new["world_transform3mf"])
                    self.assertEqual(old["world_bounds_mm"] == new["world_bounds_mm"],
                                     index != edge + 2)
                old, new = inventory(self.detached), inventory(self.edited)
                self.assertEqual(set(old), set(new))
                self.assertEqual(
                    {name for name in old if old[name] != new[name]},
                    {report["private_mesh_part"]})
                with ZipFile(self.detached) as a, ZipFile(self.edited) as b:
                    self.assertEqual(a.comment, b.comment)
                    self.assertEqual(a.read("Metadata/project_settings.config"),
                                     b.read("Metadata/project_settings.config"))
                    self.assertEqual(a.read("3D/3dmodel.model"),
                                     b.read("3D/3dmodel.model"))
                self.edited.unlink()
                self.detached.unlink()

    def test_shared_branch_cannot_be_edited(self):
        with self.assertRaises(ValueError):
            scale_private_branched_leaf(self.shared, self.edited)
        self.assertFalse(self.edited.exists())

    def test_invalid_inputs_fail_without_output_or_overwrite(self):
        clone_branched_root(self.shared, self.detached, edge_index=1)
        for edge, factor, axis in [
            (-1, 1.2, "y"), (2, 1.2, "y"), (True, 1.2, "y"),
            (1, 1, "y"), (1, float("nan"), "y"), (1, 2, "y"),
            (1, -1, "y"), (1, True, "y"), (1, 1.2, "Y"),
        ]:
            with self.subTest(edge=edge, factor=factor, axis=axis):
                with self.assertRaises(ValueError):
                    scale_private_branched_leaf(
                        self.detached, self.edited, edge, factor, axis)
                self.assertFalse(self.edited.exists())
        self.edited.write_bytes(b"do not replace")
        with self.assertRaises(ValueError):
            scale_private_branched_leaf(self.detached, self.edited)
        self.assertEqual(self.edited.read_bytes(), b"do not replace")


if __name__ == "__main__":
    unittest.main()
