#!/usr/bin/env python3
"""Audit real native v2.5.0 layer-height application on diagnostic G-code.

This reads actual emitted XY extrusion Z levels (not comments or profile names).
It is deliberately a narrow process-setting probe, not firmware simulation,
native/WASM parity, complete profile acceptance, or print-safety certification.
"""
import argparse
from decimal import Decimal
import json
from pathlib import Path
from statistics import median

from compare_gcode import PARAM, canonical

D = Decimal
MOVES = {"G0", "G1", "G00", "G01"}

def extruded_layers(path):
    x = y = z = e = D(0)
    units = D(1)
    absolute_xyz = absolute_e = True
    layers = set()
    deposited = 0
    for line_number, command in canonical(path):
        tokens = command.split()
        if tokens and tokens[0].startswith("N") and tokens[0][1:].isdigit():
            tokens = tokens[1:]
        if not tokens:
            continue
        op = tokens[0].upper()
        if op in ("G90", "G91"):
            absolute_xyz = op == "G90"
            continue
        if op in ("M82", "M83"):
            absolute_e = op == "M82"
            continue
        if op in ("G20", "G21"):
            units = D("25.4") if op == "G20" else D(1)
            continue
        if op not in MOVES and op != "G92":
            continue
        words = {}
        for token in tokens[1:]:
            m = PARAM.fullmatch(token)
            if m is None or m[1].upper() in words or m[1].upper() in ("G", "M", "N", "T"):
                raise ValueError(f"ambiguous native move/reset line {line_number}: {command}")
            words[m[1].upper()] = D(m[2]) * units
        if op == "G92":
            x, y, z, e = (words.get("X", x), words.get("Y", y),
                          words.get("Z", z), words.get("E", e))
            continue
        old_x, old_y, old_e = x, y, e
        if "X" in words:
            x = words["X"] if absolute_xyz else x + words["X"]
        if "Y" in words:
            y = words["Y"] if absolute_xyz else y + words["Y"]
        if "Z" in words:
            z = words["Z"] if absolute_xyz else z + words["Z"]
        if "E" in words:
            e = words["E"] if absolute_e else e + words["E"]
        if op in ("G1", "G01") and e > old_e and (x != old_x or y != old_y):
            # 0.001 mm granularity merges innocuous floating-point Z jitter.
            layers.add(z.quantize(D("0.001")))
            deposited += 1
    return sorted(layers), deposited

def cadence(levels):
    steps = [b - a for a, b in zip(levels, levels[1:]) if b - a >= D("0.04")]
    if not steps:
        raise ValueError("not enough printable layer transitions")
    return median(steps)

def verify(baseline, altered, expected_base=D("0.2"), expected_altered=D("0.25")):
    a, a_paths = extruded_layers(baseline)
    b, b_paths = extruded_layers(altered)
    report = {
        "baseline_layers": len(a), "altered_layers": len(b),
        "baseline_extrusion_paths": a_paths, "altered_extrusion_paths": b_paths,
        "baseline_median_layer_step_mm": str(cadence(a)),
        "altered_median_layer_step_mm": str(cadence(b)),
        "baseline_max_extrusion_z_mm": str(max(a)),
        "altered_max_extrusion_z_mm": str(max(b)),
        "provenance": "same native binary and two-item Core 3MF; only experimental process layer_height changed",
        "wasm_parity": False, "usable_for_printing": False,
    }
    if a_paths < 100 or b_paths < 100:
        raise ValueError(f"too few actual XY extrusion paths: {a_paths} / {b_paths}")
    if len(a) < 60 or len(b) < 40 or len(a) - len(b) < 10:
        raise ValueError(f"layer_height change did not sufficiently reduce extruded Z count: {len(a)} -> {len(b)}")
    if max(a) < D("19") or max(b) < D("19"):
        raise ValueError("native slicing did not reach the 20mm model height")
    if abs(cadence(a) - expected_base) > D("0.021"):
        raise ValueError(f"baseline measured layer step not {expected_base}: {cadence(a)}")
    if abs(cadence(b) - expected_altered) > D("0.021"):
        raise ValueError(f"altered measured layer step not {expected_altered}: {cadence(b)}")
    if [s for _, s in canonical(baseline)] == [s for _, s in canonical(altered)]:
        raise ValueError("layer_height override did not change actual native G-code commands")
    return report

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--altered", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    result = verify(args.baseline, args.altered)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print("PASS: native layer-height effective-settings check", json.dumps(result))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
