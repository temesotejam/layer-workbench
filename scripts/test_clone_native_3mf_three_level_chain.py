"""Adversarial offline acceptance for bounded three-level Core copy-on-write."""
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from audit_native_3mf_instance_placement import inspect_placements
from clone_native_3mf_three_level_chain import clone_three_level_chain
from compare_3mf_metadata import inventory
from plan_native_3mf_copy_on_write import plan_copy_on_write
from scale_native_3mf_private_leaf import scale_private_leaf
from test_clone_native_3mf_shared_root_chain import shared_root_parts

MAIN = "3D/3dmodel.model"
LEAF = "3D/Objects/first.model"


def three_level_parts():
    parts = shared_root_parts()
    raw = parts[MAIN]
    start = raw.index(b'<component objectid="101"')
    end = raw.index(b'/>', start) + 2
    old_edge = raw[start:end]
    # Keep the existing nontrivial rotation on the root edge; the middle
    # adds its own translation. This exercises the order of nested matrices.
    root_edge = old_edge.replace(
        b'objectid="101" p:path="/3D/Objects/first.model"',
        b'objectid="3"')
    if root_edge == old_edge or b'p:path=' in root_edge:
        raise AssertionError("Fixture root edge conversion failed")
    new_middle = (
        b'<object id="3" type="model"><components>'
        b'<component objectid="101" p:path="/3D/Objects/first.model" '
        b'transform="1 0 0 0 1 0 0 0 1 2 3 4"/>'
        b'</components></object>'
    )
    raw = raw[:start] + root_edge + raw[end:]
    raw = raw.replace(b"</resources>", new_middle + b"</resources>", 1)
    parts[MAIN] = raw
    return parts


class ThreeLevelCopyOnWriteTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.source = Path(tmp.name) / "original.3mf"
        self.output = Path(tmp.name) / "private.3mf"

    def write(self, parts):
        with ZipFile(self.source, "w") as archive:
            archive.comment = b"opaque archive comment"
            for name, data in parts.items():
                archive.writestr(name, data)

    def test_three_level_shared_path_cloned_without_sibling_side_effects(self):
        self.write(three_level_parts())
        prior_bytes = self.source.read_bytes()
        before = inspect_placements(self.source)
        self.assertEqual(len(plan_copy_on_write(self.source, 1, [0, 0])
                             ["clone_steps_inner_to_outer"]), 3)
        report = clone_three_level_chain(self.source, self.output)
        after = inspect_placements(self.output)
        self.assertTrue(report["geometry_unchanged"])
        self.assertEqual(len(set(report["private_chain"])), 3)
        self.assertEqual(report["private_chain"][0], "5")
        self.assertEqual(report["private_chain"][1], "4")
        self.assertNotEqual(report["private_chain"][2], "101")
        self.assertEqual(before["per_build_world_bounds_mm"],
                         after["per_build_world_bounds_mm"])
        self.assertEqual(before["mesh_instances"][0]["component_path"],
                         after["mesh_instances"][0]["component_path"])
        self.assertEqual(before["mesh_instances"][0]["mesh_objectid"],
                         after["mesh_instances"][0]["mesh_objectid"])
        self.assertNotEqual(before["mesh_instances"][1]["mesh_objectid"],
                            after["mesh_instances"][1]["mesh_objectid"])
        self.assertFalse(plan_copy_on_write(self.output, 1, [0, 0])
                         ["copy_on_write_required"])
        self.assertEqual(self.source.read_bytes(), prior_bytes)
        a, b = inventory(self.source), inventory(self.output)
        self.assertEqual(set(a), set(b))
        self.assertEqual({key for key in a if a[key] != b[key]}, {MAIN, LEAF})
        with ZipFile(self.source) as original, ZipFile(self.output) as private:
            self.assertEqual(original.comment, private.comment)
            self.assertEqual(original.read("Metadata/project_settings.config"),
                             private.read("Metadata/project_settings.config"))
            self.assertEqual(original.read("3D/Objects/second.model"),
                             private.read("3D/Objects/second.model"))

    def test_three_level_detach_then_private_y_scale_isolates_sibling(self):
        self.write(three_level_parts())
        original_bytes = self.source.read_bytes()
        before = inspect_placements(self.source)
        scaled = self.output.with_name("private-scaled-y.3mf")
        # Editing a still-shared leaf must fail even with a valid deep path.
        with self.assertRaises(ValueError):
            scale_private_leaf(self.source, scaled, component_edges=[0, 0],
                               scale_x=1.2, axis="y")
        self.assertFalse(scaled.exists())

        clone_three_level_chain(self.source, self.output)
        detached_bytes = self.output.read_bytes()
        detached = inspect_placements(self.output)
        with self.assertRaisesRegex(ValueError, "depth"):
            scale_private_leaf(self.output, scaled, component_edges=[0],
                               scale_x=1.2, axis="y")
        self.assertFalse(scaled.exists())

        report = scale_private_leaf(self.output, scaled, component_edges=[0, 0],
                                    scale_x=1.2, axis="y")
        after = inspect_placements(scaled)
        self.assertEqual(report["component_edge_path"], [0, 0])
        self.assertEqual(report["scale_axis"], "y")
        self.assertEqual(before["per_build_world_bounds_mm"],
                         detached["per_build_world_bounds_mm"])
        self.assertEqual(detached["per_build_world_bounds_mm"][0],
                         after["per_build_world_bounds_mm"][0])
        self.assertNotEqual(detached["per_build_world_bounds_mm"][1],
                            after["per_build_world_bounds_mm"][1])
        self.assertEqual(self.source.read_bytes(), original_bytes)
        self.assertEqual(self.output.read_bytes(), detached_bytes)
        self.assertFalse(plan_copy_on_write(scaled, 1, [0, 0])
                         ["copy_on_write_required"])
        for old, new in zip(detached["mesh_instances"], after["mesh_instances"]):
            for key in ("build_index", "mesh_part", "mesh_objectid",
                        "world_transform3mf", "triangle_count", "component_path"):
                self.assertEqual(old[key], new[key])
        old_members, new_members = inventory(self.output), inventory(scaled)
        self.assertEqual(set(old_members), set(new_members))
        self.assertEqual({key for key in old_members
                          if old_members[key] != new_members[key]}, {LEAF})
        with ZipFile(self.output) as prior, ZipFile(scaled) as edited:
            self.assertEqual(prior.comment, edited.comment)
            for member in (MAIN, "3D/Objects/second.model",
                           "Metadata/project_settings.config"):
                self.assertEqual(prior.read(member), edited.read(member))

    def test_three_level_private_scale_rejects_invalid_component_path(self):
        self.write(three_level_parts())
        clone_three_level_chain(self.source, self.output)
        scaled = self.output.with_name("reject-scaled.3mf")
        for path in ([], [0], [0, True], [1, 0], [0, 0, 0], "0,0"):
            with self.subTest(path=path):
                with self.assertRaises(ValueError):
                    scale_private_leaf(self.output, scaled, component_edges=path,
                                       scale_x=1.2, axis="y")
                self.assertFalse(scaled.exists())

    def test_independent_roots_fail_closed(self):
        parts = three_level_parts()
        parts[MAIN] = parts[MAIN].replace(
            b'<item objectid="1"/>', b'<item objectid="2"/>', 1)
        self.write(parts)
        with self.assertRaises(ValueError):
            clone_three_level_chain(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_missing_middle_or_extra_edge_fail_closed(self):
        for remove_middle in (True, False):
            with self.subTest(remove_middle=remove_middle):
                parts = three_level_parts()
                if remove_middle:
                    start = parts[MAIN].index(b'<object id="3"')
                    end = parts[MAIN].index(b'</object>', start) + len(b'</object>')
                    parts[MAIN] = parts[MAIN][:start] + parts[MAIN][end:]
                else:
                    parts[MAIN] = parts[MAIN].replace(
                        b'</components></object>',
                        b'<component objectid="101" p:path="/3D/Objects/first.model"/>'
                        b'</components></object>', 1)
                self.write(parts)
                with self.assertRaises(ValueError):
                    clone_three_level_chain(self.source, self.output)
                self.assertFalse(self.output.exists())

    def test_reject_bad_selection_and_existing_destination(self):
        self.write(three_level_parts())
        for index, edges in ((0, [0, 0]), (True, [0, 0]), (1, [0]),
                             (1, [1, 0]), (1, [0, True]), (1, [0, -1])):
            with self.subTest(index=index, edges=edges):
                with self.assertRaises(ValueError):
                    clone_three_level_chain(self.source, self.output, index, edges)
                self.assertFalse(self.output.exists())
        self.output.write_bytes(b"NO OVERWRITE")
        with self.assertRaisesRegex(ValueError, "nonexistent"):
            clone_three_level_chain(self.source, self.output)
        self.assertEqual(self.output.read_bytes(), b"NO OVERWRITE")

    def test_comment_markup_never_rewritten(self):
        parts = three_level_parts()
        parts[MAIN] = parts[MAIN].replace(
            b"</resources>", b"<!-- deliberately unsafe -->\n</resources>", 1)
        self.write(parts)
        with self.assertRaisesRegex(ValueError, "comment"):
            clone_three_level_chain(self.source, self.output)
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
