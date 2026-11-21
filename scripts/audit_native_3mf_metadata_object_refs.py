#!/usr/bin/env python3
"""Read-only audit of Orca-style 3MF object-setting ID references.

This is *not* a vendor metadata interpreter. Only direct <config><object id>
references are compared with main Core resource/build IDs. New build roots
without settings are a possible semantic hazard, not proof of data loss.
Never modify or extract the archive; never authorize G-code for printing.
"""
import argparse
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile, BadZipFile

MAIN = "3D/3dmodel.model"
SETTINGS = "Metadata/model_settings.config"
CORE = "{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}"
PROD_PATH = "{http://schemas.microsoft.com/3dmanufacturing/production/2015/06}path"
MAX_XML_BYTES = 2_000_000
MAX_MEMBERS = 512
MAX_ID = 2147483647


def _xml(raw, label):
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise ValueError("DTD/entity not allowed in " + label)
    try:
        return ET.fromstring(raw)
    except ET.ParseError as exc:
        raise ValueError("Malformed XML in " + label) from exc


def _id(value, label):
    if (not isinstance(value, str) or not value or not value.isascii() or
            not value.isdecimal() or not 1 <= int(value) <= MAX_ID):
        raise ValueError("Invalid numeric object ID in " + label)
    # XML positive integer lexical forms can differ ("01" vs "1").
    # Compare canonical IDs so aliases cannot evade duplicate/reference checks.
    return str(int(value))


def _read_parts(path):
    with ZipFile(path) as z:
        files = z.infolist()
        names = [f.filename for f in files]
        if len(files) > MAX_MEMBERS or len(set(names)) != len(names):
            raise ValueError("Unsupported ZIP member count or duplicate name")
        if MAIN not in names or SETTINGS not in names:
            raise ValueError("Required 3MF model/metadata part missing")
        for name in (MAIN, SETTINGS):
            if z.getinfo(name).file_size > MAX_XML_BYTES:
                raise ValueError("Oversized XML part: " + name)
        return z.read(MAIN), z.read(SETTINGS)


def inspect_metadata_refs(path):
    main_raw, metadata_raw = _read_parts(path)
    main, metadata = _xml(main_raw, MAIN), _xml(metadata_raw, SETTINGS)
    if main.tag != CORE + "model" or metadata.tag != "config":
        raise ValueError("Unexpected model or metadata XML root")
    resources, build = main.find(CORE + "resources"), main.find(CORE + "build")
    if resources is None or build is None:
        raise ValueError("Main Core resources or build missing")
    ids = [_id(o.get("id"), MAIN) for o in resources.findall(CORE + "object")]
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate main Core object ID")
    config_objects = metadata.findall("object")
    config_ids = [_id(o.get("id"), SETTINGS) for o in config_objects]
    if len(set(config_ids)) != len(config_ids):
        raise ValueError("Duplicate native object-setting ID")
    # Part IDs are deliberately only counted: their namespace and object
    # reference semantics cannot be inferred from the numeric value alone.
    part_counts = {obj_id: len(obj.findall("part")) for obj_id, obj
                   in zip(config_ids, config_objects)}
    build_ids = []
    external_indices = []
    for i, item in enumerate(build.findall(CORE + "item")):
        obj_id = _id(item.get("objectid"), MAIN + " build")
        if item.get(PROD_PATH) is not None:
            external_indices.append(i)
        elif obj_id not in ids:
            raise ValueError("Main build refers to absent local Core resource")
        build_ids.append(obj_id)
    return {
        "main_object_ids": ids,
        "build_object_ids": build_ids,
        "external_build_indices": external_indices,
        "settings_object_ids": config_ids,
        "settings_part_counts": part_counts,
        "local_build_roots_without_object_settings": sorted(
            set(obj_id for i, obj_id in enumerate(build_ids)
                if i not in external_indices) - set(config_ids), key=int),
        "settings_ids_without_main_resource": sorted(set(config_ids) - set(ids), key=int),
        "limitations": "Only direct config/object numeric IDs; no part-ID, UUID, "
                       "plate, per-instance, vendor-extension or printer semantics.",
    }


def compare_metadata_refs(baseline, candidate):
    """Identify newly referenced build roots that inherited no settings entry."""
    a, b = inspect_metadata_refs(baseline), inspect_metadata_refs(candidate)
    if a["settings_object_ids"] != b["settings_object_ids"]:
        raise ValueError("Object-settings ID inventory changed; no semantic rewrite audited")
    if (a["external_build_indices"] or b["external_build_indices"] or
            len(a["build_object_ids"]) != len(b["build_object_ids"])):
        raise ValueError("External or reordered build structure unsupported")
    if not set(a["main_object_ids"]).issubset(b["main_object_ids"]):
        raise ValueError("Original main Core object resources were removed")
    redirected = [
        {"build_index": i, "from_id": old, "to_id": new,
         "original_had_settings": old in a["settings_object_ids"],
         "new_has_settings": new in b["settings_object_ids"]}
        for i, (old, new) in enumerate(zip(a["build_object_ids"], b["build_object_ids"]))
        if old != new
    ]
    risks = [row for row in redirected
             if row["original_had_settings"] and not row["new_has_settings"]]
    return {
        "redirected_build_items": redirected,
        "possible_unmapped_object_settings": risks,
        "semantic_object_settings_parity_proven": False,
        "status": "needs_vendor_metadata_mapping" if risks else "no_direct_id_gap_detected",
        "limitations": "A missing direct object ID mapping is a possible loss of settings, "
                       "not proof; neither result proves Orca GUI compatibility.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path)
    parser.add_argument("--fail-on-unmapped-root", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if args.fail_on_unmapped_root and not args.candidate:
        parser.error("--fail-on-unmapped-root requires --candidate")
    try:
        report = (compare_metadata_refs(args.baseline, args.candidate)
                  if args.candidate else inspect_metadata_refs(args.baseline))
        if args.fail_on_unmapped_root and report["possible_unmapped_object_settings"]:
            raise ValueError("Cloned build root has no matching native object-settings entry")
        result = json.dumps(report, sort_keys=True, indent=2) + "\n"
        if args.report:
            args.report.write_text(result, encoding="utf-8")
        else:
            print(result, end="")
    except (ValueError, OSError, BadZipFile) as exc:
        print("Native metadata reference audit refused: " + str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
