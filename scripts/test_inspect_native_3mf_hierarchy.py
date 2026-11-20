"""Offline tests of CLI-authored 3MF component topology reporting."""
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from inspect_native_3mf_hierarchy import inspect_native_hierarchy
from test_verify_native_3mf_package import archive_parts

CORE = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
PROD = "http://schemas.microsoft.com/3dmanufacturing/production/2015/06"


def component_fixture():
    parts = archive_parts()
    parts["3D/3dmodel.model"] = (
        f'<model xmlns="{CORE}" xmlns:p="{PROD}" unit="millimeter">'
        '<resources>'
        '<object id="1" type="model"><components>'
        '<component objectid="101" p:path="/3D/Objects/first.model" '
        'transform="1 0 0 0 1 0 0 0 1 0 0 0"/>'
        '</components></object>'
        '<object id="2" type="model"><components>'
        '<component objectid="102" p:path="/3D/Objects/second.model"/>'
        '</components></object>'
        '</resources><build><item objectid="1"/><item objectid="2"/></build>'
        '</model>'
    ).encode("utf-8")
    for part, object_id in (("first", 101), ("second", 102)):
        parts[f"3D/Objects/{part}.model"] = (
            f'<model xmlns="{CORE}"><resources><object id="{object_id}">'
            '<mesh/></object></resources><build/></model>'
        ).encode("utf-8")
    return parts


class NativeHierarchyTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / "native.3mf"

    def write(self, parts):
        with ZipFile(self.path, "w") as archive:
            for name, data in parts.items():
                archive.writestr(name, data)

    def test_external_component_links_and_two_main_build_items(self):
        self.write(component_fixture())
        report = inspect_native_hierarchy(self.path)
        self.assertEqual(report["main_build_items"], 2)
        self.assertEqual(report["build_objectids"], ["1", "2"])
        self.assertTrue(report["all_core_references_resolved"])
        self.assertEqual(len(report["component_edges"]), 2)
        self.assertEqual(sum(row["mesh_objects"] for row in report["parts"]), 2)
        self.assertEqual(
            {edge["to_part"] for edge in report["component_edges"]},
            {"3D/Objects/first.model", "3D/Objects/second.model"})
        self.assertEqual(
            sum(edge["has_transform"] for edge in report["component_edges"]), 1)

    def test_root_build_item_may_target_external_production_object(self):
        parts = component_fixture()
        parts["3D/3dmodel.model"] = parts["3D/3dmodel.model"].replace(
            b'<item objectid="2"/>',
            b'<item objectid="102" p:path="/3D/Objects/second.model"/>')
        self.write(parts)
        report = inspect_native_hierarchy(self.path)
        self.assertTrue(report["all_core_references_resolved"])
        self.assertTrue(report["build_targets"][1]["external"])
        self.assertEqual(report["build_targets"][1]["to_part"],
                         "3D/Objects/second.model")

    def test_rejects_production_path_on_child_component(self):
        parts = component_fixture()
        parts["3D/Objects/first.model"] = (
            f'<model xmlns="{CORE}" xmlns:p="{PROD}"><resources>'
            '<object id="101"><components>'
            '<component objectid="102" p:path="/3D/Objects/second.model"/>'
            '</components></object></resources><build/></model>'
        ).encode("utf-8")
        self.write(parts)
        with self.assertRaisesRegex(ValueError, "non-root model component"):
            inspect_native_hierarchy(self.path)

    def test_rejects_relative_production_path(self):
        parts = component_fixture()
        parts["3D/3dmodel.model"] = parts["3D/3dmodel.model"].replace(
            b'p:path="/3D/Objects/first.model"',
            b'p:path="Objects/first.model"')
        self.write(parts)
        with self.assertRaisesRegex(ValueError, "package-root absolute"):
            inspect_native_hierarchy(self.path)

    def test_reports_missing_external_object_without_claiming_resolution(self):
        parts = component_fixture()
        parts["3D/Objects/second.model"] = parts["3D/Objects/second.model"].replace(
            b'id="102"', b'id="202"')
        self.write(parts)
        report = inspect_native_hierarchy(self.path)
        self.assertFalse(report["all_core_references_resolved"])
        self.assertEqual(len(report["unresolved_component_edges"]), 1)
        self.assertEqual(report["unresolved_component_edges"][0]["to_objectid"], "102")

    def test_reports_missing_main_build_reference(self):
        parts = component_fixture()
        parts["3D/3dmodel.model"] = parts["3D/3dmodel.model"].replace(
            b'<item objectid="2"/>', b'<item objectid="missing"/>')
        self.write(parts)
        report = inspect_native_hierarchy(self.path)
        self.assertFalse(report["all_core_references_resolved"])
        self.assertEqual(report["dangling_main_build_refs"][0]["build_index"], 1)

    def test_rejects_duplicate_main_resource_ids(self):
        parts = component_fixture()
        parts["3D/3dmodel.model"] = parts["3D/3dmodel.model"].replace(
            b'<object id="2"', b'<object id="1"')
        self.write(parts)
        with self.assertRaisesRegex(ValueError, "repeated Core object ID"):
            inspect_native_hierarchy(self.path)

    def test_rejects_unsafe_external_component_path(self):
        parts = component_fixture()
        parts["3D/3dmodel.model"] = parts["3D/3dmodel.model"].replace(
            b"/3D/Objects/first.model", b"/../outside.model")
        self.write(parts)
        with self.assertRaisesRegex(ValueError, "traverses parent"):
            inspect_native_hierarchy(self.path)


if __name__ == "__main__":
    unittest.main()
