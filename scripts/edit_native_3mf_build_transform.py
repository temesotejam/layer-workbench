#!/usr/bin/env python3
"""Conservative native CLI-authored multi-part 3MF *build placement* experiment.

Operates on the exact, audited two-object OrcaSlicer v2.5.0 CLI fixture.
Never rewrites external object parts, settings, relationships, or mesh vertices.
Not a general 3MF editor, desktop GUI equivalence, or print-ready project.
"""
import argparse
import json
import math
from pathlib import Path
import sys
import zipfile

from audit_3mf_scene import parse_model_unit
from compare_3mf_build_preservation import (
    IDENTITY, mask_build_transforms, strip_single_appended_implicit_transform,
)
from compare_3mf_metadata import inventory
from edit_3mf_build_transform import _replace_one_build_transform, validated_matrix
from three_mf_instance_expansion import compose_3mf
from verify_native_3mf_package import audit_native_package, safe_xml, MAIN_PART, CORE_NS


def compare_native_build_edit(baseline, candidate, build_index):
    """Independently check one changed Core build transform and all other bytes."""
    audit_native_package(baseline)
    audit_native_package(candidate)
    old_members = inventory(baseline)
    new_members = inventory(candidate)
    changed_other = sorted(name for name in set(old_members) | set(new_members)
                           if name != MAIN_PART and old_members.get(name) != new_members.get(name))
    with zipfile.ZipFile(baseline) as archive:
        original = archive.read(MAIN_PART)
    with zipfile.ZipFile(candidate) as archive:
        modified = archive.read(MAIN_PART)
    old_mask, old_transforms = mask_build_transforms(original)
    new_mask, new_transforms = mask_build_transforms(modified)
    differences = [i for i, (a, b) in enumerate(zip(old_transforms, new_transforms))
                   if a != b]
    same_structure = len(old_transforms) == len(new_transforms) and old_mask == new_mask
    if not same_structure and differences == [build_index] and old_transforms[build_index] is None:
        try:
            same_structure = strip_single_appended_implicit_transform(
                modified, build_index) == original
        except ValueError:
            pass
    changed = differences == [build_index] and (
        old_transforms[build_index] is not None or
        new_transforms[build_index] != IDENTITY
    ) if 0 <= build_index < len(old_transforms) and len(old_transforms) == len(new_transforms) else False
    match = (set(old_members) == set(new_members) and
             old_members.get(MAIN_PART) != new_members.get(MAIN_PART) and
             not changed_other and same_structure and changed)
    return {
        "match": bool(match), "edited_build_index": build_index,
        "changed_build_indices": differences, "changed_other_members": changed_other,
        "main_model_unchanged_except_one_build_transform": bool(same_structure),
        "preserved_external_model_parts": sorted(
            name for name in old_members if name != MAIN_PART and
            name.startswith("3D/") and name.endswith(".model")),
        "limitations": "Bounded official-CLI two-object package; byte/placement checks only. "
                       "No native metadata semantics, desktop GUI edit, G-code parity, or print safety.",
    }


def translate_native_build_item(source, destination, index, delta_mm):
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve() or destination.exists():
        raise ValueError("Destination must be a new, different archive")
    if isinstance(index, bool) or not isinstance(index, int) or index < 0:
        raise ValueError("Build item index must be nonnegative")
    if not isinstance(delta_mm, (list, tuple)) or len(delta_mm) != 3 or any(
        isinstance(v, bool) or not isinstance(v, (int, float)) or
        not math.isfinite(v) or abs(v) > 1000000 for v in delta_mm
    ) or all(v == 0 for v in delta_mm):
        raise ValueError("Expected nonzero bounded finite XYZ movement in mm")
    audit_native_package(source)
    with zipfile.ZipFile(source) as archive:
        original = archive.read(MAIN_PART)
        root = safe_xml(original, MAIN_PART)
        _, mm_per_unit = parse_model_unit(root.get("unit"))
        _, transforms = mask_build_transforms(original)
        if index >= len(transforms):
            raise ValueError("Selected main Core build item does not exist")
        matrix = list(transforms[index] if transforms[index] is not None else IDENTITY)
        for axis, delta in enumerate(delta_mm):
            matrix[9 + axis] += delta / mm_per_unit
        raw = " ".join(format(value, ".17g") for value in matrix)
        validated_matrix(raw)
        edited_xml = _replace_one_build_transform(original, index, matrix)
        try:
            with zipfile.ZipFile(destination, "x") as output:
                output.comment = archive.comment
                for info in archive.infolist():
                    output.writestr(info, edited_xml if info.filename == MAIN_PART
                                    else archive.read(info))
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
    try:
        report = compare_native_build_edit(source, destination, index)
        if not report["match"]:
            raise ValueError("Native multi-part 3MF byte-preservation audit failed")
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    report["translation_mm"] = list(delta_mm)
    report["model_unit_mm"] = mm_per_unit
    return report



def rotate_native_build_item_z(source, destination, index, angle_degrees):
    """World-axis Z rotation of one native build item about its existing origin.

    Core 3MF uses row-vector affine transforms. Post-multiply the existing
    linear part by Rz, but restore its translation so only orientation changes.
    Neither the external mesh parts nor opaque project metadata are rewritten.
    """
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve() or destination.exists():
        raise ValueError("Destination must be a new, different archive")
    if isinstance(index, bool) or not isinstance(index, int) or index < 0:
        raise ValueError("Build item index must be nonnegative")
    if (isinstance(angle_degrees, bool) or
        not isinstance(angle_degrees, (int, float)) or
        not math.isfinite(angle_degrees) or abs(angle_degrees) > 360 or
        angle_degrees % 360 == 0):
        raise ValueError("Expected nonzero finite Z rotation within -360..360 degrees")
    audit_native_package(source)
    with zipfile.ZipFile(source) as archive:
        original = archive.read(MAIN_PART)
        _, transforms = mask_build_transforms(original)
        if index >= len(transforms):
            raise ValueError("Selected main Core build item does not exist")
        matrix = list(transforms[index] if transforms[index] is not None else IDENTITY)
        radians = math.radians(angle_degrees)
        c, s = math.cos(radians), math.sin(radians)
        rotation = [c, s, 0, -s, c, 0, 0, 0, 1, 0, 0, 0]
        rotated = compose_3mf(matrix, rotation)
        rotated[9:12] = matrix[9:12]
        raw = " ".join(format(value, ".17g") for value in rotated)
        validated_matrix(raw)
        edited_xml = _replace_one_build_transform(original, index, rotated)
        try:
            with zipfile.ZipFile(destination, "x") as output:
                output.comment = archive.comment
                for info in archive.infolist():
                    output.writestr(info, edited_xml if info.filename == MAIN_PART
                                    else archive.read(info))
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
    try:
        report = compare_native_build_edit(source, destination, index)
        if not report["match"]:
            raise ValueError("Native multi-part 3MF byte-preservation audit failed")
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    report["rotation_z_degrees"] = angle_degrees
    report["pivot"] = "existing build translation (not mesh center)"
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--build-index", required=True, type=int)
    edits = parser.add_mutually_exclusive_group(required=True)
    edits.add_argument("--translate-mm", nargs=3, type=float)
    edits.add_argument("--rotate-z-deg", type=float)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        if args.translate_mm is not None:
            report = translate_native_build_item(
                args.input, args.output, args.build_index, args.translate_mm)
        else:
            report = rotate_native_build_item_z(
                args.input, args.output, args.build_index, args.rotate_z_deg)
        text = json.dumps(report, sort_keys=True, indent=2) + "\n"
        if args.report:
            args.report.write_text(text, encoding="utf-8")
        print("PASS: one native multi-part main build placement edited; all other parts preserved")
        return 0
    except (ValueError, OSError, zipfile.BadZipFile, RuntimeError, EOFError) as exc:
        print(f"Native 3MF build edit refused: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
