#!/usr/bin/env python3
"""Fail-closed native multipart 3MF build-translation *effect* audit.

Compare expanded Core mesh instances before/after an isolated build-item move,
including a shared external mesh or multiple component leaves. Requires the
separate byte-preservation gate; does not edit the archive or certify printing.
"""
import argparse
import json
import math
from pathlib import Path
import sys

from audit_native_3mf_instance_placement import inspect_placements
from edit_native_3mf_build_transform import compare_native_build_edit

TOL_MM = 1e-5
TOL_MATRIX = 1e-9


def verify_translation_effect(baseline, candidate, build_index, delta_mm):
    if type(build_index) is not int or build_index < 0:
        raise ValueError("Build index must be a nonnegative integer")
    if (not isinstance(delta_mm, (tuple, list)) or len(delta_mm) != 3 or
            any(type(v) not in (int, float) or
                not math.isfinite(v) or abs(v) > 1000000 for v in delta_mm) or
            all(v == 0 for v in delta_mm)):
        raise ValueError("Expected bounded, nonzero, finite XYZ translation")
    preserved = compare_native_build_edit(baseline, candidate, build_index)
    if not preserved["match"]:
        raise ValueError("3MF non-target bytes or transforms changed")
    before, after = inspect_placements(baseline), inspect_placements(candidate)
    if (before["build_items"] < 2 or
            before["build_items"] != after["build_items"] or
            build_index >= before["build_items"] or
            len(before["mesh_instances"]) != len(after["mesh_instances"])):
        raise ValueError("Unexpected build or mesh instance count")
    moved = untouched = 0
    for old, new in zip(before["mesh_instances"], after["mesh_instances"]):
        # Ordering and traversal paths must remain stable; matching merely on
        # AABB would let an accidentally replaced shared mesh pass unnoticed.
        for key in ("build_index", "mesh_part", "mesh_objectid",
                    "component_path", "triangle_count"):
            if old[key] != new[key]:
                raise ValueError("Core component identity or order changed")
        selected = old["build_index"] == build_index
        if any(abs(a - b) > TOL_MATRIX for a, b in zip(
                old["world_transform3mf"][:9], new["world_transform3mf"][:9])):
            raise ValueError("Mesh linear transform unexpectedly changed")
        for axis in range(3):
            shift = delta_mm[axis] if selected else 0
            for side in (0, 1):
                offset = 2 * axis + side
                if abs(new["world_bounds_mm"][offset] -
                       old["world_bounds_mm"][offset] - shift) > TOL_MM:
                    raise ValueError("Core world-space instance bounds differ from requested translation")
        if not selected and any(abs(a - b) > TOL_MATRIX for a, b in zip(
                old["world_transform3mf"][9:], new["world_transform3mf"][9:])):
            raise ValueError("Untouched sibling world transform changed")
        if selected:
            moved += 1
        else:
            untouched += 1
    if moved == 0 or untouched == 0:
        raise ValueError("Expected moved and untouched mesh instances")
    for item, (old, new) in enumerate(zip(
            before["per_build_world_bounds_mm"],
            after["per_build_world_bounds_mm"])):
        for axis in range(3):
            for side in (0, 1):
                n = 2 * axis + side
                shift = delta_mm[axis] if item == build_index else 0
                if abs(new[n] - old[n] - shift) > TOL_MM:
                    raise ValueError("Build-group bounds do not match translation")
    return {
        "match": True, "edited_build_index": build_index,
        "translation_mm": list(delta_mm), "moved_mesh_instances": moved,
        "untouched_mesh_instances": untouched,
        "per_build_before_mm": before["per_build_world_bounds_mm"],
        "per_build_after_mm": after["per_build_world_bounds_mm"],
        "byte_preservation_verified": True,
        "limitations": "Bounded equal-unit Core graph and CLI-authored test archive only; "
                       "no GUI 3MF, metadata semantics, G-code parity or print certification.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--build-index", type=int, required=True)
    parser.add_argument("--translate-mm", type=float, nargs=3, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        report = verify_translation_effect(
            args.baseline, args.candidate, args.build_index, args.translate_mm)
        rendered = json.dumps(report, sort_keys=True, indent=2) + "\n"
        if args.report:
            args.report.write_text(rendered, encoding="utf-8")
        else:
            print(rendered, end="")
    except (OSError, ValueError, RuntimeError, EOFError) as exc:
        print(f"Native 3MF instance translation audit refused: {exc}", file=sys.stderr)
        return 2
    print("PASS: selected Core instances translated; sibling world placements preserved")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
