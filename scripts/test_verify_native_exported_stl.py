"""Offline regression for conservative native Core 3MF export geometry audit."""
import struct
import tempfile
import unittest
from pathlib import Path

from make_3mf_two_build_fixture import TRIANGLES, VERTICES
from verify_native_exported_stl import audit_export


class NativeStlAuditTests(unittest.TestCase):
    @staticmethod
    def generate(shift=0., skip_second=False, truncate=False):
        faces = []
        for xoffset in ((90.,) if skip_second else (90., 150.)):
            for tri in TRIANGLES:
                face = [tuple(float(VERTICES[i][j]) +
                              (xoffset + shift if j == 0 else (90. if j == 1 else 0.))
                              for j in range(3)) for i in tri]
                faces.append(face)
        payload = bytearray(b'fixture'.ljust(80, b'\0'))
        payload += struct.pack("<I", len(faces))
        for face in faces:
            payload += struct.pack("<12f", 0, 0, 0, *(x for p in face for x in p))
            payload += b'\0\0'
        if truncate:
            payload.pop()
        return bytes(payload)

    def audit(self, data):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "fixture.stl"
            path.write_bytes(data)
            return audit_export(path)

    def test_independent_two_build_geometry(self):
        result = self.audit(self.generate())
        self.assertEqual([item["facets"] for item in result], [12, 12])
        self.assertEqual(result[0]["bounds"], (90., 110., 90., 110., 0., 20.))
        self.assertEqual(result[1]["bounds"], (150., 170., 90., 110., 0., 20.))

    def test_placement_shift_fails_even_though_shapes_same(self):
        with self.assertRaisesRegex(ValueError, "outside both"):
            self.audit(self.generate(shift=5.))

    def test_missing_second_item_fails(self):
        with self.assertRaisesRegex(ValueError, "24 cube facets"):
            self.audit(self.generate(skip_second=True))

    def test_truncated_binary_fails(self):
        with self.assertRaises(ValueError):
            self.audit(self.generate(truncate=True))

    def test_ascii_stl_support(self):
        lines = ["solid cubes"]
        for xoffset in (90, 150):
            for tri in TRIANGLES:
                lines.extend(["facet normal 0 0 1", " outer loop"])
                for i in tri:
                    x, y, z = VERTICES[i]
                    lines.append(f"  vertex {x + xoffset} {y + 90} {z}")
                lines.extend([" endloop", "endfacet"])
        lines.append("endsolid cubes")
        self.assertEqual(len(self.audit(("\n".join(lines) + "\n").encode())), 2)


if __name__ == "__main__":
    unittest.main()
