"""Offline checks for exact selected/sibling Core instance placement effects."""
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from test_audit_native_3mf_instance_placement import geometry_parts
from edit_native_3mf_build_transform import translate_native_build_item
from verify_native_3mf_edit_effect import verify_translation_effect

MAIN = "3D/3dmodel.model"


def shared_nested_parts():
    parts = geometry_parts()
    main = parts[MAIN].replace(
        b'/3D/Objects/second.model', b'/3D/Objects/first.model'
    ).replace(b'objectid="102"', b'objectid="101"')
    # Different per-build component paths now reach the same mesh, and the
    # first path contains a nontrivial nested rotation and translation.
    main = main.replace(
        b'transform="1 0 0 0 1 0 0 0 1 0 0 0"',
        b'transform="0 1 0 -1 0 0 0 0 1 5 6 0"')
    parts[MAIN] = main
    return parts


class NativeInstanceEditEffectTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.base = Path(temp.name) / "original.3mf"
        self.edited = Path(temp.name) / "translated.3mf"
        self.third = Path(temp.name) / "two-edits.3mf"

    def write(self, path, parts):
        with ZipFile(path, "w") as archive:
            for name, data in parts.items():
                archive.writestr(name, data)

    def test_second_instance_of_shared_mesh_moves_without_first(self):
        self.write(self.base, shared_nested_parts())
        translate_native_build_item(self.base, self.edited, 1, [-10, 0, 0])
        result = verify_translation_effect(self.base, self.edited, 1, [-10, 0, 0])
        self.assertTrue(result["match"])
        self.assertTrue(result["byte_preservation_verified"])
        self.assertEqual(result["moved_mesh_instances"], 1)
        self.assertEqual(result["untouched_mesh_instances"], 1)
        self.assertEqual(result["per_build_after_mm"][0],
                         result["per_build_before_mm"][0])
        self.assertAlmostEqual(
            result["per_build_after_mm"][1][0] -
            result["per_build_before_mm"][1][0], -10)

    def test_multi_leaf_component_build_moves_all_its_meshes(self):
        parts = shared_nested_parts()
        parts[MAIN] = parts[MAIN].replace(
            b"</components></object>",
            b'<component objectid="101" p:path="/3D/Objects/first.model"/>'
            b"</components></object>", 1)
        self.write(self.base, parts)
        translate_native_build_item(self.base, self.edited, 0, [5, 2, 0])
        result = verify_translation_effect(self.base, self.edited, 0, [5, 2, 0])
        self.assertEqual(result["moved_mesh_instances"], 2)
        self.assertEqual(result["untouched_mesh_instances"], 1)

    def test_reject_wrong_target_or_claimed_delta(self):
        self.write(self.base, shared_nested_parts())
        translate_native_build_item(self.base, self.edited, 1, [-10, 0, 0])
        with self.assertRaisesRegex(ValueError, "bytes|transforms"):
            verify_translation_effect(self.base, self.edited, 0, [-10, 0, 0])
        with self.assertRaisesRegex(ValueError, "bounds|translation"):
            verify_translation_effect(self.base, self.edited, 1, [-9, 0, 0])

    def test_reject_two_builds_changed_in_one_candidate(self):
        self.write(self.base, shared_nested_parts())
        translate_native_build_item(self.base, self.edited, 1, [-10, 0, 0])
        translate_native_build_item(self.edited, self.third, 0, [3, 0, 0])
        with self.assertRaisesRegex(ValueError, "bytes|transforms"):
            verify_translation_effect(self.base, self.third, 1, [-10, 0, 0])

    def test_reject_nonfinite_zero_or_invalid_index(self):
        self.write(self.base, shared_nested_parts())
        for delta in ([0, 0, 0], [float("nan"), 0, 0],
                      [float("inf"), 0, 0], [True, 0, 0]):
            with self.subTest(delta=delta), self.assertRaises(ValueError):
                verify_translation_effect(self.base, self.base, 1, delta)
        for idx in (-1, True, 10):
            with self.subTest(index=idx), self.assertRaises(ValueError):
                verify_translation_effect(self.base, self.base, idx, [5, 0, 0])


if __name__ == "__main__":
    unittest.main()
