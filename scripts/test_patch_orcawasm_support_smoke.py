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
        self.pinned = ("\n".join([
            module.OLD, module.ENFORCER_OLD, module.BLOCKER_OLD, module.LOOP_OLD,
            module.COMPARE_OLD, module.ASSERTION,
        ]) + "\n")

    def test_enables_support_without_weakening_output_assertion(self):
        updated = module.apply_patch(self.pinned)
        self.assertIn("support_enable: 1,", updated)
        self.assertIn(module.ASSERTION, updated)
        self.assertEqual(updated.count("support_enable: 1,"), 1)
        self.assertEqual(updated.count(module.ASSERTION), 1)
        self.assertIn("position: [0, 0, 5]", updated)
        self.assertIn("position: [0, 0, 15]", updated)
        self.assertIn("size: [30, 30, 30]", updated)
        self.assertNotIn(module.BLOCKER_OLD, updated)
        self.assertIn("size: [16, 16, 12]", updated)
        self.assertIn("'normal(manual)' : 'normal(auto)'", updated)
        self.assertIn("configureSession()\n      // Manual baseline", updated)
        self.assertEqual(updated.count("      configureSession()"), 1)
        self.assertIn("modifiedSupports !== referenceSupports", updated)
        self.assertIn("projectSetObjectsOnce(module, session, baseline.blob, baseline.manifest)", updated)
        self.assertNotIn(module.COMPARE_OLD, updated)
        self.assertNotIn(module.ENFORCER_OLD, updated)

    def test_rejects_missing_or_duplicate_setup(self):
        with self.assertRaisesRegex(ValueError, "missing, changed"):
            module.apply_patch(self.pinned.replace("support_threshold_angle: 45", "support_threshold_angle: 40"))
        with self.assertRaisesRegex(ValueError, "missing, changed"):
            module.apply_patch(self.pinned + module.OLD)

    def test_rejects_partial_unsafe_fixture_or_duplicate_anchors(self):
        for anchor in (module.ENFORCER_OLD, module.BLOCKER_OLD, module.LOOP_OLD, module.COMPARE_OLD):
            with self.subTest(anchor=anchor[:30]):
                with self.assertRaisesRegex(ValueError, "pinned smoke"):
                    module.apply_patch(self.pinned.replace(anchor, ""))
                with self.assertRaisesRegex(ValueError, "pinned smoke"):
                    module.apply_patch(self.pinned + anchor)

    def test_rejects_missing_assertion_and_double_patch(self):
        with self.assertRaisesRegex(ValueError, "assertion"):
            module.apply_patch(module.OLD)
        with self.assertRaises(ValueError):
            module.apply_patch(module.apply_patch(self.pinned))


if __name__ == "__main__":
    unittest.main()
