#!/usr/bin/env python3
"""Scale one coordinate axis of ONE already-private Core 3MF mesh leaf.

Experimental offline native CLI fixture only. The caller must first detach
the full selected component path; this writer never edits a shared mesh.
Only the selected external Core mesh's numeric vertex attributes on the chosen axis change.
No real printer files, G-code or public browser features are produced.
"""
import argparse
import json
import math
from pathlib import Path
import re
import sys
from zipfile import ZipFile

from audit_3mf_scene import parse_model_unit
from audit_native_3mf_instance_placement import inspect_placements, MAX_COORD
from clone_native_3mf_shared_leaf import _attribute, _guard_xml, _object_block
from compare_3mf_metadata import inventory
from plan_native_3mf_copy_on_write import plan_copy_on_write
from verify_native_3mf_package import CORE_NS, MAIN_PART, audit_native_package

VERTEX_TAG = re.compile(rb'<(?:(?:[A-Za-z_][\w.-]*):)?vertex(?=\s)[^<>]*/>')
MIN_SCALE, MAX_SCALE = 0.5, 1.5


def _scaled_mesh_xml(raw, mesh_id, factor, axis="x"):
    if type(axis) is not str or axis not in ("x", "y", "z"):
        raise ValueError("Scale axis must be x, y or z")
    root = _guard_xml(raw, "private external Core model")
    _, mm_per_unit = parse_model_unit(root.get("unit"))
    if mm_per_unit != 1:
        raise ValueError("Private mesh scaling requires millimetre Core model units")
    resources = root.find(CORE_NS + "resources")
    matches = [] if resources is None else [
        obj for obj in resources.findall(CORE_NS + "object") if obj.get("id") == mesh_id
    ]
    if len(matches) != 1:
        raise ValueError("Selected private Core mesh ID is ambiguous")
    mesh = matches[0].find(CORE_NS + "mesh")
    if mesh is None or mesh.find(CORE_NS + "vertices") is None:
        raise ValueError("Selected private Core object is not a mesh")
    expected_vertices = mesh.find(CORE_NS + "vertices").findall(CORE_NS + "vertex")
    start, _, end = _object_block(raw, mesh_id)
    block = raw[start:end]
    tags = list(VERTEX_TAG.finditer(block))
    if not tags or len(tags) != len(expected_vertices):
        raise ValueError("Unsupported private Core vertex markup")
    coordinates = []
    for tag in tags:
        match = _attribute(tag.group(), axis)
        try:
            value = float(match.group("value").decode("ascii"))
        except (UnicodeError, ValueError) as exc:
            raise ValueError(f"Invalid private Core vertex {axis.upper()} value") from exc
        if not math.isfinite(value) or abs(value) > MAX_COORD:
            raise ValueError("Out-of-range private Core vertex")
        coordinates.append(value)
    low, high = min(coordinates), max(coordinates)
    if high - low <= 1e-8:
        raise ValueError("Cannot scale a zero-width private Core mesh on the selected axis")
    center = (low + high) / 2
    changed = block
    for tag, original in reversed(list(zip(tags, coordinates))):
        opening = tag.group()
        coordinate_attr = _attribute(opening, axis)
        new = center + (original - center) * factor
        if not math.isfinite(new) or abs(new) > MAX_COORD:
            raise ValueError("Scaled Core vertex exceeds coordinate budget")
        updated = (opening[:coordinate_attr.start("value")] +
                   format(new, ".12g").encode("ascii") +
                   opening[coordinate_attr.end("value"):])
        changed = changed[:tag.start()] + updated + changed[tag.end():]
    if changed == block:
        raise ValueError("Private Core mesh edit was a no-op")
    result = raw[:start] + changed + raw[end:]
    checked = _guard_xml(result, "scaled private external Core model")
    objects = checked.find(CORE_NS + "resources").findall(CORE_NS + "object")
    target = [o for o in objects if o.get("id") == mesh_id]
    if len(target) != 1 or len(target[0].find(CORE_NS + "mesh")
                                .find(CORE_NS + "vertices").findall(CORE_NS + "vertex")) != len(tags):
        raise ValueError("Private Core mesh changed structural vertex count")
    return result


def scale_private_leaf(source, destination, build_index=1, edge_index=0, scale_x=1.1,
                       axis="x", component_edges=None):
    """Edit exactly one private leaf in a bounded two-build native 3MF."""
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve() or destination.exists():
        raise ValueError("Output must be a distinct, nonexistent path")
    if type(build_index) is not int or type(edge_index) is not int:
        raise ValueError("Core occurrence indices must be integers")
    if component_edges is None:
        selected_edges = [edge_index]
    elif (isinstance(component_edges, (tuple, list)) and
          all(type(edge) is int for edge in component_edges) and
          edge_index == 0):
        selected_edges = list(component_edges)
    else:
        raise ValueError("Invalid or conflicting component-edge path")
    if selected_edges not in ([0], [0, 0]):
        raise ValueError("Only bounded Core component paths 0 and 0,0 are supported")
    if type(axis) is not str or axis not in ("x", "y", "z"):
        raise ValueError("Scale axis must be x, y or z")
    if type(scale_x) not in (float, int) or not math.isfinite(scale_x):
        raise ValueError("Scale factor must be finite and numeric")
    if not MIN_SCALE <= scale_x <= MAX_SCALE or scale_x == 1:
        raise ValueError("Scale factor must be nonidentity within 0.5..1.5")
    audit_native_package(source)
    before = inspect_placements(source)
    instances = before["mesh_instances"]
    if (before["build_items"] != 2 or len(instances) != 2 or
            sorted(row["build_index"] for row in instances) != [0, 1] or
            build_index != 1 or edge_index != 0):
        raise ValueError("Only the second independent private mesh of two builds is supported")
    selected = instances[build_index]
    sibling = instances[1 - build_index]
    if (len(selected["component_path"]) != len(selected_edges) + 1 or
            len(sibling["component_path"]) != len(selected_edges) + 1):
        raise ValueError("Selected Core component depth does not match explicit path")
    if (selected["mesh_part"] == MAIN_PART or
            selected["mesh_part"] != sibling["mesh_part"] or
            selected["mesh_objectid"] == sibling["mesh_objectid"]):
        raise ValueError("Selected Core mesh is not a private external clone")
    if plan_copy_on_write(source, build_index, selected_edges)["copy_on_write_required"]:
        raise ValueError("Selected Core leaf still has shared ownership")
    leaf_part, leaf_id = selected["mesh_part"], selected["mesh_objectid"]
    with ZipFile(source) as original:
        source_leaf = original.read(leaf_part)
        changed_leaf = _scaled_mesh_xml(source_leaf, leaf_id, scale_x, axis)
        # The other object block must remain completely untouched, including
        # its attributes and vertex bytes.
        old_start, _, old_end = _object_block(source_leaf, sibling["mesh_objectid"])
        new_start, _, new_end = _object_block(changed_leaf, sibling["mesh_objectid"])
        if source_leaf[old_start:old_end] != changed_leaf[new_start:new_end]:
            raise ValueError("Unselected Core mesh object was modified")
        try:
            with ZipFile(destination, "x") as modified:
                modified.comment = original.comment
                for info in original.infolist():
                    payload = changed_leaf if info.filename == leaf_part else original.read(info)
                    modified.writestr(info, payload)
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
    try:
        audit_native_package(destination)
        old_members, new_members = inventory(source), inventory(destination)
        if set(old_members) != set(new_members) or {
                name for name in old_members if old_members[name] != new_members[name]
        } != {leaf_part}:
            raise ValueError("Private mesh edit changed unrelated archive members")
        after = inspect_placements(destination)
        old_instances, new_instances = before["mesh_instances"], after["mesh_instances"]
        if len(new_instances) != 2:
            raise ValueError("Mesh instance count changed")
        for old, new in zip(old_instances, new_instances):
            for field in ("build_index", "mesh_part", "mesh_objectid",
                          "world_transform3mf", "triangle_count", "component_path"):
                if old[field] != new[field]:
                    raise ValueError("Private mesh edit unexpectedly changed occurrence identity")
            if old["build_index"] != build_index and old["world_bounds_mm"] != new["world_bounds_mm"]:
                raise ValueError("Unselected build geometry changed")
        if after["per_build_world_bounds_mm"][0] != before["per_build_world_bounds_mm"][0]:
            raise ValueError("Sibling build bounds changed")
        if all(abs(a - b) < 1e-6 for a, b in zip(
                before["per_build_world_bounds_mm"][1],
                after["per_build_world_bounds_mm"][1])):
            raise ValueError("Selected private mesh geometry did not change")
        if plan_copy_on_write(destination, build_index, selected_edges)["copy_on_write_required"]:
            raise ValueError("Edited private mesh became shared")
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return {
        "source": "bounded native Core private mesh single-axis vertex scaling",
        "edited_build_index": build_index,
        "component_edge_path": selected_edges,
        "private_mesh": {"part": leaf_part, "objectid": leaf_id},
        "scale_axis": axis,
        "scale_factor": scale_x,
        **({"scale_x": scale_x} if axis == "x" else {}),
        "changed_model_parts": [leaf_part],
        "sibling_unchanged": True,
        "opaque_zip_members_preserved": True,
        "before_bounds_mm": before["per_build_world_bounds_mm"],
        "after_bounds_mm": after["per_build_world_bounds_mm"],
        "limitations": "CLI fixture only; no GUI metadata, G-code or print safety certified."
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--build-index", type=int, default=1)
    parser.add_argument("--component-edge", type=int, default=0)
    parser.add_argument("--component-edges", choices=("0", "0,0"),
                        help="Explicit bounded Core path (0 or 0,0); default is 0")
    axis_group = parser.add_mutually_exclusive_group()
    axis_group.add_argument("--scale-x", type=float, help="Scale private X vertices")
    axis_group.add_argument("--scale-y", type=float, help="Scale private Y vertices")
    axis_group.add_argument("--scale-z", type=float, help="Scale private Z vertices")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        chosen = [(axis, value) for axis, value in (
            ("x", args.scale_x), ("y", args.scale_y), ("z", args.scale_z)
        ) if value is not None]
        axis, factor = chosen[0] if chosen else ("x", 1.1)
        edges = (None if args.component_edges is None else
                 [int(edge) for edge in args.component_edges.split(",")])
        result = scale_private_leaf(args.input, args.output, args.build_index,
                                    args.component_edge, factor, axis, edges)
        report = json.dumps(result, sort_keys=True, indent=2) + "\n"
        if args.report:
            args.report.write_text(report, encoding="utf-8")
        else:
            print(report, end="")
    except (ValueError, KeyError, OSError, RuntimeError, EOFError) as exc:
        print("Native private Core mesh scaling refused: " + str(exc), file=sys.stderr)
        return 2
    print("PASS: one private Core mesh changed; sibling and opaque members unchanged")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
