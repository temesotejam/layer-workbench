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
            module.COMPARE_OLD, module.ASSERTION, module.FAIL_MESSAGE_OLD,
        ]) + "\n")

    def test_enables_support_without_weakening_output_assertion(self):
        updated = module.apply_patch(self.pinned)
        self.assertIn("enable_support: 1,", updated)
        self.assertNotIn("support_enable: 1,", updated)
        self.assertIn("support_threshold_angle: 10,", updated)
        self.assertNotIn("support_threshold_angle: 45,", updated)
        self.assertIn("sphereStl(2, 10) occupies Z≈0..20 mm", updated)
        self.assertIn(module.ASSERTION, updated)
        # Native support must be enabled both at initialization and at the
        # per-role profile boundary; the legacy spelling is not a native key.
        self.assertEqual(updated.count("enable_support: 1,"), 2)
        self.assertIn("applyProfileOnce(module, session, {\n        enable_support: 1,", updated)
        self.assertEqual(updated.count(module.ASSERTION), 1)
        self.assertIn("position: [0, 0, 0]", updated)
        self.assertIn("position: [0, 0, 15]", updated)
        self.assertEqual(updated.count("size: [30, 30, 30]"), 2)
        self.assertNotIn(module.BLOCKER_OLD, updated)
        self.assertNotIn("size: [16, 16, 12]", updated)
        self.assertIn("'normal(manual)' : 'normal(auto)'", updated)
        self.assertIn("configureSession()\n      // Manual baseline", updated)
        self.assertEqual(updated.count("      configureSession()"), 1)
        self.assertIn("modifiedSupports !== referenceSupports", updated)
        self.assertIn("projectSetObjectsOnce(module, session, baseline.blob, baseline.manifest)", updated)
        self.assertNotIn(module.COMPARE_OLD, updated)
        self.assertIn("support annotations=", updated)
        self.assertIn("label + ' baseline", updated)
        self.assertNotIn(module.FAIL_MESSAGE_OLD, updated)
        self.assertNotIn(module.ENFORCER_OLD, updated)

    def test_rejects_missing_or_duplicate_setup(self):
        with self.assertRaisesRegex(ValueError, "missing, changed"):
            module.apply_patch(self.pinned.replace("support_threshold_angle: 45", "support_threshold_angle: 40"))
        with self.assertRaisesRegex(ValueError, "missing, changed"):
            module.apply_patch(self.pinned + module.OLD)

    def test_rejects_partial_unsafe_fixture_or_duplicate_anchors(self):
        for anchor in (module.ENFORCER_OLD, module.BLOCKER_OLD, module.LOOP_OLD, module.COMPARE_OLD, module.FAIL_MESSAGE_OLD):
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
