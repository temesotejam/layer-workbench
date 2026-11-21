"""Synthetic offline checks: Part counts are observations, not identity mappings."""
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from audit_native_3mf_part_mesh_context import audit_part_mesh_context
from clone_native_3mf_branched_root import clone_branched_root
from test_clone_native_3mf_branched_root import branched_parts


def fixture_config(part_count):
    parts = ''.join(
        f'<part id="{n}" subtype="normal_part">'
        f'<metadata key="name" value="PRIVATE_{n}"/></part>'
        for n in (999, 700)[:part_count]
    )
    return ('<config><object id="1">' + parts +
            '</object><object id="2"/></config>').encode()


class NativePartMeshContextTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.source = Path(tmp.name) / 'before.3mf'
        self.candidate = Path(tmp.name) / 'after.3mf'

    def write(self, part_count=2):
        files = branched_parts()
        files['Metadata/model_settings.config'] = fixture_config(part_count)
        with ZipFile(self.source, 'w') as z:
            for path, content in files.items():
                z.writestr(path, content)

    def test_shared_root_two_occurrences_count_matches_but_no_mapping(self):
        self.write()
        result = audit_part_mesh_context(self.source)
        self.assertEqual([r['main_core_root_id'] for r in result['build_contexts']],
                         ['1', '1'])
        self.assertEqual([r['core_mesh_occurrences'] for r in result['build_contexts']],
                         [2, 2])
        self.assertEqual(result['matching_count_builds'], 2)
        self.assertEqual(result['mismatching_count_builds'], 0)
        self.assertTrue(all(r['distinct_core_mesh_resources'] == 1
                            for r in result['build_contexts']))
        self.assertFalse(result['part_to_mesh_identity_proven'])
        self.assertEqual(result['build_contexts'][0]['native_part_descriptors'][0]['id'],
                         '999')
        self.assertNotIn('PRIVATE_999', str(result))

    def test_mismatched_cardinality_reports_difference_without_asserting_loss(self):
        self.write(part_count=1)
        result = audit_part_mesh_context(self.source)
        self.assertEqual(result['mismatching_count_builds'], 2)
        self.assertTrue(all(r['part_count_equals_core_mesh_occurrences'] is False
                            for r in result['build_contexts']))
        self.assertFalse(result['part_to_mesh_identity_proven'])

    def test_cloned_root_without_vendor_settings_is_visible(self):
        self.write()
        original_bytes = self.source.read_bytes()
        clone_branched_root(self.source, self.candidate, edge_index=0)
        result = audit_part_mesh_context(self.candidate)
        self.assertEqual(result['builds_without_direct_settings'], 1)
        self.assertTrue(result['build_contexts'][0]['native_object_settings_present'])
        self.assertFalse(result['build_contexts'][1]['native_object_settings_present'])
        self.assertIsNone(result['build_contexts'][1]['native_part_count'])
        self.assertIsNone(result['build_contexts'][1]['part_count_equals_core_mesh_occurrences'])
        self.assertEqual(self.source.read_bytes(), original_bytes)

    def test_invalid_vendor_settings_refused(self):
        self.write()
        with ZipFile(self.source, 'a') as z:
            # Duplicate archive members must fail closed, not select one.
            z.writestr('Metadata/model_settings.config', b'<config/>')
        with self.assertRaises(ValueError):
            audit_part_mesh_context(self.source)


if __name__ == '__main__':
    unittest.main()
