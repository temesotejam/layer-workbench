import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from make_parity_manifest import generate, NAMES
from check_parity_pair import PIN, verify

class ManifestGeneratorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for role in ("native", "wasm"):
            folder = self.root / role
            folder.mkdir()
            for kind, name in NAMES.items():
                payload = b"G1 X1 E0.1\nG1 X2 E0.3\n" if kind == "gcode" else (kind + " fixture").encode()
                (folder / name).write_bytes(payload)

    def test_generated_manifests_accept_identical_fixtures(self):
        for role in ("native", "wasm"):
            folder = self.root / role
            (folder / "manifest.json").write_text(json.dumps(generate(folder, role)))
        report = verify(self.root / "native/manifest.json", self.root / "wasm/manifest.json", minimum=2)
        self.assertTrue(report["match"])

    def test_generated_hashes_match_real_bytes(self):
        manifest = generate(self.root / "native", "native")
        self.assertEqual(manifest["upstream_commit"], PIN)
        for kind, name in NAMES.items():
            data = (self.root / "native" / name).read_bytes()
            self.assertEqual(manifest["files"][kind]["sha256"], hashlib.sha256(data).hexdigest())

    def test_missing_input_fails_closed(self):
        (self.root / "native" / NAMES["process"]).unlink()
        with self.assertRaisesRegex(ValueError, "missing or unsafe"):
            generate(self.root / "native", "native")

    def test_symlink_input_outside_fixture_rejected(self):
        outside = self.root / "outside.stl"
        outside.write_bytes(b"not a model")
        model = self.root / "native" / NAMES["model"]
        model.unlink()
        model.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "missing or unsafe"):
            generate(self.root / "native", "native")

    def test_invalid_role_rejected(self):
        with self.assertRaises(ValueError):
            generate(self.root / "native", "not-a-slicer")

if __name__ == "__main__":
    unittest.main()
