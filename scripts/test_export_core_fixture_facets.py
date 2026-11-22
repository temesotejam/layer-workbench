#!/usr/bin/env python3
"""Regression for source Core oriented facet extraction (synthetic fixtures only)."""
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

from export_core_fixture_facets import extract_source_facets
from make_3mf_two_build_fixture import make_file


class SourceFacetWitnessTest(unittest.TestCase):
    def fixture(self, **opts):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        target = Path(tmp.name) / "fixture.3mf"
        make_file(target, **opts)
        return target

    def test_original_index_order_and_translation(self):
        report = extract_source_facets(self.fixture())
        self.assertEqual(report["builds"], 2)
        self.assertEqual(report["comparedTriangles"], 24)
        self.assertEqual(report["facets"][0],
                         [[90, 90, 0], [110, 90, 0], [110, 110, 0]])
        self.assertEqual(report["facets"][12][0], [150, 90, 0])

    def test_three_affine_builds_keep_source_winding(self):
        report = extract_source_facets(self.fixture(rotated_scaled=True,
                                                     third_shared_mesh=True))
        self.assertEqual(report["builds"], 3)
        self.assertEqual(len(report["facets"]), 36)
        self.assertEqual(report["facets"][24][0], [195, 90, 0])
        # Original triangle (0,1,2) has positive Z cross product.
        for idx in (0, 12, 24):
            p, q, r = report["facets"][idx]
            area_z = ((q[0] - p[0]) * (r[1] - p[1]) -
                      (q[1] - p[1]) * (r[0] - p[0]))
            self.assertGreater(area_z, 0)
        self.assertNotEqual(report["facets"][0], report["facets"][12])

    def test_build_reorder_changes_sequence_not_geometry(self):
        report = extract_source_facets(self.fixture(rotated_scaled=True,
                                                     distinct_objects=True,
                                                     reverse_build_order=True))
        self.assertEqual(report["comparedTriangles"], 24)
        self.assertEqual(report["facets"][0][0], [150, 90, 0])
        self.assertEqual(report["facets"][12][0], [90, 90, 0])

    def test_rejects_component_or_unknown_core_attribute(self):
        path = self.fixture()
        with ZipFile(path) as source:
            parts = [(name, source.read(name)) for name in source.namelist()]
        xml = dict(parts)["3D/3dmodel.model"].decode()
        # Unsupported build metadata is not silently ignored.
        xml = xml.replace('<item objectid="1"', '<item path="/other.model" objectid="1"', 1)
        with ZipFile(path, "w", compression=ZIP_DEFLATED) as dest:
            for name, payload in parts:
                dest.writestr(name, xml.encode() if name == "3D/3dmodel.model" else payload)
        with self.assertRaises(ValueError):
            extract_source_facets(path)


if __name__ == "__main__":
    unittest.main()
