#!/usr/bin/env python3
"""Numeric-only diagnostic of real native and browser-WASM cube G-code.

This is explicitly NOT a profile-parity or print-safety test: native uses full
upstream presets, WASM uses a restricted generic PLA development profile.
Never archive G-code or the full-profile JSON with this report.
"""
import argparse
import hashlib
import json
from pathlib import Path

from compare_gcode import compare

CUBE_SHA256 = "7b59223183b5c34815cbf197e1207b108932779a650bd9e6c9a6d2be811f8e93"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def diagnostic(native, wasm, wasm_summary, source_stl, minimum=100):
    if minimum < 1:
        raise ValueError("minimum extrusion moves must be positive")
    if source_stl.stat().st_size != 684 or sha256(source_stl) != CUBE_SHA256:
        raise ValueError("native cube STL does not match the shared byte-pinned source")
    for label, path in (("native", native), ("wasm", wasm)):
        if not 1024 <= path.stat().st_size <= 20_000_000:
            raise ValueError(f"{label} G-code missing, too small or oversized")
    raw_summary = wasm_summary.read_text(encoding="utf-8")
    # One archived 2026-11-17 browser fixture accidentally ended in literal
    # backslash-n instead of JSON whitespace. Accept ONLY that exact suffix.
    if raw_summary.endswith("\\n"):
        raw_summary = raw_summary[:-2] + "\n"
    summary = json.loads(raw_summary)
    if not isinstance(summary, dict):
        raise ValueError("WASM summary must be an object")
    expected = {
        "engine": "OrcaSlicer WASM candidate",
        "version": "2.5.0",
        "api": "0.7.0",
        "source_stl_sha256": CUBE_SHA256,
        "gcode_sha256": sha256(wasm),
        "bytes": wasm.stat().st_size,
    }
    if any(summary.get(key) != value for key, value in expected.items()):
        raise ValueError("WASM summary provenance/size/hash mismatch")
    if not isinstance(summary.get("layers"), int) or summary["layers"] < 2:
        raise ValueError("WASM summary lacks multiple layers")
    result = compare(native, wasm, min_extrusion_moves=minimum)
    if result["input_issues"]:
        raise ValueError("real G-code fails minimum deposition gate: " +
                         "; ".join(result["input_issues"]))
    # Do not include first_differences, file paths or raw executable commands
    # in the archived diagnostic; original G-code stays in the CI workspace.
    fields = (
        "native_commands", "wasm_commands", "native_motion_commands",
        "wasm_motion_commands", "native_extrusion_moves",
        "wasm_extrusion_moves", "native_counted_positive_e_mm",
        "wasm_counted_positive_e_mm", "counted_positive_e_delta_mm",
        "native_counted_linear_xy_moves", "wasm_counted_linear_xy_moves",
        "native_counted_linear_xy_mm", "wasm_counted_linear_xy_mm",
        "counted_linear_xy_delta_mm", "mismatched_commands",
        # Actual real-engine Z-strata observations, not synthetic fixture
        # estimates. Unknown/unsupported motion produces null, not a layer.
        "native_counted_planar_z_levels", "wasm_counted_planar_z_levels",
        "native_counted_nonplanar_deposition_moves",
        "wasm_counted_nonplanar_deposition_moves",
        "first_counted_planar_z_differences",
    )
    return {
        "status": "DIAGNOSTIC_ONLY",
        "parity_pass": False,
        "parity_reason": "Full native and restricted WASM profiles are not equivalent; "
                         "native Core 3MF and WASM STL import paths also differ.",
        "source_model_sha256": CUBE_SHA256,
        "source_bytes": 684,
        "native_gcode_sha256": result["native_sha256"],
        "wasm_gcode_sha256": result["wasm_sha256"],
        "ordered_commands_equal": result["match"],
        "metrics": {key: result[key] for key in fields},
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--native", type=Path, required=True)
    p.add_argument("--wasm", type=Path, required=True)
    p.add_argument("--wasm-summary", type=Path, required=True)
    p.add_argument("--source-stl", type=Path, required=True)
    p.add_argument("--report", type=Path, required=True)
    p.add_argument("--min-extrusion-moves", type=int, default=100)
    a = p.parse_args()
    report = diagnostic(a.native, a.wasm, a.wasm_summary, a.source_stl,
                        a.min_extrusion_moves)
    a.report.parent.mkdir(parents=True, exist_ok=True)
    a.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
