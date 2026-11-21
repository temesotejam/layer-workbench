#!/usr/bin/env python3
"""Read-only Part metadata-value drift audit across a native v2.5.0 3MF re-export.

Compare *positions* within two build items, never infer semantic Part/mesh
identity from a matching numeric ID. Only direct Part <metadata key/value>
attributes and subtype are inspected. Other vendor settings are deliberately
outside the audit. No G-code or printer commands are produced.
"""
import argparse
import math
import json
from pathlib import Path
import sys
from zipfile import ZipFile

from audit_native_3mf_metadata_object_refs import SETTINGS, _xml, inspect_metadata_refs
from verify_native_3mf_package import audit_native_package

MAX_PARTS_PER_BUILD = 64
MAX_METADATA_FIELDS_PER_PART = 128



MATRIX_COEFFICIENT_TOLERANCE = 1e-6


def _matrix_coefficient_status(before_values, after_values):
    """Compare pinned v2.5.0 row-major 4x4 matrix coefficients, not geometry.

    This is a diagnostic only: a numeric match cannot establish equivalent
    Core placements, Part identity, or native GUI project semantics.
    """
    if len(before_values) != 1 or len(after_values) != 1:
        return "not_comparable_missing_or_duplicate"

    def parse(raw):
        if len(raw) > 2048:
            return None
        words = raw.split()
        if len(words) != 16:
            return None
        try:
            values = tuple(float(word) for word in words)
        except (ValueError, OverflowError):
            return None
        return values if all(math.isfinite(value) for value in values) else None

    old, new = parse(before_values[0]), parse(after_values[0])
    if old is None or new is None:
        return "not_comparable_invalid_4x4"
    if old == new:
        return "numeric_coefficients_equal"
    if all(abs(a - b) <= MATRIX_COEFFICIENT_TOLERANCE for a, b in zip(old, new)):
        return "coefficient_delta_within_1e-6"
    return "coefficient_delta_exceeds_1e-6"


def _part_snapshot(path):
    audit_native_package(path)
    refs = inspect_metadata_refs(path)
    builds = refs["build_object_ids"]
    if len(builds) != 2 or refs["external_build_indices"]:
        raise ValueError("Expected exactly two local main build items")
    with ZipFile(path) as archive:
        root = _xml(archive.read(SETTINGS), SETTINGS)
    objects = {str(int(obj.get("id"))): obj for obj in root.findall("object")}
    out = []
    for root_id in builds:
        obj = objects.get(root_id)
        if obj is None:
            out.append(None)
            continue
        parts = obj.findall("part")
        if len(parts) > MAX_PARTS_PER_BUILD:
            raise ValueError("Too many native Part settings to audit")
        snapshot = []
        for part in parts:
            fields = {}
            for field in part.findall("metadata"):
                key, value = field.get("key"), field.get("value")
                if not key or len(key) > 128 or value is None:
                    raise ValueError("Unsupported Part metadata key/value")
                fields.setdefault(key, []).append(value)
                if sum(map(len, fields.values())) > MAX_METADATA_FIELDS_PER_PART:
                    raise ValueError("Too many native Part metadata attributes")
            snapshot.append({
                "id": part.get("id"),
                "subtype": part.get("subtype"),
                "fields": fields,
                "uninspected_child_nodes": sum(child.tag != "metadata" for child in part),
            })
        out.append({
            "parts": snapshot,
            "uninspected_object_nodes": sum(child.tag != "part" for child in obj),
        })
    return out


def compare_part_values(before_path, after_path):
    before = _part_snapshot(before_path)
    after = _part_snapshot(after_path)
    builds = []
    changes = 0
    labels = 0
    partial = False
    for build_index, (old, new) in enumerate(zip(before, after)):
        if old is None or new is None:
            changes += 1
            builds.append({
                "build_index": build_index,
                "missing_direct_settings_before": old is None,
                "missing_direct_settings_after": new is None,
            })
            continue
        count_changed = len(old["parts"]) != len(new["parts"])
        if count_changed:
            changes += 1
        partial |= bool(old["uninspected_object_nodes"] or new["uninspected_object_nodes"])
        part_rows = []
        for index, (a, b) in enumerate(zip(old["parts"], new["parts"])):
            removed = sorted(set(a["fields"]) - set(b["fields"]))
            added = sorted(set(b["fields"]) - set(a["fields"]))
            changed = sorted(
                key for key in set(a["fields"]) & set(b["fields"])
                if a["fields"][key] != b["fields"][key]
            )
            subtype_changed = a["subtype"] != b["subtype"]
            id_changed = a["id"] != b["id"]
            labels += int(id_changed)
            changes += int(bool(removed or added or changed or subtype_changed))
            partial |= bool(a["uninspected_child_nodes"] or b["uninspected_child_nodes"])
            part_rows.append({
                "part_index": index,
                "numeric_part_label_changed": id_changed,
                "subtype_changed": subtype_changed,
                "removed_metadata_keys": removed,
                "added_metadata_keys": added,
                "changed_metadata_value_keys": changed,
                "matrix_4x4_coefficient_diagnostic": (
                    _matrix_coefficient_status(
                        a["fields"].get("matrix", []),
                        b["fields"].get("matrix", []))
                    if "matrix" in changed else None
                ),
            })
        builds.append({
            "build_index": build_index,
            "previous_part_count": len(old["parts"]),
            "current_part_count": len(new["parts"]),
            "part_count_changed": count_changed,
            "part_comparisons": part_rows,
            "other_vendor_nodes_present": bool(
                old["uninspected_object_nodes"] or new["uninspected_object_nodes"] or
                any(p["uninspected_child_nodes"] for p in old["parts"] + new["parts"])
            ),
        })
    return {
        "source": "read-only native v2.5.0 Part metadata value comparison",
        "builds": builds,
        "observed_value_or_inventory_changes": changes,
        "changed_numeric_part_labels": labels,
        "has_uninspected_vendor_nodes": partial,
        "status": ("review_observed_part_metadata_drift" if changes else
                   "numeric_labels_changed_values_stable" if labels else
                   "no_observed_part_metadata_value_drift"),
        "complete_vendor_settings_parity_proven": False,
        "limitations": "Build/Part indices are positional comparison candidates; no "
                       "cross-export semantic identity or Part-to-mesh mapping is "
                       "proved. Direct Part metadata key/value and subtype only. "
                       "The optional matrix diagnostic compares 16 finite row-major "
                       "coefficients at absolute tolerance 1e-6 without revealing "
                       "values; it never proves equal world geometry or settings. "
                       "No object/plate settings, hidden vendor child nodes, UUID "
                       "interpretation, native/WASM G-code equality, or print safety "
                       "is assessed. Reports never include metadata values.",
    }


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--before", required=True, type=Path)
    cli.add_argument("--after", required=True, type=Path)
    cli.add_argument("--report", type=Path)
    cli.add_argument("--fail-on-observed-drift", action="store_true")
    args = cli.parse_args()
    try:
        result = compare_part_values(args.before, args.after)
        if args.fail_on_observed_drift and result["observed_value_or_inventory_changes"]:
            raise ValueError("Part metadata values or inventory changed")
        output = json.dumps(result, indent=2, sort_keys=True) + "\n"
        if args.report:
            args.report.write_text(output, encoding="utf-8")
        else:
            print(output, end="")
    except (ValueError, KeyError, OSError, RuntimeError) as exc:
        print("Native Part-value audit refused: " + str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
