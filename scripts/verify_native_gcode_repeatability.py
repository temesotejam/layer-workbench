#!/usr/bin/env python3
"""Audit repeated official-native v2.5.0 slices for command reproducibility.

Run ONLY on two runs of the same native executable with the same verified
model, full profiles and command-line options. This does NOT compare WASM,
verify input provenance, or certify a G-code file for physical printing.
Comments, blank lines and numeric formatting are ignored by the existing
strict ordered-command comparator; all G/M/T commands remain ordered.
"""
import argparse
import hashlib
import json
from pathlib import Path

from compare_gcode import canonical, compare

MIN_SIZE = 1024
MAX_SIZE = 20_000_000


def fingerprint(path):
    commands = canonical(path)
    payload = "\n".join(command for _, command in commands).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def audit(first, repeat, minimum_extrusion=100):
    if minimum_extrusion < 1:
        raise ValueError("native repeat audit requires a positive extrusion threshold")
    for path in (first, repeat):
        size = path.stat().st_size
        if not MIN_SIZE <= size <= MAX_SIZE:
            raise ValueError(f"native G-code size outside bounded fixture: {path.name} ({size})")
    comparison = compare(first, repeat, min_extrusion_moves=minimum_extrusion)
    raw_equal = comparison["native_sha256"] == comparison["wasm_sha256"]
    canonical_first, canonical_repeat = fingerprint(first), fingerprint(repeat)
    command_equal = canonical_first == canonical_repeat
    # A mere matching hash is never sufficient: require real deposited paths
    # on BOTH sides and exact ordered canonical commands as well.
    passed = comparison["match"] and command_equal
    return {
        "pass": passed,
        "comparison_scope": "official native v2.5.0, same fixture/flags, repeated CLI process",
        "native_vs_wasm_compared": False,
        "full_input_provenance_checked_by_this_script": False,
        "raw_sha256_equal": raw_equal,
        "raw_sha256": {
            "first": comparison["native_sha256"],
            "repeat": comparison["wasm_sha256"],
        },
        "ordered_command_sha256_equal": command_equal,
        "ordered_command_sha256": {"first": canonical_first, "repeat": canonical_repeat},
        "first_command_count": comparison["native_commands"],
        "repeat_command_count": comparison["wasm_commands"],
        "first_positive_xy_extrusion_moves": comparison["native_extrusion_moves"],
        "repeat_positive_xy_extrusion_moves": comparison["wasm_extrusion_moves"],
        "minimum_extrusion_moves": minimum_extrusion,
        "ordered_command_mismatches": comparison["mismatched_commands"],
        "first_differences": comparison["first_differences"],
        "input_issues": comparison["input_issues"],
        "raw_differs_but_ordered_commands_match": not raw_equal and passed,
        "note": "An ordered-command match is a repeatability prerequisite, not native/WASM parity or print safety.",
        "usable_for_printing": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--first", type=Path, required=True)
    parser.add_argument("--repeat", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--minimum-extrusion", type=int, default=100)
    args = parser.parse_args()
    try:
        result = audit(args.first, args.repeat, args.minimum_extrusion)
    except (OSError, UnicodeError, ValueError) as error:
        result = {"pass": False, "error": str(error),
                  "native_vs_wasm_compared": False, "usable_for_printing": False}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result.get("pass") else 1


if __name__ == "__main__":
    raise SystemExit(main())
