"""Fail-closed regression checks for the experimental native exporter patch."""
import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).with_name("patch-orcawasm-3mf-object-export.py")
spec = importlib.util.spec_from_file_location("patch_3mf_native", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

FUNCTION_ANCHORS = (
    "static oneslicer_status_t build_project_plate_model(\n"
    "static oneslicer_status_t write_project_model_3mf(\n"
)


class PatchTests(unittest.TestCase):
    def setUp(self):
        self.original = FUNCTION_ANCHORS + module.OLD

    def test_preserves_native_object_and_instance_hierarchy(self):
        updated = module.apply_patch(self.original)
        self.assertIn("build_project_plate_model(", updated)
        self.assertIn("write_project_model_3mf(", updated)
        self.assertIn("native_model.objects.empty()", updated)
        self.assertNotIn("write_single_mesh_3mf(", updated)
        self.assertNotIn("build_project_export_mesh(*session", updated)
        self.assertEqual(updated.count("for (const auto& plate_id : manifest.plate_ids)"), 1)

    def test_rejects_unrecognized_or_duplicate_original(self):
        with self.assertRaisesRegex(ValueError, "missing, duplicated"):
            module.apply_patch(self.original.replace("Slic3r::TriangleMesh mesh;", "Slic3r::TriangleMesh changed;"))
        with self.assertRaisesRegex(ValueError, "missing, duplicated"):
            module.apply_patch(self.original + module.OLD)

    def test_not_idempotent_and_cannot_patch_without_native_helpers(self):
        updated = module.apply_patch(self.original)
        with self.assertRaises(ValueError):
            module.apply_patch(updated)
        with self.assertRaisesRegex(ValueError, "constructor"):
            module.apply_patch(module.OLD + "static oneslicer_status_t write_project_model_3mf(")


if __name__ == "__main__":
    unittest.main()
