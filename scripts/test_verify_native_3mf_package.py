"""Narrow native-exported 3MF OPC package regression tests (synthetic files)."""
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from verify_native_3mf_package import audit_native_package, resolve_opc_target

MODEL = b'<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources/><build/></model>'
REL = "http://schemas.openxmlformats.org/package/2006/relationships"


def relations(*entries):
    return (f'<Relationships xmlns="{REL}">' +
            "".join(f'<Relationship Id="{ident}" Type="urn:test" Target="{target}"{extra}/>'
                    for ident, target, extra in entries) +
            "</Relationships>").encode("utf-8")


def archive_parts():
    return {
        "[Content_Types].xml": b"<Types/>",
        "_rels/.rels": relations(("main", "/3D/3dmodel.model", "")),
        "3D/3dmodel.model": MODEL,
        "3D/_rels/3dmodel.model.rels": relations(
            ("obj1", "Objects/first.model", ""),
            ("obj2", "Objects/second.model", "")),
        "3D/Objects/first.model": MODEL,
        "3D/Objects/second.model": MODEL,
        "Metadata/model_settings.config": b"model settings",
        "Metadata/project_settings.config": b"project settings",
    }


class Native3MFPackageTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / "native.3mf"

    def write(self, parts):
        with ZipFile(self.path, "w") as z:
            for name, data in parts.items():
                z.writestr(name, data)

    def test_valid_external_part_layout_and_reference_resolution(self):
        self.write(archive_parts())
        report = audit_native_package(self.path)
        self.assertEqual(report["member_count"], 8)
        self.assertEqual(len(report["model_parts"]), 3)
        self.assertEqual(len(report["main_relationship_targets"]), 2)
        self.assertEqual(resolve_opc_target("../3D/Objects/first.model",
                                            "3D/3dmodel.model"),
                         "3D/Objects/first.model")

    def test_refuses_missing_parts_and_missing_targets(self):
        for removed in ("Metadata/project_settings.config",
                        "3D/Objects/second.model"):
            with self.subTest(removed=removed):
                parts = archive_parts()
                del parts[removed]
                self.write(parts)
                with self.assertRaisesRegex(ValueError, "Missing|absent|layout"):
                    audit_native_package(self.path)

    def test_refuses_external_duplicate_and_missing_root_links(self):
        for replacement, error in (
            (relations(("main", "https://outside.example/data", "")),
             "External"),
            (relations(("main", "/3D/3dmodel.model", ' TargetMode="External"')),
             "External"),
            (relations(("x", "/3D/3dmodel.model", ""),
                       ("x", "/3D/3dmodel.model", "")),
             "duplicate"),
            (relations(("other", "/3D/Objects/first.model", "")),
             "root"),
        ):
            with self.subTest(error=error):
                parts = archive_parts()
                parts["_rels/.rels"] = replacement
                self.write(parts)
                with self.assertRaisesRegex(ValueError, error):
                    audit_native_package(self.path)

    def test_refuses_dangling_or_malformed_models(self):
        parts = archive_parts()
        parts["3D/Objects/first.model"] = b"<model"
        self.write(parts)
        with self.assertRaisesRegex(ValueError, "Malformed"):
            audit_native_package(self.path)
        parts = archive_parts()
        parts["3D/Objects/first.model"] = b'<!DOCTYPE model><model/>'
        self.write(parts)
        with self.assertRaisesRegex(ValueError, "DTD"):
            audit_native_package(self.path)

    def test_rejects_escape_and_backslash_targets(self):
        for value in ("../../../outside", r"..\outside", "/../outside",
                      "https://outside.example/s", ""):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    resolve_opc_target(value, "3D/3dmodel.model")


if __name__ == "__main__":
    unittest.main()
