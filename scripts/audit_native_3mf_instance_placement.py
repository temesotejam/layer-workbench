#!/usr/bin/env python3
"""Read-only composed mesh placements for the pinned native CLI multipart 3MF.

This intentionally covers Core build and component transforms, not OrcaSlicer's
opaque project metadata or generalized 3MF project semantics. Its independently
computed world bounds can be compared against official CLI exported STL.
"""
import argparse
import json
import math
from pathlib import Path
import sys
from zipfile import ZipFile

from audit_3mf_scene import parse_model_unit, parse_transform
from inspect_native_3mf_hierarchy import inspect_native_hierarchy, referenced_part
from three_mf_instance_expansion import compose_3mf, MAX_DEPTH, MAX_INSTANCES
from verify_native_3mf_package import CORE_NS, MAIN_PART, safe_xml
from verify_native_exported_stl import audit_export

MAX_VERTICES = 200000
MAX_TRIANGLES = 400000
MAX_COORD = 1000000000


def _mesh_vertices(mesh):
    vertices_node = mesh.find(CORE_NS + "vertices")
    triangles_node = mesh.find(CORE_NS + "triangles")
    if vertices_node is None or triangles_node is None:
        raise ValueError("Unsupported incomplete Core mesh")
    vertices = vertices_node.findall(CORE_NS + "vertex")
    triangles = triangles_node.findall(CORE_NS + "triangle")
    if not (1 <= len(vertices) <= MAX_VERTICES and
            1 <= len(triangles) <= MAX_TRIANGLES):
        raise ValueError("Unsupported Core mesh size")
    coords = []
    for vertex in vertices:
        try:
            xyz = tuple(float(vertex.attrib[k]) for k in ("x", "y", "z"))
        except (ValueError, KeyError) as exc:
            raise ValueError("Invalid Core mesh vertex") from exc
        if any(not math.isfinite(v) or abs(v) > MAX_COORD for v in xyz):
            raise ValueError("Excessive/non-finite Core mesh vertex")
        coords.append(xyz)
    used = set()
    for triangle in triangles:
        for axis in ("v1", "v2", "v3"):
            try:
                index = int(triangle.attrib[axis])
            except (ValueError, KeyError) as exc:
                raise ValueError("Invalid Core triangle index") from exc
            if index < 0 or index >= len(coords):
                raise ValueError("Core triangle references missing vertex")
            used.add(index)
    return [coords[index] for index in sorted(used)], len(triangles)


def _bounds_mm(vertices, transform, mm_factor):
    mins = [math.inf] * 3
    maxs = [-math.inf] * 3
    for x, y, z in vertices:
        p = (
            x * transform[0] + y * transform[3] + z * transform[6] + transform[9],
            x * transform[1] + y * transform[4] + z * transform[7] + transform[10],
            x * transform[2] + y * transform[5] + z * transform[8] + transform[11],
        )
        for axis in range(3):
            value = p[axis] * mm_factor
            if not math.isfinite(value) or abs(value) > 1e12:
                raise ValueError("Excessive composed Core world coordinate")
            mins[axis] = min(mins[axis], value)
            maxs[axis] = max(maxs[axis], value)
    return [v for axis in range(3) for v in (mins[axis], maxs[axis])]


def inspect_placements(path, max_instances=MAX_INSTANCES):
    if type(max_instances) is not int or not 1 <= max_instances <= MAX_INSTANCES:
        raise ValueError("Invalid mesh instance budget")
    topology = inspect_native_hierarchy(path)
    if not topology["all_core_references_resolved"]:
        raise ValueError("Unresolved native Core references; cannot compose placements")
    roots, objects, units = {}, {}, {}
    with ZipFile(path) as archive:
        for part in (row["part"] for row in topology["parts"]):
            root = safe_xml(archive.read(part), part)
            roots[part] = root
            _, units[part] = parse_model_unit(root.get("unit"))
            resources = root.find(CORE_NS + "resources")
            if resources is not None:
                for obj in resources.findall(CORE_NS + "object"):
                    objects[(part, obj.get("id"))] = obj
    # A cross-part Core transform cannot be composed without accounting for
    # the source model's unit convention. Fail closed for the first narrow gate.
    if len(set(units.values())) != 1:
        raise ValueError("Mixed model units unsupported in multipart placement audit")
    mm_factor = units[MAIN_PART]
    build = roots[MAIN_PART].find(CORE_NS + "build")
    items = [] if build is None else build.findall(CORE_NS + "item")
    instances = []
    for index, item in enumerate(items):
        key = (referenced_part(item, MAIN_PART), item.get("objectid"))
        pending = [(key, parse_transform(item.get("transform")), ())]
        item_count = 0
        while pending:
            (part, objid), transform, ancestry = pending.pop()
            key = (part, objid)
            if key in ancestry:
                raise ValueError("Cyclic Core component reference")
            if len(ancestry) >= MAX_DEPTH:
                raise ValueError("Core component nesting exceeds depth limit")
            obj = objects.get(key)
            if obj is None:
                raise ValueError("Missing Core object during placement composition")
            mesh = obj.find(CORE_NS + "mesh")
            components = obj.find(CORE_NS + "components")
            if mesh is not None and components is not None:
                raise ValueError("Ambiguous Core object with mesh and components")
            if mesh is not None:
                vertices, triangles = _mesh_vertices(mesh)
                entry = {
                    "build_index": index,
                    "mesh_part": part,
                    "mesh_objectid": objid,
                    "component_path": [list(node) for node in (*ancestry, key)],
                    "triangle_count": triangles,
                    "world_transform3mf": transform,
                    "world_bounds_mm": _bounds_mm(vertices, transform, mm_factor),
                }
                instances.append(entry)
                item_count += 1
                if len(instances) > max_instances:
                    raise ValueError("Mesh instances exceed audit budget")
            elif components is not None:
                children = components.findall(CORE_NS + "component")
                if not children:
                    raise ValueError("Empty Core component container")
                for comp in reversed(children):
                    child = (referenced_part(comp, part), comp.get("objectid"))
                    pending.append((child, compose_3mf(
                        parse_transform(comp.get("transform")), transform),
                        (*ancestry, key)))
            else:
                raise ValueError("Core build object has neither mesh nor components")
        if item_count == 0:
            raise ValueError("Core build item produces no mesh instances")
    per_build = []
    for index in range(len(items)):
        matches = [row["world_bounds_mm"] for row in instances if row["build_index"] == index]
        per_build.append([
            value for axis in range(3)
            for value in (min(box[2 * axis] for box in matches),
                          max(box[2 * axis + 1] for box in matches))
        ])
    return {
        "source": "bounded, read-only Core multipart mesh transform composition",
        "build_items": len(items),
        "mesh_instances": instances,
        "per_build_world_bounds_mm": per_build,
        "all_core_references_resolved": True,
        "limitations": "Core mesh vertices and transforms only, equal model units. "
                       "No native metadata semantics, GUI project parity, "
                       "WASM toolpath parity or physical print certification.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--verify-stls", type=Path, nargs="+",
                        help="Compare independently derived two-box bounds to native CLI STL")
    parser.add_argument("--require-instances", type=int)
    args = parser.parse_args()
    try:
        result = inspect_placements(args.input)
        if (args.require_instances is not None and
                len(result["mesh_instances"]) != args.require_instances):
            raise ValueError("Unexpected native project mesh instance count")
        if args.verify_stls:
            if len(result["per_build_world_bounds_mm"]) != 2 or len(result["mesh_instances"]) != 2:
                raise ValueError("STL gate currently supports exactly two one-mesh cubes")
            audit_export(*args.verify_stls,
                         expected=tuple(tuple(b) for b in result["per_build_world_bounds_mm"]))
            result["independent_native_stl_bounds_match"] = True
    except (OSError, ValueError, RuntimeError, EOFError) as exc:
        print("Native multipart placement audit refused: " + str(exc), file=sys.stderr)
        return 2
    report = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.report:
        args.report.write_text(report, encoding="utf-8")
    else:
        print(report, end="")
    print("PASS: native multipart Core transforms composed and bounded; no full 3MF parity implied")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
