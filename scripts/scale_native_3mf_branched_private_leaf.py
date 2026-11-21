#!/usr/bin/env python3
"""Scale one detached leaf of a two-edge, two-build native-derived Core 3MF.

This offline experiment does not support GUI-created projects, opaque metadata
semantics, slicing, G-code generation, or physical printer operation. Only
the chosen build-1 branch's already-private external mesh may be modified.
"""
import argparse
import math
from pathlib import Path
import sys
from zipfile import ZipFile

from audit_native_3mf_instance_placement import inspect_placements
from clone_native_3mf_shared_leaf import _object_block
from compare_3mf_metadata import inventory
from plan_native_3mf_copy_on_write import plan_copy_on_write
from scale_native_3mf_private_leaf import _scaled_mesh_xml, MIN_SCALE, MAX_SCALE
from verify_native_3mf_package import MAIN_PART, audit_native_package


def scale_private_branched_leaf(source, destination, edge_index=1,
                                scale_factor=1.1, axis="y"):
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve() or destination.exists():
        raise ValueError("Output must be a distinct, nonexistent file")
    if type(edge_index) is not int or edge_index not in (0, 1):
        raise ValueError("Only branch edge 0 or 1 of build item 1 is supported")
    if type(axis) is not str or axis not in ("x", "y", "z"):
        raise ValueError("Scale axis must be x, y or z")
    if (type(scale_factor) not in (int, float) or
            not math.isfinite(scale_factor) or
            not MIN_SCALE <= scale_factor <= MAX_SCALE or scale_factor == 1):
        raise ValueError("Scale must be finite, nonidentity and within 0.5..1.5")

    audit_native_package(source)
    before = inspect_placements(source)
    rows = before["mesh_instances"]
    selected_index = edge_index + 2
    if (before["build_items"] != 2 or len(rows) != 4 or
            [r["build_index"] for r in rows] != [0, 0, 1, 1] or
            any(len(r["component_path"]) != 2 for r in rows)):
        raise ValueError("Expected two builds with exactly two direct external leaves each")
    target = rows[selected_index]
    leaf_part, leaf_id = target["mesh_part"], target["mesh_objectid"]
    if (leaf_part == MAIN_PART or
            sum((r["mesh_part"], r["mesh_objectid"]) ==
                (leaf_part, leaf_id) for r in rows) != 1):
        raise ValueError("Selected leaf is not a private external Core object")
    if plan_copy_on_write(source, 1, [edge_index])["copy_on_write_required"]:
        raise ValueError("Selected Core occurrence remains shared")

    with ZipFile(source) as original:
        old_xml = original.read(leaf_part)
        new_xml = _scaled_mesh_xml(old_xml, leaf_id, scale_factor, axis)
        a, _, b = _object_block(old_xml, leaf_id)
        c, _, d = _object_block(new_xml, leaf_id)
        if old_xml[:a] != new_xml[:c] or old_xml[b:] != new_xml[d:]:
            raise ValueError("Unselected Core or vendor XML bytes changed")
        try:
            with ZipFile(destination, "x") as output:
                output.comment = original.comment
                for info in original.infolist():
                    output.writestr(info, new_xml if info.filename == leaf_part
                                    else original.read(info))
        except BaseException:
            destination.unlink(missing_ok=True)
            raise

    try:
        audit_native_package(destination)
        original_members, edited_members = inventory(source), inventory(destination)
        if (set(original_members) != set(edited_members) or
                {name for name in original_members
                 if original_members[name] != edited_members[name]} != {leaf_part}):
            raise ValueError("Unexpected changes to 3MF ZIP members")
        after = inspect_placements(destination)
        changed = after["mesh_instances"]
        if len(changed) != 4:
            raise ValueError("Changed number of Core mesh occurrences")
        for index, (old, new) in enumerate(zip(rows, changed)):
            for field in ("build_index", "mesh_part", "mesh_objectid",
                          "component_path", "triangle_count", "world_transform3mf"):
                if old[field] != new[field]:
                    raise ValueError("Modified Core occurrence identity or placement")
            if index == selected_index:
                if old["world_bounds_mm"] == new["world_bounds_mm"]:
                    raise ValueError("Selected private mesh did not change geometry")
            elif old["world_bounds_mm"] != new["world_bounds_mm"]:
                raise ValueError("Nonselected mesh occurrence geometry changed")
        if plan_copy_on_write(destination, 1, [edge_index])["copy_on_write_required"]:
            raise ValueError("Edited branch lost its private ownership")
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return {
        "edited_build_index": 1, "edited_edge_index": edge_index,
        "private_mesh_part": leaf_part, "private_mesh_objectid": leaf_id,
        "scale_axis": axis, "scale_factor": scale_factor,
        "modified_zip_members": [leaf_part],
        "other_three_occurrences_unchanged": True,
        "native_cli_acceptance": "not yet established by this writer",
        "print_safety": "not tested",
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--edge-index", type=int, choices=(0, 1), default=1)
    p.add_argument("--axis", choices=("x", "y", "z"), default="y")
    p.add_argument("--factor", type=float, default=1.1)
    args = p.parse_args()
    try:
        result = scale_private_branched_leaf(
            args.input, args.output, args.edge_index, args.factor, args.axis)
    except (ValueError, OSError, RuntimeError, KeyError, EOFError) as exc:
        print("Private branched mesh edit refused: " + str(exc), file=sys.stderr)
        return 2
    print("PASS: detached branch vertex edit:", result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
