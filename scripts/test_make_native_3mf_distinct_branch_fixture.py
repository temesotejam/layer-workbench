"""Offline tests for official-derived distinct 3MF branch construction."""
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from audit_native_3mf_instance_placement import inspect_placements
from clone_native_3mf_branched_root import clone_branched_root
from compare_3mf_metadata import inventory
from make_native_3mf_distinct_branch_fixture import make_distinct_branch_fixture
from test_audit_native_3mf_instance_placement import geometry_parts
from test_clone_native_3mf_branched_root import branched_parts
from test_clone_native_3mf_shared_root_chain import shared_root_parts
from test_verify_native_3mf_edit_effect import shared_nested_parts

MAIN = "3D/3dmodel.model"


class NativeDistinctBranchFixtureTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.official = root / "official.3mf"
        self.shared = root / "shared.3mf"
        self.output = root / "distinct.3mf"
        self.clone = root / "clone.3mf"

    def write(self, path, parts):
        with ZipFile(path, "w") as archive:
            archive.comment = b"test native package comment"
            for name, data in parts.items():
                archive.writestr(name, data)

    def test_distinct_edge_retains_all_other_payloads_and_can_detach(self):
        self.write(self.official, geometry_parts())
        self.write(self.shared, branched_parts())
        before_bytes = self.shared.read_bytes()
        report = make_distinct_branch_fixture(
            self.official, self.shared, self.output)
        self.assertEqual(report["instances"], 4)
        self.assertNotEqual(report["first_part"], report["second_part"])
        self.assertEqual(self.shared.read_bytes(), before_bytes)
        a, b = inventory(self.shared), inventory(self.output)
        self.assertEqual(set(a), set(b))
        self.assertEqual({p for p in a if a[p] != b[p]}, {MAIN})
        with ZipFile(self.shared) as src, ZipFile(self.output) as dst:
            self.assertEqual(src.comment, dst.comment)
            for name in a:
                if name != MAIN:
                    self.assertEqual(src.read(name), dst.read(name))
        observed = inspect_placements(self.output)["mesh_instances"]
        self.assertEqual([m["mesh_part"] for m in observed],
                         [report["first_part"], report["second_part"]] * 2)
        for edge in (0, 1):
            destination = self.clone if edge == 0 else self.clone.with_name("other.3mf")
            result = clone_branched_root(self.output, destination, edge_index=edge)
            self.assertTrue(result["geometry_unchanged"])
            self.assertEqual(
                inspect_placements(destination)["per_build_world_bounds_mm"],
                inspect_placements(self.output)["per_build_world_bounds_mm"])

    def test_reuse_empty_native_model_slot_when_both_roots_share_first_mesh(self):
        # Mirrors the real pinned v2.5.0 CLI export: both roots point at
        # the first external model, while an existing second part is empty.
        empty = (b'<model xmlns="http://schemas.microsoft.com/3dmanufacturing/'
                 b'core/2015/02"><resources/></model>')
        official_parts = shared_nested_parts()
        shared_parts = branched_parts()
        official_parts["3D/Objects/second.model"] = empty
        shared_parts["3D/Objects/second.model"] = empty
        self.write(self.official, official_parts)
        self.write(self.shared, shared_parts)
        report = make_distinct_branch_fixture(
            self.official, self.shared, self.output)
        self.assertTrue(report["synthetic_second_mesh"])
        self.assertEqual(report["changed_members"],
                         [MAIN, "3D/Objects/second.model"])
        instances = inspect_placements(self.output)["mesh_instances"]
        self.assertEqual(
            [row["mesh_part"] for row in instances],
            ["3D/Objects/first.model", "3D/Objects/second.model"] * 2)
        self.assertNotEqual(instances[0]["mesh_objectid"], instances[1]["mesh_objectid"])
        with ZipFile(self.official) as original:
            self.assertEqual(original.read("3D/Objects/second.model"), empty)
        clone_branched_root(self.output, self.clone, edge_index=1)
        self.assertEqual(len(inspect_placements(self.clone)["mesh_instances"]), 4)

    def test_absent_second_edge_rejected_without_output(self):
        self.write(self.official, geometry_parts())
        self.write(self.shared, shared_root_parts())
        with self.assertRaises(ValueError):
            make_distinct_branch_fixture(self.official, self.shared, self.output)
        self.assertFalse(self.output.exists())

    def test_missing_distinct_target_rejected(self):
        self.write(self.official, shared_root_parts())
        self.write(self.shared, branched_parts())
        with self.assertRaises(ValueError):
            make_distinct_branch_fixture(self.official, self.shared, self.output)
        self.assertFalse(self.output.exists())

    def test_existing_output_and_same_input_rejected(self):
        self.write(self.official, geometry_parts())
        self.write(self.shared, branched_parts())
        self.output.write_bytes(b"sentinel")
        with self.assertRaises(ValueError):
            make_distinct_branch_fixture(self.official, self.shared, self.output)
        self.assertEqual(self.output.read_bytes(), b"sentinel")
        with self.assertRaises(ValueError):
            make_distinct_branch_fixture(self.official, self.shared, self.shared)
        self.assertEqual(self.output.read_bytes(), b"sentinel")


if __name__ == "__main__":
    unittest.main()
