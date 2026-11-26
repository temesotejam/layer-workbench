import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from make_anchor_zero_control import make_control
from audit_native_3mf_metadata_loss import PROJECT, MODEL
from compare_3mf_metadata import inventory

class AnchorControlTests(unittest.TestCase):
    def fixture(self, folder, value="400%", include=True):
        path = Path(folder) / "source.3mf"
        settings = {"infill_anchor_max": "20", "other": ["x", "y"]}
        if include:
            settings["infill_anchor"] = value
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("[Content_Types].xml", "fixture")
            archive.writestr("3D/3dmodel.model", "geometry" * 40)
            archive.writestr(MODEL, "<config/>")
            archive.writestr(PROJECT, json.dumps(settings))
        return path

    def test_only_anchor_changes_and_source_is_untouched(self):
        with tempfile.TemporaryDirectory() as folder:
            source = self.fixture(folder)
            original = source.read_bytes()
            dest = Path(folder) / "control.3mf"
            self.assertEqual(make_control(source, dest)["changed_settings"], 1)
            self.assertEqual(source.read_bytes(), original)
            before, after = inventory(source), inventory(dest)
            self.assertEqual({k for k in before if before[k] != after[k]}, {PROJECT})
            with zipfile.ZipFile(dest) as archive:
                self.assertEqual(json.loads(archive.read(PROJECT)),
                                 {"infill_anchor": "0", "infill_anchor_max": "20", "other": ["x", "y"]})
            with self.assertRaises(FileExistsError):
                make_control(source, dest)

    def test_refuses_missing_zero_or_invalid_original(self):
        for value, include in [("0", True), ("0%", True), (False, True), ("bad", True), ("400%", False)]:
            with self.subTest(value=value, include=include), tempfile.TemporaryDirectory() as folder:
                with self.assertRaises(ValueError):
                    make_control(self.fixture(folder, value, include), Path(folder) / "control.3mf")

    def test_max_intervention_is_independent_and_bounded(self):
        with tempfile.TemporaryDirectory() as folder:
            source = self.fixture(folder)
            first = Path(folder) / "anchor-zero.3mf"
            second = Path(folder) / "both-zero.3mf"
            make_control(source, first)
            original = first.read_bytes()
            make_control(first, second, "infill_anchor_max")
            self.assertEqual(first.read_bytes(), original)
            with zipfile.ZipFile(second) as archive:
                self.assertEqual(json.loads(archive.read(PROJECT)),
                                 {"infill_anchor": "0", "infill_anchor_max": "0", "other": ["x", "y"]})
            with self.assertRaises(ValueError):
                make_control(second, Path(folder) / "invalid.3mf", "infill_anchor_max")
            with self.assertRaises(ValueError):
                make_control(source, Path(folder) / "unsupported.3mf", "other")
