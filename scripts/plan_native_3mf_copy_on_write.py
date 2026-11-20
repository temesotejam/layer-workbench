#!/usr/bin/env python3
"""Read-only clone-chain plan for ONE reachable native Core 3MF mesh occurrence.

A component-edge index (rather than just an object ID) selects an occurrence
even when the same child is instantiated twice. This tool NEVER mutates the
archive and NEVER authorizes editing opaque OrcaSlicer metadata.
"""
import argparse
import json
from pathlib import Path
import sys
from zipfile import ZipFile

from audit_native_3mf_edit_ownership import audit_edit_ownership
from inspect_native_3mf_hierarchy import inspect_native_hierarchy, referenced_part
from three_mf_instance_expansion import MAX_DEPTH
from verify_native_3mf_package import CORE_NS, MAIN_PART, safe_xml


def plan_copy_on_write(path, build_index, component_edges):
    """Return the minimal occurrence-specific Core clone chain, leaf first."""
    if type(build_index) is not int or build_index < 0:
        raise ValueError("Invalid build item index")
    if not isinstance(component_edges, (list, tuple)) or len(component_edges) >= MAX_DEPTH:
        raise ValueError("Invalid component-edge path")
    if any(type(edge) is not int or edge < 0 for edge in component_edges):
        raise ValueError("Component-edge indices must be nonnegative integers")

    ownership = audit_edit_ownership(path)  # validates all Core refs/geometry
    topology = inspect_native_hierarchy(path)
    visits = {(n["part"], n["objectid"]): n["total_visits"]
              for n in ownership["reachable_objects"]}
    objects = {}
    with ZipFile(path) as archive:
        for row in topology["parts"]:
            part = row["part"]
            root = safe_xml(archive.read(part), part)
            resources = root.find(CORE_NS + "resources")
            if resources is not None:
                for obj in resources.findall(CORE_NS + "object"):
                    objects[(part, obj.get("id"))] = obj
            if part == MAIN_PART:
                build = root.find(CORE_NS + "build")
                items = [] if build is None else build.findall(CORE_NS + "item")
    if build_index >= len(items):
        raise ValueError("Selected build item is absent")

    item = items[build_index]
    key = (referenced_part(item, MAIN_PART), item.get("objectid"))
    trail = [key]
    for edge_index in component_edges:
        parent = objects[trail[-1]]
        components = parent.find(CORE_NS + "components")
        if components is None:
            raise ValueError("Component path continues through a mesh")
        children = components.findall(CORE_NS + "component")
        if edge_index >= len(children):
            raise ValueError("Component-edge index is out of range")
        edge = children[edge_index]
        trail.append((referenced_part(edge, trail[-1][0]), edge.get("objectid")))

    leaf = objects[trail[-1]]
    if leaf.find(CORE_NS + "mesh") is None:
        raise ValueError("Selected occurrence is not a Core mesh leaf")

    steps = []
    # Clone from leaf to root: each cloned parent must reference the cloned
    # child, not accidentally retarget siblings or other build instances.
    for depth in range(len(trail) - 1, -1, -1):
        part, objid = trail[depth]
        if visits[(part, objid)] <= 1:
            continue
        if depth:
            parent_part, parent_id = trail[depth - 1]
            attach = {"kind": "component",
                      "parent_part": parent_part,
                      "parent_objectid": parent_id,
                      "edge_index": component_edges[depth - 1],
                      "parent_must_be_cloned": visits[trail[depth - 1]] > 1}
        else:
            attach = {"kind": "build_item", "build_index": build_index}
        steps.append({"part": part, "objectid": objid,
                      "total_visits": visits[(part, objid)],
                      "redirect_occurrence": attach})

    return {
        "source": "read-only Core occurrence-specific copy-on-write plan",
        "build_index": build_index,
        "component_edge_path": list(component_edges),
        "selected_mesh": {"part": trail[-1][0], "objectid": trail[-1][1]},
        "occurrence_chain": [
            {"part": part, "objectid": objid, "total_visits": visits[(part, objid)]}
            for part, objid in trail
        ],
        "copy_on_write_required": bool(steps),
        "clone_steps_inner_to_outer": steps,
        "limitations": (
            "This is a plan only: no object IDs allocated, XML/OPC rewritten, "
            "native metadata interpreted, or printer output validated. "
            "An editor must preserve unrelated build/component occurrences "
            "and independently verify the exported native geometry."
        ),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--build-index", type=int, required=True)
    parser.add_argument("--component-edges", type=str, default="0",
                        help="Comma-separated zero-based component indices; empty for a mesh root")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--require-copy", action="store_true")
    args = parser.parse_args()
    try:
        edges = [] if args.component_edges == "" else [
            int(value) for value in args.component_edges.split(",")]
        plan = plan_copy_on_write(args.input, args.build_index, edges)
        if args.require_copy and not plan["copy_on_write_required"]:
            raise ValueError("Expected shared occurrence requiring a clone")
        result = json.dumps(plan, indent=2, sort_keys=True) + "\n"
        if args.report:
            args.report.write_text(result, encoding="utf-8")
        else:
            print(result, end="")
    except (ValueError, OSError, RuntimeError, EOFError, KeyError) as exc:
        print("Native 3MF copy-on-write planner refused: " + str(exc), file=sys.stderr)
        return 2
    print("PASS: occurrence clone chain planned read-only; no 3MF was modified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
