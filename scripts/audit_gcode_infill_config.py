"""Read-only, allowlisted comparison of Orca v2.5.0 serialized G-code config.

This is not the effective per-object/per-region configuration. Never emit values,
unknown keys, raw lines or filenames, and never affect the strict motion gate.
"""
import re
from pathlib import Path

KEYS = (
    "layer_height", "initial_layer_print_height", "wall_loops",
    "sparse_infill_density", "sparse_infill_pattern", "infill_direction",
    "solid_infill_direction", "infill_anchor", "infill_anchor_max",
    "infill_wall_overlap", "infill_combination",
    "infill_combination_max_layer_height", "sparse_infill_line_width",
    "sparse_infill_flow_ratio", "sparse_infill_speed",
    "internal_solid_infill_line_width", "internal_solid_infill_flow_ratio",
    "internal_solid_infill_speed", "top_surface_pattern", "bottom_surface_pattern",
)
MAX_BYTES = 12_000_000
KEY_LINE = re.compile(r"^; ([a-z][a-z0-9_]*) = (.*)$")


def parse_config(path):
    """Return None for unavailable/ambiguous blocks, never guess from comments."""
    try:
        with Path(path).open("rb") as f:
            raw = f.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            return None
        lines = raw.decode("utf-8").splitlines()
    except (OSError, UnicodeError):
        return None
    state = 0
    values = {}
    for line in lines:
        if line == "; CONFIG_BLOCK_START":
            if state != 0:
                return None
            state = 1
        elif line == "; CONFIG_BLOCK_END":
            if state != 1:
                return None
            state = 2
        elif state == 1:
            if not line.startswith(";"):
                return None
            match = KEY_LINE.fullmatch(line)
            if match and match[1] in KEYS:
                key, value = match.groups()
                if key in values or not value or len(value) > 1024:
                    return None
                values[key] = value
            elif any(line.startswith("; " + key + " ") or
                     line.startswith("; " + key + "=") for key in KEYS):
                return None
    return values if state == 2 and values else None


def compare_infill_config(native, wasm):
    a, b = parse_config(native), parse_config(wasm)
    report = {
        "native_block_available": a is not None,
        "wasm_block_available": b is not None,
        "scope": "allowlisted_serialized_config_only",
        "effective_full_profile_equivalence_verified": False,
        "usable_for_printing": False,
        "allowlisted_key_count": len(KEYS),
        "equal_keys": None,
        "different_keys": None,
        "native_only_keys": None,
        "wasm_only_keys": None,
        "absent_both_keys": None,
    }
    if a is None or b is None:
        return report
    report.update(
        equal_keys=sorted(k for k in a.keys() & b.keys() if a[k] == b[k]),
        different_keys=sorted(k for k in a.keys() & b.keys() if a[k] != b[k]),
        native_only_keys=sorted(a.keys() - b.keys()),
        wasm_only_keys=sorted(b.keys() - a.keys()),
        absent_both_keys=sorted(set(KEYS) - a.keys() - b.keys()),
    )
    return report
