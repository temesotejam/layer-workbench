"""Synthetic Core 3MF edit acceptance, not an OrcaSlicer project parity test."""
from pathlib import Path
import tempfile
import unittest
import zipfile

from audit_3mf_scene import audit
from compare_3mf_metadata import inventory
from edit_3mf_build_transform import edit_core_build_item, translate_core_build_item, rotate_core_build_item_z
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


    def rewrite_core_model(self, source, replacements):
        with zipfile.ZipFile(source) as archive:
            entries = [(entry, archive.read(entry)) for entry in archive.infolist()]
        with zipfile.ZipFile(source, 'w') as archive:
            for entry, payload in entries:
                if entry.filename == '3D/3dmodel.model':
                    for old, new in replacements:
                        self.assertEqual(payload.count(old), 1)
                        payload = payload.replace(old, new, 1)
                archive.writestr(entry, payload)

    def test_relative_move_preserves_rotated_scaled_item_and_opaque_member(self):
        with tempfile.TemporaryDirectory() as folder:
            source, dest = self.paths(folder)
            self.rewrite_core_model(source, [(b'1 0 0 0 1 0 0 0 1 150 90 0',
                                              b'0 2 0 -1 0 0 0 0 1 150 90 0')])
            with zipfile.ZipFile(source, 'a') as archive:
                archive.writestr('Metadata/vendor.bin', b'opaque-settings')
            source_bytes, old = source.read_bytes(), inventory(source)
            result = translate_core_build_item(source, dest, 1, (30, -10, 3))
            self.assertEqual(result['relativeTranslationMm'], [30, -10, 3])
            self.assertEqual(result['modelUnit'], 'millimeter')
            self.assertEqual(source.read_bytes(), source_bytes)
            a = audit(source)['scenes'][0]['buildItems']
            b = audit(dest)['scenes'][0]['buildItems']
            self.assertEqual(a[0], b[0])
            self.assertEqual(a[1]['transform3mf'][:9], b[1]['transform3mf'][:9])
            self.assertEqual(b[1]['transform3mf'][9:], [180., 80., 3.])
            after = inventory(dest)
            self.assertEqual(set(old), set(after))
            for name in old:
                if name != '3D/3dmodel.model':
                    self.assertEqual(old[name], after[name], name)

    def test_relative_z_rotation_preserves_other_item_and_opaque_archive(self):
        with tempfile.TemporaryDirectory() as folder:
            source, dest = self.paths(folder)
            with zipfile.ZipFile(source, 'a') as archive:
                archive.writestr('Metadata/vendor.xml', b'<opaque>keep</opaque>')
            original = source.read_bytes()
            before = inventory(source)
            result = rotate_core_build_item_z(source, dest, 1, 90)
            self.assertEqual(result['relativeRotationZDegrees'], 90)
            self.assertIn('not mesh center', result['pivot'])
            self.assertEqual(source.read_bytes(), original)
            after = inventory(dest)
            self.assertEqual(set(before), set(after))
            for name in before:
                if name != '3D/3dmodel.model':
                    self.assertEqual(before[name], after[name], name)
            old = audit(source)['scenes'][0]
            new = audit(dest)['scenes'][0]
            self.assertEqual(old['buildItems'][0], new['buildItems'][0])
            matrix = new['buildItems'][1]['transform3mf']
            for value, expected in zip(matrix, (0, 1, 0, -1, 0, 0, 0, 0, 1, 150, 90, 0)):
                self.assertAlmostEqual(value, expected, places=10)
            instances = new['resolvedMeshInstances']
            bounds = instances[1]['conservativeWorldBounds']
            for side, expected in [('min', (130, 90, 0)), ('max', (150, 110, 20))]:
                for actual, wanted in zip(bounds[side], expected):
                    self.assertAlmostEqual(actual, wanted, places=9)

    def test_relative_z_rotation_preserves_nonuniform_scale(self):
        with tempfile.TemporaryDirectory() as folder:
            source, dest = self.paths(folder)
            self.rewrite_core_model(source, [(b'1 0 0 0 1 0 0 0 1 150 90 0',
                                              b'0 2 0 -1 0 0 0 0 1 150 90 0')])
            result = rotate_core_build_item_z(source, dest, 1, 90)
            self.assertEqual(result['editedBuildIndex'], 1)
            before = audit(source)['scenes'][0]['buildItems']
            after = audit(dest)['scenes'][0]['buildItems']
            self.assertEqual(before[0], after[0])
            self.assertEqual(before[1]['transform3mf'][9:], after[1]['transform3mf'][9:])
            for value, expected in zip(after[1]['transform3mf'][:9], (-2, 0, 0, 0, -1, 0, 0, 0, 1)):
                self.assertAlmostEqual(value, expected, places=10)

    def test_relative_z_rotation_rejects_invalid_and_noop(self):
        with tempfile.TemporaryDirectory() as folder:
            source, dest = self.paths(folder)
            for index, degrees in ((-1, 90), (2, 90), (True, 90),
                                   (1, 0), (1, 360), (1, -360),
                                   (1, True), (1, float('nan')),
                                   (1, float('inf')), (1, 361)):
                with self.subTest(index=index, degrees=degrees):
                    with self.assertRaises(ValueError):
                        rotate_core_build_item_z(source, dest, index, degrees)
                    self.assertFalse(dest.exists())

    def test_relative_move_obeys_non_mm_3mf_model_units(self):
        with tempfile.TemporaryDirectory() as folder:
            source, dest = self.paths(folder)
            self.rewrite_core_model(source, [
                (b'unit="millimeter"', b'unit="inch"'),
                (b'1 0 0 0 1 0 0 0 1 150 90 0',
                 b'1 0 0 0 1 0 0 0 1 5 3 0')])
            result = translate_core_build_item(source, dest, 1, (25.4, -12.7, 0))
            self.assertEqual(result['modelUnit'], 'inch')
            a = audit(source)['scenes'][0]['buildItems']
            b = audit(dest)['scenes'][0]['buildItems']
            self.assertEqual(a[0], b[0])
            self.assertEqual(a[1]['transform3mf'][:9], b[1]['transform3mf'][:9])
            self.assertEqual(b[1]['transform3mf'][9:], [6., 2.5, 0.])

    def test_relative_move_invalid_inputs_leave_no_output(self):
        with tempfile.TemporaryDirectory() as folder:
            source, dest = self.paths(folder)
            for index, delta in (
                (-1, (1, 0, 0)), (2, (1, 0, 0)), (True, (1, 0, 0)),
                (1, (0, 0, 0)), (1, (float('nan'), 0, 0)),
                (1, (float('inf'), 0, 0)), (1, (1_000_001, 0, 0)),
                (1, (1, 2)), (1, (True, 0, 0))
            ):
                with self.subTest(index=index, delta=delta):
                    with self.assertRaises(ValueError):
                        translate_core_build_item(source, dest, index, delta)
                    self.assertFalse(dest.exists())

    def test_refuses_missing_target_invalid_and_clobbering(self):
        with tempfile.TemporaryDirectory() as folder:
            source, dest = self.paths(folder)
            for index, transform, error in (
                (-1, IDENTITY_180, 'range'),
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
