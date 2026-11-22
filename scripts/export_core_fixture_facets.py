#!/usr/bin/env python3
"""Derive oriented world facets from a small, *synthetic* single-part Core 3MF.

This independent source witness checks the original Core triangle indices,
not ThreeMFLoader vertex order or native WASM STL normals. Only simple direct
mesh build items are supported; unsupported 3MF hierarchies fail closed.
Local CI output contains coordinates and MUST NOT be published or logged.
"""
import argparse
import json
import math
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from audit_3mf_scene import CORE, parse_transform
from compare_3mf_metadata import inventory

MAX_ARCHIVE_BYTES = 8 * 1024 * 1024
MAX_FACETS = 256
MAX_BUILDS = 64
MAX_VERTICES = 2560


def extract_source_facets(path):
    path = Path(path)
    if not path.is_file() or not 0 < path.stat().st_size <= MAX_ARCHIVE_BYTES:
        raise ValueError("Input must be a bounded local 3MF fixture")
    members = inventory(path)
    model_parts = [name for name in members if name.lower().endswith(".model")]
    if model_parts != ["3D/3dmodel.model"]:
        raise ValueError("Only a single synthetic Core 3MF model part is supported")
    with ZipFile(path) as archive:
        raw = archive.read("3D/3dmodel.model")
    if len(raw) > 2 * 1024 * 1024 or b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise ValueError("Unsafe or oversized Core XML")
    root = ET.fromstring(raw)
    if root.tag != CORE + "model" or root.get("unit", "millimeter") != "millimeter":
        raise ValueError("Only millimeter Core model fixtures are supported")
    resources, build = root.find(CORE + "resources"), root.find(CORE + "build")
    if resources is None or build is None:
        raise ValueError("Missing Core resources or build")
    meshes = {}
    for obj in resources:
        if obj.tag != CORE + "object" or obj.find(CORE + "components") is not None:
            raise ValueError("Only direct mesh objects are supported")
        oid = obj.get("id")
        if not oid or not oid.isascii() or not oid.isdecimal() or int(oid) <= 0 or oid in meshes:
            raise ValueError("Invalid or duplicate mesh object ID")
        mesh = obj.find(CORE + "mesh")
        if mesh is None:
            raise ValueError("Missing Core mesh")
        vertices_node, triangles_node = mesh.find(CORE + "vertices"), mesh.find(CORE + "triangles")
        if vertices_node is None or triangles_node is None:
            raise ValueError("Missing Core vertices/triangles")
        if not 3 <= len(vertices_node) <= MAX_VERTICES or not 1 <= len(triangles_node) <= MAX_FACETS:
            raise ValueError("Mesh exceeds bounded source audit")
        vertices = []
        for entry in vertices_node:
            if entry.tag != CORE + "vertex":
                raise ValueError("Unexpected vertex tag")
            try:
                point = tuple(float(entry.attrib[axis]) for axis in ("x", "y", "z"))
            except (ValueError, KeyError) as exc:
                raise ValueError("Invalid vertex") from exc
            if any(not math.isfinite(x) or abs(x) > 1e7 for x in point):
                raise ValueError("Invalid vertex coordinate")
            vertices.append(point)
        faces = []
        for triangle in triangles_node:
            if triangle.tag != CORE + "triangle":
                raise ValueError("Unexpected triangle tag")
            try:
                indices = tuple(int(triangle.attrib[key]) for key in ("v1", "v2", "v3"))
            except (ValueError, KeyError) as exc:
                raise ValueError("Invalid triangle index") from exc
            if any(i < 0 or i >= len(vertices) for i in indices) or len(set(indices)) != 3:
                raise ValueError("Out-of-range or degenerate triangle index")
            faces.append(indices)
        meshes[oid] = (vertices, faces)
    if not 1 <= len(build) <= MAX_BUILDS:
        raise ValueError("Build-item count is unsupported")
    facets = []
    for item in build:
        if item.tag != CORE + "item" or set(item.attrib) - {"objectid", "transform"}:
            raise ValueError("Unsupported build item attributes")
        if item.get("objectid") not in meshes:
            raise ValueError("Build references an unknown mesh")
        matrix = parse_transform(item.get("transform"))
        vertices, faces = meshes[item.get("objectid")]
        if len(facets) + len(faces) > MAX_FACETS:
            raise ValueError("Too many world facets")
        world = [
            [sum(point[k] * matrix[k * 3 + axis] for k in range(3)) + matrix[9 + axis]
             for axis in range(3)]
            for point in vertices
        ]
        if any(not math.isfinite(x) or abs(x) > 1e7 for point in world for x in point):
            raise ValueError("Invalid world coordinate")
        facets.extend([[world[i] for i in face] for face in faces])
    return {"source": "synthetic-core-indices", "builds": len(build),
            "comparedTriangles": len(facets), "facets": facets}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        parser.error("Source archive must not be overwritten")
    report = extract_source_facets(args.input)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"PASS: source Core triangle indices and {report['comparedTriangles']} oriented facets extracted (coordinates withheld)")


if __name__ == "__main__":
    main()
