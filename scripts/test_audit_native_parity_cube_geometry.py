#!/usr/bin/env python3
"""Regression tests for independent native Core 3MF cube export geometry."""
import math
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest

from audit_native_parity_cube_geometry import audit


def write_binary_stl(path, faces):
    data = bytearray(84 + 50 * len(faces))
    struct.pack_into("<I", data, 80, len(faces))
    for i, face in enumerate(faces):
        for j, p in enumerate(face):
            struct.pack_into("<fff", data, 84 + 50*i + 12 + 12*j, *p)
    path.write_bytes(data)


class NativePlacedCubeAuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / "original.stl"
        self.exported = self.root / "exported.stl"
        fixture = Path(__file__).with_name("parity-cube-fixture.mjs")
        subprocess.run(["node", str(fixture), str(self.source)],
                       capture_output=True, text=True, check=True)
        data = self.source.read_bytes()
        self.faces = [tuple(tuple(struct.unpack_from("<fff", data, 84 + i*50 + 12 + j*12))
                            for j in range(3)) for i in range(12)]
        self.placed = [tuple((x+128, y+128, z) for x,y,z in face) for face in self.faces]
        write_binary_stl(self.exported, self.placed)

    def test_pinned_native_cube_geometry_passes(self):
        result = audit(self.source, self.exported)
        self.assertTrue(result["passed"])
        self.assertFalse(result["parity_pass"])
        self.assertEqual(result["source_triangles"], 12)
        self.assertEqual(result["expected_xyz_bounds_mm"],
                         [[128.0, 148.0], [128.0, 148.0], [0.0, 20.0]])

    def test_winding_and_face_order_may_change(self):
        write_binary_stl(self.exported, [tuple(reversed(f)) for f in reversed(self.placed)])
        self.assertTrue(audit(self.source, self.exported)["passed"])

    def test_translation_change_is_detected(self):
        shifted = [tuple((x+2, y, z) for x,y,z in face) for face in self.placed]
        write_binary_stl(self.exported, shifted)
        result = audit(self.source, self.exported)
        self.assertFalse(result["passed"])
        self.assertEqual(result["max_bounds_deviation_mm"], 2.0)

    def test_same_bounds_but_changed_triangle_detected(self):
        faces = list(self.placed)
        # Replace one face's vertex with another cube corner; global XYZ AABB
        # remains identical. A pure bounds check would incorrectly pass.
        face = list(faces[0])
        face[1] = (128.0, 148.0, 20.0)
        faces[0] = tuple(face)
        write_binary_stl(self.exported, faces)
        result = audit(self.source, self.exported)
        self.assertEqual(result["max_bounds_deviation_mm"], 0.0)
        self.assertFalse(result["passed"])
        self.assertGreater(result["max_face_vertex_deviation_mm"], 0.0)

    def test_triangle_count_mismatch_fails(self):
        write_binary_stl(self.exported, self.placed[:-1])
        self.assertFalse(audit(self.source, self.exported)["passed"])

    def test_corrupted_source_is_rejected(self):
        modified = bytearray(self.source.read_bytes())
        modified[120] ^= 1
        self.source.write_bytes(modified)
        with self.assertRaisesRegex(ValueError, "byte-pinned"):
            audit(self.source, self.exported)

    def test_nonfinite_native_vertex_rejected(self):
        faces = list(self.placed)
        face = list(faces[0])
        face[0] = (math.nan, 128.0, 0.0)
        faces[0] = tuple(face)
        write_binary_stl(self.exported, faces)
        with self.assertRaisesRegex(ValueError, "invalid triangle"):
            audit(self.source, self.exported)

    def test_invalid_tolerance_rejected(self):
        with self.assertRaisesRegex(ValueError, "tolerance"):
            audit(self.source, self.exported, float("nan"))
        with self.assertRaisesRegex(ValueError, "tolerance"):
            audit(self.source, self.exported, 0.1)


if __name__ == "__main__":
    unittest.main()
