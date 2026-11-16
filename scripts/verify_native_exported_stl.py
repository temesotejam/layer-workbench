#!/usr/bin/env python3
"""Check geometry of an official native v2.5.0 export from the synthetic Core 3MF.

This is a geometry-only diagnostic. It does NOT certify arbitrary 3MF round-trips,
printer settings, G-code, native/WASM parity, or print safety.
"""
import argparse
import math
from pathlib import Path
import re
import struct

EXPECTED = ((90., 110., 90., 110., 0., 20.),
            (150., 170., 90., 110., 0., 20.))
EPS = 0.0005
MAX_BYTES = 20_000_000


def read_triangles(path: Path):
    size = path.stat().st_size
    if size <= 0 or size > MAX_BYTES:
        raise ValueError("STL missing, empty, or oversized")
    data = path.read_bytes()
    if len(data) >= 84:
        n = struct.unpack_from("<I", data, 80)[0]
        if 0 < n <= 200_000 and 84 + 50 * n == len(data):
            faces = []
            for i in range(n):
                # Normal is metadata; vertex positions are the geometry we audit.
                values = struct.unpack_from("<12f", data, 84 + 50 * i)
                faces.append(tuple(tuple(values[3 + j * 3:6 + j * 3])
                                   for j in range(3)))
            return faces
    # Some STL exporters use ASCII. Accept the standard facet/vertex/endfacet
    # structure, but do not silently treat arbitrary text as a valid STL.
    try:
        text = data.decode("ascii", errors="strict")
    except UnicodeError as exc:
        raise ValueError("not a complete binary or ASCII STL") from exc
    facets = re.findall(r"(?is)\bfacet\s+normal\s+[^\r\n]+\s+outer\s+loop\s+"
                        r"(.+?)\s+endloop\s+endfacet\b", text)
    if not facets or not re.match(r"(?is)^\s*solid\b", text):
        raise ValueError("not a recognized ASCII STL")
    if len(re.findall(r"(?i)\bendfacet\b", text)) != len(facets):
        raise ValueError("malformed ASCII STL facets")
    faces = []
    for facet in facets:
        lines = [line.strip() for line in facet.splitlines() if line.strip()]
        if len(lines) != 3:
            raise ValueError("ASCII STL facet does not contain three vertices")
        triangle = []
        for line in lines:
            words = line.split()
            if len(words) != 4 or words[0].lower() != "vertex":
                raise ValueError("invalid ASCII STL vertex")
            triangle.append(tuple(float(s) for s in words[1:]))
        faces.append(tuple(triangle))
    return faces


def audit_export(path: Path):
    faces = read_triangles(path)
    if len(faces) != 24:
        raise ValueError(f"expected exactly 24 cube facets, found {len(faces)}")
    groups = ([], [])
    for face in faces:
        if len(face) != 3 or any(len(p) != 3 or
                                 not all(math.isfinite(c) for c in p)
                                 for p in face):
            raise ValueError("nonfinite or malformed STL geometry")
        (a, b, c) = face
        u = [b[i] - a[i] for i in range(3)]
        v = [c[i] - a[i] for i in range(3)]
        cross = (u[1]*v[2]-u[2]*v[1],
                 u[2]*v[0]-u[0]*v[2],
                 u[0]*v[1]-u[1]*v[0])
        if sum(k*k for k in cross) <= EPS * EPS:
            raise ValueError("degenerate STL triangle")
        matches = []
        for i, (xmin, xmax, ymin, ymax, zmin, zmax) in enumerate(EXPECTED):
            if all(xmin-EPS <= p[0] <= xmax+EPS and
                   ymin-EPS <= p[1] <= ymax+EPS and
                   zmin-EPS <= p[2] <= zmax+EPS for p in face):
                matches.append(i)
        if len(matches) != 1:
            raise ValueError("triangle outside both expected placed cubes")
        groups[matches[0]].append(face)
    report = []
    for idx, (faces_in_group, expected) in enumerate(zip(groups, EXPECTED)):
        if len(faces_in_group) != 12:
            raise ValueError(f"build item {idx + 1}: expected 12 facets, got {len(faces_in_group)}")
        vertices = [point for face in faces_in_group for point in face]
        bounds = (min(v[0] for v in vertices), max(v[0] for v in vertices),
                  min(v[1] for v in vertices), max(v[1] for v in vertices),
                  min(v[2] for v in vertices), max(v[2] for v in vertices))
        if any(abs(a-b) > EPS for a, b in zip(bounds, expected)):
            raise ValueError(f"build item {idx + 1}: incorrect bounds: {bounds}")
        report.append({"item": idx + 1, "facets": len(faces_in_group), "bounds": bounds})
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stl", type=Path)
    args = parser.parse_args()
    for entry in audit_export(args.stl):
        print("PASS: official native exported Core 3MF build item",
              entry["item"], "facets=", entry["facets"], "XYZ bounds=", entry["bounds"])


if __name__ == "__main__":
    main()
