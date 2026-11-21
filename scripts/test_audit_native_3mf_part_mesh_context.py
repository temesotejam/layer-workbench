"""Synthetic offline checks: Part counts are observations, not identity mappings."""
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from audit_native_3mf_part_mesh_context import audit_part_mesh_context
from clone_native_3mf_branched_root import clone_branched_root
from test_clone_native_3mf_branched_root import branched_parts, distinct_branched_parts


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

    def test_unique_part_ids_match_distinct_leaf_resources_as_candidates_only(self):
        parts = distinct_branched_parts()
        # The exporter records part IDs from volume Core resource IDs,
        # not from source_object_id/volume_id provenance indices.
        parts['Metadata/model_settings.config'] = b'''<config><object id="1">
<part id="0101" subtype="normal_part">
<metadata key="source_object_id" value="98765"/></part>
<part id="102" subtype="normal_part">
<metadata key="source_volume_id" value="54321"/></part>
</object><object id="2"/></config>'''
        with ZipFile(self.source, 'w') as z:
            for path, content in parts.items():
                z.writestr(path, content)
        result = audit_part_mesh_context(self.source)
        self.assertEqual(result['one_to_one_numeric_id_candidate_builds'], 2)
        for build in result['build_contexts']:
            self.assertTrue(build['one_to_one_numeric_id_candidates'])
            self.assertEqual(build['part_core_id_candidates'], [
                {'vendor_part_id': '0101',
                 'status': 'unique_numeric_core_id_candidate',
                 'core_mesh_occurrence_indices': [0]},
                {'vendor_part_id': '102',
                 'status': 'unique_numeric_core_id_candidate',
                 'core_mesh_occurrence_indices': [1]},
            ])
        self.assertFalse(result['part_to_mesh_identity_proven'])
        self.assertNotIn('98765', str(result))
        self.assertNotIn('54321', str(result))

    def test_repeated_core_leaf_is_ambiguous_even_with_matching_id(self):
        self.write(part_count=2)
        config = b'''<config><object id="1">
<part id="101" subtype="normal_part"/>
<part id="999" subtype="normal_part"/></object><object id="2"/></config>'''
        # Replace archive rather than appending a duplicate metadata member.
        files = branched_parts()
        files['Metadata/model_settings.config'] = config
        self.source.unlink()
        with ZipFile(self.source, 'w') as z:
            for path, content in files.items():
                z.writestr(path, content)
        result = audit_part_mesh_context(self.source)
        self.assertEqual(result['matching_count_builds'], 2)
        self.assertEqual(result['one_to_one_numeric_id_candidate_builds'], 0)
        statuses = [row['status'] for row in result['build_contexts'][0]
                    ['part_core_id_candidates']]
        self.assertEqual(statuses, ['ambiguous_repeated_core_id',
                                    'no_numeric_core_id_candidate'])

    def test_duplicate_vendor_ids_cannot_claim_one_to_one(self):
        self.write()
        files = distinct_branched_parts()
        files['Metadata/model_settings.config'] = b'''<config><object id="1">
<part id="101"/><part id="0101"/></object><object id="2"/></config>'''
        self.source.unlink()
        with ZipFile(self.source, 'w') as z:
            for path, content in files.items():
                z.writestr(path, content)
        result = audit_part_mesh_context(self.source)
        self.assertEqual(result['one_to_one_numeric_id_candidate_builds'], 0)
        statuses = [row['status'] for row in result['build_contexts'][0]
                    ['part_core_id_candidates']]
        self.assertEqual(statuses, ['duplicate_part_id', 'duplicate_part_id'])

    def test_unsupported_part_id_and_missing_settings_do_not_assert_mapping(self):
        self.write()
        result = audit_part_mesh_context(self.source)
        self.assertEqual(result['one_to_one_numeric_id_candidate_builds'], 0)
        for row in result['build_contexts']:
            self.assertFalse(row['one_to_one_numeric_id_candidates'])
        clone_branched_root(self.source, self.candidate, edge_index=0)
        changed = audit_part_mesh_context(self.candidate)
        self.assertIsNone(changed['build_contexts'][1]['one_to_one_numeric_id_candidates'])
        self.assertEqual(changed['build_contexts'][1]['part_core_id_candidates'], [])

    def test_invalid_vendor_settings_refused(self):
        self.write()
        with ZipFile(self.source, 'a') as z:
            # Duplicate archive members must fail closed, not select one.
            z.writestr('Metadata/model_settings.config', b'<config/>')
        with self.assertRaises(ValueError):
            audit_part_mesh_context(self.source)


if __name__ == '__main__':
    unittest.main()
