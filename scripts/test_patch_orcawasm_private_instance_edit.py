"""Pure source-anchor and safety-contract tests for the experimental bridge."""
import unittest

from patch_orcawasm_private_instance_edit import (
    BRIDGE_ANCHOR, BRIDGE_CODE, LINK_ANCHOR, apply_patch,
)


class TestPrivateImportedInstanceEdit(unittest.TestCase):
    def setUp(self):
        self.bridge = "// surrounding pinned bridge\n" + BRIDGE_ANCHOR + " }\n"
        self.cmake = "# pinned export list\n" + LINK_ANCHOR + "'_oneslicer_free',\\\n"

    def test_both_pinned_files_are_patched(self):
        bridge, cmake = apply_patch(self.bridge, self.cmake)
        self.assertEqual(bridge.count("oneslicer_status_t orcawasm_project_edit_instance_transform("), 1)
        self.assertEqual(cmake.count("'_orcawasm_project_edit_instance_transform',"), 1)
        self.assertIn("session->project_manifest.swap(next);", bridge)
        self.assertIn("session->native_project_dirty = true;", bridge)
        self.assertIn("clear_project_outputs(*session);", bridge)

    def test_mutation_has_strict_validation_and_no_set_objects(self):
        self.assertIn("session->native_project_blob.empty()", BRIDGE_CODE)
        self.assertIn("parse_project_matrix(", BRIDGE_CODE)
        self.assertIn("instance[\"id\"]", BRIDGE_CODE)
        self.assertIn("matched != 1", BRIDGE_CODE)
        self.assertIn("session->active_slice", BRIDGE_CODE)
        self.assertNotIn("oneslicer_project_set_objects(", BRIDGE_CODE)
        self.assertNotIn("native_project_blob.clear()", BRIDGE_CODE)
        self.assertNotIn("native_project_dirty = false", BRIDGE_CODE)

    def test_refuses_second_application(self):
        result = apply_patch(self.bridge, self.cmake)
        with self.assertRaisesRegex(ValueError, "already staged"):
            apply_patch(*result)

    def test_refuses_missing_and_duplicate_anchors(self):
        for bridge, cmake in (
            (self.bridge.replace(BRIDGE_ANCHOR, ""), self.cmake),
            (self.bridge + BRIDGE_ANCHOR, self.cmake),
            (self.bridge, self.cmake.replace(LINK_ANCHOR, "")),
            (self.bridge, self.cmake + LINK_ANCHOR),
        ):
            with self.subTest(bridge=bridge[:24], cmake=cmake[:24]):
                with self.assertRaisesRegex(ValueError, "anchors"):
                    apply_patch(bridge, cmake)


if __name__ == "__main__":
    unittest.main()
