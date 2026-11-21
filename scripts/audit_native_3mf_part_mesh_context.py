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
        })
    return {
        "source": "read-only native Part/Core mesh occurrence cardinality observation",
        "build_contexts": entries,
        "matching_count_builds": sum(row["part_count_equals_core_mesh_occurrences"] is True
                                     for row in entries),
        "mismatching_count_builds": sum(row["part_count_equals_core_mesh_occurrences"] is False
                                        for row in entries),
        "builds_without_direct_settings": sum(
            not row["native_object_settings_present"] for row in entries),
        "part_to_mesh_identity_proven": False,
        "limitations": "The count of vendor <part> records is not a mapping to Core "
                       "mesh resources, volume IDs, UUIDs, or instance settings. "
                       "Even equal counts do not establish ordered correspondence. "
                       "No GUI 3MF, G-code/WASM or printer-safety parity.",
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
