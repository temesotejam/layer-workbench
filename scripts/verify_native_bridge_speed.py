#!/usr/bin/env python3
"""Bounded native v2.5.0 bridge deposition-speed gate, diagnostic only.

Reuses the tested modal G-code parser from the outer-wall audit but selects
explicit bridge feature labels. This does not establish desktop/WASM parity.
"""
import argparse
from decimal import Decimal
import json
from pathlib import Path
from statistics import median

from verify_native_outer_wall_speed import outer_wall_feedrates

D = Decimal
# Deliberately exclude untagged moves, overhang walls and travel moves.
BRIDGE_FEATURES = frozenset({
    "bridge", "external bridge", "internal bridge", "bridge infill",
    "internal bridge infill", "bridge over infill",
})


def verify(baseline, slow):
    a_count, a = outer_wall_feedrates(baseline, features=BRIDGE_FEATURES)
    b_count, b = outer_wall_feedrates(slow, features=BRIDGE_FEATURES)
    if min(a_count, b_count) < 10:
        raise ValueError(f"too few tagged positive-E XY bridge moves: {a_count}/{b_count}")
    a_median, b_median = median(a), median(b)
    # process.bridge_speed=2 mm/s => F120; bridge variants may have distinct
    # speed modifiers, so the target is measured in actual tagged G1 moves.
    target_count = sum(abs(speed-D(120)) <= D(12) for speed in b)
    baseline_target = sum(abs(speed-D(120)) <= D(12) for speed in a)
    if target_count < 3 or target_count <= baseline_target:
        raise ValueError(f"no newly effective bridge F120 deposition: {baseline_target}/{target_count}")
    if a_median <= b_median * D('1.5'):
        raise ValueError(f"bridge speed did not significantly decrease: F{a_median}/F{b_median}")
    return {
        "baseline_tagged_bridge_xy_extrusions": a_count,
        "altered_tagged_bridge_xy_extrusions": b_count,
        "baseline_bridge_median_feed_mm_min": str(a_median),
        "altered_bridge_median_feed_mm_min": str(b_median),
        "baseline_F120_tagged_extrusions": baseline_target,
        "altered_F120_tagged_extrusions": target_count,
        "geometry": "same deterministic STL as isolated WASM bridge arch OBJ fixture",
        "setting": "full official process + bridge_speed=2 mm/s only in altered run",
        "native_wasm_gcode_match": False,
        "safe_for_printer": False,
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--baseline', required=True, type=Path)
    p.add_argument('--altered', required=True, type=Path)
    p.add_argument('--report', required=True, type=Path)
    args = p.parse_args()
    report = verify(args.baseline, args.altered)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print('PASS: native tagged bridge speed effect',json.dumps(report))

if __name__ == '__main__':
    main()
