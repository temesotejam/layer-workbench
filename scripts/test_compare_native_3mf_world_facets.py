"""World-space native Core triangle regression tests: no real printer output."""
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from audit_native_3mf_instance_placement import inspect_placements
from clone_native_3mf_branched_root import clone_branched_root
from compare_native_3mf_world_facets import (
    _cyclic_canonical, _facets_close, _oriented_facets_close,
    compare_world_facets,
)
from reconcile_native_3mf_cloned_root_settings import copy_bounded_root_settings
from test_reconcile_native_3mf_cloned_root_settings import native_fixture

MAIN = "3D/3dmodel.model"
SECOND = "3D/Objects/second.model"
SETTINGS = "Metadata/model_settings.config"


class NativeWorldFacetComparisonTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        folder = Path(temp.name)
        self.source = folder / "source.3mf"
        self.core = folder / "core.3mf"
        self.restored = folder / "restored.3mf"
        self.changed = folder / "changed.3mf"
        with ZipFile(self.source, "w") as archive:
            for name, raw in native_fixture().items():
                archive.writestr(name, raw)
        clone_branched_root(self.source, self.core, edge_index=1)
        copy_bounded_root_settings(self.source, self.core, self.restored)

    def replace_member(self, name, old, new):
        with ZipFile(self.restored) as source, ZipFile(self.changed, "w") as target:
            for info in source.infolist():
                raw = source.read(info)
                if info.filename == name:
                    self.assertIn(old, raw)
                    raw = raw.replace(old, new, 1)
                target.writestr(info, raw)

    def test_tiny_reversed_triangle_rejected_even_inside_vertex_tolerance(self):
        # A 0.001 mm triangle is nondegenerate yet all swapped vertices are
        # within the 0.005 mm positional allowance. Positions alone pass.
        face = ((0.0, 0.0, 0.0), (0.001, 0.0, 0.0),
                (0.0, 0.001, 0.0))
        original = [_cyclic_canonical(face)]
        reversed_face = [_cyclic_canonical((face[0], face[2], face[1]))]
        self.assertTrue(_facets_close(original, reversed_face))
        self.assertFalse(_oriented_facets_close(original, reversed_face))

    def test_tiny_triangle_cyclic_and_small_displacement_keeps_orientation(self):
        face = ((0.0, 0.0, 0.0), (0.001, 0.0, 0.0),
                (0.0, 0.001, 0.0))
        shifted = (face[1], (0.0, 0.001, 0.00001), face[0])
        self.assertTrue(_oriented_facets_close(
            [_cyclic_canonical(face)],
            [_cyclic_canonical(shifted)],
        ))

    def test_private_core_id_cloning_keeps_world_triangles(self):
        report = compare_world_facets(self.source, self.restored)
        self.assertTrue(report["world_triangle_positions_equal_within_tolerance"])
        self.assertTrue(report["world_triangle_winding_equal_within_tolerance"])
        self.assertEqual(len(report["build_comparisons"]), 2)
        self.assertEqual([b["before_triangle_count"]
                          for b in report["build_comparisons"]], [2, 2])
        self.assertFalse(report["part_matrix_semantics_proven"])

    def test_reversed_face_winding_detected_despite_same_positions(self):
        self.replace_member(
            SECOND, b'<triangle v1="0" v2="1" v3="2"/>',
            b'<triangle v1="0" v2="2" v3="1"/>')
        report = compare_world_facets(self.restored, self.changed)
        self.assertTrue(report["world_triangle_positions_equal_within_tolerance"])
        self.assertFalse(report["world_triangle_winding_equal_within_tolerance"])
        # The COW fixture can isolate one external Core leaf: changing its
        # triangles need not change *both* build occurrences.
        self.assertGreaterEqual(sum(
            not row["world_triangle_winding_match_within_0p005_mm"]
            for row in report["build_comparisons"]), 1)

    def test_cyclic_face_vertex_renumbering_keeps_winding(self):
        self.replace_member(
            SECOND, b'<triangle v1="0" v2="1" v3="2"/>',
            b'<triangle v1="1" v2="2" v3="0"/>')
        report = compare_world_facets(self.restored, self.changed)
        self.assertTrue(report["world_triangle_positions_equal_within_tolerance"])
        self.assertTrue(report["world_triangle_winding_equal_within_tolerance"])

    def test_vendor_part_matrix_changes_do_not_fake_core_geometry_change(self):
        old = b'<metadata key="source_offset_x" value="2"/>'
        new = (old + b'<metadata key="matrix" value="'
               + b'1 0 0 17 0 1 0 0 0 0 1 0 0 0 0 1"/>')
        self.replace_member(SETTINGS, old, new)
        report = compare_world_facets(self.restored, self.changed)
        self.assertTrue(report["world_triangle_positions_equal_within_tolerance"])
        self.assertTrue(report["world_triangle_winding_equal_within_tolerance"])
        self.assertFalse(report["complete_native_3mf_parity_proven"])
        self.assertNotIn("17 0 1", str(report))

    def test_changed_vertex_detected_even_when_part_settings_unchanged(self):
        self.replace_member(SECOND, b'x="17"', b'x="17.2"')
        report = compare_world_facets(self.restored, self.changed)
        self.assertFalse(report["world_triangle_positions_equal_within_tolerance"])
        self.assertFalse(report["build_comparisons"][0][
            "world_triangle_vertex_positions_match_within_0p005_mm"])
        self.assertNotIn("17.2", str(report))

    def test_core_transform_change_detected(self):
        original = b'transform="1 0 0 0 1 0 0 0 1 34 0 0"'
        changed = b'transform="1 0 0 0 1 0 0 0 1 34.1 0 0"'
        self.replace_member(MAIN, original, changed)
        report = compare_world_facets(self.restored, self.changed)
        self.assertFalse(report["world_triangle_positions_equal_within_tolerance"])

    def test_malformed_core_geometry_fails_closed(self):
        self.replace_member(SECOND, b'x="17"', b'x="NaN"')
        with self.assertRaisesRegex(ValueError, "non-finite|Invalid"):
            compare_world_facets(self.restored, self.changed)


if __name__ == "__main__":
    unittest.main()
