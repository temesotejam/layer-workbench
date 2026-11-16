#!/usr/bin/env python3
"""Diagnostic native OrcaSlicer v2.5.0 outer-wall speed application check.

Only positive-E XY G1 moves under *explicit* outer-wall feature comments count.
The feed rate is a G-code command, not a measurement of physical velocity.
"""
import argparse
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
from statistics import median
import re

D = Decimal
WORD = re.compile(r"([A-Za-z])([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$")
FEATURE = re.compile(r"^;\s*(?:TYPE|FEATURE)\s*:\s*([^;\r\n]{1,80})\s*$", re.I)
FEATURE_PREFIX = re.compile(r"^;\s*(?:TYPE|FEATURE)\s*:", re.I)
OUTER_WALL = {"outer wall", "external perimeter"}
MOVE = {"G0", "G1", "G00", "G01", "G2", "G3", "G02", "G03"}


def outer_wall_feedrates(path, features=OUTER_WALL, *, feature_counts=None, feature_lengths=None):
    """Return (positive XY wall deposition count, commanded feedrates mm/min).

    Optional feature_lengths accumulates straight G1 XY path length in mm
    by explicitly accepted feature. Arcs remain excluded from this subset.

    F-only travel/moves and extrusion-only priming cannot satisfy the gate.
    Reject ambiguous G-code instead of accepting a misleading speed reading.
    """
    if path.stat().st_size > 20_000_000:
        raise ValueError("native G-code exceeds diagnostic size cap")
    x = y = z = e = D(0)
    xyz_absolute = e_absolute = True
    units = D(1)
    feed = None
    feature = None
    speeds = []
    count = 0
    with path.open(encoding="utf-8", errors="strict") as source:
        for line_number, raw in enumerate(source, 1):
            stripped = raw.strip()
            if FEATURE_PREFIX.match(stripped):
                match = FEATURE.fullmatch(stripped)
                feature = (" ".join(match[1].strip().lower().split()) if match else None)
                continue
            command = raw.split(";", 1)[0].strip().upper()
            if not command:
                continue
            tokens = command.split()
            if tokens and re.fullmatch(r"N\d+", tokens[0]):
                tokens = tokens[1:]
            if not tokens:
                continue
            opcode = tokens[0]
            if opcode in ("G90", "G91"):
                xyz_absolute = opcode == "G90"
                continue
            if opcode in ("M82", "M83"):
                e_absolute = opcode == "M82"
                continue
            if opcode in ("G20", "G21"):
                units = D("25.4") if opcode == "G20" else D(1)
                continue
            if opcode not in MOVE and opcode != "G92":
                continue
            words = {}
            for token in tokens[1:]:
                match = WORD.fullmatch(token)
                if not match or match[1] not in "XYZEFIJR" or match[1] in words:
                    raise ValueError(f"ambiguous native motion line {line_number}: {command}")
                try:
                    numeric = D(match[2])
                except InvalidOperation as error:
                    raise ValueError(f"invalid numeric motion word at {line_number}") from error
                if not numeric.is_finite():
                    raise ValueError(f"non-finite motion word at {line_number}")
                words[match[1]] = numeric * units
            if opcode == "G92":
                x, y, z, e = (words.get("X", x), words.get("Y", y),
                              words.get("Z", z), words.get("E", e))
                continue
            if "F" in words:
                if words["F"] <= 0 or words["F"] > 10_000_000:
                    raise ValueError(f"invalid feedrate at {line_number}")
                feed = words["F"]
            old_x, old_y, old_e = x, y, e
            if "X" in words:
                x = words["X"] if xyz_absolute else x + words["X"]
            if "Y" in words:
                y = words["Y"] if xyz_absolute else y + words["Y"]
            if "Z" in words:
                z = words["Z"] if xyz_absolute else z + words["Z"]
            if "E" in words:
                e = words["E"] if e_absolute else e + words["E"]
            # Only linear positive deposition: arcs are excluded from the measured subset.
            if opcode in ("G1", "G01") and feature in features and e > old_e \
                    and (x != old_x or y != old_y):
                if feed is None:
                    raise ValueError(f"outer-wall extrusion has no commanded F at {line_number}")
                speeds.append(feed)
                count += 1
                if feature_counts is not None:
                    feature_counts[feature] = feature_counts.get(feature, 0) + 1
                if feature_lengths is not None:
                    dx, dy = x - old_x, y - old_y
                    distance = (dx * dx + dy * dy).sqrt()
                    feature_lengths[feature] = feature_lengths.get(feature, D(0)) + distance
    return count, speeds


def verify(baseline, altered):
    a_count, a = outer_wall_feedrates(baseline)
    b_count, b = outer_wall_feedrates(altered)
    if min(a_count, b_count) < 20:
        raise ValueError(f"too few explicitly tagged outer-wall XY extrusion moves: {a_count}/{b_count}")
    a_median, b_median = median(a), median(b)
    # Only process.outer_wall_speed is altered, to 2 mm/s = F120.
    # A bounded tolerance accommodates G-code rounding, not arbitrary speed differences.
    if a_median < D(300):
        raise ValueError(f"unexpectedly slow baseline outer-wall feedrate: F{a_median}")
    if abs(b_median - D(120)) > D(12):
        raise ValueError(f"outer_wall_speed=2 mm/s did not reach measured F120: F{b_median}")
    if a_median <= b_median * 2:
        raise ValueError("outer wall commands did not slow down appreciably")
    return {
        "baseline_outer_wall_positive_xy_moves": a_count,
        "altered_outer_wall_positive_xy_moves": b_count,
        "baseline_median_outer_wall_feed_mm_min": str(a_median),
        "altered_median_outer_wall_feed_mm_min": str(b_median),
        "measured_subset": "positive-E XY G1 under explicit ;TYPE:/;FEATURE: outer-wall labels",
        "only_experimental_override": "process.outer_wall_speed=2 mm/s",
        "wasm_parity": False,
        "physical_velocity_measured": False,
        "usable_for_printing": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--altered", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    report = verify(args.baseline, args.altered)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("PASS: native outer-wall feedrate follows isolated process override", json.dumps(report))


if __name__ == "__main__":
    main()
