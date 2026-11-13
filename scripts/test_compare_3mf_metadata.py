import pathlib
import tempfile
import unittest
import warnings
import zipfile
from compare_3mf_metadata import compare, inventory

MODEL = b'<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"/>'
TYPES = b'<Types/>'


def make(path, settings=b'<config/>', model=MODEL, extra=None, ordering=False):
    entries = {"[Content_Types].xml": TYPES, "3D/3dmodel.model": model,
               "Metadata/model_settings.config": settings}
    entries.update(extra or {})
    with zipfile.ZipFile(path, "w") as archive:
        for name in (reversed(list(entries)) if ordering else entries):
            archive.writestr(name, entries[name])


class Test3MFMetadata(unittest.TestCase):
    def test_identical_members_different_zip_order(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = pathlib.Path(d) / 'a.3mf', pathlib.Path(d) / 'b.3mf'
            make(a)
            make(b, ordering=True)
            self.assertTrue(compare(a, b)['match'])
            self.assertTrue(compare(a, b, 'metadata')['match'])

    def test_changed_missing_added(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = pathlib.Path(d) / 'a.3mf', pathlib.Path(d) / 'b.3mf'
            make(a)
            make(b, settings=b'<config>changed</config>', extra={'Metadata/extra.xml': b'a'})
            r = compare(a, b)
            self.assertFalse(r['match'])
            self.assertEqual([x['path'] for x in r['changed']], ['Metadata/model_settings.config'])
            self.assertEqual(r['added'], ['Metadata/extra.xml'])
            make(b, extra={"Metadata/model_settings.config": b'ignored'})
            self.assertFalse(compare(a, b)['match'])

    def test_geometry_ignored_only_in_explicit_metadata_scope(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = pathlib.Path(d) / 'a.3mf', pathlib.Path(d) / 'b.3mf'
            make(a)
            make(b, model=b'<model>new geometry</model>')
            self.assertFalse(compare(a, b)['match'])
            self.assertTrue(compare(a, b, 'metadata')['match'])

    def test_invalid_zip_paths_duplicate_and_vacuous(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d) / 'a.3mf'
            for name in ('../escape', '/absolute', '3D//bad.model', '3D\\bad.model'):
                make(p, extra={name: b'bad'})
                with self.assertRaisesRegex(ValueError, 'Unsafe'):
                    inventory(p)
            make(p)
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', UserWarning)
                with zipfile.ZipFile(p, 'a') as z:
                    z.writestr('Metadata/model_settings.config', b'again')
            with self.assertRaisesRegex(ValueError, 'Duplicate'):
                inventory(p)
            # Empty metadata can never establish metadata-only equivalence.
            with zipfile.ZipFile(p, 'w') as z:
                z.writestr('[Content_Types].xml', TYPES)
                z.writestr('3D/3dmodel.model', MODEL)
            with self.assertRaisesRegex(ValueError, 'No selected'):
                compare(p, p, 'metadata')


if __name__ == '__main__':
    unittest.main()
