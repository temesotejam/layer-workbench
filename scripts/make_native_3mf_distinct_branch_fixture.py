#!/usr/bin/env python3
"""Build a narrowly bounded DISTINCT-leaf branch from an official CLI 3MF.

A native v2.5.0 CLI two-object project is the authority for the second
external mesh reference. The separate source is an official-derived, shared
two-edge root whose edges initially reference one mesh. Only the second edge's
Core object ID and Production p:path are changed. Never publish this fixture
as a general GUI 3MF editor or use its G-code for printing.
"""
import argparse
from pathlib import Path
from zipfile import ZipFile

from audit_native_3mf_instance_placement import inspect_placements
from clone_native_3mf_shared_leaf import (
    COMPONENT_OPEN, _guard_xml, _object_block, _replace_attr_in_opening,
    _renew_production_uuid,
)
from compare_3mf_metadata import inventory
from inspect_native_3mf_hierarchy import PROD_PATH, referenced_part
from verify_native_3mf_package import CORE_NS, MAIN_PART, audit_native_package


def make_distinct_branch_fixture(official_path, shared_path, output_path):
    official_path, shared_path, output_path = (
        Path(official_path), Path(shared_path), Path(output_path))
    if (len({p.resolve() for p in (official_path, shared_path, output_path)}) != 3
            or output_path.exists()):
        raise ValueError("Inputs and nonexistent destination must be distinct")
    audit_native_package(official_path)
    audit_native_package(shared_path)
    with ZipFile(official_path) as official, ZipFile(shared_path) as shared:
        original = _guard_xml(official.read(MAIN_PART), "official project")
        candidate_bytes = shared.read(MAIN_PART)
        candidate = _guard_xml(candidate_bytes, "shared branching source")
        original_build = original.find(CORE_NS + "build")
        candidate_build = candidate.find(CORE_NS + "build")
        if original_build is None or candidate_build is None:
            raise ValueError("Core build is required")
        old_items = original_build.findall(CORE_NS + "item")
        new_items = candidate_build.findall(CORE_NS + "item")
        if len(old_items) != 2 or len(new_items) != 2:
            raise ValueError("Exactly two native build items are required")
        first_id, second_id = (item.get("objectid") for item in old_items)
        shared_id = new_items[0].get("objectid")
        if (not first_id or not second_id or first_id == second_id or
                shared_id != first_id or new_items[1].get("objectid") != shared_id):
            raise ValueError("Native roots must be independent; candidate root shared")
        old_resources = original.find(CORE_NS + "resources")
        new_resources = candidate.find(CORE_NS + "resources")
        if old_resources is None or new_resources is None:
            raise ValueError("Core resources are required")
        old_roots = [o for o in old_resources.findall(CORE_NS + "object")
                     if o.get("id") == second_id]
        new_roots = [o for o in new_resources.findall(CORE_NS + "object")
                     if o.get("id") == shared_id]
        if len(old_roots) != 1 or len(new_roots) != 1:
            raise ValueError("Ambiguous Core root")
        old_container = old_roots[0].find(CORE_NS + "components")
        new_container = new_roots[0].find(CORE_NS + "components")
        old_edges = [] if old_container is None else old_container.findall(CORE_NS + "component")
        new_edges = [] if new_container is None else new_container.findall(CORE_NS + "component")
        if len(old_edges) != 1 or len(new_edges) != 2:
            raise ValueError("Expected one original second edge and two candidate edges")
        first_part = referenced_part(new_edges[0], MAIN_PART)
        target_part = referenced_part(old_edges[0], MAIN_PART)
        if (first_part == MAIN_PART or target_part == MAIN_PART or
                referenced_part(new_edges[1], MAIN_PART) != first_part or
                new_edges[0].get("objectid") != new_edges[1].get("objectid")):
            raise ValueError("Expected two matching candidate external edges")
        target_id = old_edges[0].get("objectid")
        replacement_part = None
        if target_part == first_part:
            # Official v2.5.0 may reuse ONE mesh for two Core roots and
            # emit a second *empty* model part. In this case, manufacture a
            # new mesh PART in the existing, already-related empty member.
            # This is explicitly a synthetic test fixture, NOT an original
            # second native mesh or a GUI-save parity assertion.
            options = sorted(set(audit_native_package(official_path)["model_parts"])
                             - {MAIN_PART, first_part})
            if len(options) != 1:
                raise ValueError("No unique native empty model-part slot")
            target_part = options[0]
            if official.read(target_part) != shared.read(target_part):
                raise ValueError("Candidate changes native empty model slot")
            empty = _guard_xml(official.read(target_part), "native unused model part")
            empty_resources = empty.find(CORE_NS + "resources")
            empty_build = empty.find(CORE_NS + "build")
            if (empty_resources is None or len(empty_resources) or
                    (empty_build is not None and len(empty_build))):
                raise ValueError("Alternate model part is not empty; do not overwrite")
            first_raw = official.read(first_part)
            first_model = _guard_xml(first_raw, "native source mesh")
            first_resources = first_model.find(CORE_NS + "resources")
            objects = [] if first_resources is None else first_resources.findall(CORE_NS + "object")
            if (len(objects) != 1 or len(first_resources) != 1 or
                    objects[0].find(CORE_NS + "mesh") is None or
                    objects[0].find(CORE_NS + "components") is not None):
                raise ValueError("Native source is not one independent mesh")
            target_id = objects[0].get("id")
            if not target_id:
                raise ValueError("Native source mesh has no ID")
            # The native v2.5.0 CLI can collapse two different p:path
            # resources if they reuse the same numeric object ID. Give this
            # synthetic second model its own explicit Core ID as a diagnostic.
            if (not target_id.isascii() or not target_id.isdecimal() or
                    not 1 <= int(target_id) < 2147483647):
                raise ValueError("Source mesh ID cannot be safely distinguished")
            new_target_id = str(int(target_id) + 1)
            start_mesh, opening_end_mesh, _ = _object_block(first_raw, target_id)
            refreshed = _renew_production_uuid(
                first_raw[start_mesh:opening_end_mesh], objects[0], first_raw)
            refreshed = _replace_attr_in_opening(
                refreshed, "id", target_id, new_target_id)
            replacement_part = (first_raw[:start_mesh] + refreshed +
                                first_raw[opening_end_mesh:])
            target_id = new_target_id
            _guard_xml(replacement_part, "synthetic second external mesh")
        old_id = new_edges[1].get("objectid")
        old_path = new_edges[1].get(PROD_PATH)
        new_path = "/" + target_part
        if not all((target_id, old_id, old_path, new_path)):
            raise ValueError("Explicit Production p:path and Core object IDs required")
        start, _, end = _object_block(candidate_bytes, shared_id)
        block = candidate_bytes[start:end]
        raw_edges = list(COMPONENT_OPEN.finditer(block))
        if len(raw_edges) != 2:
            raise ValueError("Ambiguous raw Core edge count")
        selected = raw_edges[1]
        replaced = _replace_attr_in_opening(selected.group(), "objectid", old_id, target_id)
        replaced = _replace_attr_in_opening(replaced, "p:path", old_path, new_path)
        new_block = block[:selected.start()] + replaced + block[selected.end():]
        edited = candidate_bytes[:start] + new_block + candidate_bytes[end:]
        _guard_xml(edited, "distinct-leaf native fixture")
        try:
            with ZipFile(output_path, "x") as output:
                output.comment = shared.comment
                for info in shared.infolist():
                    payload = (edited if info.filename == MAIN_PART else
                               replacement_part if info.filename == target_part and
                               replacement_part is not None else shared.read(info))
                    output.writestr(info, payload)
        except BaseException:
            output_path.unlink(missing_ok=True)
            raise
    try:
        audit_native_package(output_path)
        a, b = inventory(shared_path), inventory(output_path)
        expected_changes = ({MAIN_PART, target_part} if replacement_part is not None
                            else {MAIN_PART})
        if set(a) != set(b) or {k for k in a if a[k] != b[k]} != expected_changes:
            raise ValueError("Unexpected 3MF members modified while constructing fixture")
        observed = inspect_placements(output_path)["mesh_instances"]
        if (len(observed) != 4 or
                [o["mesh_part"] for o in observed] !=
                [first_part, target_part, first_part, target_part] or
                any(o["triangle_count"] < 1 for o in observed)):
            raise ValueError("Distinct external-leaf instances are not preserved")
    except BaseException:
        output_path.unlink(missing_ok=True)
        raise
    return {"first_part": first_part, "second_part": target_part,
            "changed_members": sorted(expected_changes), "instances": 4,
            "synthetic_second_mesh": replacement_part is not None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--official", type=Path, required=True)
    parser.add_argument("--shared", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    make_distinct_branch_fixture(args.official, args.shared, args.output)
    print("PASS: distinct native external leaf edge constructed without opaque edits")


if __name__ == "__main__":
    main()
