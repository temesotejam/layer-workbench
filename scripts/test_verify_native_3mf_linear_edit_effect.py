"""Fail-closed offline tests for one-instance Core 3MF linear edits."""
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from edit_native_3mf_build_transform import (
    rotate_native_build_item_z, scale_native_build_item_xyz,
    translate_native_build_item,
)
from test_verify_native_3mf_edit_effect import shared_nested_parts
from verify_native_3mf_linear_edit_effect import verify_linear_effect

MAIN = "3D/3dmodel.model"


class NativeLinearEditEffectTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.original = Path(temp.name) / "source.3mf"
        self.changed = Path(temp.name) / "changed.3mf"
        self.twice = Path(temp.name) / "twice.3mf"
        self.parts = shared_nested_parts()

    def write(self, parts=None):
        with ZipFile(self.original, "w") as archive:
            for path, raw in (parts or self.parts).items():
                archive.writestr(path, raw)

    def test_rotate_second_shared_mesh_and_preserve_first(self):
        self.write()
        rotate_native_build_item_z(self.original, self.changed, 1, 30)
        result = verify_linear_effect(
            self.original, self.changed, 1, rotation_z_degrees=30)
        self.assertTrue(result["match"])
        self.assertTrue(result["byte_preservation_verified"])
        self.assertEqual(result["edited_mesh_instances"], 1)
        self.assertEqual(result["untouched_mesh_instances"], 1)
        self.assertEqual(result["per_build_before_mm"][0],
                         result["per_build_after_mm"][0])

    def test_scale_second_shared_mesh_and_preserve_first(self):
        self.write()
        scale_native_build_item_xyz(self.original, self.changed, 1,
                                    [1.5, 0.75, 1.25])
        result = verify_linear_effect(
            self.original, self.changed, 1, scale_xyz=[1.5, 0.75, 1.25])
        self.assertTrue(result["match"])
        self.assertEqual(result["per_build_before_mm"][0],
                         result["per_build_after_mm"][0])

    def test_rotate_multi_leaf_build_without_changing_sibling(self):
        parts = shared_nested_parts()
        parts[MAIN] = parts[MAIN].replace(
            b"</components></object>",
            b'<component objectid="101" p:path="/3D/Objects/first.model"/>'
            b"</components></object>", 1)
        self.write(parts)
        rotate_native_build_item_z(self.original, self.changed, 0, -45)
        report = verify_linear_effect(
            self.original, self.changed, 0, rotation_z_degrees=-45)
        self.assertEqual(report["edited_mesh_instances"], 2)
        self.assertEqual(report["untouched_mesh_instances"], 1)

    def test_reject_wrong_rotation_scale_and_target(self):
        self.write()
        rotate_native_build_item_z(self.original, self.changed, 1, 30)
        with self.assertRaisesRegex(ValueError, "transform"):
            verify_linear_effect(self.original, self.changed, 1,
                                 rotation_z_degrees=35)
        with self.assertRaisesRegex(ValueError, "transforms|bytes"):
            verify_linear_effect(self.original, self.changed, 0,
                                 rotation_z_degrees=30)
        with self.assertRaisesRegex(ValueError, "transform"):
            verify_linear_effect(self.original, self.changed, 1,
                                 scale_xyz=[1.5, 1, 1])

    def test_reject_translation_masquerading_as_rotation(self):
        self.write()
        translate_native_build_item(self.original, self.changed, 1, [5, 0, 0])
        with self.assertRaisesRegex(ValueError, "transform"):
            verify_linear_effect(self.original, self.changed, 1,
                                 rotation_z_degrees=30)

    def test_reject_altered_sibling_even_when_target_is_correct(self):
        self.write()
        scale_native_build_item_xyz(self.original, self.changed, 1, [2, 1, 1])
        translate_native_build_item(self.changed, self.twice, 0, [2, 0, 0])
        with self.assertRaisesRegex(ValueError, "bytes|transforms"):
            verify_linear_effect(self.original, self.twice, 1,
                                 scale_xyz=[2, 1, 1])

    def test_reject_nonfinite_noop_invalid_bounds_and_boolean_values(self):
        self.write()
        for value in (0, 360, float("nan"), float("inf"), True, 361):
            with self.subTest(rotation=value), self.assertRaises(ValueError):
                verify_linear_effect(self.original, self.original, 1,
                                     rotation_z_degrees=value)
        for factors in ([1, 1, 1], [float("nan"), 1, 1],
                        [0.2, 1, 1], [4.1, 1, 1], [True, 1, 1]):
            with self.subTest(scale=factors), self.assertRaises(ValueError):
                verify_linear_effect(self.original, self.original, 1,
                                     scale_xyz=factors)
        for index in (-1, True, 3):
            with self.subTest(index=index), self.assertRaises(ValueError):
                verify_linear_effect(self.original, self.original, index,
                                     rotation_z_degrees=15)
        for kwargs in ({}, {"rotation_z_degrees": 20, "scale_xyz": [2, 1, 1]}):
            with self.assertRaises(ValueError):
                verify_linear_effect(self.original, self.original, 1, **kwargs)


if __name__ == "__main__":
    unittest.main()
