#!/usr/bin/env python3
"""Read-only comparison of native Orca Part descriptors and Core mesh occurrences.

A matching count is only an observation, NEVER a Part-ID-to-mesh mapping.
This tool does not modify vendor metadata or authorize physical printing.
"""
import argparse
import json
from pathlib import Path
import sys

from audit_native_3mf_instance_placement import inspect_placements
from audit_native_3mf_metadata_object_refs import inspect_metadata_refs


# In the pinned v2.5.0 BBS exporter, <part id> is serialized from a
# volume resource ID. Numeric equality is useful evidence, but duplicate
# IDs across model parts and repeated instances make it non-unique. In
# contrast, source_object_id/source_volume_id are provenance indices and
# MUST NOT be used as Core object references.
MAX_CORE_ID = 2147483647


def _core_id(raw):
    if not isinstance(raw, str) or not raw or not raw.isascii() or not raw.isdecimal():
        return None
    number = int(raw)
    return str(number) if 1 <= number <= MAX_CORE_ID else None


def _part_core_id_candidates(parts, meshes):
    """Match by numeric label only; never infer a vendor metadata mapping."""
    mesh_indices = {}
    for i, mesh in enumerate(meshes):
        key = _core_id(mesh["mesh_objectid"])
        if key is not None:
            mesh_indices.setdefault(key, []).append(i)
    part_counts = {}
    for part in parts:
        key = _core_id(part["id"])
        if key is not None:
            part_counts[key] = part_counts.get(key, 0) + 1

    rows, unique_indices = [], []
    for part in parts:
        key = _core_id(part["id"])
        candidates = mesh_indices.get(key, []) if key is not None else []
        if key is None:
            status = "unsupported_part_id"
        elif part_counts[key] != 1:
            status = "duplicate_part_id"
        elif len(candidates) == 1:
            status = "unique_numeric_core_id_candidate"
            unique_indices.append(candidates[0])
        elif not candidates:
            status = "no_numeric_core_id_candidate"
        else:
            status = "ambiguous_repeated_core_id"
        rows.append({
            "vendor_part_id": part["id"],
            "status": status,
            "core_mesh_occurrence_indices": candidates,
        })
    complete = (bool(meshes) and len(parts) == len(meshes) and
                len(unique_indices) == len(meshes) and
                len(set(unique_indices)) == len(meshes))
    return rows, complete


def audit_part_mesh_context(path):
    metadata = inspect_metadata_refs(path)
    placement = inspect_placements(path)
    build_ids = metadata["build_object_ids"]
    if len(build_ids) != placement["build_items"]:
        raise ValueError("Inconsistent Core build item inventories")
    external = set(metadata["external_build_indices"])
    entries = []
    for index, root_id in enumerate(build_ids):
        mesh_rows = [item for item in placement["mesh_instances"]
                     if item["build_index"] == index]
        # Distinguish occurrences from unique mesh resources: two volume
        # instances can share the same external Core object resource.
        occurrences = len(mesh_rows)
        resource_count = len({(item["mesh_part"], item["mesh_objectid"])
                              for item in mesh_rows})
        has_settings = root_id in metadata["settings_object_ids"] and index not in external
        parts = metadata["settings_part_inventory"].get(root_id, []) if has_settings else []
        count_match = (len(parts) == occurrences) if has_settings else None
        id_candidates, complete_id_candidates = (
            _part_core_id_candidates(parts, mesh_rows) if has_settings
            else ([], None))
        entries.append({
            "build_index": index,
            "main_core_root_id": root_id,
            "external_build_reference": index in external,
            "core_mesh_occurrences": occurrences,
            "distinct_core_mesh_resources": resource_count,
            "native_object_settings_present": has_settings,
            "native_part_count": len(parts) if has_settings else None,
            "native_part_descriptors": parts if has_settings else [],
            "part_count_equals_core_mesh_occurrences": count_match,
            "part_core_id_candidates": id_candidates,
            "one_to_one_numeric_id_candidates": complete_id_candidates,
        })
    return {
        "source": "read-only native Part/Core mesh occurrence cardinality observation",
        "build_contexts": entries,
        "matching_count_builds": sum(row["part_count_equals_core_mesh_occurrences"] is True
                                     for row in entries),
        "one_to_one_numeric_id_candidate_builds": sum(
            row["one_to_one_numeric_id_candidates"] is True for row in entries),
        "mismatching_count_builds": sum(row["part_count_equals_core_mesh_occurrences"] is False
                                        for row in entries),
        "builds_without_direct_settings": sum(
            not row["native_object_settings_present"] for row in entries),
        "part_to_mesh_identity_proven": False,
        "limitations": "Numeric Part-ID/Core mesh-ID matches are candidate labels only; "
                       "different model parts can reuse IDs and components can repeat meshes. "
                       "source_object_id/source_volume_id are source provenance indices, "
                       "NOT Core object references. No vendor-to-volume semantic mapping, "
                       "UUID, settings inheritance, GUI/WASM parity or print safety proven.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        report = json.dumps(audit_part_mesh_context(args.input),
                            indent=2, sort_keys=True) + "\n"
        if args.report:
            args.report.write_text(report, encoding="utf-8")
        else:
            print(report, end="")
    except (ValueError, OSError, KeyError, RuntimeError) as exc:
        print("Native Part/mesh context audit refused: " + str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
