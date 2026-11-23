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
