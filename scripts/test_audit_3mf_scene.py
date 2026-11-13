import pathlib
import tempfile
import unittest
import zipfile

from audit_3mf_scene import audit, parse_transform

NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
TYPES = b"<Types/>"


def archive(path, model):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", TYPES)
        z.writestr("3D/3dmodel.model", model.encode("utf-8"))


def scene(build='<item objectid="2" transform="1 0 0 0 1 0 0 0 1 128 128 0"/>',
          triangle='<triangle v1="0" v2="1" v3="2"/>',
          extra=''):
    return f'''<?xml version="1.0"?>
<model xmlns="{NS}"><resources>
<object id="1" type="model"><mesh><vertices>
<vertex x="0" y="0" z="0"/><vertex x="20" y="0" z="0"/>
<vertex x="0" y="20" z="0"/></vertices><triangles>{triangle}</triangles></mesh></object>
<object id="2" type="model"><components>
<component objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
</components></object>{extra}</resources><build>{build}</build></model>'''


class Test3MFScene(unittest.TestCase):
    def test_core_component_build_and_raw_native_transform(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d) / "one.3mf"
            archive(p, scene())
            result = audit(p)
            self.assertEqual((result["totalObjects"], result["totalBuildItems"],
                              result["totalMeshTriangles"]), (2, 1, 1))
            self.assertEqual(result["scenes"][0]["objects"][1]["components"], ["1"])
            self.assertEqual(result["totalResolvedMeshInstances"], 1)
            self.assertEqual(result["totalResolvedTriangleInstances"], 1)
            self.assertEqual(result["scenes"][0]["objects"][0]["localBounds"],
                             {"min": [0.0, 0.0, 0.0], "max": [20.0, 20.0, 0.0]})
            self.assertEqual(
                result["scenes"][0]["resolvedMeshInstances"][0]["conservativeWorldBounds"],
                {"min": [128.0, 128.0, 0.0], "max": [148.0, 148.0, 0.0]})
            self.assertEqual(result["scenes"][0]["resolvedMeshInstances"][0]["objectPath"],
                             ["2", "1"])
            self.assertEqual(result["scenes"][0]["resolvedMeshInstances"][0]["transform3mf"][-3:],
                             [128.0, 128.0, 0.0])
            self.assertEqual(result["scenes"][0]["buildItems"][0]["transform3mf"][-3:],
                             [128.0, 128.0, 0.0])
            archive(p, scene(build='<item objectid="1"/>'))
            self.assertEqual(audit(p)["scenes"][0]["buildItems"][0]["transform3mf"],
                             parse_transform(None))

    def test_invalid_reference_and_geometry_are_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d) / "bad.3mf"
            for model, message in (
                (scene(build='<item objectid="3"/>'), "missing object"),
                (scene(triangle='<triangle v1="0" v2="1" v3="99"/>'), "vertex index"),
                (scene(extra='<object id="1"/>'), "Duplicate"),
                (scene().replace('objectid="1" transform=', 'objectid="9" transform='), "missing object"),
                (scene(build='<item objectid="2" transform="NaN"/>'), "12 numbers"),
                (scene(build='<item objectid="2" transform="1 0 0 0 1 0 0 0 1 nan 0 0"/>'), "Non-finite"),
                (scene(build='<item objectid="2" path="/3D/a.model"/>'), "External-part"),
                (scene().replace('x="20"', 'x="nan"'), "vertex coordinate"),
                (scene().replace('x="20"', 'x="1e10000"'), "vertex coordinate"),
                (scene().replace('x="20"', 'x="1000000001"'), "vertex coordinate"),
                (scene().replace('x="20"', 'x="text"'), "vertex coordinate"),
                (scene().replace('x="20"', 'w="20"'), "vertex coordinate"),
                (scene().replace('<vertex x="20"', '<notvertex x="20"'), "vertices"),
                ('<!DOCTYPE model [<!ENTITY x "bad">]>' + scene(), "DTD/entities"),
            ):
                archive(p, model)
                with self.subTest(message=message):
                    with self.assertRaisesRegex(ValueError, message):
                        audit(p)

    def test_nested_component_translation_and_cycle_rejection(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d) / "nested.3mf"
            translated = scene().replace(
                '<component objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>',
                '<component objectid="1" transform="1 0 0 0 1 0 0 0 1 5 7 0"/>')
            archive(p, translated)
            r = audit(p)
            self.assertEqual(r["scenes"][0]["resolvedMeshInstances"][0]["transform3mf"][-3:],
                             [133.0, 135.0, 0.0])
            self.assertEqual(r["totalMeshTriangles"], 1)
            self.assertEqual(r["totalResolvedTriangleInstances"], 1)
            # Cyclic component resources must fail even if the build references a
            # different mesh. Silently expanding such archives is unsafe.
            cyclic = scene(build='<item objectid="1"/>').replace(
                '<component objectid="1" transform=', '<component objectid="2" transform=')
            archive(p, cyclic)
            with self.assertRaisesRegex(ValueError, "Cyclic"):
                audit(p)
            with_external = scene().replace(
                '<component objectid="1" transform=',
                '<component objectid="1" path="/3D/elsewhere.model" transform=')
            archive(p, with_external)
            with self.assertRaisesRegex(ValueError, "External-part component"):
                audit(p)

    def test_no_geometry_fabricated_from_components(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d) / "scene.3mf"
            archive(p, scene(build='<item objectid="1"/><item objectid="2"/>'))
            result = audit(p)
            self.assertEqual(result["totalMeshTriangles"], 1)
            self.assertEqual(result["totalBuildItems"], 2)
            self.assertEqual(result["scenes"][0]["objects"][1]["triangles"], 0)


if __name__ == "__main__":
    unittest.main()
