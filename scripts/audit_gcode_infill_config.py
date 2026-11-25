"""Read-only, allowlisted comparison of Orca v2.5.0 serialized G-code config.

This is not the effective per-object/per-region configuration. Never emit values,
unknown keys, raw lines or filenames, and never affect the strict motion gate.
"""
import re
import zipfile
from pathlib import Path

from audit_native_3mf_metadata_loss import PROJECT, _config
from compare_3mf_metadata import inventory

KEYS = (
    "layer_height", "initial_layer_print_height", "wall_loops",
    "sparse_infill_density", "sparse_infill_pattern", "infill_direction",
    "solid_infill_direction", "infill_anchor", "infill_anchor_max",
    "infill_wall_overlap", "infill_combination",
    "infill_combination_max_layer_height", "sparse_infill_line_width",
    "sparse_infill_flow_ratio", "sparse_infill_speed",
    "internal_solid_infill_line_width", "internal_solid_infill_flow_ratio",
    "internal_solid_infill_speed", "top_surface_pattern", "bottom_surface_pattern",
    "internal_solid_infill_pattern", "align_infill_direction_to_model", "separated_infills",
)
MAX_BYTES = 12_000_000
KEY_LINE = re.compile(r"^; ([a-z][a-z0-9_]*) = (.*)$")


def _parse_config(path):
    """Return (bounded status, values or None); never include raw data in status."""
    try:
        with Path(path).open("rb") as f:
            raw = f.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            return "too-large", None
        # Orca writes LF-delimited records; splitlines() also splits on
        # Unicode separators and control characters inside serialized strings.
        lines = raw.decode("utf-8").split("\n")
    except OSError:
        return "read-error", None
    except UnicodeError:
        return "invalid-utf8", None
    state = 0
    values = {}
    for line in lines:
        # Accept CRLF, but not a bare CR embedded in a config record.
        line = line.removesuffix("\r")
        if line == "; CONFIG_BLOCK_START":
            if state != 0:
                return "repeated-start", None
            state = 1
        elif line == "; CONFIG_BLOCK_END":
            if state != 1:
                return "unexpected-end", None
            state = 2
        elif state == 1:
            if "\r" in line:
                return "embedded-carriage-return", None
            # Empty and horizontal-whitespace-only physical records carry
            # neither a setting nor a machine command. Other noncomments
            # still invalidate the entire block.
            if not line.strip(" \t"):
                continue
            if not line.startswith(";"):
                return "noncomment-in-block", None
            match = KEY_LINE.fullmatch(line)
            if match and match[1] in KEYS:
                key, value = match.groups()
                if key in values:
                    return "duplicate-allowlisted-key", None
                if not value or len(value) > 1024:
                    return "invalid-allowlisted-value", None
                values[key] = value
            elif any(line.startswith("; " + key + " ") or
                     line.startswith("; " + key + "=") for key in KEYS):
                return "malformed-allowlisted-line", None
    if state == 0:
        return "no-delimiters", None
    if state == 1:
        return "missing-end", None
    if not values:
        return "no-allowlisted-values", None
    return "available", values


def parse_config(path):
    """Compatibility wrapper: return None for unavailable/ambiguous blocks."""
    return _parse_config(path)[1]


def embedded_skip_config_status(archive):
    """Classify only the source project's serialized skip flag, not applied config."""
    if archive is None:
        return "not-checked"
    try:
        settings = _config(archive, inventory(archive))
        if settings is None:
            return "missing-project-config"
        if "gcode_skip_config_block" not in settings:
            return "missing-key"
        value = settings["gcode_skip_config_block"]
        # _config canonicalizes JSON; never coerce arbitrary strings/numbers.
        if value in ('"0"', '0', 'false'):
            return "explicit-disabled"
        if value in ('"1"', '1', 'true'):
            return "explicit-enabled"
        return "unrecognized-value"
    except (ValueError, OSError, zipfile.BadZipFile, RuntimeError, EOFError,
            OverflowError, RecursionError, NotImplementedError):
        return "invalid-archive-or-config"


def compare_infill_config(native, wasm, *, archive=None):
    native_status, a = _parse_config(native)
    wasm_status, b = _parse_config(wasm)
    report = {
        "native_block_available": a is not None,
        "wasm_block_available": b is not None,
        "native_block_status": native_status,
        "wasm_block_status": wasm_status,
        "source_skip_config_block_status": embedded_skip_config_status(archive),
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
