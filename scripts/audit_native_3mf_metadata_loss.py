#!/usr/bin/env python3
"""CI-only, count-only audit of metadata loss after a best-effort 3MF edit.

Geometry reopen is a separate gate. Never copy stale native metadata into a
regenerated project, emit config values, or interpret a matching key as proof
that the desktop slicer uses the same effective setting.
"""
import argparse
import json
from pathlib import Path
import sys
import zipfile
import xml.etree.ElementTree as ET

from compare_3mf_metadata import inventory

PROJECT = "Metadata/project_settings.config"
MODEL = "Metadata/model_settings.config"
MAX_CONFIG = 4 * 1024 * 1024


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate project JSON key")
        result[key] = value
    return result


def _reject_constant(_):
    raise ValueError("Nonfinite project JSON constant")


def _config(path, members):
    if PROJECT not in members:
        return None
    if members[PROJECT]["bytes"] > MAX_CONFIG:
        raise ValueError("Project config exceeds diagnostic limit")
    with zipfile.ZipFile(path) as archive:
        data = json.loads(archive.read(PROJECT).decode("utf-8-sig"),
                          object_pairs_hook=_unique_pairs,
                          parse_constant=_reject_constant)
    if not isinstance(data, dict) or not data or len(data) > 10000:
        raise ValueError("Expected bounded nonempty project JSON object")
    # Canonical JSON avoids bool/int equality and preserves array order.
    return {key: json.dumps(value, sort_keys=True, allow_nan=False,
                            separators=(",", ":")) for key, value in data.items()}


def _counts(before, after):
    old, new = set(before), set(after)
    return {"baseline": len(old), "candidate": len(new),
            "missing": len(old - new), "added": len(new - old),
            "changed": sum(before[k] != after[k] for k in old & new),
            "unchanged": sum(before[k] == after[k] for k in old & new)}


def _part_status(before, after, name):
    if name not in before:
        raise ValueError("Required baseline native metadata part absent")
    if name not in after:
        return "missing"
    return "unchanged" if before[name] == after[name] else "changed"


def audit(baseline, candidate):
    before, after = inventory(baseline), inventory(candidate)
    project_status = _part_status(before, after, PROJECT)
    model_status = _part_status(before, after, MODEL)
    old_config = _config(baseline, before)
    new_config = _config(candidate, after)
    groups = {}
    for label, selector in (
        ("metadata", lambda k: k.startswith("Metadata/")),
        ("model_parts", lambda k: k.startswith("3D/") and k.lower().endswith(".model")),
        ("other", lambda k: not k.startswith("Metadata/") and not
         (k.startswith("3D/") and k.lower().endswith(".model"))),
    ):
        groups[label] = _counts({k: v for k, v in before.items() if selector(k)},
                                {k: v for k, v in after.items() if selector(k)})
    return {"members": groups, "project_config_bytes": project_status,
            "model_config_bytes": model_status,
            "project_json": {"status": "missing" if new_config is None else "present",
                             **_counts(old_config, new_config or {})},
            "metadata_semantic_parity_verified": False,
            "print_safety_verified": False}



def _model_xml(path, members):
    """Bounded, order-sensitive parsed XML inventory; not a native config interpreter.

    Upstream bbs_3mf.cpp::_add_model_config_file_to_archive serializes object,
    part, plate and model_instance separately. identify_id can be generated
    from the runtime ModelInstance id; report it separately, never discard it.
    """
    if MODEL not in members or members[MODEL]["bytes"] > MAX_CONFIG:
        raise ValueError("Missing or oversized model settings XML")
    with zipfile.ZipFile(path) as archive:
        raw = archive.read(MODEL).decode("utf-8-sig")
    # No DTD, entities, CDATA or other declarations in this bounded fixture.
    if "<!" in raw:
        raise ValueError("Unsupported model settings XML declaration")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise ValueError("Invalid model settings XML") from exc
    if root.tag != "config":
        raise ValueError("Expected native model config root")
    groups = {key: {} for key in ("object", "part", "plate", "instance",
                                   "instance_identity", "other")}
    count = 0

    def walk(node, path_key, group, parent_tag=None):
        nonlocal count
        count += 1
        if count > 20000 or len(path_key) > 32:
            raise ValueError("Model settings XML exceeds node or depth limit")
        if parent_tag == "config" and node.tag in ("object", "plate"):
            group = node.tag
        elif parent_tag == "object" and node.tag == "part":
            group = "part"
        elif parent_tag == "plate" and node.tag == "model_instance":
            group = "instance"
        elif (parent_tag == "model_instance" and group == "instance" and
              node.tag == "metadata" and node.get("key") == "identify_id" and
              set(node.attrib) == {"key", "value"} and not len(node)):
            group = "instance_identity"
        # Ignore formatting-only indentation and attribute order; retain all
        # nonblank text, attribute values, node order and unknown elements.
        text = node.text if node.text and node.text.strip() else ""
        tail = node.tail if node.tail and node.tail.strip() else ""
        groups[group][path_key] = (node.tag, tuple(sorted(node.attrib.items())), text, tail)
        for i, child in enumerate(node):
            walk(child, (*path_key, i), group, node.tag)

    walk(root, (), "other")
    if not all(groups[k] for k in ("object", "part", "plate", "instance")):
        raise ValueError("Expected nonempty native object/part/plate/instance fixture")
    return groups


def model_xml_audit(baseline, candidate):
    before = _model_xml(baseline, inventory(baseline))
    after = _model_xml(candidate, inventory(candidate))
    return {group: _counts(before[group], after[group]) for group in before}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--require-identical-config", action="store_true",
                        help="Positive control: require all metadata member bytes unchanged")
    parser.add_argument("--require-identical-project-json", action="store_true",
                        help="Require nonempty typed project settings to match after native re-export")
    parser.add_argument("--compare-model-xml", action="store_true",
                        help="Report parsed model XML node differences by scope")
    parser.add_argument("--require-identical-object-part-xml", action="store_true",
                        help="Require exact ordered object and part XML nodes; report all other scopes")
    args = parser.parse_args()
    try:
        result = audit(args.baseline, args.candidate)
        if args.compare_model_xml or args.require_identical_object_part_xml:
            result["model_xml"] = model_xml_audit(args.baseline, args.candidate)
            if args.require_identical_object_part_xml and any(
                    result["model_xml"][group][key]
                    for group in ("object", "part")
                    for key in ("missing", "added", "changed")):
                raise ValueError("Native object or part XML differs")
        if args.require_identical_project_json:
            project = result["project_json"]
            if (project["status"] != "present" or not project["baseline"] or
                    any(project[k] for k in ("missing", "added", "changed"))):
                raise ValueError("Native re-export project JSON differs")
        if args.require_identical_config:
            meta = result["members"]["metadata"]
            if any(meta[k] for k in ("missing", "added", "changed")):
                raise ValueError("Positive control changed metadata members")
            if result["project_config_bytes"] != "unchanged" or result["model_config_bytes"] != "unchanged":
                raise ValueError("Positive control changed native config bytes")
    except (ValueError, OSError, zipfile.BadZipFile, RuntimeError, EOFError,
            OverflowError, RecursionError):
        # Never echo archive member names, project values or parser messages.
        print("3MF metadata loss audit refused invalid input or failed positive control", file=sys.stderr)
        return 2
    print("NATIVE_3MF_METADATA_DELTA " + json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
