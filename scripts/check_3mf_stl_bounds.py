#!/usr/bin/env python3
"""Read-only comparison of a browser-WASM 3MF-to-STL conversion with placed 3MF geometry.

This diagnostic does not prove native desktop parity, preserve face IDs, or
certify that the resulting STL is safe to print.
"""
import argparse
import json
import math
from pathlib import Path
import struct
import sys
import xml.etree.ElementTree as ET
import zipfile

from audit_3mf_scene import CORE, audit

MAX_TRIANGLES = 200_000
MAX_STL_BYTES = 84 + 50 * MAX_TRIANGLES


def stl_geometry(path, include_axis_samples=False, include_triangles=False):
    # Read at most the diagnostic limit plus one sentinel byte, even for a
    # maliciously oversized or sparse input file.
    with Path(path).open("rb") as stream:
        data = stream.read(MAX_STL_BYTES + 1)
    if len(data) < 84 or len(data) > MAX_STL_BYTES:
        raise ValueError("Converted STL size is empty or excessive")
    triangles = struct.unpack_from("<I", data, 80)[0]
    if not 1 <= triangles <= MAX_TRIANGLES or len(data) != 84 + 50 * triangles:
        raise ValueError("Invalid binary STL triangle count or byte length")
    low = [math.inf] * 3
    high = [-math.inf] * 3
    # Sample every placed triangle vertex, including repeated vertices. The
    # bounded axis multisets reveal interior drift that identical AABBs miss.
    axis_samples = [[], [], []] if include_axis_samples else None
    triangle_samples = [] if include_triangles else None
    for i in range(triangles):
        xyz = struct.unpack_from("<9f", data, 84 + i * 50 + 12)
        for axis in range(3):
            for value in xyz[axis::3]:
                if not math.isfinite(value) or abs(value) > 1e12:
                    raise ValueError("Non-finite or excessive converted STL coordinate")
                low[axis] = min(low[axis], value)
                high[axis] = max(high[axis], value)
                if axis_samples is not None:
                    axis_samples[axis].append(value)
        if triangle_samples is not None:
            points = [tuple(xyz[j:j+3]) for j in (0, 3, 6)]
            triangle_samples.append(tuple(sorted(points)))
    result = (triangles, {"min": low, "max": high})
    if include_triangles:
        return (*result, axis_samples, triangle_samples)
    return (*result, axis_samples) if axis_samples is not None else result


def expected_geometry(archive_path, scene, include_axis_samples=False, include_triangles=False):
    """Exact bounds of used 3MF triangle vertices after same-part transforms."""
    with zipfile.ZipFile(archive_path) as archive:
        root = ET.fromstring(archive.read(scene["part"]))
    meshes = {}
    for obj in root.findall(CORE + "resources/" + CORE + "object"):
        mesh = obj.find(CORE + "mesh")
        if mesh is None:
            continue
        vertices_node = mesh.find(CORE + "vertices")
        triangles_node = mesh.find(CORE + "triangles")
        vertices = [
            (float(v.get("x")), float(v.get("y")), float(v.get("z")))
            for v in vertices_node
        ]
        faces = [
            (int(t.get("v1")), int(t.get("v2")), int(t.get("v3")))
            for t in triangles_node
        ]
        meshes[obj.get("id")] = (vertices, faces)
    low = [math.inf] * 3
    high = [-math.inf] * 3
    total_triangles = 0
    axis_samples = [[], [], []] if include_axis_samples else None
    triangle_samples = [] if include_triangles else None
    factor = scene["millimetersPerUnit"]
    for instance in scene["resolvedMeshInstances"]:
        vertices, faces = meshes[instance["objectId"]]
        total_triangles += len(faces)
        if total_triangles > MAX_TRIANGLES:
            raise ValueError("3MF expanded geometry exceeds conversion audit limit")
        m = instance["transform3mf"]
        # Core 3MF row vectors: mesh vertex -> component -> build.
        for a, b, c in faces:
            placed = [] if triangle_samples is not None else None
            for index in (a, b, c):
                x, y, z = vertices[index]
                transformed = (
                    (x*m[0] + y*m[3] + z*m[6] + m[9]) * factor,
                    (x*m[1] + y*m[4] + z*m[7] + m[10]) * factor,
                    (x*m[2] + y*m[5] + z*m[8] + m[11]) * factor,
                )
                for axis, value in enumerate(transformed):
                    if not math.isfinite(value) or abs(value) > 1e12:
                        raise ValueError("Excessive world-space 3MF mesh vertex")
                    low[axis] = min(low[axis], value)
                    high[axis] = max(high[axis], value)
                    if axis_samples is not None:
                        axis_samples[axis].append(value)
                if placed is not None:
                    placed.append(transformed)
            if triangle_samples is not None:
                triangle_samples.append(tuple(sorted(placed)))
    if total_triangles < 1:
        raise ValueError("No placed 3MF triangles to compare")
    result = (total_triangles, {"min": low, "max": high})
    if include_triangles:
        return (*result, axis_samples, triangle_samples)
    return (*result, axis_samples) if axis_samples is not None else result


def compare(archive_path, stl_path, tolerance_mm=0.05):
    if not math.isfinite(tolerance_mm) or not 0 <= tolerance_mm <= 1:
        raise ValueError("Invalid 3MF/STL comparison tolerance")
    report = audit(archive_path)
    if report["modelParts"] != 1:
        raise ValueError("Only single-part core 3MF is supported by this comparison")
    scene = report["scenes"][0]
    expected_count, expected_bounds, expected_axis, expected_triangles = expected_geometry(
        archive_path, scene, include_axis_samples=True, include_triangles=True)
    converted_count, converted_bounds, converted_axis, converted_triangles = stl_geometry(
        stl_path, include_axis_samples=True, include_triangles=True)
    deltas = {
        side: [converted_bounds[side][i] - expected_bounds[side][i] for i in range(3)]
        for side in ("min", "max")
    }
    max_deviation = max(abs(value) for side in deltas.values() for value in side)
    # Sorting each coordinate axis independently is invariant to triangle
    # ordering, vertex ordering and winding. For equal-size multisets, maximum
    # rank-wise deviation is a necessary (not sufficient) geometry parity gate.
    # It cannot prove vertex/triangle correspondence or topology.
    axis_deviations = None
    if expected_count == converted_count:
        axis_deviations = [
            max(abs(a-b) for a, b in zip(sorted(expected_axis[axis]),
                                         sorted(converted_axis[axis])))
            for axis in range(3)
        ]
    # Canonicalize vertex order within each face and then face order. This
    # detects vertex-to-triangle reassignment that independent XYZ multisets
    # miss. It is a bounded, conservative diagnostic, not indexed-topology or
    # winding parity; near-tied coordinates may reorder under float rounding.
    triangle_deviation = None
    if expected_count == converted_count:
        triangle_deviation = max(
            abs(a - b)
            for expected_face, converted_face in zip(
                sorted(expected_triangles), sorted(converted_triangles))
            for expected_point, converted_point in zip(expected_face, converted_face)
            for a, b in zip(expected_point, converted_point)
        )
    return {
        "source3mf": str(archive_path), "convertedStl": str(stl_path),
        "unit": scene["unit"], "triangles3mfPlaced": expected_count,
        "trianglesStl": converted_count, "exactPlacedBoundsMm": expected_bounds,
        "convertedStlBoundsMm": converted_bounds, "stlMinus3mfBoundsMm": deltas,
        "maxDeviationMm": max_deviation,
        "maxAxisDistributionDeviationMm": max(axis_deviations) if axis_deviations is not None else None,
        "axisDistributionDeviationsMm": axis_deviations,
        "maxTriangleVertexDeviationMm": triangle_deviation,
        "toleranceMm": tolerance_mm,
        "passed": (expected_count == converted_count
                   and max_deviation <= tolerance_mm
                   and max(axis_deviations) <= tolerance_mm
                   and triangle_deviation <= tolerance_mm),
        "limitations": "Checks triangle count, bounds, per-axis coordinates and sorted 3D face-vertex triples. Face order and winding are ignored; lexicographic matching can conservatively fail when near-tied points reorder under rounding. Does NOT prove indexed mesh topology, vertex/face IDs, component metadata, desktop 3MF parity or printer safety. STL is assumed millimetres."
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--stl", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--tolerance-mm", type=float, default=0.05)
    args = parser.parse_args()
    try:
        result = compare(args.input, args.stl, args.tolerance_mm)
    except (OSError, ValueError, KeyError, IndexError, TypeError, zipfile.BadZipFile, ET.ParseError) as exc:
        print(f"3MF/STL geometry check error: {exc}", file=sys.stderr)
        return 2
    output = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        args.report.write_text(output, encoding="utf-8")
    else:
        print(output, end="")
    if not result["passed"]:
        print("3MF/STL geometry differs in bounds, axis values, triangle vertices or count", file=sys.stderr)
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
