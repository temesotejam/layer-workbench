#!/usr/bin/env python3
"""Read-only copy-on-write preflight for Core objects in a pinned native 3MF.

Count actual object *visits* from each build item (not just unique object IDs
or mesh-leaf path names). Repeated component edges and nested references can
instantiate the same object more than once. Editing that resource in place
would change every instance, so an instance-specific editor must first clone
and redirect the appropriate parent chain.

This deliberately does not edit a 3MF or certify opaque Orca metadata semantics.
"""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import sys
from zipfile import ZipFile

from audit_native_3mf_instance_placement import inspect_placements
from inspect_native_3mf_hierarchy import inspect_native_hierarchy, referenced_part
from three_mf_instance_expansion import MAX_DEPTH, MAX_INSTANCES
from verify_native_3mf_package import CORE_NS, MAIN_PART, safe_xml

# inspect_placements() already bounds actual leaf expansion; cap intermediate
# object visits independently to make this diagnostic fail closed as well.
MAX_OBJECT_VISITS = MAX_INSTANCES * MAX_DEPTH


def audit_edit_ownership(path):
    """Inventory reachable Core resources and their per-build instance counts."""
    placement = inspect_placements(path)  # validates refs, cycles, geometry and units
    topology = inspect_native_hierarchy(path)
    parts = [row["part"] for row in topology["parts"]]
    objects = {}
    with ZipFile(path) as archive:
        for part in parts:
            root = safe_xml(archive.read(part), part)
            resources = root.find(CORE_NS + "resources")
            if resources is not None:
                for obj in resources.findall(CORE_NS + "object"):
                    objects[(part, obj.get("id"))] = obj
            if part == MAIN_PART:
                build = root.find(CORE_NS + "build")
                items = [] if build is None else build.findall(CORE_NS + "item")

    counts = defaultdict(lambda: [0] * len(items))
    roots = []
    total_visits = 0
    for build_index, item in enumerate(items):
        key = (referenced_part(item, MAIN_PART), item.get("objectid"))
        roots.append(key)
        pending = [(key, ())]
        while pending:
            key, ancestors = pending.pop()
            if key in ancestors or len(ancestors) >= MAX_DEPTH:
                raise ValueError("Unsafe Core hierarchy depth or cycle")
            obj = objects.get(key)
            if obj is None:
                raise ValueError("Unresolved Core object during ownership audit")
            total_visits += 1
            if total_visits > MAX_OBJECT_VISITS:
                raise ValueError("Core ownership visit budget exceeded")
            counts[key][build_index] += 1
            components = obj.find(CORE_NS + "components")
            if components is not None:
                # Do NOT deduplicate identical edges. Two <component> elements
                # referencing one child are two placements even if object-ID
                # sequences are identical. This is why mesh-leaf paths alone
                # cannot safely decide copy-on-write requirements.
                for comp in reversed(components.findall(CORE_NS + "component")):
                    child = (referenced_part(comp, key[0]), comp.get("objectid"))
                    pending.append((child, (*ancestors, key)))

    nodes = []
    shared_meshes = []
    for (part, obj_id), visits in sorted(counts.items()):
        obj = objects[(part, obj_id)]
        kind = "mesh" if obj.find(CORE_NS + "mesh") is not None else "components"
        total = sum(visits)
        node = {
            "part": part, "objectid": obj_id, "kind": kind,
            "visits_by_build": visits, "total_visits": total,
            "shared_across_builds": sum(1 for v in visits if v) > 1,
            "repeated_within_build": any(v > 1 for v in visits),
            "requires_copy_on_write_for_one_instance": total > 1,
        }
        nodes.append(node)
        if kind == "mesh" and node["shared_across_builds"]:
            shared_meshes.append({"part": part, "objectid": obj_id})

    root_reports = []
    for index, (part, objid) in enumerate(roots):
        visits = counts[(part, objid)]
        root_reports.append({
            "build_index": index, "part": part, "objectid": objid,
            "root_used_by_one_build_instance_only": sum(visits) == 1,
        })
    return {
        "source": "bounded read-only Core copy-on-write preflight",
        "build_items": placement["build_items"],
        "mesh_instances": len(placement["mesh_instances"]),
        "build_roots": root_reports,
        "reachable_objects": nodes,
        "cross_build_shared_meshes": shared_meshes,
        "total_object_visits": total_visits,
        "limitations": (
            "Object visits reflect Core resources, not metadata ownership. "
            "A single visit is a necessary precondition only, not approval "
            "to edit vendor metadata, GUI 3MFs, or print G-code. "
            "No clone or rewrite is performed."
        ),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--require-shared-mesh", action="store_true")
    parser.add_argument("--require-independent-roots", action="store_true")
    args = parser.parse_args()
    try:
        result = audit_edit_ownership(args.input)
        if args.require_shared_mesh and not result["cross_build_shared_meshes"]:
            raise ValueError("Expected cross-build shared Core mesh is absent")
        if (args.require_independent_roots and
                not all(r["root_used_by_one_build_instance_only"]
                        for r in result["build_roots"])):
            raise ValueError("At least one main Core build root is shared")
        output = json.dumps(result, sort_keys=True, indent=2) + "\n"
        if args.report:
            args.report.write_text(output, encoding="utf-8")
        else:
            print(output, end="")
    except (ValueError, OSError, RuntimeError, EOFError) as exc:
        print("Native 3MF edit ownership preflight refused: " + str(exc), file=sys.stderr)
        return 2
    print("PASS: Core ownership inventoried; shared instances require copy-on-write")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
