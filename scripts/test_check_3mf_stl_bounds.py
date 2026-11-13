import pathlib
import struct
import tempfile
import unittest
import zipfile

from check_3mf_stl_bounds import compare, stl_geometry, MAX_STL_BYTES

NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"


def make_3mf(path, unit="inch", second_item=False):
    # A nested child rotates the mesh and translates it; build adds an offset.
    content = f'''<?xml version="1.0"?>
<model xmlns="{NS}" unit="{unit}"><resources>
<object id="1" type="model"><mesh><vertices>
<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/>
<vertex x="0" y="2" z="0"/>
</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
<object id="2" type="model"><components>
<component objectid="1" transform="0 1 0 -1 0 0 0 0 1 2 3 0"/>
</components></object></resources><build>
<item objectid="2" transform="1 0 0 0 1 0 0 0 1 10 0 0"/>
{"<item objectid='1'/>" if second_item else ""}
</build></model>'''
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("3D/3dmodel.model", content)


def make_stl(path, triangles):
    data = bytearray(84)
    struct.pack_into("<I", data, 80, len(triangles))
    for points in triangles:
        fields = [0., 0., 1.] + [v for point in points for v in point]
        data.extend(struct.pack("<12fH", *fields, 0))
    pathlib.Path(path).write_bytes(data)


class Test3mfToStlBounds(unittest.TestCase):
    def test_inches_rotation_parent_and_translation(self):
        with tempfile.TemporaryDirectory() as d:
            src, dst = pathlib.Path(d)/"model.3mf", pathlib.Path(d)/"model.stl"
            make_3mf(src)
            points = [(12*25.4,3*25.4,0), (12*25.4,4*25.4,0), (10*25.4,3*25.4,0)]
            make_stl(dst, [points])
            result = compare(src, dst)
            self.assertTrue(result["passed"], result)
            self.assertEqual(result["triangles3mfPlaced"], 1)
            for got, wanted in zip(result["exactPlacedBoundsMm"]["min"], [254,76.2,0]):
                self.assertAlmostEqual(got,wanted)
            for got, wanted in zip(result["exactPlacedBoundsMm"]["max"], [304.8,101.6,0]):
                self.assertAlmostEqual(got,wanted)
            self.assertLess(result["maxDeviationMm"], 0.001)

    def test_multiple_build_instances_and_count_failure(self):
        with tempfile.TemporaryDirectory() as d:
            src, dst = pathlib.Path(d)/"model.3mf", pathlib.Path(d)/"model.stl"
            make_3mf(src, unit="millimeter", second_item=True)
            shifted = [(12,3,0),(12,4,0),(10,3,0)]
            origin = [(0,0,0),(1,0,0),(0,2,0)]
            make_stl(dst, [shifted, origin])
            self.assertTrue(compare(src,dst)["passed"])
            make_stl(dst, [shifted])
            result = compare(src,dst)
            self.assertFalse(result["passed"])
            self.assertEqual((result["triangles3mfPlaced"], result["trianglesStl"]), (2,1))

    def test_reject_misplaced_geometry_with_same_triangle_count(self):
        with tempfile.TemporaryDirectory() as d:
            src, dst = pathlib.Path(d)/"model.3mf", pathlib.Path(d)/"model.stl"
            make_3mf(src, unit="millimeter")
            make_stl(dst,[[(0,0,0),(0,1,0),(-2,0,0)]])
            result = compare(src,dst)
            self.assertFalse(result["passed"])
            self.assertGreater(result["maxDeviationMm"], 1)

    def test_interior_vertex_drift_with_unchanged_bounds_fails(self):
        # Previous AABB/triangle-count gate missed this deformation: the
        # triangle still occupies X=10..12 and Y=3..4, but one X changed.
        with tempfile.TemporaryDirectory() as d:
            src, dst = pathlib.Path(d)/"model.3mf", pathlib.Path(d)/"model.stl"
            make_3mf(src, unit="millimeter")
            changed = [(12,3,0),(11.5,4,0),(10,3,0)]
            make_stl(dst, [changed])
            result = compare(src, dst)
            self.assertFalse(result["passed"], result)
            self.assertLess(result["maxDeviationMm"], 1e-8)
            self.assertAlmostEqual(result["maxAxisDistributionDeviationMm"], 0.5)
            self.assertEqual(result["axisDistributionDeviationsMm"][1], 0.0)

    def test_triangle_order_and_winding_do_not_trigger_false_failure(self):
        with tempfile.TemporaryDirectory() as d:
            src, dst = pathlib.Path(d)/"model.3mf", pathlib.Path(d)/"model.stl"
            make_3mf(src, unit="millimeter", second_item=True)
            shifted = [(12,3,0),(12,4,0),(10,3,0)]
            origin = [(0,0,0),(1,0,0),(0,2,0)]
            # Both triangle and vertex orders differ from the model source.
            make_stl(dst, [list(reversed(origin)), [shifted[1], shifted[2], shifted[0]]])
            result = compare(src, dst)
            self.assertTrue(result["passed"], result)
            self.assertLess(result["maxAxisDistributionDeviationMm"], 1e-8)

    def test_sub_tolerance_float32_conversion_remains_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            src, dst = pathlib.Path(d)/"model.3mf", pathlib.Path(d)/"model.stl"
            make_3mf(src, unit="millimeter")
            moved = [(12,3,0),(12,4.00002,0),(10,3,0)]
            make_stl(dst, [moved])
            self.assertTrue(compare(src, dst, tolerance_mm=0.05)["passed"])
            self.assertFalse(compare(src, dst, tolerance_mm=0.000001)["passed"])

    def test_strict_binary_stl_and_nonfinite_guard(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d)/"bad.stl"
            p.write_bytes(b"solid\nend")
            with self.assertRaisesRegex(ValueError,"size"):
                stl_geometry(p)
            make_stl(p,[[(float("nan"),0,0),(1,0,0),(0,1,0)]])
            with self.assertRaisesRegex(ValueError,"Non-finite"):
                stl_geometry(p)
            p.write_bytes(bytes(84) + bytes(49))
            with self.assertRaisesRegex(ValueError,"count"):
                stl_geometry(p)
            with p.open("wb") as stream:
                stream.seek(MAX_STL_BYTES)
                stream.write(b"x")
            with self.assertRaisesRegex(ValueError,"excessive"):
                stl_geometry(p)

    def test_invalid_tolerance_and_unit(self):
        with tempfile.TemporaryDirectory() as d:
            src, dst = pathlib.Path(d)/"model.3mf", pathlib.Path(d)/"model.stl"
            make_3mf(src)
            make_stl(dst, [[(0,0,0),(1,0,0),(0,1,0)]])
            for bad in (-0.1, float("nan"), 1.01):
                with self.assertRaisesRegex(ValueError, "tolerance"):
                    compare(src,dst,bad)
            make_3mf(src,unit="wrong")
            with self.assertRaisesRegex(ValueError,"unit"):
                compare(src,dst)


if __name__ == "__main__":
    unittest.main()
