"""Offline regression for conservative native Core 3MF export geometry audit."""
import struct
import tempfile
import unittest
from pathlib import Path

from make_3mf_two_build_fixture import TRIANGLES, VERTICES
from verify_native_exported_stl import EXPECTED, audit_export


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

    def test_explicit_shifted_bounds_require_both_native_placements(self):
        shifted = ((95., 115., 90., 110., 0., 20.),
                   (155., 175., 90., 110., 0., 20.))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "shifted.stl"
            path.write_bytes(self.generate(shift=5.))
            result = audit_export(path, expected=shifted)
            self.assertEqual([item["bounds"] for item in result], list(shifted))
            with self.assertRaisesRegex(ValueError, "outside both"):
                audit_export(path)
            with self.assertRaisesRegex(ValueError, "outside both"):
                audit_export(path, expected=(shifted[0],
                                            (150., 170., 90., 110., 0., 20.)))

    def test_invalid_custom_boxes_are_rejected(self):
        EXPECTED_BOX = EXPECTED[1]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "fixture.stl"
            path.write_bytes(self.generate())
            for boxes in (
                (EXPECTED_BOX,),
                ((90., 90., 90., 110., 0., 20.), EXPECTED_BOX),
                ((float('nan'), 110., 90., 110., 0., 20.), EXPECTED_BOX),
                ((90., 110., 90., 110., 0.), EXPECTED_BOX),
            ):
                with self.subTest(boxes=boxes):
                    with self.assertRaisesRegex(ValueError, "Expected two finite"):
                        audit_export(path, expected=boxes)

    def test_missing_second_item_fails(self):
        with self.assertRaisesRegex(ValueError, "24 cube facets"):
            self.audit(self.generate(skip_second=True))

    def test_two_independent_stl_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            whole = self.generate()
            # Split 24 triangle records into two twelve-facet binary STLs.
            prefix = whole[:80]
            parts = []
            for start in (0, 12):
                path = Path(tmp) / f'item{start}.stl'
                path.write_bytes(prefix + struct.pack('<I', 12) +
                                 whole[84 + start*50:84 + (start+12)*50])
                parts.append(path)
            self.assertEqual(len(audit_export(*parts)), 2)

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
