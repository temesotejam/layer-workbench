#!/usr/bin/env python3
"""Narrow three-level Core 3MF copy-on-write for a shared root / middle / mesh.

Exactly two build items share ONE main-part root, which points to ONE main-part
middle component, which points to ONE external mesh. This experimental writer
never edits vertices, profile metadata or unrelated ZIP members. It rejects
other topologies rather than generalizing silently to GUI-authored projects.
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
    _require_clone_safe_annotations,
)
from clone_native_3mf_shared_root_chain import _clone_root_and_redirect_build
from compare_3mf_metadata import inventory
from plan_native_3mf_copy_on_write import plan_copy_on_write
from verify_native_3mf_package import CORE_NS, MAIN_PART, audit_native_package


def _clone_middle(raw, middle_id, old_child_id, new_child_id):
    """Clone a single-edge main-part component without altering its original."""
    root = _guard_xml(raw, "middle Core model")
    resources = root.find(CORE_NS + "resources")
    if resources is None:
        raise ValueError("Main Core resources absent")
    objects = resources.findall(CORE_NS + "object")
    ids = [obj.get("id") for obj in objects]
    if not ids or any(v is None or not v.isascii() or not v.isdecimal()
                      or not 1 <= int(v) <= MAX_CORE_ID for v in ids):
        raise ValueError("Unsupported main Core resource IDs")
    new_num = max(map(int, ids)) + 1
    if new_num > MAX_CORE_ID:
        raise ValueError("Main Core resource ID space exhausted")
    new_id = str(new_num)
    matches = [obj for obj in objects if obj.get("id") == middle_id]
    if len(matches) != 1:
        raise ValueError("Ambiguous middle Core component")
    _require_clone_safe_annotations(matches[0], "middle component")
    group = matches[0].find(CORE_NS + "components")
    children = [] if group is None else group.findall(CORE_NS + "component")
    if len(children) != 1 or children[0].get("objectid") != old_child_id:
        raise ValueError("Middle Core component must have one selected child")
    start, opening_end, end = _object_block(raw, middle_id)
    original = raw[start:end]
    clone = (_replace_attr_in_opening(
        raw[start:opening_end], "id", middle_id, new_id) + raw[opening_end:end])
    edges = list(COMPONENT_OPEN.finditer(clone))
    if len(edges) != 1:
        raise ValueError("Ambiguous raw middle component markup")
    edge = edges[0]
    edited = _replace_attr_in_opening(
        edge.group(), "objectid", old_child_id, new_child_id)
    clone = clone[:edge.start()] + edited + clone[edge.end():]
    endings = list(RESOURCES_END.finditer(raw))
    if len(endings) != 1 or end > endings[0].start():
        raise ValueError("Ambiguous middle Core insertion point")
    at = endings[0].start()
    result = raw[:at] + b"\n" + clone + b"\n" + raw[at:]
    checked = _guard_xml(result, "cloned middle Core model")
    found = checked.find(CORE_NS + "resources").findall(CORE_NS + "object")
    copies = [obj for obj in found if obj.get("id") == new_id]
    if len(found) != len(objects) + 1 or len(copies) != 1:
        raise ValueError("Middle Core copy count mismatch")
    edge_copies = copies[0].find(CORE_NS + "components").findall(CORE_NS + "component")
    if len(edge_copies) != 1 or edge_copies[0].get("objectid") != new_child_id:
        raise ValueError("Middle Core copy does not point to private child")
    old_start, _, old_end = _object_block(result, middle_id)
    if result[old_start:old_end] != original:
        raise ValueError("Original middle Core bytes changed")
    return result, new_id


def clone_three_level_chain(source, destination, build_index=1, edges=(0, 0)):
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve() or destination.exists():
        raise ValueError("Output must be a distinct, nonexistent path")
    if type(build_index) is not int or build_index != 1 or (
        not isinstance(edges, (list, tuple)) or len(edges) != 2 or
        any(type(edge) is not int or edge != 0 for edge in edges)
    ):
        raise ValueError("Only build item 1 and component edge path 0,0 are supported")

    audit_native_package(source)
    before = inspect_placements(source)
    if (before["build_items"] != 2 or len(before["mesh_instances"]) != 2 or
            [row["build_index"] for row in before["mesh_instances"]] != [0, 1]):
        raise ValueError("Exactly one Core mesh instance per build is required")
    plan = plan_copy_on_write(source, build_index, edges)
    steps = plan["clone_steps_inner_to_outer"]
    if (len(steps) != 3 or
            [step["part"] == MAIN_PART for step in steps] != [False, True, True] or
            any(step["total_visits"] != 2 for step in steps)):
        raise ValueError("Expected three shared levels: root, middle and external mesh")
    leaf, middle, root = steps
    leaf_id, middle_id, root_id = (
        leaf["objectid"], middle["objectid"], root["objectid"])
    if middle_id == root_id:
        raise ValueError("Middle and root Core object must be distinct")
    if (leaf["redirect_occurrence"] != {
            "kind": "component", "parent_part": MAIN_PART,
            "parent_objectid": middle_id, "edge_index": 0,
            "parent_must_be_cloned": True} or
            middle["redirect_occurrence"] != {
                "kind": "component", "parent_part": MAIN_PART,
                "parent_objectid": root_id, "edge_index": 0,
                "parent_must_be_cloned": True} or
            root["redirect_occurrence"] != {
                "kind": "build_item", "build_index": 1}):
        raise ValueError("Unsupported three-level Core reference graph")

    leaf_part = leaf["part"]
    with ZipFile(source) as original:
        leaf_raw, new_leaf_id = _clone_mesh_part(
            original.read(leaf_part), leaf_id)
        middle_raw, new_middle_id = _clone_middle(
            original.read(MAIN_PART), middle_id, leaf_id, new_leaf_id)
        main_raw, new_root_id = _clone_root_and_redirect_build(
            middle_raw, root_id, middle_id, new_middle_id)
        try:
            with ZipFile(destination, "x") as result:
                result.comment = original.comment
                for info in original.infolist():
                    payload = (leaf_raw if info.filename == leaf_part else
                               main_raw if info.filename == MAIN_PART else
                               original.read(info))
                    result.writestr(info, payload)
        except BaseException:
            destination.unlink(missing_ok=True)
            raise

    try:
        audit_native_package(destination)
        old, new = inventory(source), inventory(destination)
        if (set(old) != set(new) or
                {key for key in old if old[key] != new[key]} !=
                {MAIN_PART, leaf_part}):
            raise ValueError("Unexpected 3MF archive member changes")
        after = inspect_placements(destination)
        if (before["per_build_world_bounds_mm"] !=
                after["per_build_world_bounds_mm"] or
                len(after["mesh_instances"]) != 2):
            raise ValueError("Three-level clone changed geometry")
        for idx, (old_instance, new_instance) in enumerate(zip(
                before["mesh_instances"], after["mesh_instances"])):
            expected_id = leaf_id if idx == 0 else new_leaf_id
            for key in ("build_index", "mesh_part", "triangle_count",
                        "world_transform3mf", "world_bounds_mm"):
                if old_instance[key] != new_instance[key]:
                    raise ValueError("Original occurrence geometry or placement changed")
            if new_instance["mesh_objectid"] != expected_id:
                raise ValueError("Wrong Core mesh occurrence retargeted")
        if plan_copy_on_write(destination, 1, [0, 0])["copy_on_write_required"]:
            raise ValueError("Chosen three-level occurrence remains shared")
    except BaseException:
        destination.unlink(missing_ok=True)
        raise

    return {
        "source": "bounded three-level native Core copy-on-write",
        "private_build_index": 1,
        "original_chain": [root_id, middle_id, leaf_id],
        "private_chain": [new_root_id, new_middle_id, new_leaf_id],
        "changed_model_parts": [MAIN_PART, leaf_part],
        "geometry_unchanged": True,
        "opaque_zip_members_preserved": True,
        "limitations": "One mesh per build; no arbitrary GUI metadata, multi-edge DAG, G-code or printing parity."
    }


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--input", type=Path, required=True)
    cli.add_argument("--output", type=Path, required=True)
    cli.add_argument("--report", type=Path)
    args = cli.parse_args()
    try:
        summary = json.dumps(
            clone_three_level_chain(args.input, args.output),
            sort_keys=True, indent=2) + "\n"
        if args.report:
            args.report.write_text(summary, encoding="utf-8")
        else:
            print(summary, end="")
    except (ValueError, KeyError, OSError, RuntimeError, EOFError) as exc:
        print("Three-level Core 3MF copy-on-write refused: " + str(exc),
              file=sys.stderr)
        return 2
    print("PASS: three-level Core occurrence made private without geometry edits")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
