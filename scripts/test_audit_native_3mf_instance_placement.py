"""Offline adversarial coverage of read-only native multipart Core placements."""
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from audit_native_3mf_instance_placement import inspect_placements
from test_inspect_native_3mf_hierarchy import component_fixture


MESH = (b'<mesh><vertices>'
        b'<vertex x="0" y="0" z="0"/>'
        b'<vertex x="10" y="0" z="0"/>'
        b'<vertex x="0" y="20" z="5"/>'
        b'</vertices><triangles><triangle v1="0" v2="1" v3="2"/>'
        b'</triangles></mesh>')
IDENTITY = "1 0 0 0 1 0 0 0 1 0 0 0"


def geometry_parts():
    parts = component_fixture()
    for part in ("3D/Objects/first.model", "3D/Objects/second.model"):
        parts[part] = parts[part].replace(b"<mesh/>", MESH)
    return parts


class NativeWorldPlacementTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / "native.3mf"

    def write(self, parts):
        with ZipFile(self.path, "w") as archive:
            for name, data in parts.items():
                archive.writestr(name, data)

    def test_two_external_meshes_with_identity_build_placements(self):
        self.write(geometry_parts())
        report = inspect_placements(self.path)
        self.assertEqual(report["build_items"], 2)
        self.assertEqual(len(report["mesh_instances"]), 2)
        self.assertEqual(report["per_build_world_bounds_mm"], [
            [0, 10, 0, 20, 0, 5], [0, 10, 0, 20, 0, 5]])
        self.assertEqual(report["mesh_instances"][0]["triangle_count"], 1)

    def test_component_then_build_translation_composes_in_correct_order(self):
        parts = geometry_parts()
        source = parts["3D/3dmodel.model"]
        source = source.replace(
            b'objectid="101" p:path="/3D/Objects/first.model" '
            b'transform="1 0 0 0 1 0 0 0 1 0 0 0"',
            b'objectid="101" p:path="/3D/Objects/first.model" '
            b'transform="1 0 0 0 1 0 0 0 1 5 6 7"')
        source = source.replace(b'<item objectid="1"/>',
                                b'<item objectid="1" transform="1 0 0 0 1 0 0 0 1 10 0 0"/>')
        parts["3D/3dmodel.model"] = source
        self.write(parts)
        report = inspect_placements(self.path)
        self.assertEqual(report["per_build_world_bounds_mm"][0],
                         [15, 25, 6, 26, 7, 12])
        self.assertEqual(report["per_build_world_bounds_mm"][1],
                         [0, 10, 0, 20, 0, 5])

    def test_nested_rotation_then_translation_not_commutative(self):
        parts = geometry_parts()
        source = parts["3D/3dmodel.model"]
        source = source.replace(
            b'transform="1 0 0 0 1 0 0 0 1 0 0 0"',
            b'transform="0 1 0 -1 0 0 0 0 1 5 0 0"')
        source = source.replace(b'<item objectid="1"/>',
                                b'<item objectid="1" transform="1 0 0 0 1 0 0 0 1 10 0 0"/>')
        parts["3D/3dmodel.model"] = source
        self.write(parts)
        self.assertEqual(inspect_placements(self.path)["per_build_world_bounds_mm"][0],
                         [-5, 15, 0, 10, 0, 5])

    def test_repeated_instance_uses_same_mesh_without_mutating_external_part(self):
        parts = geometry_parts()
        parts["3D/3dmodel.model"] = parts["3D/3dmodel.model"].replace(
            b'/3D/Objects/second.model', b'/3D/Objects/first.model'
        ).replace(b'objectid="102"', b'objectid="101"')
        self.write(parts)
        report = inspect_placements(self.path)
        self.assertEqual(len(report["mesh_instances"]), 2)
        self.assertEqual(report["mesh_instances"][0]["mesh_part"],
                         report["mesh_instances"][1]["mesh_part"])

    def test_rejects_same_part_component_cycle(self):
        parts = geometry_parts()
        src = parts["3D/3dmodel.model"]
        start = src.index(b"<resources>")
        end = src.index(b"</resources>") + len(b"</resources>")
        src = (src[:start] +
               b'<resources><object id="1"><components><component objectid="2"/></components></object>'
               b'<object id="2"><components><component objectid="1"/></components></object>'
               b'</resources>' + src[end:])
        parts["3D/3dmodel.model"] = src
        self.write(parts)
        with self.assertRaisesRegex(ValueError, "Cyclic"):
            inspect_placements(self.path)

    def test_rejects_dangling_component_before_composition(self):
        parts = geometry_parts()
        parts["3D/Objects/first.model"] = parts["3D/Objects/first.model"].replace(
            b'id="101"', b'id="909"')
        self.write(parts)
        with self.assertRaisesRegex(ValueError, "Unresolved"):
            inspect_placements(self.path)

    def test_rejects_mixed_units(self):
        parts = geometry_parts()
        parts["3D/Objects/first.model"] = parts["3D/Objects/first.model"].replace(
            b"<model ", b'<model unit="inch" ', 1)
        self.write(parts)
        with self.assertRaisesRegex(ValueError, "Mixed model units"):
            inspect_placements(self.path)

    def test_rejects_invalid_triangle_reference(self):
        parts = geometry_parts()
        parts["3D/Objects/first.model"] = parts["3D/Objects/first.model"].replace(
            b'v3="2"', b'v3="200"')
        self.write(parts)
        with self.assertRaisesRegex(ValueError, "missing vertex"):
            inspect_placements(self.path)

    def test_rejects_nonfinite_vertex(self):
        parts = geometry_parts()
        parts["3D/Objects/first.model"] = parts["3D/Objects/first.model"].replace(
            b'x="10"', b'x="nan"')
        self.write(parts)
        with self.assertRaisesRegex(ValueError, "non-finite"):
            inspect_placements(self.path)

    def test_rejects_insufficient_instance_budget(self):
        self.write(geometry_parts())
        with self.assertRaisesRegex(ValueError, "budget"):
            inspect_placements(self.path, max_instances=1)


if __name__ == "__main__":
    unittest.main()
