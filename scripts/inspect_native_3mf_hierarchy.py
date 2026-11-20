#!/usr/bin/env python3
"""Read-only topology inventory for the pinned CLI-authored multipart 3MF.

Reports Core build and component reference edges without modifying the
archive. It is diagnostic, not a full native 3MF interpreter or validator of
OrcaSlicer vendor metadata, component transforms, or printability.
"""
import argparse
import json
from pathlib import Path
import sys
import zipfile

from verify_native_3mf_package import (
    MAIN_PART, CORE_NS, audit_native_package, resolve_opc_target, safe_xml,
)


def inspect_native_hierarchy(path):
    package = audit_native_package(path)  # constrained ZIP inventory and OPC links
    parts = package["model_parts"]
    roots = {}
    objects_by_part = {}
    with zipfile.ZipFile(path) as archive:
        for part in parts:
            root = safe_xml(archive.read(part), part)
            roots[part] = root
            resources = root.find(CORE_NS + "resources")
            objects = [] if resources is None else resources.findall(CORE_NS + "object")
            ids = [obj.get("id") for obj in objects]
            if any(not key for key in ids) or len(set(ids)) != len(ids):
                raise ValueError("Missing or repeated Core object ID in " + part)
            objects_by_part[part] = {obj.get("id"): obj for obj in objects}

    main_build = roots[MAIN_PART].find(CORE_NS + "build")
    items = [] if main_build is None else main_build.findall(CORE_NS + "item")
    main_ids = objects_by_part[MAIN_PART]
    build_refs = [item.get("objectid") for item in items]
    missing_build = [
        {"build_index": i, "objectid": ref}
        for i, ref in enumerate(build_refs) if ref not in main_ids
    ]

    # Core component links are distinct from the OPC relationships already
    # checked in audit_native_package. Namespace-qualified production path
    # hints can point to a different model part. Never infer a flattened
    # instance transform or silently substitute a same-part reference.
    edges, unresolved = [], []
    summaries = []
    part_set = set(parts)
    for part in parts:
        meshes = 0
        components = 0
        for obj_id, obj in objects_by_part[part].items():
            if obj.find(CORE_NS + "mesh") is not None:
                meshes += 1
            parent = obj.find(CORE_NS + "components")
            if parent is None:
                continue
            for comp in parent.findall(CORE_NS + "component"):
                components += 1
                path_hints = [
                    value for attr, value in comp.attrib.items()
                    if attr.rsplit("}", 1)[-1] == "path"
                ]
                if len(path_hints) > 1:
                    raise ValueError("Ambiguous component part path")
                target_part = (
                    resolve_opc_target(path_hints[0], part) if path_hints else part
                )
                target_id = comp.get("objectid")
                edge = {
                    "from_part": part,
                    "from_objectid": obj_id,
                    "to_part": target_part,
                    "to_objectid": target_id,
                    "external": target_part != part,
                    "has_transform": "transform" in comp.attrib,
                }
                edges.append(edge)
                if (target_part not in part_set or
                        target_id not in objects_by_part.get(target_part, {})):
                    unresolved.append(edge)
        summaries.append({
            "part": part,
            "core_objects": len(objects_by_part[part]),
            "mesh_objects": meshes,
            "component_edges": components,
        })
    return {
        "source": "bounded CLI-authored native 3MF inspection",
        "main_build_items": len(items),
        "build_objectids": build_refs,
        "parts": summaries,
        "component_edges": edges,
        "dangling_main_build_refs": missing_build,
        "unresolved_component_edges": unresolved,
        "all_core_references_resolved": not missing_build and not unresolved,
        "limitations": (
            "Read-only Core reference inventory, not semantic interpretation of "
            "native metadata, relative transform composition, GUI 3MF parity, "
            "WASM/native G-code equivalence or physical print safety."
        ),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--require-build-items", type=int)
    args = parser.parse_args()
    try:
        result = inspect_native_hierarchy(args.input)
        if (args.require_build_items is not None and
                result["main_build_items"] != args.require_build_items):
            raise ValueError("Unexpected main Core build-item count")
    except (ValueError, OSError, zipfile.BadZipFile, RuntimeError, EOFError) as exc:
        print("Native 3MF hierarchy inspection refused: " + str(exc), file=sys.stderr)
        return 2
    output = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.report:
        args.report.write_text(output, encoding="utf-8")
    else:
        print(output, end="")
    print("PASS: native multipart Core reference topology inventoried; not parity proof")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
