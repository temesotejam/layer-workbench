#!/usr/bin/env python3
"""Audit actual native v2.5.0 STL export against the pinned shared cube.

Checks each placed triangle, not only the bounding box. The source STL bytes
and explicit Core 3MF build translation are independently pinned. This is a
native geometry-only gate; it does not inspect the WASM mesh or prove G-code
parity, profile equivalence, or print safety.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

from verify_native_exported_stl import read_triangles
from wrap_parity_cube_3mf import BUILD_TRANSFORM, SOURCE_SHA256

SOURCE_BYTES = 684
TRANSLATION = (128.0, 128.0, 0.0)
MAX_EXPORT_BYTES = 20_000_000
TOLERANCE_MM = 0.001


def _canonical_faces(faces, translation):
    """Ignore winding and face order, but retain exact triangle connectivity."""
    dx, dy, dz = translation
    return sorted(tuple(sorted((x + dx, y + dy, z + dz) for x, y, z in face))
                  for face in faces)


def _bounds(faces):
    points = [point for face in faces for point in face]
    return [[min(p[axis] for p in points), max(p[axis] for p in points)]
            for axis in range(3)]


def audit(source: Path, exported: Path, tolerance_mm: float = TOLERANCE_MM):
    if not math.isfinite(tolerance_mm) or not 0 <= tolerance_mm <= 0.01:
        raise ValueError("invalid native cube geometry tolerance")
    # Do not silently change the expected placement when the Core 3MF
    # wrapper is edited. The browser fixture still uses (128,128,0).
    if BUILD_TRANSFORM != "1 0 0 0 1 0 0 0 1 128 128 0":
        raise ValueError("native Core 3MF fixture placement changed")
    if source.stat().st_size != SOURCE_BYTES or hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError("source STL is not the byte-pinned shared cube")
    if not 84 <= exported.stat().st_size <= MAX_EXPORT_BYTES:
        raise ValueError("native exported STL absent, empty or oversized")
    original_faces = read_triangles(source)
    actual_faces = read_triangles(exported)
    if len(original_faces) != 12:
        raise ValueError("pinned cube has unexpected triangle count")
    for label, faces in (("source", original_faces), ("native export", actual_faces)):
        for face in faces:
            if len(face) != 3 or any(len(p) != 3 or not all(math.isfinite(c) and abs(c) <= 1e6 for c in p) for p in face):
                raise ValueError(f"{label}: invalid triangle coordinates")
    expected = _canonical_faces(original_faces, TRANSLATION)
    observed = _canonical_faces(actual_faces, (0, 0, 0))
    expected_bounds = _bounds([tuple((x + TRANSLATION[0], y + TRANSLATION[1], z + TRANSLATION[2])
                                    for x, y, z in face) for face in original_faces])
    observed_bounds = _bounds(actual_faces)
    max_bounds_delta = max(abs(a - b) for expected_axis, actual_axis
                           in zip(expected_bounds, observed_bounds)
                           for a, b in zip(expected_axis, actual_axis))
    max_face_delta = None
    if len(expected) == len(observed):
        max_face_delta = max(abs(a-b) for ef, af in zip(expected, observed)
                             for ep, ap in zip(ef, af) for a, b in zip(ep, ap))
    return {
        "status": "NATIVE_GEOMETRY_ONLY",
        "source_sha256": SOURCE_SHA256,
        "native_export_sha256": hashlib.sha256(exported.read_bytes()).hexdigest(),
        "source_triangles": len(original_faces),
        "exported_triangles": len(actual_faces),
        "expected_xyz_bounds_mm": expected_bounds,
        "observed_xyz_bounds_mm": observed_bounds,
        "max_bounds_deviation_mm": max_bounds_delta,
        "max_face_vertex_deviation_mm": max_face_delta,
        "tolerance_mm": tolerance_mm,
        "passed": (len(actual_faces) == len(original_faces)
                   and max_bounds_delta <= tolerance_mm
                   and max_face_delta is not None
                   and max_face_delta <= tolerance_mm),
        "parity_pass": False,
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", required=True, type=Path)
    p.add_argument("--export-dir", required=True, type=Path)
    p.add_argument("--report", type=Path)
    args = p.parse_args()
    try:
        files = sorted(args.export_dir.rglob("*.stl"))
        if len(files) != 1 or not files[0].is_file() or files[0].is_symlink():
            raise ValueError("expected one regular native exported STL")
        report = audit(args.source, files[0])
    except (OSError, ValueError, TypeError, IndexError) as exc:
        report = {"passed": False, "parity_pass": False, "error": str(exc)}
    out = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(out, encoding="utf-8")
    print(out, end="")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
