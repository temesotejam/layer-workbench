"""Regress native CLI-style multi-part 3MF build edits without upstream downloads."""
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from test_verify_native_3mf_package import archive_parts
from edit_native_3mf_build_transform import (
    compare_native_build_edit, translate_native_build_item, rotate_native_build_item_z,
)
from compare_3mf_build_preservation import mask_build_transforms

MAIN = "3D/3dmodel.model"
NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
ONE = "1 0 0 0 1 0 0 0 1 90 90 0"
TWO = "1 0 0 0 1 0 0 0 1 150 90 0"


def contents(implicit=False):
    parts = archive_parts()
    first = ('<item objectid="1"/>' if implicit else
             f'<item objectid="1" transform="{ONE}"/>')
    parts[MAIN] = (
        f'<model xmlns="{NS}" unit="millimeter">'
        f'<metadata name="vendor:opaque">unchanged</metadata>'
        f'<resources/><build>{first}'
        f'<item objectid="2" transform="{TWO}"/></build></model>'
    ).encode("utf-8")
    parts["Metadata/vendor_unknown.bin"] = b"opaque\x00\xff"
    return parts


class NativeBuildEditTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.base = Path(temp.name) / "source.3mf"
        self.output = Path(temp.name) / "edited.3mf"

    def write(self, path, parts):
        with ZipFile(path, "w") as archive:
            for name, payload in parts.items():
                archive.writestr(name, payload)

    def test_first_build_moved_and_every_other_model_and_metadata_byte_preserved(self):
        self.write(self.base, contents())
        report = translate_native_build_item(self.base, self.output, 0, [10, 0, 0])
        self.assertTrue(report["match"])
        self.assertEqual(len(report["preserved_external_model_parts"]), 2)
        with ZipFile(self.base) as original, ZipFile(self.output) as edited:
            for name in original.namelist():
                if name != MAIN:
                    self.assertEqual(original.read(name), edited.read(name))
            masked_old, old = mask_build_transforms(original.read(MAIN))
            masked_new, new = mask_build_transforms(edited.read(MAIN))
        self.assertEqual(masked_old, masked_new)
        self.assertEqual(new[0][9:12], (100, 90, 0))
        self.assertEqual(new[1], old[1])

    def test_missing_implicit_transform_can_be_added_without_rewriting_other_xml(self):
        self.write(self.base, contents(implicit=True))
        report = translate_native_build_item(self.base, self.output, 0, [10, 0, 0])
        self.assertTrue(report["match"])
        with ZipFile(self.output) as archive:
            _, transforms = mask_build_transforms(archive.read(MAIN))
        self.assertEqual(transforms[0][9:12], (10, 0, 0))

    def test_native_rotation_preserves_opaque_parts_and_sibling_placement(self):
        self.write(self.base, contents())
        report = rotate_native_build_item_z(self.base, self.output, 0, 90)
        self.assertTrue(report["match"])
        self.assertEqual(report["changed_build_indices"], [0])
        self.assertEqual(report["rotation_z_degrees"], 90)
        with ZipFile(self.base) as before, ZipFile(self.output) as after:
            for member in before.namelist():
                if member != MAIN:
                    self.assertEqual(before.read(member), after.read(member))
            masked_old, old = mask_build_transforms(before.read(MAIN))
            masked_new, new = mask_build_transforms(after.read(MAIN))
        self.assertEqual(masked_old, masked_new)
        for actual, expected in zip(new[0],
            [0, 1, 0, -1, 0, 0, 0, 0, 1, 90, 90, 0]):
            self.assertAlmostEqual(actual, expected, places=12)
        self.assertEqual(new[1], old[1])

    def test_native_rotation_implicit_identity_and_prior_orientation(self):
        self.write(self.base, contents(implicit=True))
        report = rotate_native_build_item_z(self.base, self.output, 0, 90)
        self.assertTrue(report["match"])
        with ZipFile(self.output) as after:
            _, transforms = mask_build_transforms(after.read(MAIN))
        self.assertAlmostEqual(transforms[0][1], 1)
        self.assertAlmostEqual(transforms[0][3], -1)
        self.assertEqual(transforms[0][9:12], (0, 0, 0))
        self.output.unlink()
        parts = contents()
        parts[MAIN] = parts[MAIN].replace(
            ONE.encode(), b"0 2 0 -1 0 0 0 0 1 90 90 0")
        self.base.unlink()
        self.write(self.base, parts)
        self.assertTrue(rotate_native_build_item_z(
            self.base, self.output, 0, 90)["match"])
        with ZipFile(self.output) as after:
            _, transforms = mask_build_transforms(after.read(MAIN))
        for actual, expected in zip(transforms[0][:9],
                                    [-2, 0, 0, 0, -1, 0, 0, 0, 1]):
            self.assertAlmostEqual(actual, expected, places=12)
        self.assertEqual(transforms[0][9:12], (90, 90, 0))

    def test_native_rotation_rejects_invalid_and_noop_angles(self):
        self.write(self.base, contents())
        for angle in (0, 360, -360, 361, float("inf"), float("nan"), True):
            with self.subTest(angle=angle):
                with self.assertRaisesRegex(ValueError, "rotation"):
                    rotate_native_build_item_z(self.base, self.output, 0, angle)
                self.assertFalse(self.output.exists())

    def test_audit_rejects_changes_to_external_model_or_opaque_metadata(self):
        self.write(self.base, contents())
        original = contents()
        original["3D/Objects/first.model"] += b" "
        self.write(self.output, original)
        report = compare_native_build_edit(self.base, self.output, 0)
        self.assertFalse(report["match"])
        self.assertIn("3D/Objects/first.model", report["changed_other_members"])
        self.output.unlink()
        original = contents()
        original["Metadata/vendor_unknown.bin"] = b"changed"
        self.write(self.output, original)
        report = compare_native_build_edit(self.base, self.output, 0)
        self.assertFalse(report["match"])
        self.assertIn("Metadata/vendor_unknown.bin", report["changed_other_members"])

    def test_noop_and_two_build_changes_are_refused(self):
        self.write(self.base, contents())
        self.assertFalse(compare_native_build_edit(self.base, self.base, 0)["match"])
        self.assertRaisesRegex(ValueError, "nonzero",
                               translate_native_build_item, self.base, self.output,
                               0, [0, 0, 0])
        self.assertFalse(self.output.exists())
        self.assertRaisesRegex(ValueError, "does not exist",
                               translate_native_build_item, self.base, self.output,
                               2, [10, 0, 0])
        self.assertFalse(self.output.exists())

    def test_rejects_same_destination_and_malformed_transform(self):
        self.write(self.base, contents())
        with self.assertRaisesRegex(ValueError, "Destination"):
            translate_native_build_item(self.base, self.base, 0, [10, 0, 0])
        parts = contents()
        parts[MAIN] = parts[MAIN].replace(ONE.encode(), b"0 0 0 0 0 0 0 0 1 90 90 0")
        self.base.unlink()
        self.write(self.base, parts)
        with self.assertRaises(ValueError):
            translate_native_build_item(self.base, self.output, 0, [10, 0, 0])
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
