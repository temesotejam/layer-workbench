#!/usr/bin/env python3
"""Create a synthetic *different-shaped* external leaf for the pinned 3MF CLI gate.

This is NOT a user-facing 3MF editor: the already verified two-edge, two-build
native-derived fixture has two distinct external model parts. Scale Y vertices
of the SECOND leaf in both builds (it remains shared until copy-on-write).
Preserve all other ZIP members byte-for-byte. Never generate printable G-code.
"""
import argparse
from pathlib import Path
from zipfile import ZipFile

from audit_native_3mf_instance_placement import inspect_placements
from clone_native_3mf_shared_leaf import _guard_xml
from compare_3mf_metadata import inventory
from scale_native_3mf_private_leaf import _scaled_mesh_xml
from verify_native_3mf_package import CORE_NS, MAIN_PART, audit_native_package

SCALE_Y = 1.2


def make_distinct_shape_fixture(source, destination):
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve() or destination.exists():
        raise ValueError("Output must be a distinct, nonexistent file")
    audit_native_package(source)
    before = inspect_placements(source)
    rows = before["mesh_instances"]
    if (before["build_items"] != 2 or len(rows) != 4 or
            [r["build_index"] for r in rows] != [0, 0, 1, 1] or
            rows[0]["mesh_part"] != rows[2]["mesh_part"] or
            rows[1]["mesh_part"] != rows[3]["mesh_part"] or
            rows[0]["mesh_part"] in (MAIN_PART, rows[1]["mesh_part"]) or
            rows[1]["mesh_part"] == MAIN_PART or
            rows[1]["mesh_objectid"] != rows[3]["mesh_objectid"] or
            any(r["triangle_count"] < 1 for r in rows) or
            rows[0]["triangle_count"] != rows[2]["triangle_count"] or
            rows[1]["triangle_count"] != rows[3]["triangle_count"]):
        raise ValueError("Expected two shared builds, each with distinct nonempty external leaves")

    second_part = rows[1]["mesh_part"]
    second_id = rows[1]["mesh_objectid"]
    with ZipFile(source) as original:
        raw = original.read(second_part)
        model = _guard_xml(raw, "synthetic second mesh source")
        resources = model.find(CORE_NS + "resources")
        objects = [] if resources is None else resources.findall(CORE_NS + "object")
        if (len(objects) != 1 or objects[0].get("id") != second_id or
                objects[0].find(CORE_NS + "mesh") is None):
            raise ValueError("Second model must contain exactly one supported mesh object")
        changed_leaf = _scaled_mesh_xml(raw, second_id, SCALE_Y, axis="y")
        try:
            with ZipFile(destination, "x") as output:
                output.comment = original.comment
                for info in original.infolist():
                    output.writestr(
                        info, changed_leaf if info.filename == second_part
                        else original.read(info))
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
    try:
        audit_native_package(destination)
        a, b = inventory(source), inventory(destination)
        if (set(a) != set(b) or
                {part for part in a if a[part] != b[part]} != {second_part}):
            raise ValueError("Unexpected changes outside the synthetic second mesh")
        after = inspect_placements(destination)["mesh_instances"]
        if len(after) != 4:
            raise ValueError("Mesh instance count changed")
        for idx, (old, new) in enumerate(zip(rows, after)):
            for key in ("mesh_part", "mesh_objectid", "build_index",
                        "world_transform3mf", "triangle_count", "component_path"):
                if old[key] != new[key]:
                    raise ValueError("Mesh occurrence identity or transform changed")
            if (idx % 2 == 0) != (old["world_bounds_mm"] == new["world_bounds_mm"]):
                raise ValueError("Wrong branch shape changed")
        first_y_span = after[0]["world_bounds_mm"][3] - after[0]["world_bounds_mm"][2]
        second_y_span = after[1]["world_bounds_mm"][3] - after[1]["world_bounds_mm"][2]
        if abs(first_y_span - second_y_span) < 0.01:
            raise ValueError("Synthetic mesh widths remain indistinguishable")
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return {
        "synthetic": True, "modified_part": second_part, "scale_axis": "y",
        "scale_factor": SCALE_Y, "mesh_occurrences": 4,
        "first_y_span_mm": first_y_span, "second_y_span_mm": second_y_span,
        "limitations": "Only CLI-derived two-edge Core fixtures; no metadata semantics, native/WASM G-code parity or print safety."
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = make_distinct_shape_fixture(args.input, args.output)
    print("PASS: second synthetic external leaf has different Y geometry:", report)


if __name__ == "__main__":
    main()
