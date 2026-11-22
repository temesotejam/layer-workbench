#!/usr/bin/env python3
"""Fail-closed provenance gate for paired native/WASM G-code fixtures.

This validates self-reported fixture hashes and scene placement witnesses;
it does not prove producer identity or actual slicer placement.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
from compare_gcode import compare

PIN = "40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19"
# A model STL hash alone does not encode its placement on a build plate.
# scene.json is a self-reported normalized placement witness from each engine,
# NOT independent proof that the engine applied the transform.
KINDS = ("model", "scene", "machine", "filament", "process", "gcode")

def invertible_scene_linear(matrix):
    """Conservative affine rank guard; the scene witness is not a mesh proof.

    A self-reported transform that flattens a solid onto a plane cannot act
    as valid placement evidence, even if both producers report identical
    hashes and G-code. Normalize determinant by column norms so a large
    uniform scale does not hide a nearly dependent axis.
    """
    columns = ((matrix[0], matrix[4], matrix[8]),
               (matrix[1], matrix[5], matrix[9]),
               (matrix[2], matrix[6], matrix[10]))
    lengths = [math.hypot(*column) for column in columns]
    if min(lengths) < 1e-6:
        return False
    determinant = (
        matrix[0] * (matrix[5] * matrix[10] - matrix[6] * matrix[9])
        - matrix[1] * (matrix[4] * matrix[10] - matrix[6] * matrix[8])
        + matrix[2] * (matrix[4] * matrix[9] - matrix[5] * matrix[8])
    )
    normalized = abs(determinant) / math.prod(lengths)
    return math.isfinite(normalized) and normalized > 1e-8



def validate_scene(path, model_sha256, role):
    """Reject absent, malformed or unbound placement evidence before comparison."""
    if path.stat().st_size > 65536:
        raise ValueError(f"{role}: scene witness exceeds 64 KiB")
    scene = json.loads(path.read_text(encoding="utf-8"))
    if (not isinstance(scene, dict) or set(scene) != {
            "schema", "units", "matrix_layout", "source_model_sha256", "instances"} or
        scene["schema"] != "layer-workbench-scene-v1" or
        scene["units"] != "mm" or scene["matrix_layout"] != "row-major" or
        scene["source_model_sha256"] != model_sha256):
        raise ValueError(f"{role}: invalid scene schema or unbound source model")
    instances = scene["instances"]
    if not isinstance(instances, list) or not 1 <= len(instances) <= 32:
        raise ValueError(f"{role}: expected 1..32 scene instances")
    for instance in instances:
        if not isinstance(instance, dict) or set(instance) != {
                "source_index", "plate_index", "matrix"}:
            raise ValueError(f"{role}: invalid scene instance record")
        for key, maximum in (("source_index", 1023), ("plate_index", 31)):
            value = instance[key]
            if type(value) is not int or not 0 <= value <= maximum:
                raise ValueError(f"{role}: invalid scene {key}")
        matrix = instance["matrix"]
        if (not isinstance(matrix, list) or len(matrix) != 16 or
            any(type(n) not in (int, float) or not math.isfinite(n) or
                abs(n) > 1_000_000 for n in matrix) or
            matrix[12:] != [0, 0, 0, 1] or
            not invertible_scene_linear(matrix)):
            raise ValueError(f"{role}: invalid row-major scene matrix")


def read_manifest(path, role):
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("engine") != role or data.get("upstream_commit") != PIN:
        raise ValueError(f"{role}: incorrect engine or unpinned revision")
    files = data.get("files")
    if not isinstance(files, dict) or set(files) != set(KINDS):
        raise ValueError(f"{role}: expected model/scene/machine/filament/process/gcode")
    out = {}
    for kind in KINDS:
        entry = files[kind]
        if not isinstance(entry, dict) or set(entry) != {"path", "sha256"}:
            raise ValueError(f"{role}: invalid {kind} entry")
        rel, sha = entry["path"], entry["sha256"]
        if not isinstance(rel, str) or not rel or Path(rel).is_absolute() or "\\" in rel:
            raise ValueError(f"{role}: invalid relative path for {kind}")
        full = (path.parent / rel).resolve()
        if not full.is_relative_to(path.parent.resolve()) or not full.is_file():
            raise ValueError(f"{role}: missing or outside-fixture {kind}")
        if not isinstance(sha, str) or len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
            raise ValueError(f"{role}: invalid sha256 for {kind}")
        if not 0 < full.stat().st_size <= 200_000_000:
            raise ValueError(f"{role}: empty or oversized {kind}")
        if hashlib.sha256(full.read_bytes()).hexdigest() != sha:
            raise ValueError(f"{role}: SHA256 mismatch for {kind}")
        out[kind] = (sha, full)
    validate_scene(out["scene"][1], out["model"][0], role)
    return out

def verify(native_manifest, wasm_manifest, minimum=1, diagnose_mismatched_inputs=False):
    """Compare G-code on verified-equal inputs, or optionally inspect unequal ones.

    Diagnostic mode never certifies parity: different source/profile bytes
    force the final result to mismatch even if commands happen to be equal.
    """
    if minimum < 1:
        raise ValueError("minimum extrusion moves must be positive")
    n = read_manifest(native_manifest, "native")
    w = read_manifest(wasm_manifest, "wasm")
    different = [k for k in KINDS if k != "gcode" and n[k][0] != w[k][0]]
    report = {"upstream_commit": PIN, "different_inputs": different,
              "input_hashes_match": not different, "match": False}
    if different and not diagnose_mismatched_inputs:
        return report
    result = compare(n["gcode"][1], w["gcode"][1], min_extrusion_moves=minimum)
    report["gcode_comparison"] = result
    # A changed input can still produce identical commands accidentally.
    # Keep the conservative parity gate CLOSED in diagnostic-only mode.
    report["match"] = not different and result["match"]
    if different:
        report["diagnostic_only"] = True
        report["diagnostic_note"] = (
            "G-code inspected despite mismatched model/profile SHA256; "
            "command agreement is NOT native/WASM parity.")
    return report

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--native-manifest", required=True, type=Path)
    p.add_argument("--wasm-manifest", required=True, type=Path)
    p.add_argument("--min-extrusion-moves", type=int, default=1)
    p.add_argument("--report", type=Path)
    p.add_argument("--diagnose-mismatched-inputs", action="store_true",
                   help="Compute command/XY/E diagnostics even when model or profile hashes differ; "
                        "never return a parity PASS for unequal inputs")
    args = p.parse_args()
    try:
        report = verify(args.native_manifest, args.wasm_manifest, args.min_extrusion_moves,
                        diagnose_mismatched_inputs=args.diagnose_mismatched_inputs)
    except (OSError, ValueError, UnicodeError, KeyError, TypeError) as exc:
        report = {"match": False, "error": str(exc)}
    output = json.dumps(report, ensure_ascii=False, indent=2, default=str)
    print(output)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(output + "\n", encoding="utf-8")
    return 0 if report.get("match") else 1

if __name__ == "__main__":
    raise SystemExit(main())
