#!/usr/bin/env python3
"""Bounded two-edge shared-root Core 3MF copy-on-write experiment.

Two build items must share the same main Core root with exactly two external
mesh component edges (the same mesh or two different meshes). Only one edge
in build item 1 is detached. The other edge in that build and BOTH edges in build item 0 retain
the original mesh. This is an offline native-CLI fixture helper, not a generic
3MF editor or a browser feature.
"""
import argparse
import json
from pathlib import Path
import sys
from zipfile import ZipFile

from audit_native_3mf_instance_placement import inspect_placements
from clone_native_3mf_shared_leaf import (
    COMPONENT_OPEN, MAX_CORE_ID, RESOURCES_END, _clone_mesh_part,
    _guard_xml, _object_block, _replace_attr_in_opening,
    _require_clone_safe_annotations, _renew_production_uuid,
)
from clone_native_3mf_shared_root_chain import ITEM_OPEN
from compare_3mf_metadata import inventory
from inspect_native_3mf_hierarchy import referenced_part
from plan_native_3mf_copy_on_write import plan_copy_on_write
from verify_native_3mf_package import CORE_NS, MAIN_PART, audit_native_package


def _clone_branched_root(raw, root_id, old_leaf_id, new_leaf_id,
                         leaf_part, edge_index):
    model = _guard_xml(raw, "branched main Core model")
    resources = model.find(CORE_NS + "resources")
    build = model.find(CORE_NS + "build")
    if resources is None or build is None:
        raise ValueError("Missing Core resources or build")
    objects = resources.findall(CORE_NS + "object")
    ids = [obj.get("id") for obj in objects]
    if not ids or any(v is None or not v.isascii() or not v.isdecimal()
                      or not 1 <= int(v) <= MAX_CORE_ID for v in ids):
        raise ValueError("Unsupported Core object IDs")
    if len(set(ids)) != len(ids) or max(map(int, ids)) >= MAX_CORE_ID:
        raise ValueError("Duplicate or exhausted Core object IDs")
    new_root_id = str(max(map(int, ids)) + 1)
    roots = [obj for obj in objects if obj.get("id") == root_id]
    if len(roots) != 1:
        raise ValueError("Ambiguous shared root")
    original_root = roots[0]
    _require_clone_safe_annotations(original_root, "branched root")
    container = original_root.find(CORE_NS + "components")
    children = [] if container is None else container.findall(CORE_NS + "component")
    if (len(children) != 2 or
            children[edge_index].get("objectid") != old_leaf_id or
            referenced_part(children[edge_index], MAIN_PART) != leaf_part):
        raise ValueError("Selected external mesh edge is absent or ambiguous")
    items = build.findall(CORE_NS + "item")
    if len(items) != 2 or any(item.get("objectid") != root_id for item in items):
        raise ValueError("Expected two build items sharing one root")

    start, opening_end, end = _object_block(raw, root_id)
    original = raw[start:end]
    opening = _replace_attr_in_opening(
        raw[start:opening_end], "id", root_id, new_root_id)
    opening = _renew_production_uuid(opening, original_root, raw)
    cloned = opening + raw[opening_end:end]
    edges = list(COMPONENT_OPEN.finditer(cloned))
    if len(edges) != 2:
        raise ValueError("Ambiguous raw branched component markup")
    # Both component occurrences acquire a new Production UUID, even the
    # copied sibling whose objectid remains unchanged.
    for i in reversed(range(2)):
        edge = edges[i]
        edited = edge.group()
        if i == edge_index:
            edited = _replace_attr_in_opening(
                edited, "objectid", old_leaf_id, new_leaf_id)
        edited = _renew_production_uuid(edited, children[i], raw)
        cloned = cloned[:edge.start()] + edited + cloned[edge.end():]

    endings = list(RESOURCES_END.finditer(raw))
    if len(endings) != 1 or not end <= endings[0].start():
        raise ValueError("Ambiguous resources insertion point")
    at = endings[0].start()
    inserted = raw[:at] + b"\n" + cloned + b"\n" + raw[at:]
    item_tags = list(ITEM_OPEN.finditer(inserted))
    if len(item_tags) != 2:
        raise ValueError("Ambiguous self-closing Core build items")
    tag = item_tags[1]
    updated = _replace_attr_in_opening(
        tag.group(), "objectid", root_id, new_root_id)
    result = inserted[:tag.start()] + updated + inserted[tag.end():]

    checked = _guard_xml(result, "private branched Core model")
    new_objects = checked.find(CORE_NS + "resources").findall(CORE_NS + "object")
    if len(new_objects) != len(objects) + 1:
        raise ValueError("Unexpected Core resource count")
    matches = [obj for obj in new_objects if obj.get("id") == new_root_id]
    if len(matches) != 1:
        raise ValueError("Private branched root not found")
    private_children = matches[0].find(CORE_NS + "components").findall(
        CORE_NS + "component")
    expected = [child.get("objectid") for child in children]
    expected[edge_index] = new_leaf_id
    if [child.get("objectid") for child in private_children] != expected:
        raise ValueError("Private branch retarget mismatch")
    if [item.get("objectid") for item in checked.find(
            CORE_NS + "build").findall(CORE_NS + "item")] != [root_id, new_root_id]:
        raise ValueError("Only the second build item may be retargeted")
    old_start, _, old_end = _object_block(result, root_id)
    if result[old_start:old_end] != original:
        raise ValueError("Original root bytes changed")
    return result, new_root_id


def clone_branched_root(source, destination, build_index=1, edge_index=0):
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve() or destination.exists():
        raise ValueError("Output must be a distinct, nonexistent path")
    if (type(build_index) is not int or build_index != 1 or
            type(edge_index) is not int or edge_index not in (0, 1)):
        raise ValueError("Only build item 1 and branch edge 0 or 1 are supported")
    audit_native_package(source)
    before = inspect_placements(source)
    if (before["build_items"] != 2 or len(before["mesh_instances"]) != 4 or
            [row["build_index"] for row in before["mesh_instances"]]
            != [0, 0, 1, 1]):
        raise ValueError("Expected two component meshes in each of two builds")
    plan = plan_copy_on_write(source, build_index, [edge_index])
    steps = plan["clone_steps_inner_to_outer"]
    if (len(steps) != 2 or steps[0]["part"] == MAIN_PART or
            steps[1]["part"] != MAIN_PART or
            steps[0]["total_visits"] not in (2, 4) or
            steps[1]["total_visits"] != 2 or
            steps[0]["redirect_occurrence"] != {
                "kind": "component", "parent_part": MAIN_PART,
                "parent_objectid": steps[1]["objectid"],
                "edge_index": edge_index, "parent_must_be_cloned": True} or
            steps[1]["redirect_occurrence"] != {
                "kind": "build_item", "build_index": 1}):
        raise ValueError("Unsupported branching Core ownership graph")
    leaf_part, leaf_id = steps[0]["part"], steps[0]["objectid"]
    root_id = steps[1]["objectid"]

    with ZipFile(source) as original:
        leaf_raw, new_leaf_id = _clone_mesh_part(original.read(leaf_part), leaf_id)
        main_raw, new_root_id = _clone_branched_root(
            original.read(MAIN_PART), root_id, leaf_id, new_leaf_id,
            leaf_part, edge_index)
        try:
            with ZipFile(destination, "x") as output:
                output.comment = original.comment
                for info in original.infolist():
                    payload = (main_raw if info.filename == MAIN_PART else
                               leaf_raw if info.filename == leaf_part else
                               original.read(info))
                    output.writestr(info, payload)
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
    try:
        audit_native_package(destination)
        old, new = inventory(source), inventory(destination)
        if (set(old) != set(new) or
                {name for name in old if old[name] != new[name]}
                != {MAIN_PART, leaf_part}):
            raise ValueError("Unexpected changed 3MF ZIP members")
        after = inspect_placements(destination)
        if (before["per_build_world_bounds_mm"] !=
                after["per_build_world_bounds_mm"] or
                len(after["mesh_instances"]) != 4):
            raise ValueError("Branch detachment changed world geometry")
        for idx, (prior, current) in enumerate(zip(
                before["mesh_instances"], after["mesh_instances"])):
            expected_leaf = (new_leaf_id if idx == 2 + edge_index else
                             prior["mesh_objectid"])
            for field in ("build_index", "mesh_part", "triangle_count",
                          "world_transform3mf", "world_bounds_mm"):
                if prior[field] != current[field]:
                    raise ValueError("Sibling branch geometry changed")
            if current["mesh_objectid"] != expected_leaf:
                raise ValueError("Wrong leaf occurrence detached")
        if plan_copy_on_write(destination, 1, [edge_index])[
                "copy_on_write_required"]:
            raise ValueError("Selected branch remains shared")
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return {
        "source": "bounded two-edge Core shared-root copy-on-write",
        "selected_build_index": 1,
        "selected_edge_index": edge_index,
        "original_root_id": root_id,
        "private_root_id": new_root_id,
        "original_leaf_id": leaf_id,
        "private_leaf_id": new_leaf_id,
        "changed_model_parts": [MAIN_PART, leaf_part],
        "geometry_unchanged": True,
        "limitations": "One shared root with two external mesh edges (identical or distinct); no GUI 3MF, metadata-semantic, native CLI, G-code or print parity."
    }


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--input", type=Path, required=True)
    cli.add_argument("--output", type=Path, required=True)
    cli.add_argument("--edge-index", type=int, choices=[0, 1], default=0)
    cli.add_argument("--report", type=Path)
    args = cli.parse_args()
    try:
        report = clone_branched_root(args.input, args.output, edge_index=args.edge_index)
        output = json.dumps(report, sort_keys=True, indent=2) + "\n"
        if args.report:
            args.report.write_text(output, encoding="utf-8")
        else:
            print(output, end="")
    except (ValueError, KeyError, OSError, RuntimeError, EOFError) as exc:
        print("Branched native Core copy-on-write refused: " + str(exc),
              file=sys.stderr)
        return 2
    print("PASS: selected Core branch detached without changing geometry")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
