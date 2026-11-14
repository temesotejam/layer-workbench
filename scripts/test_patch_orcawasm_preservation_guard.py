"""Fail-closed regression tests for the pinned imported-3MF safety patch."""
import unittest
from patch_orcawasm_preservation_guard import REPLACEMENTS, apply_patch


class TestPreservationGuard(unittest.TestCase):
    def setUp(self):
        self.source = "\n".join(old for old, _ in REPLACEMENTS)

    def test_all_required_changes_are_applied(self):
        result = apply_patch(self.source)
        self.assertIn("bool native_project_replaced = false;", result)
        self.assertIn("session.native_project_replaced = false;", result)
        self.assertIn("|| !session->native_project_blob.empty();", result)
        self.assertIn("preservation=require cannot retain imported 3MF metadata", result)
        self.assertIn('"code", "native-project-replaced"', result)

    def test_refuses_second_application(self):
        with self.assertRaises(ValueError):
            apply_patch(apply_patch(self.source))

    def test_refuses_missing_or_duplicated_anchor(self):
        old = REPLACEMENTS[2][0]
        with self.assertRaises(ValueError):
            apply_patch(self.source.replace(old, ""))
        with self.assertRaises(ValueError):
            apply_patch(self.source + "\n" + old)


if __name__ == "__main__":
    unittest.main()
