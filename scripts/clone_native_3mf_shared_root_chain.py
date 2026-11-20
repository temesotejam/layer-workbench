#!/usr/bin/env python3
"""Copy-on-write of a shared main Core root AND its shared external mesh leaf.

This deliberately narrow two-level writer supports a pinned native-CLI style
3MF with exactly two build items referring to one main Core root, one leaf
occurrence per build, and one cross-part component edge. It preserves all
untouched ZIP member payloads; it is NOT a general native/GUI 3MF editor.
"""
import argparse
import json
from pathlib import Path
import re
import sys
from zipfile import ZipFile

from audit_native_3mf_instance_placement import inspect_placements
from clone_native_3mf_shared_leaf import (
    MAX_CORE_ID, COMPONENT_OPEN, OBJECT_OPEN, RESOURCES_END,
    _attribute, _clone_mesh_part, _guard_xml, _object_block,
    _replace_attr_in_opening, _require_clone_safe_annotations,
    _renew_production_uuid,
)
from compare_3mf_metadata import inventory
from plan_native_3mf_copy_on_write import plan_copy_on_write
from verify_native_3mf_package import CORE_NS, MAIN_PART, audit_native_package

ITEM_OPEN = re.compile(rb'<(?:(?:[A-Za-z_][\w.-]*):)?item(?=\s)[^<>]*/>')


def _clone_root_and_redirect_build(raw, root_id, old_leaf_id, new_leaf_id,
                                   build_index=1, edge_index=0):
    root = _guard_xml(raw, "main Core model")
    resources = root.find(CORE_NS + "resources")
    build = root.find(CORE_NS + "build")
    if resources is None or build is None:
        raise ValueError("Main Core resources or build missing")
    objects = resources.findall(CORE_NS + "object")
    ids = [obj.get("id") for obj in objects]
    if not ids or any(value is None or not value.isascii() or not value.isdecimal()
                      or not 1 <= int(value) <= MAX_CORE_ID for value in ids):
        raise ValueError("Unsupported main Core object IDs")
    new_id_value = max(map(int, ids)) + 1
    if new_id_value > MAX_CORE_ID:
        raise ValueError("Main Core object ID space exhausted")
    new_id = str(new_id_value)
    old = [obj for obj in objects if obj.get("id") == root_id]
    if len(old) != 1:
        raise ValueError("Shared main Core root is ambiguous")
    _require_clone_safe_annotations(old[0], "shared root")
    components = old[0].find(CORE_NS + "components")
    children = [] if components is None else components.findall(CORE_NS + "component")
    if (len(children) != 1 or edge_index != 0 or
            children[0].get("objectid") != old_leaf_id):
        raise ValueError("Only one shared external component edge is supported")
    items = build.findall(CORE_NS + "item")
    if (len(items) != 2 or build_index != 1 or
            any(item.get("objectid") != root_id for item in items)):
        raise ValueError("Both build items must reference the same Core root")
    start, opening_end, end = _object_block(raw, root_id)
    original_block = raw[start:end]
    clone_opening = _replace_attr_in_opening(
        raw[start:opening_end], "id", root_id, new_id)
    clone_opening = _renew_production_uuid(clone_opening, old[0], raw)
    cloned_block = clone_opening + raw[opening_end:end]
    edges = list(COMPONENT_OPEN.finditer(cloned_block))
    if len(edges) != 1:
        raise ValueError("Ambiguous raw component markup in cloned root")
    edge = edges[0]
    changed_edge = _replace_attr_in_opening(
        edge.group(), "objectid", old_leaf_id, new_leaf_id)
    changed_edge = _renew_production_uuid(changed_edge, children[0], raw)
    cloned_block = (cloned_block[:edge.start()] + changed_edge +
                    cloned_block[edge.end():])
    endings = list(RESOURCES_END.finditer(raw))
    if len(endings) != 1 or not end <= endings[0].start():
        raise ValueError("Ambiguous main Core resources insertion point")
    insertion = endings[0].start()
    with_clone = raw[:insertion] + b"\n" + cloned_block + b"\n" + raw[insertion:]
    # The build items must be simple self-closing Core item tags. Do not
    # rewrite vendor metadata, extensions, or ambiguous XML representations.
    item_tags = list(ITEM_OPEN.finditer(with_clone))
    if len(item_tags) != len(items):
        raise ValueError("Unsupported or ambiguous main Core build item markup")
    target = item_tags[build_index]
    changed_item = _replace_attr_in_opening(
        target.group(), "objectid", root_id, new_id)
    result = (with_clone[:target.start()] + changed_item +
              with_clone[target.end():])
    checked = _guard_xml(result, "isolated main Core root")
    new_resources = checked.find(CORE_NS + "resources")
    new_objects = new_resources.findall(CORE_NS + "object")
    if len(new_objects) != len(objects) + 1:
        raise ValueError("Main Core clone count changed unexpectedly")
    root_copy = [obj for obj in new_objects if obj.get("id") == new_id]
    if len(root_copy) != 1:
        raise ValueError("Main Core clone ID is missing or duplicated")
    copied_children = root_copy[0].find(CORE_NS + "components").findall(
        CORE_NS + "component")
    if len(copied_children) != 1 or copied_children[0].get("objectid") != new_leaf_id:
        raise ValueError("Cloned root does not reference private leaf")
    resulting_items = checked.find(CORE_NS + "build").findall(CORE_NS + "item")
    if [item.get("objectid") for item in resulting_items] != [root_id, new_id]:
        raise ValueError("Build-item retarget did not isolate selected instance")
    original_start, _, original_end = _object_block(result, root_id)
    if result[original_start:original_end] != original_block:
        raise ValueError("Original shared root bytes changed")
    return result, new_id


def clone_shared_root_chain(source, destination, build_index=1, edge_index=0):
    """Clone exactly one shared root and its external leaf for build item 1."""
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve() or destination.exists():
        raise ValueError("Output must be a distinct, nonexistent path")
    if type(build_index) is not int or type(edge_index) is not int:
        raise ValueError("Core occurrence indices must be integers")
    if build_index != 1 or edge_index != 0:
        raise ValueError("Only build item 1, component edge 0 is supported")

    audit_native_package(source)
    before = inspect_placements(source)
    if (before["build_items"] != 2 or len(before["mesh_instances"]) != 2 or
            [row["build_index"] for row in before["mesh_instances"]] != [0, 1]):
        raise ValueError("Exactly one mesh instance in each of two builds is required")
    plan = plan_copy_on_write(source, build_index, [edge_index])
    steps = plan["clone_steps_inner_to_outer"]
    if (len(steps) != 2 or steps[0]["part"] == MAIN_PART or
            steps[1]["part"] != MAIN_PART or
            steps[0]["redirect_occurrence"]["kind"] != "component" or
            not steps[0]["redirect_occurrence"]["parent_must_be_cloned"] or
            steps[1]["redirect_occurrence"] !=
            {"kind": "build_item", "build_index": 1} or
            any(step["total_visits"] != 2 for step in steps)):
        raise ValueError("Exactly one shared main root and one external leaf are required")
    leaf_part, leaf_id = steps[0]["part"], steps[0]["objectid"]
    root_id = steps[1]["objectid"]
    if (steps[0]["redirect_occurrence"]["parent_objectid"] != root_id or
            steps[0]["redirect_occurrence"]["parent_part"] != MAIN_PART or
            steps[0]["redirect_occurrence"]["edge_index"] != 0):
        raise ValueError("Unsupported root-to-leaf reference path")

    with ZipFile(source) as original:
        leaf_raw, new_leaf_id = _clone_mesh_part(original.read(leaf_part), leaf_id)
        main_raw, new_root_id = _clone_root_and_redirect_build(
            original.read(MAIN_PART), root_id, leaf_id, new_leaf_id)
        try:
            with ZipFile(destination, "x") as output:
                output.comment = original.comment
                for info in original.infolist():
                    payload = (leaf_raw if info.filename == leaf_part else
                               main_raw if info.filename == MAIN_PART else
                               original.read(info))
                    output.writestr(info, payload)
        except BaseException:
            destination.unlink(missing_ok=True)
            raise

    try:
        audit_native_package(destination)
        previous, current = inventory(source), inventory(destination)
        if (set(previous) != set(current) or
                {key for key in previous if previous[key] != current[key]}
                != {MAIN_PART, leaf_part}):
            raise ValueError("Unexpected ZIP member changes after root copy-on-write")
        after = inspect_placements(destination)
        if (after["per_build_world_bounds_mm"] != before["per_build_world_bounds_mm"] or
                len(after["mesh_instances"]) != 2):
            raise ValueError("Root copy-on-write changed placement or geometry")
        for index, (old, new) in enumerate(zip(
                before["mesh_instances"], after["mesh_instances"])):
            expected_leaf = leaf_id if index == 0 else new_leaf_id
            if (old["build_index"] != new["build_index"] or
                    old["mesh_part"] != new["mesh_part"] or
                    new["mesh_objectid"] != expected_leaf or
                    old["triangle_count"] != new["triangle_count"] or
                    old["world_transform3mf"] != new["world_transform3mf"] or
                    old["world_bounds_mm"] != new["world_bounds_mm"]):
                raise ValueError("A sibling or instance changed during root isolation")
        if plan_copy_on_write(destination, build_index, [edge_index])["copy_on_write_required"]:
            raise ValueError("Selected instance remains shared after copy-on-write")
    except BaseException:
        destination.unlink(missing_ok=True)
        raise

    return {
        "source": "bounded two-level native Core copy-on-write",
        "build_index": build_index,
        "component_edge": edge_index,
        "original_root": {"part": MAIN_PART, "objectid": root_id},
        "cloned_root": {"part": MAIN_PART, "objectid": new_root_id},
        "original_leaf": {"part": leaf_part, "objectid": leaf_id},
        "cloned_leaf": {"part": leaf_part, "objectid": new_leaf_id},
        "changed_model_parts": [MAIN_PART, leaf_part],
        "geometry_unchanged": True,
        "opaque_zip_members_preserved": True,
        "limitations": ("Two single-edge shared roots only; no GUI metadata semantics, "
                        "general nested paths, slicing parity or print verification.")
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--build-index", type=int, default=1)
    parser.add_argument("--component-edge", type=int, default=0)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        report = clone_shared_root_chain(
            args.input, args.output, args.build_index, args.component_edge)
        output = json.dumps(report, sort_keys=True, indent=2) + "\n"
        if args.report:
            args.report.write_text(output, encoding="utf-8")
        else:
            print(output, end="")
    except (ValueError, KeyError, OSError, RuntimeError, EOFError) as exc:
        print("Native shared-root chain copy-on-write refused: " + str(exc),
              file=sys.stderr)
        return 2
    print("PASS: isolated shared main Core root and external leaf without geometry changes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
