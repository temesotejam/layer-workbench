#!/usr/bin/env python3
"""Small generated 3MF fixture guard: object identity and Core build ordering."""
import tempfile
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from make_3mf_two_build_fixture import make_file

NS = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}


def read_model(*, distinct=False, reverse=False, rotated=False):
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "fixture.3mf"
        make_file(target, distinct_objects=distinct, reverse_build_order=reverse,
                  rotated_scaled=rotated)
        with ZipFile(target) as zf:
            return ET.fromstring(zf.read("3D/3dmodel.model"))


class GeneratedCoreFixtureTest(unittest.TestCase):
    def test_default_keeps_one_shared_cube_mesh(self):
        root = read_model()
        objects = root.findall("m:resources/m:object", NS)
        items = root.findall("m:build/m:item", NS)
        self.assertEqual([x.attrib["id"] for x in objects], ["1"])
        self.assertEqual([x.attrib["objectid"] for x in items], ["1", "1"])

    def test_reversed_builds_reference_different_meshes(self):
        root = read_model(distinct=True, reverse=True, rotated=True)
        objects = root.findall("m:resources/m:object", NS)
        items = root.findall("m:build/m:item", NS)
        self.assertEqual([x.attrib["id"] for x in objects], ["1", "2"])
        self.assertEqual([x.attrib["objectid"] for x in items], ["2", "1"])
        self.assertEqual([len(x.findall("m:mesh/m:triangles/m:triangle", NS))
                          for x in objects], [12, 12])
        dims = []
        for obj in objects:
            vertices = obj.findall("m:mesh/m:vertices/m:vertex", NS)
            values = [[float(v.attrib[c]) for v in vertices] for c in ("x", "y", "z")]
            dims.append(tuple(max(axis)-min(axis) for axis in values))
        self.assertEqual(dims, [(20., 20., 20.), (10., 15., 25.)])
        self.assertEqual([float(v) for v in items[0].attrib["transform"].split()][9:],
                         [150., 90., 0.])
        self.assertEqual([float(v) for v in items[1].attrib["transform"].split()][9:],
                         [90., 90., 0.])
        self.assertNotEqual(items[1].attrib["transform"].split()[:9],
                            ["1", "0", "0", "0", "1", "0", "0", "0", "1"])


if __name__ == "__main__":
    unittest.main()
