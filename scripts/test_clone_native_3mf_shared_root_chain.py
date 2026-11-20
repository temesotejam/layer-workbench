"""Two-level Core copy-on-write, including a shared main build root."""
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from audit_native_3mf_instance_placement import inspect_placements
from clone_native_3mf_shared_root_chain import clone_shared_root_chain
from compare_3mf_metadata import inventory
from plan_native_3mf_copy_on_write import plan_copy_on_write
from test_verify_native_3mf_edit_effect import shared_nested_parts

MAIN = "3D/3dmodel.model"
LEAF = "3D/Objects/first.model"


def shared_root_parts():
    parts = shared_nested_parts()
    # Each build separately instantiates the SAME root and mesh, requiring
    # two clone steps. This does not modify the original source fixture.
    assert b'<item objectid="2"/>' in parts[MAIN]
    parts[MAIN] = parts[MAIN].replace(
        b'<item objectid="2"/>', b'<item objectid="1"/>')
    return parts


class NativeRootChainCloneTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.source = Path(temp.name) / "original.3mf"
        self.output = Path(temp.name) / "isolated.3mf"

    def write(self, parts):
        with ZipFile(self.source, "w") as archive:
            archive.comment = b"preserve native comment"
            for name, data in parts.items():
                archive.writestr(name, data)

    def test_shared_root_and_leaf_isolated_without_moving_other_instance(self):
        self.write(shared_root_parts())
        original_bytes = self.source.read_bytes()
        before = inspect_placements(self.source)
        self.assertEqual(len(plan_copy_on_write(self.source, 1, [0])
                             ["clone_steps_inner_to_outer"]), 2)
        result = clone_shared_root_chain(self.source, self.output)
        after = inspect_placements(self.output)
        self.assertTrue(result["geometry_unchanged"])
        self.assertTrue(result["opaque_zip_members_preserved"])
        self.assertNotEqual(result["cloned_root"]["objectid"], "1")
        self.assertNotEqual(result["cloned_leaf"]["objectid"], "101")
        self.assertEqual(before["per_build_world_bounds_mm"],
                         after["per_build_world_bounds_mm"])
        self.assertEqual(before["mesh_instances"][0]["mesh_objectid"],
                         after["mesh_instances"][0]["mesh_objectid"])
        self.assertNotEqual(before["mesh_instances"][1]["mesh_objectid"],
                            after["mesh_instances"][1]["mesh_objectid"])
        self.assertFalse(plan_copy_on_write(self.output, 1, [0])["copy_on_write_required"])
        self.assertEqual(self.source.read_bytes(), original_bytes)
        a, b = inventory(self.source), inventory(self.output)
        self.assertEqual(set(a), set(b))
        self.assertEqual({key for key in a if a[key] != b[key]}, {MAIN, LEAF})
        with ZipFile(self.source) as src, ZipFile(self.output) as dst:
            self.assertEqual(src.comment, dst.comment)
            self.assertEqual(src.read("3D/Objects/second.model"),
                             dst.read("3D/Objects/second.model"))
            self.assertIn(b'<object id="1"', dst.read(MAIN))
            self.assertIn(b'<item objectid="1"/>', dst.read(MAIN))

    def test_independent_roots_do_not_meet_shared_root_requirement(self):
        self.write(shared_nested_parts())
        with self.assertRaisesRegex(ValueError, "Exactly one shared main root"):
            clone_shared_root_chain(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_repeated_components_fail_closed(self):
        parts = shared_root_parts()
        parts[MAIN] = parts[MAIN].replace(
            b"</components></object>",
            b'<component objectid="101" p:path="/3D/Objects/first.model"/>'
            b"</components></object>", 1)
        self.write(parts)
        with self.assertRaisesRegex(ValueError, "Exactly one mesh instance"):
            clone_shared_root_chain(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_reject_invalid_occurrence_and_existing_destination(self):
        self.write(shared_root_parts())
        for build, edge in ((0, 0), (1, 1), (-1, 0), (True, 0), (1, True)):
            with self.subTest(build=build, edge=edge):
                with self.assertRaises(ValueError):
                    clone_shared_root_chain(self.source, self.output, build, edge)
                self.assertFalse(self.output.exists())
        self.output.write_bytes(b"DO NOT OVERWRITE")
        with self.assertRaisesRegex(ValueError, "nonexistent"):
            clone_shared_root_chain(self.source, self.output)
        self.assertEqual(self.output.read_bytes(), b"DO NOT OVERWRITE")

    def test_touched_xml_comments_are_rejected(self):
        parts = shared_root_parts()
        parts[MAIN] = parts[MAIN].replace(
            b"</resources>", b"<!-- unsafe regex markup -->\n</resources>")
        self.write(parts)
        with self.assertRaisesRegex(ValueError, "comment"):
            clone_shared_root_chain(self.source, self.output)
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
