#!/usr/bin/env python3
"""Compare bounded Core world-space triangle positions across native v2.5.0 3MF exports.

This is an independent, read-only geometric observation. It ignores numeric
object/Part IDs and per-Part metadata matrices. Triangle winding is checked separately; texture, vendor settings, topology
beyond triangle vertex positions and winding, and print safety are not proved. Only the existing two-build, three-Core-part native CLI fixture is
supported. Neither input is modified; no coordinates are logged.
"""
import argparse
import json
import math
from pathlib import Path
import sys
from zipfile import BadZipFile, ZipFile

from audit_3mf_scene import parse_model_unit
from audit_native_3mf_instance_placement import inspect_placements, _mesh_vertices
from verify_native_3mf_package import CORE_NS, safe_xml, audit_native_package

TOLERANCE_MM = 0.005
MAX_MESH_OCCURRENCES = 64
MAX_WORLD_FACETS = 50000
MAX_WORLD_COORD_MM = 1e12
MIN_DOUBLE_AREA_MM2 = 1e-12


def _nondegenerate(face):
    a, b, c = face
    u = tuple(b[i] - a[i] for i in range(3))
    v = tuple(c[i] - a[i] for i in range(3))
    cross = (u[1] * v[2] - u[2] * v[1],
             u[2] * v[0] - u[0] * v[2],
             u[0] * v[1] - u[1] * v[0])
    return math.hypot(*cross) > MIN_DOUBLE_AREA_MM2


def _cyclic_canonical(face):
    # Preserve orientation but ignore cyclic numbering of a triangle.
    # A reversed winding must produce a different signature.
    return min(face, face[1:] + face[:1], face[2:] + face[:2])


def _facets_close(a, b):
    return len(a) == len(b) and all(
        abs(p - q) <= TOLERANCE_MM
        for face_a, face_b in zip(a, b)
        for vertex_a, vertex_b in zip(face_a, face_b)
        for p, q in zip(vertex_a, vertex_b)
    )


def _world_facets(path):
    audit_native_package(path)
    placement = inspect_placements(path, max_instances=MAX_MESH_OCCURRENCES)
    if placement["build_items"] != 2:
        raise ValueError("Expected exactly two native Core build items")
    rows = placement["mesh_instances"]
    if not rows:
        raise ValueError("No native Core mesh occurrences")
    per_build = [[] for _ in range(2)]
    oriented_per_build = [[] for _ in range(2)]
    degenerate_per_build = [0, 0]
    triangles_per_build = [0, 0]
    occurrences_per_build = [0, 0]
    meshes = {}
    with ZipFile(path) as archive:
        for part in sorted({row["mesh_part"] for row in rows}):
            root = safe_xml(archive.read(part), part)
            _, mm_factor = parse_model_unit(root.get("unit"))
            resources = root.find(CORE_NS + "resources")
            if resources is None:
                raise ValueError("Missing Core resource collection")
            for obj in resources.findall(CORE_NS + "object"):
                key = (part, obj.get("id"))
                if key in meshes:
                    raise ValueError("Duplicate Core mesh resource label")
                mesh = obj.find(CORE_NS + "mesh")
                if mesh is None:
                    continue
                # Reuse the independent placement auditor's bounds, finite
                # vertex and triangle-index validation before reading faces.
                _mesh_vertices(mesh)
                vertices_node = mesh.find(CORE_NS + "vertices")
                triangles_node = mesh.find(CORE_NS + "triangles")
                vertices = [
                    tuple(float(node.get(axis)) for axis in ("x", "y", "z"))
                    for node in vertices_node.findall(CORE_NS + "vertex")
                ]
                faces = [
                    tuple(int(node.get(axis)) for axis in ("v1", "v2", "v3"))
                    for node in triangles_node.findall(CORE_NS + "triangle")
                ]
                meshes[key] = (vertices, faces, mm_factor)

        total = 0
        for row in rows:
            index = row["build_index"]
            if index not in (0, 1):
                raise ValueError("Unexpected native Core build index")
            key = (row["mesh_part"], row["mesh_objectid"])
            if key not in meshes:
                raise ValueError("Missing native Core mesh resource")
            vertices, faces, mm_factor = meshes[key]
            matrix = row["world_transform3mf"]
            total += len(faces)
            if total > MAX_WORLD_FACETS:
                raise ValueError("Too many world-space facets to compare")
            occurrences_per_build[index] += 1
            triangles_per_build[index] += len(faces)
            transformed = []
            for x, y, z in vertices:
                point = tuple(mm_factor * (
                    x * matrix[axis] + y * matrix[axis + 3] +
                    z * matrix[axis + 6] + matrix[axis + 9])
                    for axis in range(3))
                if not all(math.isfinite(v) and abs(v) <= MAX_WORLD_COORD_MM
                           for v in point):
                    raise ValueError("Invalid composed Core world position")
                transformed.append(point)
            for face in faces:
                # Ignore face ordering, index allocation and cyclic vertex
                # numbering, but retain duplicate triangular occurrences.
                # This deliberately does not test surface normals/winding.
                triangle = tuple(transformed[i] for i in face)
                per_build[index].append(tuple(sorted(triangle)))
                oriented_per_build[index].append(_cyclic_canonical(triangle))
                if not _nondegenerate(triangle):
                    degenerate_per_build[index] += 1

    return [
        {"facets": sorted(per_build[i]),
         "oriented_facets": sorted(oriented_per_build[i]),
         "degenerate_facets": degenerate_per_build[i],
         "triangle_count": triangles_per_build[i],
         "mesh_occurrences": occurrences_per_build[i]}
        for i in range(2)
    ]


def compare_world_facets(before_path, after_path):
    before, after = _world_facets(before_path), _world_facets(after_path)
    comparisons = []
    for index, (old, new) in enumerate(zip(before, after)):
        counts_match = (old["triangle_count"] == new["triangle_count"] and
                        old["mesh_occurrences"] == new["mesh_occurrences"])
        positions_match = counts_match and _facets_close(
            old["facets"], new["facets"])
        # A position-only match cannot detect reversed face orientation.
        # Degenerate faces have no meaningful winding and must fail closed.
        winding_match = (positions_match and old["degenerate_facets"] == 0
                         and new["degenerate_facets"] == 0
                         and _facets_close(old["oriented_facets"],
                                           new["oriented_facets"]))
        comparisons.append({
            "build_index": index,
            "before_triangle_count": old["triangle_count"],
            "after_triangle_count": new["triangle_count"],
            "before_mesh_occurrences": old["mesh_occurrences"],
            "after_mesh_occurrences": new["mesh_occurrences"],
            "triangle_and_occurrence_counts_match": counts_match,
            "before_degenerate_triangle_count": old["degenerate_facets"],
            "after_degenerate_triangle_count": new["degenerate_facets"],
            "world_triangle_vertex_positions_match_within_0p005_mm": positions_match,
            "world_triangle_winding_match_within_0p005_mm": winding_match,
        })
    equal = all(row["world_triangle_vertex_positions_match_within_0p005_mm"]
                for row in comparisons)
    winding_equal = all(row["world_triangle_winding_match_within_0p005_mm"]
                        for row in comparisons)
    return {
        "source": "read-only bounded native Core world triangle position comparison",
        "build_comparisons": comparisons,
        "world_triangle_positions_equal_within_tolerance": equal,
        "world_triangle_winding_equal_within_tolerance": winding_equal,
        "absolute_position_tolerance_mm": TOLERANCE_MM,
        "part_matrix_semantics_proven": False,
        "complete_native_3mf_parity_proven": False,
        "limitations": (
            "Build indices are only positional comparison candidates. "
            "Core triangle vertex positions and separately cyclic-invariant "
            "oriented triangles are compared after external-part and "
            "nested-component 3MF affine transforms and millimetre conversion. "
            "Degenerate triangles cannot establish winding agreement. "
            "The comparison does not prove manifold topology, internal "
            "metadata Part matrices, object/Part identity, modifiers, GUI "
            "project compatibility, G-code parity or print safety. "
            "Coordinates and private metadata values are never reported."
        ),
    }


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--before", type=Path, required=True)
    cli.add_argument("--after", type=Path, required=True)
    cli.add_argument("--report", type=Path)
    cli.add_argument("--require-equal", action="store_true")
    args = cli.parse_args()
    try:
        result = compare_world_facets(args.before, args.after)
        output = json.dumps(result, indent=2, sort_keys=True) + "\n"
        if args.report:
            args.report.write_text(output, encoding="utf-8")
        else:
            print(output, end="")
        if args.require_equal and not (
            result["world_triangle_positions_equal_within_tolerance"]
            and result["world_triangle_winding_equal_within_tolerance"]
        ):
            print("Native world triangle positions or winding changed",
                  file=sys.stderr)
            return 1
    except (ValueError, OSError, RuntimeError, BadZipFile, EOFError) as exc:
        print("Native world-facet comparison refused: " + str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
