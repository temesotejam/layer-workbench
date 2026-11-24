import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from audit_native_3mf_metadata_loss import audit, main, PROJECT, MODEL
from unittest.mock import patch
from contextlib import redirect_stdout, redirect_stderr
from io import StringIO


def make(path, config, model=True, extras=None):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("3D/3dmodel.model", "<model/>")
        if config is not None:
            z.writestr(PROJECT, config)
        if model:
            z.writestr(MODEL, "<config/>")
        for name, value in (extras or {}).items():
            z.writestr(name, value)


class MetadataLossTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.a = Path(self.temp.name) / "a.3mf"
        self.b = Path(self.temp.name) / "b.3mf"
        make(self.a, '{"speed":"20","flags":[1,2],"secret":"hidden-value"}',
             extras={"Metadata/thumbnail.png": "test"})

    def test_missing_config_is_measured_not_vacuous_pass(self):
        make(self.b, None, model=False)
        result = audit(self.a, self.b)
        self.assertEqual(result["project_config_bytes"], "missing")
        self.assertEqual(result["model_config_bytes"], "missing")
        self.assertEqual(result["project_json"]["missing"], 3)
        self.assertEqual(result["members"]["metadata"]["missing"], 3)
        self.assertFalse(result["metadata_semantic_parity_verified"])

    def test_changed_types_and_array_order(self):
        make(self.b, '{"speed":20,"flags":[2,1],"secret":"hidden-value","new":true}')
        result = audit(self.a, self.b)
        self.assertEqual(result["project_json"],
                         {"status":"present","baseline":3,"candidate":4,
                          "missing":0,"added":1,"changed":2,"unchanged":1})
        self.assertEqual(result["model_config_bytes"], "unchanged")
        self.assertNotIn("hidden-value", json.dumps(result))
        self.assertNotIn("speed", json.dumps(result))

    def test_json_order_not_confused_with_byte_identity(self):
        make(self.b, '{"secret":"hidden-value","flags":[1,2],"speed":"20"}',
             extras={"Metadata/thumbnail.png": "test"})
        result = audit(self.a, self.b)
        self.assertEqual(result["project_config_bytes"], "changed")
        self.assertEqual(result["project_json"]["unchanged"], 3)

    def test_bad_and_missing_baseline_refused(self):
        for raw in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":1e999}', '[]', '{}'):
            make(self.b, raw)
            with self.assertRaises(ValueError):
                audit(self.a, self.b)
        make(self.b, None)
        with self.assertRaises(ValueError):
            audit(self.b, self.a)

    def test_positive_control_and_diagnostic_cli(self):
        def run(strict):
            args = ["audit", "--baseline", str(self.a), "--candidate", str(self.b)]
            if strict:
                args.append("--require-identical-config")
            out, err = StringIO(), StringIO()
            with patch("sys.argv", args), redirect_stdout(out), redirect_stderr(err):
                code = main()
            self.assertNotIn("hidden-value", out.getvalue() + err.getvalue())
            return code
        self.b.write_bytes(self.a.read_bytes())
        self.assertEqual(run(True), 0)
        make(self.b, None)
        self.assertEqual(run(False), 0)
        self.assertEqual(run(True), 2)

    def test_strict_project_json_native_reexport(self):
        args = ["audit", "--baseline", str(self.a), "--candidate", str(self.b),
                "--require-identical-project-json"]
        def run(raw):
            make(self.b, raw)
            out, err = StringIO(), StringIO()
            with patch("sys.argv", args), redirect_stdout(out), redirect_stderr(err):
                code = main()
            self.assertNotIn("hidden-value", out.getvalue() + err.getvalue())
            return code

        # Native serialization may reorder keys or alter whitespace.
        self.assertEqual(run('{"secret":"hidden-value", "flags":[1,2], "speed":"20"}'), 0)
        for raw in (None, '{"speed":20,"flags":[1,2],"secret":"hidden-value"}',
                    '{"speed":"20","flags":[2,1],"secret":"hidden-value"}',
                    '{"speed":"20","flags":[1,2]}',
                    '{"speed":"20","flags":[1,2],"secret":"hidden-value","extra":true}'):
            self.assertEqual(run(raw), 2)


if __name__ == "__main__":
    unittest.main()
