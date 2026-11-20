#!/usr/bin/env python3
"""Narrow structural audit of a CLI-exported OrcaSlicer 3MF (CI only).

This checks packaging and internal OPC targets, NOT metadata semantics or a
native project round-trip. The independent official-CLI STL geometry reimport
is a separate acceptance gate.
"""
import argparse
import json
from pathlib import Path, PurePosixPath
import posixpath
import sys
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile

from compare_3mf_metadata import inventory

REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
CORE_NS = "{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}"
MAIN_PART = "3D/3dmodel.model"
MAIN_RELS = "3D/_rels/3dmodel.model.rels"
ROOT_RELS = "_rels/.rels"
REQUIRED = {
    MAIN_PART, MAIN_RELS, ROOT_RELS,
    "Metadata/model_settings.config", "Metadata/project_settings.config",
}


def safe_xml(raw, name):
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise ValueError(f"DTD/entity in native project part: {name}")
    try:
        return ET.fromstring(raw)
    except ET.ParseError as exc:
        raise ValueError(f"Malformed native project XML part: {name}") from exc


def resolve_opc_target(target, source_part):
    """Return a safe canonical package path for one internal OPC relationship."""
    if not isinstance(target, str) or not target or "\\" in target:
        raise ValueError("Unsafe or empty OPC relationship target")
    parsed = urllib.parse.urlsplit(target)
    if parsed.scheme or parsed.netloc or parsed.query:
        raise ValueError("External or qualified OPC relationship target")
    try:
        decoded = urllib.parse.unquote(parsed.path, errors="strict")
    except UnicodeError as exc:
        raise ValueError("Invalid encoded OPC relationship target") from exc
    if decoded.startswith("/") and ".." in decoded.split("/"):
        raise ValueError("Absolute OPC relationship traverses parent")
    if not decoded or "\\" in decoded or "\x00" in decoded:
        raise ValueError("Invalid decoded OPC relationship target")
    base = "" if source_part is None else posixpath.dirname(source_part)
    path = posixpath.normpath(decoded.lstrip("/") if decoded.startswith("/")
                            else posixpath.join(base, decoded))
    if path in ("", ".", "..") or path.startswith("../") or path.startswith("/"):
        raise ValueError("OPC relationship escapes package root")
    if any(x in (".", "..") for x in PurePosixPath(path).parts):
        raise ValueError("Invalid normalized OPC target")
    return path


def relationship_targets(archive, member_names, relationships_name, source_part):
    root = safe_xml(archive.read(relationships_name), relationships_name)
    if root.tag != REL_NS + "Relationships":
        raise ValueError("Unexpected OPC relationships XML root")
    ids, targets = set(), set()
    for item in root:
        if item.tag != REL_NS + "Relationship":
            raise ValueError("Unexpected OPC relationship element")
        rel_id, target = item.get("Id"), item.get("Target")
        if not rel_id or rel_id in ids:
            raise ValueError("Missing or duplicate OPC relationship Id")
        if item.get("TargetMode", "Internal") != "Internal":
            raise ValueError("External OPC relationship is unsupported")
        ids.add(rel_id)
        path = resolve_opc_target(target, source_part)
        if path not in member_names:
            raise ValueError(f"OPC relationship refers to absent part: {path}")
        targets.add(path)
    if not ids:
        raise ValueError("Empty OPC relationship collection")
    return targets


def audit_native_package(path):
    members = inventory(path)  # bounded streaming ZIP reads and unsafe path gate
    names = set(members)
    if not REQUIRED.issubset(names):
        raise ValueError(f"Missing native 3MF members: {sorted(REQUIRED - names)}")
    parts = sorted(name for name in names if
                   name.startswith("3D/") and name.lower().endswith(".model"))
    # The current pinned fixture produces one main part and two external
    # object parts. Do not assume that arbitrary native projects share it.
    children = sorted(set(parts) - {MAIN_PART})
    if len(parts) != 3 or len(children) != 2 or not all(
        name.startswith("3D/Objects/") for name in children
    ):
        raise ValueError(f"Unexpected native project model-part layout: {parts}")
    with zipfile.ZipFile(path) as z:
        for name in parts:
            if safe_xml(z.read(name), name).tag != CORE_NS + "model":
                raise ValueError(f"Non-Core native model part: {name}")
        root_targets = relationship_targets(z, names, ROOT_RELS, None)
        model_targets = relationship_targets(z, names, MAIN_RELS, MAIN_PART)
    if MAIN_PART not in root_targets:
        raise ValueError("Package root does not reference the main 3MF model")
    if not set(children).issubset(model_targets):
        raise ValueError("Main model relations do not reference both object parts")
    return {
        "native_export_package": True,
        "model_parts": parts,
        "metadata_parts": sorted(name for name in names if name.startswith("Metadata/")),
        "root_relationship_targets": sorted(root_targets),
        "main_relationship_targets": sorted(model_targets),
        "member_count": len(names),
        "limitations": (
            "Only this source-pinned two-object CLI export layout is checked. "
            "OPC relationship existence and XML syntax do not prove native "
            "config equivalence, editable external-part transforms, GUI-saved "
            "project support, safe print output or WASM parity."
        ),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        result = audit_native_package(args.input)
    except (ValueError, OSError, zipfile.BadZipFile, RuntimeError, EOFError) as exc:
        print(f"Native 3MF package diagnostic refused: {exc}", file=sys.stderr)
        return 2
    output = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.report:
        args.report.write_text(output, encoding="utf-8")
    else:
        print(output, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
