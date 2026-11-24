#!/usr/bin/env python3
"""Synthetic, no-WASM tests for first-stage 3MF hierarchy loss."""
import unittest
from classify_3mf_hierarchy_gap import classify_hierarchy_gap


def evidence(shared=False):
    resources = 1 if shared else 2
    return ({
        'initialObjects': resources, 'initialMeshes': resources,
        'initialInstances': 2, 'reimportedObjects': resources,
        'reimportedMeshes': resources, 'reimportedInstances': 2,
        'flattenedTriangles': 24,
    }, {
        'totalObjects': resources, 'totalResolvedMeshInstances': 2,
        'totalBuildItems': 2, 'totalResolvedTriangleInstances': 24,
        'modelParts': 1,
    })


class HierarchyGapTests(unittest.TestCase):
    def test_exporter_loses_distinct_resources(self):
        s, a = evidence()
        a.update(totalObjects=1, totalResolvedMeshInstances=1, totalBuildItems=1)
        s.update(reimportedObjects=1, reimportedMeshes=1, reimportedInstances=1)
        report = classify_hierarchy_gap(s, a)
        self.assertEqual(report['firstObservedGap'], 'exported-core-hierarchy-lost')
        self.assertFalse(report['isNativeParity'])

    def test_exporter_loses_shared_instances(self):
        s, a = evidence(shared=True)
        a.update(totalResolvedMeshInstances=1, totalBuildItems=1)
        s.update(reimportedInstances=1)
        self.assertEqual(classify_hierarchy_gap(s, a)['firstObservedGap'],
                         'exported-core-hierarchy-lost')

    def test_importer_loses_hierarchy_after_valid_export(self):
        s, a = evidence()
        s.update(reimportedObjects=1, reimportedMeshes=1, reimportedInstances=1)
        self.assertEqual(classify_hierarchy_gap(s, a)['firstObservedGap'],
                         'reimport-manifest-hierarchy-lost')

    def test_components_can_expand_one_build_item(self):
        s, a = evidence(shared=True)
        a['totalBuildItems'] = 1
        self.assertEqual(classify_hierarchy_gap(s, a)['firstObservedGap'],
                         'counts-retained-placement-unverified')

    def test_geometry_mismatch_is_inconclusive(self):
        s, a = evidence()
        a['totalResolvedTriangleInstances'] = 12
        self.assertEqual(classify_hierarchy_gap(s, a)['firstObservedGap'],
                         'inconclusive-geometry-mismatch')

    def test_component_wrapper_is_not_an_extra_native_object(self):
        s, a = evidence(shared=True)
        a.update(totalObjects=2, scenes=[{
            'buildItems': [{'objectId': '2'}, {'objectId': '2'}],
            'resolvedMeshInstances': [
                {'buildItemIndex': i, 'objectId': '1', 'objectPath': ['2', '1']}
                for i in range(2)
            ],
        }])
        report = classify_hierarchy_gap(s, a)
        self.assertEqual(report['firstObservedGap'], 'counts-retained-placement-unverified')
        self.assertEqual(report['exportedCore']['Objects'], 2)
        self.assertEqual(report['exportedCore']['DistinctBuildRoots'], 1)
        self.assertEqual(report['exportedCore']['DistinctResolvedMeshResources'], 1)
        self.assertFalse(report['isNativeParity'])
        s.update(reimportedObjects=2, reimportedMeshes=2)
        self.assertEqual(classify_hierarchy_gap(s, a)['firstObservedGap'],
                         'inconclusive-manifest-expansion')

    def test_distinct_roots_with_distinct_meshes_do_not_count_wrappers(self):
        s, a = evidence()
        a.update(totalObjects=4, scenes=[{
            'buildItems': [{'objectId': '3'}, {'objectId': '4'}],
            'resolvedMeshInstances': [
                {'buildItemIndex': 0, 'objectId': '1', 'objectPath': ['3', '1']},
                {'buildItemIndex': 1, 'objectId': '2', 'objectPath': ['4', '2']},
            ],
        }])
        self.assertEqual(classify_hierarchy_gap(s, a)['firstObservedGap'],
                         'counts-retained-placement-unverified')
        a['scenes'][0]['resolvedMeshInstances'][1].update(objectId='1', objectPath=['4', '1'])
        self.assertEqual(classify_hierarchy_gap(s, a)['firstObservedGap'],
                         'exported-core-hierarchy-lost')

    def test_reject_inconsistent_detailed_scene(self):
        s, a = evidence(shared=True)
        a['scenes'] = [{'buildItems': [{'objectId': '2'}, {'objectId': '2'}],
                        'resolvedMeshInstances': []}]
        with self.assertRaises(ValueError):
            classify_hierarchy_gap(s, a)
        a['scenes'][0]['resolvedMeshInstances'] = [
            {'buildItemIndex': i, 'objectId': '1', 'objectPath': ['wrong', '1']}
            for i in range(2)]
        with self.assertRaises(ValueError):
            classify_hierarchy_gap(s, a)

    def test_refuse_empty_and_malformed_counts(self):
        for bad in (0, -1, True, 1.5, None, '2'):
            s, a = evidence()
            s['initialInstances'] = bad
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                classify_hierarchy_gap(s, a)
        s, a = evidence()
        a['totalBuildItems'] = 0
        with self.assertRaises(ValueError):
            classify_hierarchy_gap(s, a)

    def test_unexpected_expansion_is_not_parity(self):
        s, a = evidence()
        a['totalResolvedMeshInstances'] = 3
        self.assertEqual(classify_hierarchy_gap(s, a)['firstObservedGap'],
                         'inconclusive-core-expansion')


if __name__ == '__main__':
    unittest.main()
