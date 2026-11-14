"""Synthetic Core 3MF edit acceptance, not an OrcaSlicer project parity test."""
from pathlib import Path
import tempfile
import unittest
import zipfile

from audit_3mf_scene import audit
from compare_3mf_metadata import inventory
from edit_3mf_build_transform import edit_core_build_item
from make_3mf_two_build_fixture import make_file

IDENTITY_180 = '1 0 0 0 1 0 0 0 1 180 90 0'


class Core3MFBuildTransformTests(unittest.TestCase):
    def paths(self, folder):
        base = Path(folder)
        source, dest = base / 'input.3mf', base / 'edited.3mf'
        make_file(source)
        return source, dest

    def test_changes_only_second_placement_and_one_zip_member(self):
        with tempfile.TemporaryDirectory() as folder:
            source, dest = self.paths(folder)
            # An opaque third-party member must survive *byte-for-byte* in its
            # decompressed form, even though its semantics cannot be certified.
            with zipfile.ZipFile(source, 'a') as archive:
                archive.writestr('Metadata/custom.config', b'opaque\x00settings')
            old = inventory(source)
            original = source.read_bytes()
            report = edit_core_build_item(source, dest, 1, IDENTITY_180)
            self.assertEqual(report['editedBuildIndex'], 1)
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(report['preservedMembers'], len(old)-1)
            now = inventory(dest)
            self.assertEqual(set(old), set(now))
            for key in old:
                if key != '3D/3dmodel.model':
                    self.assertEqual(old[key], now[key], key)
            self.assertNotEqual(old['3D/3dmodel.model'], now['3D/3dmodel.model'])
            before, after = audit(source), audit(dest)
            self.assertEqual(after['totalResolvedTriangleInstances'], 24)
            self.assertEqual(before['scenes'][0]['buildItems'][0],
                             after['scenes'][0]['buildItems'][0])
            self.assertEqual(after['scenes'][0]['buildItems'][1]['transform3mf'][9:],
                             [180., 90., 0.])
            with zipfile.ZipFile(source) as z1, zipfile.ZipFile(dest) as z2:
                pre, post = z1.read('3D/3dmodel.model'), z2.read('3D/3dmodel.model')
                self.assertEqual(post,
                    pre.replace(b'1 0 0 0 1 0 0 0 1 150 90 0',
                                b'1 0 0 0 1 0 0 0 1 180 90 0'))
                self.assertEqual(z1.read('Metadata/custom.config'),
                                 z2.read('Metadata/custom.config'))

    def test_refuses_missing_target_invalid_and_clobbering(self):
        with tempfile.TemporaryDirectory() as folder:
            source, dest = self.paths(folder)
            for index, transform, error in (
                (-1, IDENTITY_180, 'index'),
                (2, IDENTITY_180, 'range'),
                (1, '1 0 0', '12'),
                (1, '1 0 0 0 1 0 0 0 1 NaN 0 0', 'Non-finite'),
                (1, '0 0 0 0 0 0 0 0 0 180 90 0', 'Singular'),
            ):
                with self.subTest(index=index, transform=transform):
                    with self.assertRaisesRegex(ValueError, error):
                        edit_core_build_item(source, dest, index, transform)
                    self.assertFalse(dest.exists())
            with self.assertRaisesRegex(ValueError, 'distinct'):
                edit_core_build_item(source, source, 1, IDENTITY_180)
            dest.write_bytes(b'important file')
            with self.assertRaisesRegex(ValueError, 'new path'):
                edit_core_build_item(source, dest, 1, IDENTITY_180)
            self.assertEqual(dest.read_bytes(), b'important file')

    def test_refuses_missing_attribute_or_unexpected_model_part(self):
        with tempfile.TemporaryDirectory() as folder:
            source, dest = self.paths(folder)
            with zipfile.ZipFile(source) as original:
                entries = {i.filename:original.read(i) for i in original.infolist()}
            model_name = '3D/3dmodel.model'
            entries[model_name] = entries[model_name].replace(
                b' transform="1 0 0 0 1 0 0 0 1 150 90 0"', b'', 1)
            with zipfile.ZipFile(source, 'w') as archive:
                for name, content in entries.items():
                    archive.writestr(name, content)
            with self.assertRaisesRegex(ValueError, 'explicit transform'):
                edit_core_build_item(source, dest, 1, IDENTITY_180)
            self.assertFalse(dest.exists())
            entries['3D/second.model'] = entries[model_name]
            with zipfile.ZipFile(source, 'w') as archive:
                for name, content in entries.items():
                    archive.writestr(name, content)
            with self.assertRaisesRegex(ValueError, 'single'):
                edit_core_build_item(source, dest, 0, IDENTITY_180)
            self.assertFalse(dest.exists())

    def test_refuses_unsafe_archive_and_dtd(self):
        with tempfile.TemporaryDirectory() as folder:
            source, dest = self.paths(folder)
            with zipfile.ZipFile(source, 'a') as archive:
                archive.writestr('../unsafe', b'bad')
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                edit_core_build_item(source, dest, 1, IDENTITY_180)
            self.assertFalse(dest.exists())


if __name__ == '__main__':
    unittest.main()
