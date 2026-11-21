"""Synthetic metadata-ID audit tests; no native project editing or G-code."""
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from audit_native_3mf_metadata_object_refs import (inspect_metadata_refs,
                                                   compare_metadata_refs)

MODEL = b'''<?xml version="1.0"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources><object id="1"/><object id="2"/></resources>
<build><item objectid="1"/><item objectid="1"/></build></model>'''
CONFIG = b'''<config><object id="1"><part id="11" subtype="normal_part"/></object>
<object id="2"/></config>'''


class MetadataObjectReferencesTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.a = Path(tmp.name) / 'original.3mf'
        self.b = Path(tmp.name) / 'candidate.3mf'

    def put(self, path, model=MODEL, config=CONFIG):
        with ZipFile(path, 'w') as z:
            z.writestr('3D/3dmodel.model', model)
            z.writestr('Metadata/model_settings.config', config)

    def test_shared_root_clone_with_stale_settings_is_flagged(self):
        self.put(self.a)
        changed = MODEL.replace(b'<object id="2"/>', b'<object id="2"/><object id="3"/>')
        changed = changed.replace(b'<item objectid="1"/>', b'<item objectid="3"/>', 1)
        self.put(self.b, changed)
        info = compare_metadata_refs(self.a, self.b)
        self.assertEqual(info['status'], 'needs_vendor_metadata_mapping')
        self.assertEqual(info['possible_unmapped_object_settings'], [
            dict(build_index=0, from_id='1', to_id='3',
                 original_had_settings=True, new_has_settings=False)])
        self.assertFalse(info['semantic_object_settings_parity_proven'])

    def test_unmapped_original_is_not_an_asserted_loss(self):
        self.put(self.a, config=b'<config><object id="2"/></config>')
        candidate = MODEL.replace(b'<object id="2"/>', b'<object id="2"/><object id="3"/>')
        self.put(self.b, candidate.replace(b'<item objectid="1"/>', b'<item objectid="3"/>', 1),
                 config=b'<config><object id="2"/></config>')
        result = compare_metadata_refs(self.a, self.b)
        self.assertEqual(result['status'], 'no_direct_id_gap_detected')
        self.assertFalse(result['semantic_object_settings_parity_proven'])

    def test_valid_metadata_part_inventory(self):
        self.put(self.a)
        info = inspect_metadata_refs(self.a)
        self.assertEqual(info['settings_part_counts'], {'1': 1, '2': 0})
        self.assertEqual(info['build_object_ids'], ['1', '1'])
        self.assertFalse(info['local_build_roots_without_object_settings'])

    def test_duplicate_ids_and_dtd_are_rejected(self):
        for config in (b'<config><object id="1"/><object id="1"/></config>',
                       b'<!DOCTYPE config [<!ENTITY x "hi">]><config/>',
                       b'<config><object id="-1"/></config>'):
            with self.subTest(config=config):
                self.put(self.a, config=config)
                with self.assertRaises(ValueError):
                    inspect_metadata_refs(self.a)
                self.a.unlink()

    def test_missing_or_ambiguous_archive_rejected(self):
        with ZipFile(self.a, 'w') as z:
            z.writestr('3D/3dmodel.model', MODEL)
        with self.assertRaisesRegex(ValueError, 'Required'):
            inspect_metadata_refs(self.a)
        self.a.unlink()
        with ZipFile(self.a, 'w') as z:
            z.writestr('3D/3dmodel.model', MODEL)
            z.writestr('Metadata/model_settings.config', CONFIG)
            z.writestr('Metadata/model_settings.config', CONFIG)
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            inspect_metadata_refs(self.a)

    def test_baseline_metadata_ids_cannot_be_silently_rewritten(self):
        self.put(self.a)
        self.put(self.b, config=b'<config><object id="2"/></config>')
        with self.assertRaisesRegex(ValueError, 'inventory changed'):
            compare_metadata_refs(self.a, self.b)


if __name__ == '__main__':
    unittest.main()
