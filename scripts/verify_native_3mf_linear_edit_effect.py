#!/usr/bin/env python3
"""Fail-closed Core 3MF rotation/scale *effect* audit for one native build item.

Checks expanded shared-mesh instance transforms independently of the editor,
plus sibling placement and byte-preservation. This does not validate print G-code.
"""
import argparse
import json
import math
from pathlib import Path
import sys
from zipfile import ZipFile

from audit_native_3mf_instance_placement import inspect_placements
from compare_3mf_build_preservation import IDENTITY, mask_build_transforms
from edit_native_3mf_build_transform import compare_native_build_edit
from three_mf_instance_expansion import compose_3mf
from verify_native_3mf_package import MAIN_PART

TOL_MATRIX = 1e-7
TOL_MM = 1e-5


def verify_linear_effect(baseline, candidate, build_index, *,
                         rotation_z_degrees=None, scale_xyz=None):
    """Verify a specific world-axis linear edit about the original build origin.

    Core 3MF uses row vectors. A leaf's existing translation has to be rotated
    or scaled relative to its build origin, NOT about global zero or mesh AABB
    center. The native CLI STL readback is a separate acceptance gate.
    """
    if type(build_index) is not int or build_index < 0:
        raise ValueError("Build index must be a nonnegative integer")
    if (rotation_z_degrees is None) == (scale_xyz is None):
        raise ValueError("Specify exactly one rotation or scale operation")
    if rotation_z_degrees is not None:
        a = rotation_z_degrees
        if (type(a) not in (int, float) or not math.isfinite(a)
                or abs(a) > 360 or a % 360 == 0):
            raise ValueError("Expected bounded, nonzero, finite Z rotation")
        c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
        operation = [c, s, 0, -s, c, 0, 0, 0, 1, 0, 0, 0]
        declared = {"rotation_z_degrees": a}
    else:
        if (not isinstance(scale_xyz, (list, tuple)) or len(scale_xyz) != 3
                or any(type(v) not in (int, float) or not math.isfinite(v)
                       or not 0.25 <= v <= 4 for v in scale_xyz)
                or all(v == 1 for v in scale_xyz)):
            raise ValueError("Expected bounded, nonidentity, finite XYZ scale")
        sx, sy, sz = scale_xyz
        operation = [sx, 0, 0, 0, sy, 0, 0, 0, sz, 0, 0, 0]
        declared = {"scale_xyz": list(scale_xyz)}

    preserved = compare_native_build_edit(baseline, candidate, build_index)
    if not preserved["match"]:
        raise ValueError("3MF non-target bytes or transforms changed")
    before = inspect_placements(baseline)
    after = inspect_placements(candidate)
    if (before["build_items"] < 2 or
            before["build_items"] != after["build_items"] or
            build_index >= before["build_items"] or
            len(before["mesh_instances"]) != len(after["mesh_instances"])):
        raise ValueError("Unexpected build or Core mesh-instance count")

    with ZipFile(baseline) as archive:
        _, transforms = mask_build_transforms(archive.read(MAIN_PART))
    pivot = (transforms[build_index] or IDENTITY)[9:12]

    affected = untouched = 0
    for original, edited in zip(before["mesh_instances"], after["mesh_instances"]):
        for key in ("build_index", "mesh_part", "mesh_objectid",
                    "component_path", "triangle_count"):
            if original[key] != edited[key]:
                raise ValueError("Core component identity or traversal changed")
        selected = original["build_index"] == build_index
        old_world = original["world_transform3mf"]
        expected = list(old_world)
        if selected:
            expected = compose_3mf(old_world, operation)
            # Rotate/scale around the build placement, never world origin.
            for axis in range(3):
                expected[9 + axis] += pivot[axis] - sum(
                    pivot[k] * operation[3 * k + axis] for k in range(3))
            affected += 1
        else:
            untouched += 1
            if any(abs(a - b) > TOL_MM for a, b in zip(
                    original["world_bounds_mm"], edited["world_bounds_mm"])):
                raise ValueError("Untouched sibling Core world bounds changed")
        if any(not math.isfinite(v) or abs(v - exp) > TOL_MATRIX
               for v, exp in zip(edited["world_transform3mf"], expected)):
            raise ValueError("Core world transform differs from declared linear edit")

    if affected < 1 or untouched < 1:
        raise ValueError("Expected edited and untouched Core mesh instances")
    for index, (old, new) in enumerate(zip(
            before["per_build_world_bounds_mm"], after["per_build_world_bounds_mm"])):
        if index != build_index and any(abs(a - b) > TOL_MM for a, b in zip(old, new)):
            raise ValueError("Untouched build-group bounds changed")
    return {
        "match": True, "edited_build_index": build_index, **declared,
        "edited_mesh_instances": affected, "untouched_mesh_instances": untouched,
        "per_build_before_mm": before["per_build_world_bounds_mm"],
        "per_build_after_mm": after["per_build_world_bounds_mm"],
        "byte_preservation_verified": True,
        "limitations": "Bounded equal-unit Core hierarchy only, with separate native STL "
                       "readback. No GUI-authored 3MF, metadata semantics, G-code parity "
                       "or physical-print certification.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--build-index", type=int, required=True)
    edit = parser.add_mutually_exclusive_group(required=True)
    edit.add_argument("--rotate-z-deg", type=float)
    edit.add_argument("--scale-xyz", type=float, nargs=3)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        result = verify_linear_effect(
            args.baseline, args.candidate, args.build_index,
            rotation_z_degrees=args.rotate_z_deg, scale_xyz=args.scale_xyz)
        output = json.dumps(result, sort_keys=True, indent=2) + "\n"
        if args.report:
            args.report.write_text(output, encoding="utf-8")
        else:
            print(output, end="")
    except (ValueError, OSError, RuntimeError, EOFError) as exc:
        print("Native 3MF linear edit effect audit refused: " + str(exc), file=sys.stderr)
        return 2
    print("PASS: one build linear edit; sibling Core world placements preserved")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
