"""Independent regression checks for strict Core 3MF model-byte preservation."""
import pathlib
import tempfile
import unittest
from zipfile import ZipFile

from compare_3mf_build_preservation import (
    compare_build_preservation, mask_build_transforms,
)
from edit_3mf_build_transform import translate_core_build_item
from make_3mf_two_build_fixture import make_file

FIRST = b'1 0 0 0 1 0 0 0 1 90 90 0'
FIRST_EDIT = b'1 0 0 0 1 0 0 0 1 100 90 0'
SECOND = b'1 0 0 0 1 0 0 0 1 150 90 0'
SECOND_EDIT = b'1 0 0 0 1 0 0 0 1 160 90 0'
MODEL = '3D/3dmodel.model'


def rewrite(source, destination, replace=None, extra=None):
    """Keep archive members while independently editing raw test fixture bytes."""
    with ZipFile(source) as z:
        parts = {name: z.read(name) for name in z.namelist()}
    if replace:
        old, new = replace
        assert old in parts[MODEL]
        parts[MODEL] = parts[MODEL].replace(old, new, 1)
    parts.update(extra or {})
    with ZipFile(destination, 'w') as z:
        for name, data in parts.items():
            z.writestr(name, data)


class TestCoreBuildPreservation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.a = self.root / 'original.3mf'
        self.b = self.root / 'modified.3mf'
        make_file(self.a)

    def test_actual_surgical_translate_keeps_every_other_model_byte(self):
        translate_core_build_item(self.a, self.b, 0, [10, 0, 0])
        result = compare_build_preservation(self.a, self.b)
        self.assertTrue(result['match'], result)
        self.assertTrue(result['ancillary_match'])
        self.assertEqual([e['build_index'] for e in result['changed_build_items']], [0])

    def test_single_valid_change_passes_but_original_noop_fails(self):
        rewrite(self.a, self.b, (FIRST, FIRST_EDIT))
        self.assertTrue(compare_build_preservation(self.a, self.b)['match'])
        self.assertFalse(compare_build_preservation(self.a, self.a)['match'])

    def test_implicit_identity_to_explicit_move_is_exactly_one_added_attribute(self):
        with ZipFile(self.a) as z:
            parts = {name: z.read(name) for name in z.namelist()}
        implicit = b'<item objectid="1"/>'
        parts[MODEL] = parts[MODEL].replace(
            b'<item objectid="1" transform="' + FIRST + b'"/>', implicit, 1)
        with ZipFile(self.a, 'w') as z:
            for name, data in parts.items():
                z.writestr(name, data)
        translate_core_build_item(self.a, self.b, 0, [10, 0, 0])
        result = compare_build_preservation(self.a, self.b)
        self.assertTrue(result['match'], result)
        self.assertEqual(result['changed_build_items'][0]['before'], None)
        self.assertEqual(result['changed_build_items'][0]['after'][9:12],
                         [10., 0., 0.])
        with ZipFile(self.b) as z:
            edited = {name: z.read(name) for name in z.namelist()}
        # Subtly changed attribute formatting must not be accepted as an
        # exact insertion even if an XML parser considers it equivalent.
        good = b' transform="1 0 0 0 1 0 0 0 1 10 0 0"'
        self.assertIn(good, edited[MODEL])
        for bad in (
            b'  transform="1 0 0 0 1 0 0 0 1 10 0 0"',
            b' transform = "1 0 0 0 1 0 0 0 1 10 0 0"',
        ):
            with self.subTest(bad=bad):
                edited[MODEL] = edited[MODEL].replace(good, bad, 1)
                with ZipFile(self.b, 'w') as z:
                    for name, data in edited.items():
                        z.writestr(name, data)
                self.assertFalse(compare_build_preservation(self.a, self.b)['match'])
                edited[MODEL] = edited[MODEL].replace(bad, good, 1)
        # Changing geometry in the same archive can never be hidden by a
        # legitimate added transform attribute.
        self.assertIn(b'<vertex x="0"', edited[MODEL])
        edited[MODEL] = edited[MODEL].replace(b'<vertex x="0"',
                                              b'<vertex x="9"', 1)
        with ZipFile(self.b, 'w') as z:
            for name, data in edited.items():
                z.writestr(name, data)
        self.assertFalse(compare_build_preservation(self.a, self.b)['match'])

    def test_unmodified_sibling_or_multiple_edited_items(self):
        rewrite(self.a, self.b, (FIRST, FIRST_EDIT))
        with ZipFile(self.b) as z:
            parts = {name: z.read(name) for name in z.namelist()}
        parts[MODEL] = parts[MODEL].replace(SECOND, SECOND_EDIT, 1)
        with ZipFile(self.b, 'w') as z:
            for name, data in parts.items():
                z.writestr(name, data)
        result = compare_build_preservation(self.a, self.b)
        self.assertFalse(result['match'])
        self.assertEqual(len(result['changed_build_items']), 2)

    def test_geometry_model_metadata_and_attribute_edits_fail(self):
        for extra_change in (
            (b'<vertex x="0"', b'<vertex x="5"'),
            (b'<item objectid="1"', b'<item objectid="2"'),
            (b'</build></model>', b'</build><!-- vendor note --></model>'),
            (b'<resources>', b'<resources><!-- unknown extension -->'),
        ):
            with self.subTest(extra_change=extra_change):
                with ZipFile(self.a) as z:
                    parts = {name: z.read(name) for name in z.namelist()}
                raw = parts[MODEL].replace(FIRST, FIRST_EDIT, 1)
                self.assertIn(extra_change[0], raw)
                parts[MODEL] = raw.replace(*extra_change, 1)
                with ZipFile(self.b, 'w') as z:
                    for name, data in parts.items():
                        z.writestr(name, data)
                result = compare_build_preservation(self.a, self.b)
                self.assertFalse(result['match'])
                self.assertFalse(result['model_bytes_unchanged_except_build_transform'])

    def test_unrelated_archive_member_changes_fail(self):
        rewrite(self.a, self.b, (FIRST, FIRST_EDIT),
                extra={'Vendor/raw-extension.bin': b'\x00\xff'})
        result = compare_build_preservation(self.a, self.b)
        self.assertFalse(result['match'])
        self.assertEqual(result['ancillary_added'], ['Vendor/raw-extension.bin'])

    def test_invalid_or_unsupported_xml_fails_closed(self):
        with ZipFile(self.a) as z:
            base = z.read(MODEL)
        for raw in (
            base.replace(FIRST, b'1 0 0 0 0 0 0 0 1 90 90 0', 1),
            base.replace(FIRST, b'NaN 0 0 0 1 0 0 0 1 90 90 0', 1),
            base.replace(FIRST, b'1 0 0', 1),
            b'<!DOCTYPE model [<!ENTITY x "bad">]>' + base,
            base.replace(b'</model>', b'', 1),
        ):
            with self.subTest(raw=raw[-60:]):
                with self.assertRaises(ValueError):
                    mask_build_transforms(raw)

    def test_unknown_model_parts_are_not_certified(self):
        rewrite(self.a, self.b, (FIRST, FIRST_EDIT),
                extra={'3D/other.model': b'<model/>'})
        with self.assertRaisesRegex(ValueError, 'Only one'):
            compare_build_preservation(self.a, self.b)

    def test_namespace_and_component_transforms_not_masked(self):
        with ZipFile(self.a) as z:
            base = z.read(MODEL)
        # A vendor XML attribute named transform must not become a permitted
        # exception merely because it looks like a 12-number build transform.
        vendor = b'<vendor:extension xmlns:vendor="urn:vendor" transform="a" />'
        altered = b'<vendor:extension xmlns:vendor="urn:vendor" transform="b" />'
        extra_baseline = base.replace(b'</model>', vendor + b'</model>')
        extra_candidate = extra_baseline.replace(FIRST, FIRST_EDIT).replace(vendor, altered)
        with ZipFile(self.a, 'w') as z:
            z.writestr('[Content_Types].xml', b'<Types/>')
            z.writestr('_rels/.rels', b'<Relationships/>')
            z.writestr(MODEL, extra_baseline)
        with ZipFile(self.b, 'w') as z:
            z.writestr('[Content_Types].xml', b'<Types/>')
            z.writestr('_rels/.rels', b'<Relationships/>')
            z.writestr(MODEL, extra_candidate)
        self.assertFalse(compare_build_preservation(self.a, self.b)['match'])


if __name__ == '__main__':
    unittest.main()
