#!/usr/bin/env python3
"""Experimental, fail-closed Part-settings copy for ONE Core shared-root COW.

Only a source-mapped two-build, two-distinct-mesh case with a single changed
leaf ID and a bounded known metadata vocabulary is accepted. This is NOT a
general vendor 3MF editor, a GUI round-trip, or printable profile validation.
Original and Core-only candidate are never modified; output is a new archive.
"""
import argparse
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile

from audit_native_3mf_part_mesh_context import audit_part_mesh_context
from audit_native_3mf_metadata_object_refs import inspect_metadata_refs, _xml, SETTINGS
from audit_native_3mf_instance_placement import inspect_placements
from compare_3mf_metadata import inventory
from verify_native_3mf_package import audit_native_package

# Only names whose fields are known not to be arbitrary Core/UUID references.
# source_object_id / source_volume_id are source provenance indices (NOT
# Core object/volume IDs), so they must stay untouched in this experiment.
SAFE_KEYS = frozenset({
    "name", "matrix", "source_object_id", "source_volume_id",
    "source_offset_x", "source_offset_y", "source_offset_z",
})
OPEN_OBJECT = re.compile(rb'<object(?=\s)[^<>]*>')
OPEN_PART = re.compile(rb'<part(?=\s)[^<>]*>')
END_CONFIG = re.compile(rb'</config\s*>\s*\Z')
ID_ATTR = re.compile(rb'(?<![\w:.-])id\s*=\s*(?P<q>["\'])(?P<id>[0-9]+)(?P=q)')


def _id_from_tag(tag):
    matches = list(ID_ATTR.finditer(tag))
    if len(matches) != 1:
        raise ValueError("Ambiguous native object/Part id attribute")
    return str(int(matches[0].group("id")))


def _change_id(tag, before, after):
    matches = list(ID_ATTR.finditer(tag))
    if len(matches) != 1 or _id_from_tag(tag) != before:
        raise ValueError("Native object/Part id mismatch during byte edit")
    m = matches[0]
    return tag[:m.start("id")] + after.encode("ascii") + tag[m.end("id"):]


def _checked_source_settings(raw, old_id, part_ids):
    if (b'<!--' in raw or b'<![CDATA[' in raw or
            b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper() or
            b'<?' in raw):
        raise ValueError("Nontrivial XML markup is unsupported in native settings")
    tree = _xml(raw, SETTINGS)
    if tree.tag != "config" or not END_CONFIG.search(raw):
        raise ValueError("Unexpected native config document")
    objects = tree.findall("object")
    found = [obj for obj in objects if obj.get("id") == old_id]
    if len(found) != 1 or any(child.tag not in ("object",) for child in tree):
        raise ValueError("Noncanonical native settings root")
    obj = found[0]
    if set(obj.attrib) != {"id"}:
        raise ValueError("Unknown object-level attributes require vendor mapping")
    parts = obj.findall("part")
    if len(parts) != len(part_ids) or not parts:
        raise ValueError("Part inventory does not match one-to-one mesh mapping")
    for i, part in enumerate(parts):
        if (set(part.attrib) != {"id", "subtype"} or
                part.get("id") != part_ids[i] or
                part.get("subtype") != "normal_part"):
            raise ValueError("Unsupported Part identity or subtype")
    for node in obj.iter():
        if node is obj:
            continue
        if node.tag not in ("part", "metadata"):
            raise ValueError("Unknown nested settings element")
        if node.tag == "metadata":
            if set(node.attrib) != {"key", "value"} or node.get("key") not in SAFE_KEYS:
                raise ValueError("Unknown vendor metadata key; refusing to copy")
            if list(node) or (node.text and node.text.strip()):
                raise ValueError("Nonempty vendor metadata body")
        if node.tag == "part" and any(child.tag != "metadata" for child in node):
            raise ValueError("Unknown Part child")
    matches = [(m, _id_from_tag(m.group())) for m in OPEN_OBJECT.finditer(raw)]
    matches = [m for m, ident in matches if ident == old_id]
    if len(matches) != 1:
        raise ValueError("Ambiguous source object XML boundaries")
    start = matches[0].start()
    end = raw.find(b'</object>', matches[0].end())
    if end < 0:
        raise ValueError("Missing source object close tag")
    block = raw[start:end + len(b'</object>')]
    if block.count(b'<object') != 1 or block.count(b'</object>') != 1:
        raise ValueError("Nested or ambiguous native object")
    tags = list(OPEN_PART.finditer(block))
    if len(tags) != len(part_ids) or any(
            _id_from_tag(tag.group()) != part_ids[i] for i, tag in enumerate(tags)):
        raise ValueError("Part markup and parsed Part order disagree")
    return block


def copy_bounded_root_settings(source, candidate, output):
    source, candidate, output = map(Path, (source, candidate, output))
    if len({p.resolve() for p in (source, candidate, output)}) != 3 or output.exists():
        raise ValueError("Inputs and nonexistent output must be distinct")
    audit_native_package(source)
    audit_native_package(candidate)
    before, after = audit_part_mesh_context(source), audit_part_mesh_context(candidate)
    src, dst = before["build_contexts"], after["build_contexts"]
    if (len(src) != 2 or len(dst) != 2 or
            src[0]["main_core_root_id"] != src[1]["main_core_root_id"] or
            dst[0]["main_core_root_id"] != src[0]["main_core_root_id"] or
            dst[1]["main_core_root_id"] == src[1]["main_core_root_id"] or
            not all(row["one_to_one_numeric_id_candidates"] is True for row in src) or
            not all(row["native_object_settings_present"] for row in src) or
            dst[1]["native_object_settings_present"] or
            not dst[0]["native_object_settings_present"] or
            before["model_settings_sha256"] != after["model_settings_sha256"]):
        raise ValueError("Not a supported unchanged-settings two-build root clone")
    old_root, new_root = src[1]["main_core_root_id"], dst[1]["main_core_root_id"]
    old_placements = inspect_placements(source)["mesh_instances"]
    new_placements = inspect_placements(candidate)["mesh_instances"]
    if len(old_placements) != 4 or len(new_placements) != 4:
        raise ValueError("Exactly two leaves per build are required")
    changes = {}
    for i, (a, b) in enumerate(zip(old_placements, new_placements)):
        for key in ("build_index", "mesh_part", "triangle_count", "world_transform3mf", "world_bounds_mm"):
            if a[key] != b[key]:
                raise ValueError("Core placement/shape changed, not a pure COW clone")
        if i < 2 and a["mesh_objectid"] != b["mesh_objectid"]:
            raise ValueError("Unselected build changed")
        if i >= 2 and a["mesh_objectid"] != b["mesh_objectid"]:
            changes[a["mesh_objectid"]] = b["mesh_objectid"]
    if len(changes) != 1 or len({b["mesh_objectid"] for b in new_placements[2:]}) != 2:
        raise ValueError("Require one unique private leaf ID with unchanged sibling")
    part_ids = [str(int(p["id"])) for p in src[1]["native_part_descriptors"]]
    if len(part_ids) != 2 or len(set(part_ids)) != 2:
        raise ValueError("Expected two unique native Part IDs")
    if set(part_ids) != {a["mesh_objectid"] for a in old_placements[2:]}:
        raise ValueError("Part IDs are not uniquely tied to the source leaves")
    with ZipFile(source) as z:
        raw = z.read(SETTINGS)
    with ZipFile(candidate) as z:
        if raw != z.read(SETTINGS):
            raise ValueError("Core candidate changed vendor settings bytes")
    metadata = inspect_metadata_refs(candidate)
    if new_root in metadata["settings_object_ids"] or old_root not in metadata["settings_object_ids"]:
        raise ValueError("Cannot safely attach a second direct settings entry")
    block = _checked_source_settings(raw, old_root, part_ids)
    opening = OPEN_OBJECT.search(block)
    if opening is None:
        raise ValueError("Missing native object opening tag")
    block = _change_id(opening.group(), old_root, new_root) + block[opening.end():]
    part_matches = list(OPEN_PART.finditer(block))
    for match in reversed(part_matches):
        old = _id_from_tag(match.group())
        if old not in changes:
            continue
        new = changes[old]
        block = block[:match.start()] + _change_id(match.group(), old, new) + block[match.end():]
    end = END_CONFIG.search(raw)
    assert end is not None
    updated = raw[:end.start()] + b'\n' + block + b'\n' + raw[end.start():]
    _xml(updated, SETTINGS)
    try:
        with ZipFile(candidate) as original:
            with ZipFile(output, "x") as out:
                out.comment = original.comment
                for info in original.infolist():
                    out.writestr(info, updated if info.filename == SETTINGS else original.read(info))
        audit_native_package(output)
        old_inventory, new_inventory = inventory(candidate), inventory(output)
        if (set(old_inventory) != set(new_inventory) or
                {name for name in old_inventory if old_inventory[name] != new_inventory[name]}
                != {SETTINGS}):
            raise ValueError("Unexpected ZIP member changes")
        final = inspect_metadata_refs(output)
        if new_root not in final["settings_object_ids"]:
            raise ValueError("New root settings entry was not indexed")
        new_parts = final["settings_part_inventory"][new_root]
        expected = [changes.get(part_id, part_id) for part_id in part_ids]
        if [str(int(part["id"])) for part in new_parts] != expected:
            raise ValueError("New Part IDs differ from the cloned Core leaf IDs")
    except BaseException:
        output.unlink(missing_ok=True)
        raise
    return {
        "source": "bounded experimental native 3MF root settings copy",
        "old_root": old_root, "new_root": new_root,
        "new_private_part_ids": list(changes.values()),
        "changed_member": SETTINGS,
        "semantic_vendor_parity_proven": False,
        "limitations": "Only a single two-leaf COW with known metadata keys. "
                       "Numeric ID alignment and byte-preserving clone are not "
                       "native GUI metadata semantics, full 3MF fidelity, "
                       "G-code parity or printer safety.",
    }


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--source", type=Path, required=True)
    cli.add_argument("--core-candidate", type=Path, required=True)
    cli.add_argument("--output", type=Path, required=True)
    args = cli.parse_args()
    try:
        print(json.dumps(copy_bounded_root_settings(args.source, args.core_candidate, args.output),
                         indent=2, sort_keys=True))
    except (ValueError, KeyError, OSError, RuntimeError, EOFError) as exc:
        print("Native COW settings copy refused: " + str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
