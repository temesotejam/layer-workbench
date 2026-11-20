"""Bounded branched shared-root 3MF copy-on-write tests; no printer output."""
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile
from xml.etree import ElementTree as ET

from audit_native_3mf_instance_placement import inspect_placements
from clone_native_3mf_branched_root import clone_branched_root
from compare_3mf_metadata import inventory
from plan_native_3mf_copy_on_write import plan_copy_on_write
from test_clone_native_3mf_shared_root_chain import shared_root_parts

MAIN = "3D/3dmodel.model"
LEAF = "3D/Objects/first.model"
PROD = "{http://schemas.microsoft.com/3dmanufacturing/production/2015/06}UUID"


def branched_parts():
    parts = shared_root_parts()
    main = parts[MAIN]
    original_end = b"</components></object>"
    if main.count(original_end) < 1:
        raise AssertionError("Missing fixture root component")
    # Different local displacement makes both Core occurrences observable.
    sibling = (b'<component objectid="101" '
               b'p:path="/3D/Objects/first.model" '
               b'transform="1 0 0 0 1 0 0 0 1 34 0 0"/>')
    parts[MAIN] = main.replace(
        original_end, sibling + original_end, 1)
    return parts


class BranchRootIsolationTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.base = Path(tmp.name) / "base.3mf"
        self.result = Path(tmp.name) / "private.3mf"

    def write(self, parts):
        with ZipFile(self.base, "w") as archive:
            archive.comment = b"native style fixture"
            for name, raw in parts.items():
                archive.writestr(name, raw)

    def test_both_edge_indices_detach_only_selected_occurrence(self):
        for edge in (0, 1):
            with self.subTest(edge=edge):
                self.write(branched_parts())
                prior_file = self.base.read_bytes()
                prior = inspect_placements(self.base)
                self.assertEqual(len(prior["mesh_instances"]), 4)
                plan = plan_copy_on_write(self.base, 1, [edge])
                self.assertEqual([s["total_visits"] for s in
                                  plan["clone_steps_inner_to_outer"]], [4, 2])
                report = clone_branched_root(
                    self.base, self.result, edge_index=edge)
                after = inspect_placements(self.result)
                self.assertTrue(report["geometry_unchanged"])
                self.assertEqual(prior["per_build_world_bounds_mm"],
                                 after["per_build_world_bounds_mm"])
                for i, (old, new) in enumerate(zip(
                        prior["mesh_instances"], after["mesh_instances"])):
                    if i == edge + 2:
                        self.assertNotEqual(old["mesh_objectid"],
                                            new["mesh_objectid"])
                    else:
                        self.assertEqual(old["mesh_objectid"],
                                         new["mesh_objectid"])
                    for name in ("world_bounds_mm", "triangle_count",
                                 "world_transform3mf", "mesh_part", "build_index"):
                        self.assertEqual(old[name], new[name])
                self.assertFalse(plan_copy_on_write(self.result, 1, [edge])
                                 ["copy_on_write_required"])
                self.assertTrue(plan_copy_on_write(self.result, 1, [1 - edge])
                                ["copy_on_write_required"])
                self.assertEqual(self.base.read_bytes(), prior_file)
                a, b = inventory(self.base), inventory(self.result)
                self.assertEqual(set(a), set(b))
                self.assertEqual({n for n in a if a[n] != b[n]}, {MAIN, LEAF})
                with ZipFile(self.base) as src, ZipFile(self.result) as dst:
                    self.assertEqual(src.comment, dst.comment)
                    for item in ("Metadata/project_settings.config",
                                 "3D/Objects/second.model"):
                        self.assertEqual(src.read(item), dst.read(item))
                self.result.unlink()
                self.base.unlink()

    def test_production_uuids_renew_on_both_cloned_edges(self):
        parts = branched_parts()
        main = parts[MAIN]
        uuids = [f"00000000-0000-4000-8000-{v:012x}".encode()
                 for v in range(1, 5)]
        root = b'<object id="1" type="model">'
        main = main.replace(
            root, root[:-1] + b' p:UUID="' + uuids[0] + b'">', 1)
        edge_a = b'<component objectid="101"'
        self.assertEqual(main.count(edge_a), 2)
        main = main.replace(
            edge_a, b'<component p:UUID="' + uuids[1] + b'" objectid="101"', 1)
        main = main.replace(
            edge_a, b'<component p:UUID="' + uuids[2] + b'" objectid="101"', 1)
        parts[MAIN] = main
        leaf = parts[LEAF]
        leaf = leaf.replace(
            b'<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
            b'<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
            b'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">', 1)
        parts[LEAF] = leaf.replace(
            b'<object id="101">',
            b'<object id="101" p:UUID="' + uuids[3] + b'">', 1)
        self.write(parts)
        clone_branched_root(self.base, self.result, edge_index=1)
        def identifiers(path):
            with ZipFile(path) as archive:
                return [e.get(PROD) for name in (MAIN, LEAF)
                        for e in ET.fromstring(archive.read(name)).iter()
                        if e.get(PROD)]
        before, after = identifiers(self.base), identifiers(self.result)
        self.assertEqual(len(before), 4)
        self.assertEqual(len(after), 8)
        self.assertEqual(len(set(after)), 8)
        self.assertTrue(set(before).issubset(after))

    def test_invalid_selection_or_destination_never_overwritten(self):
        self.write(branched_parts())
        for b, e in ((0, 0), (True, 0), (1, True), (1, -1), (1, 2)):
            with self.subTest(build=b, edge=e):
                with self.assertRaises(ValueError):
                    clone_branched_root(self.base, self.result, b, e)
                self.assertFalse(self.result.exists())
        self.result.write_bytes(b"sentinel")
        with self.assertRaisesRegex(ValueError, "nonexistent"):
            clone_branched_root(self.base, self.result)
        self.assertEqual(self.result.read_bytes(), b"sentinel")

    def test_wrong_graph_and_opaque_identity_fail_closed(self):
        cases = []
        cases.append(shared_root_parts())
        triple = branched_parts()
        triple[MAIN] = triple[MAIN].replace(
            b"</components></object>",
            b'<component objectid="101" p:path="/3D/Objects/first.model"/>'
            b"</components></object>", 1)
        cases.append(triple)
        opaque = branched_parts()
        opaque[MAIN] = opaque[MAIN].replace(
            b'<object id="1" type="model">',
            b'<object id="1" type="model" xmlns:v="urn:vendor" v:uuid="opaque">', 1)
        cases.append(opaque)
        for i, parts in enumerate(cases):
            with self.subTest(case=i):
                self.write(parts)
                with self.assertRaises(ValueError):
                    clone_branched_root(self.base, self.result)
                self.assertFalse(self.result.exists())
                self.base.unlink()


if __name__ == "__main__":
    unittest.main()
