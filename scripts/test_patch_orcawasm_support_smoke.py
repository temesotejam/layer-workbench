"""Fail-closed tests for the pinned generic support-modifier smoke fixture."""
import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).with_name("patch-orcawasm-support-smoke.py")
spec = importlib.util.spec_from_file_location("pinned_support_smoke", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SupportSmokeFixtureTests(unittest.TestCase):
    def setUp(self):
        self.pinned = module.OLD + "  " + module.ASSERTION + " {\n    throw new Error('regression')\n  }\n"

    def test_enables_support_without_weakening_output_assertion(self):
        updated = module.apply_patch(self.pinned)
        self.assertIn("support_enable: 1,", updated)
        self.assertIn(module.ASSERTION, updated)
        self.assertEqual(updated.count("support_enable: 1,"), 1)
        self.assertEqual(updated.count(module.ASSERTION), 1)

    def test_rejects_missing_or_duplicate_setup(self):
        with self.assertRaisesRegex(ValueError, "missing, changed"):
            module.apply_patch(self.pinned.replace("support_threshold_angle: 45", "support_threshold_angle: 40"))
        with self.assertRaisesRegex(ValueError, "missing, changed"):
            module.apply_patch(self.pinned + module.OLD)

    def test_rejects_missing_assertion_and_double_patch(self):
        with self.assertRaisesRegex(ValueError, "assertion"):
            module.apply_patch(module.OLD)
        with self.assertRaises(ValueError):
            module.apply_patch(module.apply_patch(self.pinned))


if __name__ == "__main__":
    unittest.main()
