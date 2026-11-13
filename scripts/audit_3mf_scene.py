#!/usr/bin/env python3
"""Bounded, read-only audit of core 3MF model objects, triangles and build items.

Reports raw 12-number 3MF transform vectors; it does not convert them into
OrcaSlicer/WASM matrix conventions or assert full project compatibility.
"""
import argparse
import json
import math
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

from compare_3mf_metadata import inventory
from three_mf_instance_expansion import expand_scene

CORE = "{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}"
# Core 3MF §3.3: model/@unit applies to vertices and translations alike.
# Retain the native unit in the report; add millimetre diagnostics separately.
UNIT_TO_MM = {
    "micron": 0.001, "millimeter": 1.0, "centimeter": 10.0,
    "inch": 25.4, "foot": 304.8, "meter": 1000.0,
}
MAX_MODEL_PARTS = 32
MAX_SCENE_ELEMENTS = 1_000_000
POSITIVE_ID = re.compile(r"^[1-9][0-9]*$")


def parse_model_unit(raw):
    """Return the strict core 3MF unit and its millimetre multiplier."""
    unit = "millimeter" if raw is None else raw
    if unit not in UNIT_TO_MM:
        raise ValueError(f"Unsupported 3MF model unit: {unit!r}")
    return unit, UNIT_TO_MM[unit]


def diagnostic_bounds_mm(bounds, factor):
    """Scale a diagnostic AABB, never changing its 3MF source coordinates."""
    if bounds is None:
        return None
    scaled = {side: [v * factor for v in bounds[side]] for side in ("min", "max")}
    if any(not math.isfinite(v) or abs(v) > 1_000_000_000_000
           for side in scaled.values() for v in side):
        raise ValueError("Excessive 3MF millimetre bounds")
    return scaled


def positive_id(raw, kind):
    if raw is None or not POSITIVE_ID.fullmatch(raw) or len(raw) > 18:
        raise ValueError(f"Invalid 3MF {kind} id")
    return raw


def parse_transform(raw):
    if raw is None:
        return [1.0, 0.0, 0.0, 0.0, 1.0, 0.0,
                0.0, 0.0, 1.0, 0.0, 0.0, 0.0]
    parts = raw.split()
    if len(parts) != 12:
        raise ValueError("3MF transform must contain 12 numbers")
    try:
        values = [float(x) for x in parts]
    except ValueError as exc:
        raise ValueError("Invalid 3MF transform number") from exc
    if not all(math.isfinite(x) and abs(x) <= 1_000_000 for x in values):
        raise ValueError("Non-finite or excessive 3MF transform")
    return values


def audit(path):
    members = inventory(path)  # Validates ZIP paths, duplicates and size limits.
    parts = sorted(name for name in members
                   if name.startswith("3D/") and name.lower().endswith(".model"))
    if not parts or len(parts) > MAX_MODEL_PARTS:
        raise ValueError("Invalid 3MF model part count")
    scenes = []
    with zipfile.ZipFile(path) as archive:
        for part in parts:
            raw = archive.read(part)
            upper = raw.upper()
            if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
                raise ValueError("DTD/entities are forbidden in 3MF scene audit")
            try:
                root = ET.fromstring(raw)
            except ET.ParseError as exc:
                raise ValueError(f"Invalid 3MF model XML: {part}") from exc
            if root.tag != CORE + "model":
                raise ValueError(f"Unexpected 3MF model root: {part}")
            unit, mm_per_unit = parse_model_unit(root.get("unit"))
            resources = root.find(CORE + "resources")
            build = root.find(CORE + "build")
            if resources is None or build is None:
                raise ValueError("3MF model lacks resources or build")
            objects = {}
            element_count = 0
            for obj in resources.findall(CORE + "object"):
                oid = positive_id(obj.get("id"), "object")
                if oid in objects:
                    raise ValueError("Duplicate 3MF object ID")
                mesh = obj.find(CORE + "mesh")
                components = obj.find(CORE + "components")
                if mesh is not None and components is not None:
                    raise ValueError("Object has both mesh and components")
                vertex_count = triangle_count = 0
                local_bounds = None
                references = []
                component_instances = []
                if mesh is not None:
                    vertices = mesh.find(CORE + "vertices")
                    triangles = mesh.find(CORE + "triangles")
                    if vertices is None or triangles is None:
                        raise ValueError("3MF mesh lacks vertices or triangles")
                    vertex_count = len(vertices)
                    triangle_count = len(triangles)
                    element_count += vertex_count + triangle_count
                    if vertex_count > MAX_SCENE_ELEMENTS or triangle_count > MAX_SCENE_ELEMENTS:
                        raise ValueError("3MF geometry exceeds scene audit limit")
                    low = [math.inf, math.inf, math.inf]
                    high = [-math.inf, -math.inf, -math.inf]
                    for vertex in vertices:
                        if vertex.tag != CORE + "vertex":
                            raise ValueError("Unexpected element in 3MF vertices")
                        for axis, key in enumerate(("x", "y", "z")):
                            raw_value = vertex.get(key)
                            try:
                                value = float(raw_value) if raw_value is not None else math.nan
                            except ValueError as exc:
                                raise ValueError("Invalid 3MF vertex coordinate") from exc
                            if not math.isfinite(value) or abs(value) > 1_000_000_000:
                                raise ValueError("Invalid or excessive 3MF vertex coordinate")
                            low[axis] = min(low[axis], value)
                            high[axis] = max(high[axis], value)
                    if vertex_count:
                        local_bounds = {"min": low, "max": high}
                    for tri in triangles:
                        if tri.tag != CORE + "triangle":
                            raise ValueError("Unexpected element in 3MF triangles")
                        for key in ("v1", "v2", "v3"):
                            val = tri.get(key)
                            if val is None or not val.isdigit() or len(val) > 9 or int(val) >= vertex_count:
                                raise ValueError("Invalid 3MF triangle vertex index")
                if components is not None:
                    for comp in components:
                        if comp.tag != CORE + "component":
                            raise ValueError("Unexpected 3MF component element")
                        if any(k.endswith("}path") or k == "path" for k in comp.attrib):
                            raise ValueError("External-part component references are not supported")
                        ref = positive_id(comp.get("objectid"), "component")
                        references.append(ref)
                        component_instances.append({"objectId": ref,
                                                    "transform3mf": parse_transform(comp.get("transform"))})
                    element_count += len(references)
                objects[oid] = {"id": oid, "vertices": vertex_count,
                                "triangles": triangle_count, "components": references,
                                "mesh": mesh is not None,
                                "localBounds": local_bounds,
                                "componentInstances": component_instances}
                if len(objects) + element_count > MAX_SCENE_ELEMENTS:
                    raise ValueError("3MF scene exceeds element limit")
            for obj in objects.values():
                for ref in obj["components"]:
                    if ref not in objects:
                        raise ValueError("3MF component refers to missing object")
            items = []
            for item in build:
                if item.tag != CORE + "item":
                    raise ValueError("Unexpected 3MF build element")
                # Cross-part reference extension requires OPC relationship
                # resolution; never silently pretend it references this part.
                if any(k.endswith("}path") or k == "path" for k in item.attrib):
                    raise ValueError("External-part build references are not supported by this audit")
                oid = positive_id(item.get("objectid"), "build object")
                if oid not in objects:
                    raise ValueError("3MF build item refers to missing object")
                items.append({"objectId": oid,
                              "transform3mf": parse_transform(item.get("transform"))})
                if len(items) + len(objects) + element_count > MAX_SCENE_ELEMENTS:
                    raise ValueError("3MF scene exceeds element limit")
            # Resolve same-part component and build transforms using 3MF's
            # row-vector convention. Reject cycles and instancing bombs.
            resolved = expand_scene(objects, items)
            for instance in resolved:
                if "conservativeWorldBounds" in instance:
                    instance["conservativeWorldBoundsMm"] = diagnostic_bounds_mm(
                        instance["conservativeWorldBounds"], mm_per_unit)
            scenes.append({"part": part, "unit": unit,
                           "millimetersPerUnit": mm_per_unit,
                           "objects": list(objects.values()),
                           "buildItems": items,
                           "meshTriangles": sum(x["triangles"] for x in objects.values()),
                           "resolvedMeshInstances": resolved,
                           "resolvedTriangleInstances": sum(x["triangles"] for x in resolved)})
    return {
        "archive": str(path), "modelParts": len(scenes),
        "totalObjects": sum(len(x["objects"]) for x in scenes),
        "totalBuildItems": sum(len(x["buildItems"]) for x in scenes),
        "totalMeshTriangles": sum(x["meshTriangles"] for x in scenes),
        "totalResolvedMeshInstances": sum(len(x["resolvedMeshInstances"]) for x in scenes),
        "totalResolvedTriangleInstances": sum(x["resolvedTriangleInstances"] for x in scenes),
        "scenes": scenes,
        "limitations": "Core 3MF scene inventory with same-part component transform expansion only. No external OPC part references, metadata/texture parity, face IDs, native transform editing, desktop reopen or print certification."
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--expected-build-items", type=int)
    parser.add_argument("--min-triangles", type=int, default=0)
    args = parser.parse_args()
    if args.min_triangles < 0 or args.expected_build_items is not None and args.expected_build_items < 0:
        parser.error("Expected counts cannot be negative")
    try:
        report = audit(args.input)
    except (ValueError, OSError, zipfile.BadZipFile, RuntimeError, EOFError) as exc:
        print(f"3MF scene audit error: {exc}", file=sys.stderr)
        return 2
    matches = (report["totalMeshTriangles"] >= args.min_triangles
               and (args.expected_build_items is None
                    or report["totalBuildItems"] == args.expected_build_items))
    report["expectationsPassed"] = matches
    output = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        args.report.write_text(output, encoding="utf-8")
    else:
        print(output, end="")
    return 0 if matches else 1


if __name__ == "__main__":
    raise SystemExit(main())
