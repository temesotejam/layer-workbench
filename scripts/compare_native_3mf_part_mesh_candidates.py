#!/usr/bin/env python3
"""Compare numeric vendor Part/Core leaf ID *candidates* across a bounded 3MF edit.

Read-only diagnostic, not a Part-to-volume mapping. Especially after Core
copy-on-write, a cloned root can lose a direct vendor object-settings entry,
or a leaf can acquire a different Core ID while the old Part label survives.
Neither observation proves actual native setting loss or printing safety.
"""
import argparse
import json
from pathlib import Path
import sys

from audit_native_3mf_part_mesh_context import audit_part_mesh_context

UNIQUE = "unique_numeric_core_id_candidate"


def compare_candidate_contexts(baseline, candidate):
    before = audit_part_mesh_context(baseline)
    after = audit_part_mesh_context(candidate)
    old_builds, new_builds = before["build_contexts"], after["build_contexts"]
    if not old_builds or len(old_builds) != len(new_builds):
        raise ValueError("Build item count changed; positional comparison unsupported")

    rows = []
    for prior, current in zip(old_builds, new_builds):
        if (prior["build_index"] != current["build_index"] or
                prior["core_mesh_occurrences"] != current["core_mesh_occurrences"]):
            raise ValueError("Core mesh occurrence count/order context changed")

        settings_gap = (prior["native_object_settings_present"] and
                        not current["native_object_settings_present"])
        # Never compare Part labels positionally when the object-settings entry
        # disappeared: report that distinct risk explicitly.
        lost_candidates = []
        part_inventory_changed = None
        if (prior["native_object_settings_present"] and
                current["native_object_settings_present"]):
            old_parts = prior["native_part_descriptors"]
            new_parts = current["native_part_descriptors"]
            part_inventory_changed = old_parts != new_parts
            for part_index, previous in enumerate(prior["part_core_id_candidates"]):
                if previous["status"] != UNIQUE:
                    continue
                updated = (current["part_core_id_candidates"][part_index]
                           if part_index < len(current["part_core_id_candidates"]) else None)
                if (updated is None or updated["vendor_part_id"] != previous["vendor_part_id"] or
                        updated["status"] != UNIQUE or
                        updated["core_mesh_occurrence_indices"] !=
                        previous["core_mesh_occurrence_indices"]):
                    lost_candidates.append({
                        "part_index": part_index,
                        "previous_part_id": previous["vendor_part_id"],
                        "prior_core_mesh_occurrence_indices":
                            previous["core_mesh_occurrence_indices"],
                        "current_numeric_candidate_status":
                            updated["status"] if updated else "part_missing",
                    })
        rows.append({
            "build_index": prior["build_index"],
            "core_root_changed": (prior["main_core_root_id"] !=
                                  current["main_core_root_id"]),
            "previous_core_root_id": prior["main_core_root_id"],
            "current_core_root_id": current["main_core_root_id"],
            "object_settings_entry_missing_after_edit": settings_gap,
            "vendor_part_descriptors_changed": part_inventory_changed,
            "lost_unique_numeric_part_id_candidates": lost_candidates,
            "previous_one_to_one_numeric_id_candidates":
                prior["one_to_one_numeric_id_candidates"],
            "current_one_to_one_numeric_id_candidates":
                current["one_to_one_numeric_id_candidates"],
        })

    gaps = sum(r["object_settings_entry_missing_after_edit"] for r in rows)
    lost = sum(len(r["lost_unique_numeric_part_id_candidates"]) for r in rows)
    changed = sum(r["vendor_part_descriptors_changed"] is True for r in rows)
    return {
        "source": "read-only before/after native 3MF Part/Core numeric candidate drift",
        "build_context_changes": rows,
        "new_direct_object_settings_gaps": gaps,
        "lost_unique_numeric_candidates": lost,
        "changed_vendor_part_inventories": changed,
        "status": ("review_numeric_or_settings_drift" if (gaps or lost or changed)
                   else "no_observed_numeric_candidate_drift"),
        "semantic_part_to_volume_identity_proven": False,
        "limitations": "Part/Core ID equality is numeric evidence only, not semantic "
                       "identity. A missing settings entry or lost numeric candidate "
                       "is a review signal, not proof of vendor settings loss. "
                       "Unchanged candidates do not prove Part/volume mapping, "
                       "Production UUID or transform parity, desktop GUI 3MF "
                       "compatibility, G-code equivalence or print safety.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--fail-on-observed-drift", action="store_true")
    args = parser.parse_args()
    try:
        result = compare_candidate_contexts(args.baseline, args.candidate)
        if args.fail_on_observed_drift and result["status"] != "no_observed_numeric_candidate_drift":
            raise ValueError("Native numeric Part/Core context drift needs manual review")
        content = json.dumps(result, indent=2, sort_keys=True) + "\n"
        if args.report:
            args.report.write_text(content, encoding="utf-8")
        else:
            print(content, end="")
    except (ValueError, KeyError, OSError, RuntimeError, EOFError) as exc:
        print("Native Part/Core drift comparison refused: " + str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
