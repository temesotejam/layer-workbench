#!/usr/bin/env python3
"""Clone ONE shared external Core mesh, retarget ONE independent parent edge.

Narrow OrcaSlicer v2.5.0 CLI 3MF experiment, NOT a generic 3MF editor.
No mesh coordinates are changed; all unchanged ZIP member payloads are preserved
byte-for-byte. Raw XML surgery retains all existing namespace/vendor bytes.
"""
import argparse
import json
from pathlib import Path
import re
import sys
from zipfile import ZipFile

from compare_3mf_metadata import inventory
from audit_native_3mf_instance_placement import inspect_placements
from plan_native_3mf_copy_on_write import plan_copy_on_write
from verify_native_3mf_package import CORE_NS, MAIN_PART, audit_native_package, safe_xml

# Only ASCII XML tags and quoted decimal Core IDs for this first writer.
OBJECT_OPEN = re.compile(rb'<(?P<prefix>[A-Za-z_][\w.-]*:)?object(?=\s)[^<>]*>')
COMPONENT_OPEN = re.compile(rb'<(?P<prefix>[A-Za-z_][\w.-]*:)?component(?=\s)[^<>]*>')
RESOURCES_END = re.compile(rb'</(?:[A-Za-z_][\w.-]*:)?resources\s*>')
MAX_CORE_ID = 2147483647


def _attribute(tag, name):
    pattern = re.compile(rb'(?<![\w:.-])' + re.escape(name.encode("ascii")) +
                         rb'\s*=\s*(?P<quote>["\'])(?P<value>[^"\']+)(?P=quote)')
    matches = list(pattern.finditer(tag))
    if len(matches) != 1:
        raise ValueError("Missing or ambiguous Core attribute: " + name)
    return matches[0]


def _object_block(raw, object_id):
    matches = []
    for opening in OBJECT_OPEN.finditer(raw):
        try:
            attr = _attribute(opening.group(), "id")
        except ValueError:
            continue
        if attr.group("value").decode("ascii") != object_id:
            continue
        endtag = b'</' + (opening.group("prefix") or b'') + b'object>'
        end = raw.find(endtag, opening.end())
        if end == -1:
            raise ValueError("Unclosed Core object")
        matches.append((opening.start(), opening.end(), end + len(endtag)))
    if len(matches) != 1:
        raise ValueError("Missing or ambiguous Core object in raw model XML")
    return matches[0]


def _replace_attr_in_opening(tag, name, old, new):
    attr = _attribute(tag, name)
    if attr.group("value").decode("ascii") != old:
        raise ValueError("Selected Core reference changed during XML surgery")
    return tag[:attr.start("value")] + new.encode("ascii") + tag[attr.end("value"):]


def _guard_xml(raw, name):
    # Comments/CDATA/processing instructions can contain faux XML tags.
    # Reject those forms rather than attempting regex edits on opaque markup.
    if b'<!--' in raw or b'<![CDATA[' in raw or b'<?' in raw.replace(b'<?xml ', b'', 1):
        raise ValueError("Unsupported comment, CDATA or processing instruction in " + name)
    return safe_xml(raw, name)



# Cloning a resource with an opaque per-object ID/annotation would copy that
# identity verbatim. Geometry equality cannot certify reference integrity.
# Fail closed until each extension's remapping rules are implemented.
_CLONE_IDENTITY_KEYS = {
    "uuid", "guid", "uniqueid", "instanceid", "objectuuid",
    "objectguid", "refuuid", "idref",
}


def _require_clone_safe_annotations(obj, location):
    """Reject opaque per-object metadata and identity-bearing clone fields.

    Keep known Core mesh/component geometry and Production p:path attributes;
    this is not a validator for Metadata/*.config cross references.
    """
    for elem in obj.iter():
        tag = elem.tag
        if not isinstance(tag, str) or not tag.startswith(CORE_NS):
            raise ValueError("Opaque extension element in cloned Core " + location)
        if tag == CORE_NS + "metadata":
            raise ValueError("Unsupported per-object metadata in cloned Core " + location)
        for key in elem.attrib:
            local = key.rsplit("}", 1)[-1].replace("_", "").lower()
            if local in _CLONE_IDENTITY_KEYS:
                raise ValueError("Identity attribute in cloned Core " + location)

def _clone_mesh_part(raw, original_id):
    root = _guard_xml(raw, "external Core model")
    resources = root.find(CORE_NS + "resources")
    if resources is None:
        raise ValueError("External model has no Core resources")
    objects = resources.findall(CORE_NS + "object")
    ids = [obj.get("id") for obj in objects]
    if not ids or any(id_ is None or not id_.isascii() or not id_.isdecimal()
                      or int(id_) < 1 or int(id_) > MAX_CORE_ID for id_ in ids):
        raise ValueError("Unsupported external Core object IDs")
    source = [obj for obj in objects if obj.get("id") == original_id]
    if len(source) != 1 or source[0].find(CORE_NS + "mesh") is None:
        raise ValueError("Selected external object is not a single Core mesh")
    _require_clone_safe_annotations(source[0], "external mesh")
    new_id_int = max(map(int, ids)) + 1
    if new_id_int > MAX_CORE_ID:
        raise ValueError("Core ID space exhausted")
    new_id = str(new_id_int)
    start, opening_end, end = _object_block(raw, original_id)
    clone = (_replace_attr_in_opening(raw[start:opening_end], "id", original_id, new_id)
             + raw[opening_end:end])
    endings = list(RESOURCES_END.finditer(raw))
    if len(endings) != 1:
        raise ValueError("Ambiguous external resources insertion point")
    insertion = endings[0].start()
    if not start < insertion or end > insertion:
        raise ValueError("Selected mesh lies outside resources")
    new_raw = raw[:insertion] + b'\n' + clone + b'\n' + raw[insertion:]
    parsed = _guard_xml(new_raw, "cloned external Core model")
    cloned = parsed.find(CORE_NS + "resources").findall(CORE_NS + "object")
    if len(cloned) != len(objects) + 1 or sum(o.get("id") == new_id for o in cloned) != 1:
        raise ValueError("External Core clone validation failed")
    return new_raw, new_id


def _retarget_parent(raw, parent_id, edge_index, old_leaf_id, new_leaf_id):
    root = _guard_xml(raw, "main Core model")
    resources = root.find(CORE_NS + "resources")
    if resources is None:
        raise ValueError("Missing main Core resources")
    parents = [obj for obj in resources.findall(CORE_NS + "object")
               if obj.get("id") == parent_id]
    if len(parents) != 1:
        raise ValueError("Ambiguous main Core parent")
    container = parents[0].find(CORE_NS + "components")
    children = [] if container is None else container.findall(CORE_NS + "component")
    if not 0 <= edge_index < len(children) or children[edge_index].get("objectid") != old_leaf_id:
        raise ValueError("Selected component edge does not match original mesh")
    start, _, end = _object_block(raw, parent_id)
    block = raw[start:end]
    edges = list(COMPONENT_OPEN.finditer(block))
    if len(edges) != len(children):
        raise ValueError("Raw component count differs from parsed Core graph")
    edge = edges[edge_index]
    changed = _replace_attr_in_opening(edge.group(), "objectid", old_leaf_id, new_leaf_id)
    block = block[:edge.start()] + changed + block[edge.end():]
    result = raw[:start] + block + raw[end:]
    checked = _guard_xml(result, "redirected main Core model")
    parent = next(obj for obj in checked.find(CORE_NS + "resources").findall(CORE_NS + "object")
                  if obj.get("id") == parent_id)
    new_edges = parent.find(CORE_NS + "components").findall(CORE_NS + "component")
    if new_edges[edge_index].get("objectid") != new_leaf_id:
        raise ValueError("Core edge redirect did not survive XML parsing")
    return result


def clone_shared_leaf(source, destination, build_index=1, edge_index=0):
    """Make one shared Core leaf private, without changing any mesh geometry."""
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve() or destination.exists():
        raise ValueError("Output must be a distinct, nonexistent path")
    if type(build_index) is not int or type(edge_index) is not int:
        raise ValueError("Core occurrence indices must be integers")
    plan = plan_copy_on_write(source, build_index, [edge_index])
    steps = plan["clone_steps_inner_to_outer"]
    if len(steps) != 1 or steps[0]["part"] == MAIN_PART:
        raise ValueError("Only one shared external mesh with an independent root is supported")
    redirect = steps[0]["redirect_occurrence"]
    if (redirect["kind"] != "component" or redirect["parent_part"] != MAIN_PART
            or redirect["parent_must_be_cloned"] or redirect["edge_index"] != edge_index):
        raise ValueError("Unsupported component ownership: nested clone chain required")
    before = inspect_placements(source)
    if (before["build_items"] != 2 or len(before["mesh_instances"]) != 2 or
            any(sum(i["build_index"] == n for i in before["mesh_instances"]) != 1
                for n in (0, 1))):
        raise ValueError("First writer supports only one mesh instance per two build items")

    leaf_part, leaf_id = steps[0]["part"], steps[0]["objectid"]
    with ZipFile(source) as original:
        new_leaf_raw, new_leaf_id = _clone_mesh_part(original.read(leaf_part), leaf_id)
        new_main_raw = _retarget_parent(
            original.read(MAIN_PART), redirect["parent_objectid"],
            edge_index, leaf_id, new_leaf_id)
        try:
            with ZipFile(destination, "x") as edited:
                edited.comment = original.comment
                for info in original.infolist():
                    payload = (new_main_raw if info.filename == MAIN_PART else
                               new_leaf_raw if info.filename == leaf_part else original.read(info))
                    edited.writestr(info, payload)
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
    try:
        audit_native_package(destination)
        before_members, after_members = inventory(source), inventory(destination)
        if set(before_members) != set(after_members):
            raise ValueError("Archive member set changed")
        changed = {n for n in before_members if before_members[n] != after_members[n]}
        if changed != {MAIN_PART, leaf_part}:
            raise ValueError("Unexpected changes to model or opaque ZIP members")
        after = inspect_placements(destination)
        if len(after["mesh_instances"]) != len(before["mesh_instances"]):
            raise ValueError("Core mesh occurrence count changed")
        for old, new in zip(before["mesh_instances"], after["mesh_instances"]):
            expected_id = new_leaf_id if old["build_index"] == build_index else old["mesh_objectid"]
            if (old["build_index"] != new["build_index"] or
                    old["mesh_part"] != new["mesh_part"] or
                    new["mesh_objectid"] != expected_id or
                    old["world_transform3mf"] != new["world_transform3mf"] or
                    old["world_bounds_mm"] != new["world_bounds_mm"] or
                    old["triangle_count"] != new["triangle_count"]):
                raise ValueError("Unintended Core instance change after clone")
        if after["per_build_world_bounds_mm"] != before["per_build_world_bounds_mm"]:
            raise ValueError("Shared-mesh clone changed build geometry")
        if plan_copy_on_write(destination, build_index, [edge_index])["copy_on_write_required"]:
            raise ValueError("Cloned occurrence still shares a Core resource")
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return {"source": "bounded native Core leaf-only copy-on-write experiment",
            "build_index": build_index, "component_edge": edge_index,
            "source_mesh": {"part": leaf_part, "objectid": leaf_id},
            "cloned_mesh": {"part": leaf_part, "objectid": new_leaf_id},
            "changed_model_parts": [MAIN_PART, leaf_part],
            "opaque_zip_members_preserved": True,
            "geometry_unchanged": True,
            "limitations": "No mesh edits, native metadata semantics, GUI 3MF, G-code parity or print safety certified."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--build-index", type=int, default=1)
    parser.add_argument("--component-edge", type=int, default=0)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        result = clone_shared_leaf(args.input, args.output, args.build_index, args.component_edge)
        report = json.dumps(result, sort_keys=True, indent=2) + "\n"
        if args.report:
            args.report.write_text(report, encoding="utf-8")
        else:
            print(report, end="")
    except (ValueError, KeyError, OSError, RuntimeError, EOFError) as exc:
        print("Native Core leaf clone refused: " + str(exc), file=sys.stderr)
        return 2
    print("PASS: one shared Core leaf cloned and retargeted; no geometry changed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
