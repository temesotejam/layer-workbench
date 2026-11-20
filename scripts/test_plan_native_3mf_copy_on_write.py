"""Occurrence-specific native Core clone planning regression tests (no writes)."""
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from plan_native_3mf_copy_on_write import plan_copy_on_write
from test_audit_native_3mf_instance_placement import geometry_parts
from test_verify_native_3mf_edit_effect import shared_nested_parts

MAIN = "3D/3dmodel.model"
MESH_PART = "3D/Objects/first.model"


class NativeCopyOnWritePlanTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "example.3mf"

    def write(self, parts):
        with ZipFile(self.path, "w") as archive:
            for name, data in parts.items():
                archive.writestr(name, data)

    def test_shared_leaf_requires_one_clone_but_independent_root_does_not(self):
        self.write(shared_nested_parts())
        original = self.path.read_bytes()
        plan = plan_copy_on_write(self.path, 1, [0])
        self.assertTrue(plan["copy_on_write_required"])
        self.assertEqual(plan["selected_mesh"], {"part": MESH_PART, "objectid": "101"})
        self.assertEqual(len(plan["clone_steps_inner_to_outer"]), 1)
        self.assertEqual(plan["clone_steps_inner_to_outer"][0]["total_visits"], 2)
        self.assertEqual(plan["clone_steps_inner_to_outer"][0]["redirect_occurrence"], {
            "kind": "component", "parent_part": MAIN, "parent_objectid": "2",
            "edge_index": 0, "parent_must_be_cloned": False,
        })
        self.assertEqual(original, self.path.read_bytes())

    def test_duplicate_edges_are_distinct_occurrences(self):
        parts = shared_nested_parts()
        parts[MAIN] = parts[MAIN].replace(
            b"</components></object>",
            b'<component objectid="101" p:path="/3D/Objects/first.model"/>'
            b"</components></object>", 1)
        self.write(parts)
        plan = plan_copy_on_write(self.path, 0, [1])
        self.assertEqual(plan["clone_steps_inner_to_outer"][0]["total_visits"], 3)
        self.assertEqual(plan["clone_steps_inner_to_outer"][0]
                         ["redirect_occurrence"]["edge_index"], 1)

    def test_shared_root_also_needs_a_clone_before_retargeting(self):
        parts = shared_nested_parts()
        parts[MAIN] = parts[MAIN].replace(
            b'<item objectid="2"/>', b'<item objectid="1"/>')
        self.write(parts)
        plan = plan_copy_on_write(self.path, 1, [0])
        self.assertEqual([(s["part"], s["objectid"]) for s in
                          plan["clone_steps_inner_to_outer"]],
                         [(MESH_PART, "101"), (MAIN, "1")])
        self.assertTrue(plan["clone_steps_inner_to_outer"][0]
                        ["redirect_occurrence"]["parent_must_be_cloned"])
        self.assertEqual(plan["clone_steps_inner_to_outer"][1]
                         ["redirect_occurrence"],
                         {"kind": "build_item", "build_index": 1})

    def test_unique_leaf_requires_no_clone(self):
        self.write(geometry_parts())
        plan = plan_copy_on_write(self.path, 0, [0])
        self.assertFalse(plan["copy_on_write_required"])
        self.assertEqual(plan["clone_steps_inner_to_outer"], [])

    def test_invalid_occurrences_fail_closed(self):
        self.write(shared_nested_parts())
        for index, edges in ((-1, [0]), (True, [0]), (3, [0]),
                             (0, [1]), (0, []), (0, [0, 0]),
                             (0, [True]), (0, [-1]), (0, ["0"])):
            with self.subTest(index=index, edges=edges):
                with self.assertRaises(ValueError):
                    plan_copy_on_write(self.path, index, edges)


if __name__ == "__main__":
    unittest.main()
