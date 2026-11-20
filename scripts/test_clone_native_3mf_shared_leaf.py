"""Safe single-leaf native Core 3MF copy-on-write writer regression tests."""
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from clone_native_3mf_shared_leaf import clone_shared_leaf
from audit_native_3mf_instance_placement import inspect_placements
from compare_3mf_metadata import inventory
from plan_native_3mf_copy_on_write import plan_copy_on_write
from test_verify_native_3mf_edit_effect import shared_nested_parts
from test_audit_native_3mf_instance_placement import geometry_parts

MAIN = "3D/3dmodel.model"
LEAF = "3D/Objects/first.model"


class NativeCoreLeafCloneTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.source = Path(folder.name) / "source.3mf"
        self.output = Path(folder.name) / "private.3mf"

    def write(self, parts):
        with ZipFile(self.source, "w") as archive:
            archive.comment = b"untouched archive comment"
            for name, payload in parts.items():
                archive.writestr(name, payload)

    def test_shared_external_leaf_cloned_without_changing_sibling_or_geometry(self):
        self.write(shared_nested_parts())
        before_bytes = self.source.read_bytes()
        before = inspect_placements(self.source)
        report = clone_shared_leaf(self.source, self.output, 1, 0)
        after = inspect_placements(self.output)
        self.assertTrue(report["opaque_zip_members_preserved"])
        self.assertTrue(report["geometry_unchanged"])
        self.assertEqual(report["source_mesh"], {"part": LEAF, "objectid": "101"})
        self.assertNotEqual(report["cloned_mesh"]["objectid"], "101")
        self.assertEqual(before["per_build_world_bounds_mm"], after["per_build_world_bounds_mm"])
        self.assertEqual(before["mesh_instances"][0]["mesh_objectid"],
                         after["mesh_instances"][0]["mesh_objectid"])
        self.assertNotEqual(before["mesh_instances"][1]["mesh_objectid"],
                            after["mesh_instances"][1]["mesh_objectid"])
        self.assertFalse(plan_copy_on_write(self.output, 1, [0])["copy_on_write_required"])
        self.assertEqual(self.source.read_bytes(), before_bytes)
        before_members, after_members = inventory(self.source), inventory(self.output)
        self.assertEqual({key for key in before_members if
                          before_members[key] != after_members[key]}, {MAIN, LEAF})
        with ZipFile(self.source) as a, ZipFile(self.output) as b:
            self.assertEqual(a.comment, b.comment)
            for name in before_members:
                if name not in (MAIN, LEAF):
                    self.assertEqual(a.read(name), b.read(name))

    def test_unique_external_leaf_refused(self):
        self.write(geometry_parts())
        with self.assertRaisesRegex(ValueError, "Only one shared"):
            clone_shared_leaf(self.source, self.output, 1, 0)
        self.assertFalse(self.output.exists())

    def test_repeated_edges_refused_until_independent_owner_supported(self):
        parts = shared_nested_parts()
        parts[MAIN] = parts[MAIN].replace(
            b"</components></object>",
            b'<component objectid="101" p:path="/3D/Objects/first.model"/>'
            b"</components></object>", 1)
        self.write(parts)
        with self.assertRaisesRegex(ValueError, "one mesh instance"):
            clone_shared_leaf(self.source, self.output, 1, 0)
        self.assertFalse(self.output.exists())

    def test_invalid_indices_and_existing_destination_are_rejected(self):
        self.write(shared_nested_parts())
        for build, edge in ((-1, 0), (True, 0), (1, True), (0, 5), (2, 0)):
            with self.subTest(build=build, edge=edge), self.assertRaises(ValueError):
                clone_shared_leaf(self.source, self.output, build, edge)
            self.assertFalse(self.output.exists())
        self.output.write_bytes(b"DO NOT OVERWRITE")
        with self.assertRaisesRegex(ValueError, "nonexistent"):
            clone_shared_leaf(self.source, self.output, 1, 0)
        self.assertEqual(self.output.read_bytes(), b"DO NOT OVERWRITE")

    def test_comments_in_touched_xml_fail_closed(self):
        parts = shared_nested_parts()
        parts[LEAF] = parts[LEAF].replace(b"</resources>", b"<!-- ambiguous -->\n</resources>")
        self.write(parts)
        with self.assertRaisesRegex(ValueError, "comment"):
            clone_shared_leaf(self.source, self.output, 1, 0)
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
