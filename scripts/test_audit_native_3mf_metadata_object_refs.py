"""Synthetic metadata-ID audit tests; no native project editing or G-code."""
import contextlib
import io
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from zipfile import ZipFile

from audit_native_3mf_metadata_object_refs import (inspect_metadata_refs,
                                                   compare_metadata_refs, main)

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

    def test_part_inventory_exposes_structure_not_values_or_core_mapping(self):
        config = b'''<config><object id="1">
<part id="0007" subtype="normal_part">
<metadata key="name" value="Private model name"/>
<metadata key="matrix" value="1 0 0 0"/>
</part><part id="7" subtype="modifier"/></object><object id="2"/></config>'''
        self.put(self.a, config=config)
        info = inspect_metadata_refs(self.a)
        self.assertEqual(info['settings_part_counts'], {'1': 2, '2': 0})
        self.assertEqual(info['settings_part_inventory']['1'], [
            {'id': '0007', 'subtype': 'normal_part',
             'metadata_keys': ['name', 'matrix']},
            {'id': '7', 'subtype': 'modifier', 'metadata_keys': []},
        ])
        self.assertEqual(info['settings_part_inventory']['2'], [])
        self.assertNotIn('Private model name', json.dumps(info))

    def test_redirected_root_reports_part_context_without_inventing_mapping(self):
        self.put(self.a)
        candidate = MODEL.replace(b'<object id="2"/>',
                                  b'<object id="2"/><object id="3"/>')
        candidate = candidate.replace(b'<item objectid="1"/>',
                                      b'<item objectid="3"/>', 1)
        self.put(self.b, model=candidate)
        result = compare_metadata_refs(self.a, self.b)
        self.assertEqual(result['status'], 'needs_vendor_metadata_mapping')
        self.assertEqual(result['redirected_part_context'], [
            {'build_index': 0, 'from_id': '1', 'to_id': '3',
             'source_parts': [{'id': '11', 'subtype': 'normal_part',
                               'metadata_keys': []}],
             'destination_parts': []},
        ])
        self.assertFalse(result['semantic_object_settings_parity_proven'])

    def test_part_structure_diff_preserves_opaque_ids_without_values(self):
        original = b'''<config><object id="1"><part id="0007" subtype="normal_part">
<metadata key="name" value="Private model name"/></part></object>
<object id="2"/></config>'''
        changed = original.replace(b'id="0007"', b'id="7"').replace(
            b'subtype="normal_part"', b'subtype="modifier"').replace(
            b'key="name"', b'key="texture"')
        self.put(self.a, config=original)
        self.put(self.b, config=changed)
        result = compare_metadata_refs(self.a, self.b)
        self.assertEqual(result['status'], 'model_settings_bytes_changed')
        self.assertEqual(result['part_structure_changes'], [{
            'object_id': '1',
            'baseline_parts': [{'id': '0007', 'subtype': 'normal_part',
                                'metadata_keys': ['name']}],
            'candidate_parts': [{'id': '7', 'subtype': 'modifier',
                                 'metadata_keys': ['texture']}],
        }])
        self.assertNotIn('Private model name', json.dumps(result))
        self.assertFalse(result['semantic_object_settings_parity_proven'])

    def test_value_only_change_does_not_claim_part_structure_change(self):
        original = b'''<config><object id="1"><part id="12" subtype="normal_part">
<metadata key="speed" value="30"/></part></object><object id="2"/></config>'''
        self.put(self.a, config=original)
        self.put(self.b, config=original.replace(b'value="30"', b'value="45"'))
        result = compare_metadata_refs(self.a, self.b)
        self.assertFalse(result['model_settings_bytes_unchanged'])
        self.assertEqual(result['part_structure_changes'], [])
        self.assertEqual(result['status'], 'model_settings_bytes_changed')
        self.assertNotIn('45', json.dumps(result))

    def test_unmodified_part_layout_has_empty_diff_on_root_redirect(self):
        self.put(self.a)
        redirected = MODEL.replace(b'<object id="2"/>',
                                   b'<object id="2"/><object id="3"/>')
        redirected = redirected.replace(b'<item objectid="1"/>',
                                        b'<item objectid="3"/>', 1)
        self.put(self.b, model=redirected)
        result = compare_metadata_refs(self.a, self.b)
        self.assertEqual(result['status'], 'needs_vendor_metadata_mapping')
        self.assertEqual(result['part_structure_changes'], [])
        self.assertTrue(result['model_settings_bytes_unchanged'])

    def test_part_id_is_not_assumed_to_match_core_resource_id(self):
        config = CONFIG.replace(b'part id="11"', b'part id="00101"')
        self.put(self.a, config=config)
        info = inspect_metadata_refs(self.a)
        self.assertEqual(info['settings_part_inventory']['1'][0]['id'], '00101')
        self.assertNotIn('101', info['main_object_ids'])

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

    def test_integer_id_lexical_aliases_match_across_parts(self):
        # Core build, Core resources and vendor settings may spell the same
        # positive integer with different leading zeros.
        model = MODEL.replace(b'<object id="1"/>', b'<object id="001"/>')
        model = model.replace(b'objectid="1"', b'objectid="0001"')
        config = CONFIG.replace(b'<object id="1">', b'<object id="01">')
        self.put(self.a, model=model, config=config)
        info = inspect_metadata_refs(self.a)
        self.assertEqual(info['main_object_ids'], ['1', '2'])
        self.assertEqual(info['build_object_ids'], ['1', '1'])
        self.assertEqual(info['settings_object_ids'], ['1', '2'])
        self.assertFalse(info['local_build_roots_without_object_settings'])

    def test_leading_zero_numeric_aliases_cannot_bypass_duplicate_check(self):
        duplicate_config = b'<config><object id="1"/><object id="01"/></config>'
        self.put(self.a, config=duplicate_config)
        with self.assertRaisesRegex(ValueError, 'Duplicate native'):
            inspect_metadata_refs(self.a)
        self.a.unlink()
        duplicate_core = MODEL.replace(b'<object id="2"/>', b'<object id="01"/>')
        self.put(self.a, model=duplicate_core)
        with self.assertRaisesRegex(ValueError, 'Duplicate main'):
            inspect_metadata_refs(self.a)

    def test_baseline_metadata_ids_cannot_be_silently_rewritten(self):
        self.put(self.a)
        self.put(self.b, config=b'<config><object id="2"/></config>')
        with self.assertRaisesRegex(ValueError, 'inventory changed'):
            compare_metadata_refs(self.a, self.b)

    def test_settings_byte_identity_on_unchanged_vendor_metadata(self):
        self.put(self.a)
        candidate = MODEL.replace(b'<object id="2"/>',
                                  b'<object id="2"/><object id="3"/>')
        self.put(self.b, model=candidate)
        result = compare_metadata_refs(self.a, self.b)
        self.assertTrue(result['model_settings_bytes_unchanged'])
        self.assertEqual(result['status'], 'no_direct_id_gap_detected')
        self.assertEqual(inspect_metadata_refs(self.a)['model_settings_sha256'],
                         inspect_metadata_refs(self.b)['model_settings_sha256'])

    def test_same_object_ids_changed_vendor_payload_is_detected(self):
        self.put(self.a)
        modified = CONFIG.replace(b'subtype="normal_part"',
                                  b'subtype="modifier"')
        self.put(self.b, config=modified)
        result = compare_metadata_refs(self.a, self.b)
        self.assertEqual(result['redirected_build_items'], [])
        self.assertFalse(result['model_settings_bytes_unchanged'])
        self.assertEqual(result['status'], 'model_settings_bytes_changed')
        self.assertFalse(result['semantic_object_settings_parity_proven'])

    def test_fail_on_settings_change_is_opt_in_and_fails_closed(self):
        self.put(self.a)
        self.put(self.b, config=CONFIG.replace(b'normal_part', b'modifier'))
        argv = ['audit', '--baseline', str(self.a), '--candidate', str(self.b)]
        with patch('sys.argv', argv), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(main(), 0)
        self.assertFalse(json.loads(output.getvalue())['model_settings_bytes_unchanged'])
        with patch('sys.argv', argv + ['--fail-on-settings-change']), \
                contextlib.redirect_stderr(io.StringIO()) as errors:
            self.assertEqual(main(), 2)
        self.assertIn('model-settings bytes changed', errors.getvalue())
        self.b.unlink()
        self.put(self.b)
        with patch('sys.argv', argv + ['--fail-on-settings-change']), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(), 0)

    def test_settings_change_gate_requires_comparison(self):
        self.put(self.a)
        with patch('sys.argv', ['audit', '--baseline', str(self.a),
                                '--fail-on-settings-change']), \
                contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                main()
        self.assertEqual(ctx.exception.code, 2)


if __name__ == '__main__':
    unittest.main()
