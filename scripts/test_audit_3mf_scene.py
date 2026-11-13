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
                ('<!DOCTYPE model [<!ENTITY x "bad">]>' + scene(), "DTD/entities"),
            ):
                archive(p, model)
                with self.subTest(message=message):
                    with self.assertRaisesRegex(ValueError, message):
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
