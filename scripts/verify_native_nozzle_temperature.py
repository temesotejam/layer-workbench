#!/usr/bin/env python3
"""Verify that native v2.5.0 obeys a single initial-layer nozzle temperature override.

Read actual M104/M109 S-targets, not G-code comments or the supplied preset.
A passing diagnostic does not certify final temperature, heater safety, or WASM parity.
"""
import argparse
from decimal import Decimal
import json
from pathlib import Path

from compare_gcode import PARAM, canonical

HEAT_COMMANDS = {"M104", "M109"}


def first_positive_targets(path):
    """Extract first strictly positive S target per native nozzle heater opcode."""
    targets = {}
    for line_number, command in canonical(path):
        tokens = command.split()
        if tokens and tokens[0].startswith("N") and tokens[0][1:].isdigit():
            tokens = tokens[1:]
        if not tokens or tokens[0].upper() not in HEAT_COMMANDS:
            continue
        opcode = tokens[0].upper()
        words = {}
        for token in tokens[1:]:
            match = PARAM.fullmatch(token)
            if match is None:
                raise ValueError(f"ambiguous heater command at line {line_number}: {command}")
            letter = match[1].upper()
            if letter in words or letter in ("G", "M", "N"):
                raise ValueError(f"ambiguous heater word at line {line_number}: {command}")
            words[letter] = Decimal(match[2])
        if "S" not in words or not words["S"].is_finite():
            raise ValueError(f"missing/invalid S target at line {line_number}: {command}")
        if words["S"] < 0 or words["S"] > 500:
            raise ValueError(f"unreasonable nozzle target at line {line_number}: {command}")
        if words["S"] > 0 and opcode not in targets:
            targets[opcode] = words["S"]
    return targets


def verify(baseline, altered, old=Decimal("220"), new=Decimal("235")):
    if not (Decimal("0") < old < new <= Decimal("250")):
        raise ValueError("unexpected diagnostic temperature range")
    a, b = first_positive_targets(baseline), first_positive_targets(altered)
    if set(a) != HEAT_COMMANDS or set(b) != HEAT_COMMANDS:
        raise ValueError(f"missing positive nozzle heat/wait targets: {a} / {b}")
    for opcode in sorted(HEAT_COMMANDS):
        if a[opcode] != old or b[opcode] != new:
            raise ValueError(f"{opcode} initial nozzle target not updated: {a[opcode]} -> {b[opcode]}")
    if [command for _, command in canonical(baseline)] == [command for _, command in canonical(altered)]:
        raise ValueError("temperature override did not change native G-code commands")
    return {
        "baseline_initial_targets_c": {key: str(value) for key, value in sorted(a.items())},
        "altered_initial_targets_c": {key: str(value) for key, value in sorted(b.items())},
        "source": "native G-code M104/M109 S commands from the same v2.5.0 binary and model",
        "only_tested_override": "filament.nozzle_temperature_initial_layer[0]",
        "actual_heater_temperature_measured": False,
        "wasm_parity": False,
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
    print("PASS: native initial nozzle temperature commands follow filament override", json.dumps(report))


if __name__ == "__main__":
    main()
