"""Adversarial copy-on-write preflight tests with synthetic multipart Core 3MF."""
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from audit_native_3mf_edit_ownership import audit_edit_ownership
from test_verify_native_3mf_edit_effect import shared_nested_parts

MAIN = "3D/3dmodel.model"


class NativeOwnershipPreflightTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.file = Path(temp.name) / "fixture.3mf"

    def write(self, parts):
        with ZipFile(self.file, "w") as archive:
            for part, content in parts.items():
                archive.writestr(part, content)

    def node(self, report, part, objectid):
        return next(n for n in report["reachable_objects"]
                    if n["part"] == part and n["objectid"] == objectid)

    def test_shared_external_mesh_needs_copy_on_write_but_roots_do_not(self):
        self.write(shared_nested_parts())
        before = self.file.read_bytes()
        report = audit_edit_ownership(self.file)
        self.assertEqual(report["build_items"], 2)
        self.assertEqual(report["mesh_instances"], 2)
        self.assertEqual(report["total_object_visits"], 4)
        self.assertEqual(len(report["cross_build_shared_meshes"]), 1)
        mesh = self.node(report, "3D/Objects/first.model", "101")
        self.assertEqual(mesh["visits_by_build"], [1, 1])
        self.assertTrue(mesh["requires_copy_on_write_for_one_instance"])
        self.assertFalse(mesh["repeated_within_build"])
        self.assertTrue(all(r["root_used_by_one_build_instance_only"]
                            for r in report["build_roots"]))
        self.assertEqual(before, self.file.read_bytes())

    def test_duplicate_edges_count_as_two_occurrences_not_one_path(self):
        parts = shared_nested_parts()
        parts[MAIN] = parts[MAIN].replace(
            b"</components></object>",
            b'<component objectid="101" p:path="/3D/Objects/first.model"/>'
            b"</components></object>", 1)
        self.write(parts)
        report = audit_edit_ownership(self.file)
        mesh = self.node(report, "3D/Objects/first.model", "101")
        self.assertEqual(mesh["visits_by_build"], [2, 1])
        self.assertTrue(mesh["repeated_within_build"])
        self.assertEqual(report["mesh_instances"], 3)
        self.assertEqual(report["total_object_visits"], 5)

    def test_shared_parent_root_must_also_be_cloned(self):
        parts = shared_nested_parts()
        # Both build items instantiate root object 1. The unused object 2
        # remains in resources, but is not an instantiated Core resource.
        parts[MAIN] = parts[MAIN].replace(
            b'<item objectid="2"/>', b'<item objectid="1"/>')
        self.write(parts)
        report = audit_edit_ownership(self.file)
        root = self.node(report, MAIN, "1")
        self.assertEqual(root["visits_by_build"], [1, 1])
        self.assertTrue(root["requires_copy_on_write_for_one_instance"])
        self.assertFalse(all(r["root_used_by_one_build_instance_only"]
                             for r in report["build_roots"]))
        self.assertNotIn((MAIN, "2"), {(n["part"], n["objectid"])
                                         for n in report["reachable_objects"]})

    def test_reject_missing_core_reference(self):
        parts = shared_nested_parts()
        parts[MAIN] = parts[MAIN].replace(
            b'objectid="101" p:path="/3D/Objects/first.model"',
            b'objectid="404" p:path="/3D/Objects/first.model"', 1)
        self.write(parts)
        with self.assertRaisesRegex(ValueError, "Unresolved"):
            audit_edit_ownership(self.file)


if __name__ == "__main__":
    unittest.main()
