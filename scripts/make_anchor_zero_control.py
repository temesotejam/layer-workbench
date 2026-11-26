"""CI-only one-setting intervention on the generated native fixture."""
import argparse
import json
import re
from pathlib import Path
import zipfile

from audit_native_3mf_metadata_loss import PROJECT, MODEL, _config, _unique_pairs, _reject_constant
from compare_3mf_metadata import inventory

KEY = "infill_anchor"

def make_control(source, destination, key=KEY):
    if key not in (KEY, "infill_anchor_max"):
        raise ValueError("Unsupported intervention")
    source, destination = Path(source), Path(destination)
    if not 300 < source.stat().st_size <= 4_000_000:
        raise ValueError("Fixture archive size outside bounds")
    before = inventory(source)
    old = _config(source, before)
    if old is None or MODEL not in before or key not in old:
        raise ValueError("Missing native fixture settings")
    value = json.loads(old[key])
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?%?", value) or float(value.rstrip("%")) <= 0:
        raise ValueError("Expected positive serialized anchor length")
    with zipfile.ZipFile(source) as original:
        data = json.loads(original.read(PROJECT).decode("utf-8-sig"),
                          object_pairs_hook=_unique_pairs, parse_constant=_reject_constant)
        data[key] = "0"
        with zipfile.ZipFile(destination, "x", compression=zipfile.ZIP_DEFLATED) as output:
            for item in original.infolist():
                payload = (json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
                           if item.filename == PROJECT else original.read(item))
                output.writestr(item, payload)
    after = inventory(destination)
    new = _config(destination, after)
    if (before.keys() != after.keys() or
            {k for k in before if before[k] != after[k]} != {PROJECT} or
            old.keys() != new.keys() or
            {k for k in old if old[k] != new[k]} != {key} or
            new[key] != '"0"'):
        raise ValueError("Unexpected archive or setting change")
    return {"changed_members": 1, "changed_settings": 1, "print_approved": False}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("destination")
    parser.add_argument("--max-only", action="store_true", help="Change only infill_anchor_max")
    args = parser.parse_args()
    try:
        result = make_control(args.source, args.destination, "infill_anchor_max" if args.max_only else KEY)
    except (ValueError, OSError, RuntimeError, zipfile.BadZipFile, EOFError, OverflowError, RecursionError):
        raise SystemExit("Anchor control refused invalid fixture")
    print("ANCHOR_ZERO_ARCHIVE " + json.dumps(result, sort_keys=True))
