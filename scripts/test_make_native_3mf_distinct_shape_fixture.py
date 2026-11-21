"""Regression tests for synthetic different-shaped external leaves (never G-code)."""
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from audit_native_3mf_instance_placement import inspect_placements
from clone_native_3mf_branched_root import clone_branched_root
from compare_3mf_metadata import inventory
from make_native_3mf_distinct_branch_fixture import make_distinct_branch_fixture
from make_native_3mf_distinct_shape_fixture import make_distinct_shape_fixture
from test_audit_native_3mf_instance_placement import geometry_parts
from test_clone_native_3mf_branched_root import branched_parts


class DistinctShapeFixtureTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        self.official = root / "official.3mf"
        self.shared = root / "shared.3mf"
        self.distinct = root / "distinct.3mf"
        self.shape = root / "shaped.3mf"
        self.private = root / "private.3mf"
        for path, parts in ((self.official, geometry_parts()),
                            (self.shared, branched_parts())):
            with ZipFile(path, "w") as archive:
                archive.comment = b"preserve this"
                for name, data in parts.items():
                    archive.writestr(name, data)
        make_distinct_branch_fixture(self.official, self.shared, self.distinct)

    def test_only_second_mesh_changes_and_both_branches_survive_detach(self):
        original_bytes = self.distinct.read_bytes()
        original = inspect_placements(self.distinct)["mesh_instances"]
        report = make_distinct_shape_fixture(self.distinct, self.shape)
        self.assertTrue(report["synthetic"])
        self.assertEqual(report["mesh_occurrences"], 4)
        self.assertEqual(self.distinct.read_bytes(), original_bytes)
        before, after = inventory(self.distinct), inventory(self.shape)
        self.assertEqual(set(before), set(after))
        self.assertEqual({p for p in before if before[p] != after[p]},
                         {report["modified_part"]})
        with ZipFile(self.distinct) as a, ZipFile(self.shape) as b:
            self.assertEqual(a.comment, b.comment)
            self.assertEqual(a.read("3D/3dmodel.model"), b.read("3D/3dmodel.model"))
            self.assertEqual(a.read("Metadata/project_settings.config"),
                             b.read("Metadata/project_settings.config"))
        changed = inspect_placements(self.shape)["mesh_instances"]
        for index in (0, 2):
            self.assertEqual(original[index]["world_bounds_mm"],
                             changed[index]["world_bounds_mm"])
        for index in (1, 3):
            self.assertNotEqual(original[index]["world_bounds_mm"],
                                changed[index]["world_bounds_mm"])
        self.assertNotAlmostEqual(report["first_y_span_mm"],
                                  report["second_y_span_mm"])
        for edge in (0, 1):
            target = self.private if edge == 0 else self.private.with_name("private1.3mf")
            detached = clone_branched_root(self.shape, target, edge_index=edge)
            self.assertTrue(detached["geometry_unchanged"])
            again = inspect_placements(target)["mesh_instances"]
            self.assertEqual([m["world_bounds_mm"] for m in changed],
                             [m["world_bounds_mm"] for m in again])
            self.assertNotEqual(again[2+edge]["mesh_objectid"],
                                changed[2+edge]["mesh_objectid"])

    def test_nonexistent_distinct_path_and_existing_output_rejected(self):
        with self.assertRaises(ValueError):
            make_distinct_shape_fixture(self.shared, self.shape)
        self.assertFalse(self.shape.exists())
        self.shape.write_bytes(b"sentinel")
        with self.assertRaises(ValueError):
            make_distinct_shape_fixture(self.distinct, self.shape)
        self.assertEqual(self.shape.read_bytes(), b"sentinel")
        with self.assertRaises(ValueError):
            make_distinct_shape_fixture(self.distinct, self.distinct)
        self.assertEqual(self.shape.read_bytes(), b"sentinel")


if __name__ == "__main__":
    unittest.main()
