#!/usr/bin/env python3
"""Create a self-reported parity fixture manifest from local files.

Does not prove which slicer generated the files. Verify source and toolchain separately.
"""
import argparse
import hashlib
import json
from pathlib import Path
from check_parity_pair import KINDS, PIN

NAMES = {
    "model": "model.stl",
    "machine": "machine.json",
    "filament": "filament.json",
    "process": "process.json",
    "gcode": "gcode.gcode",
}

def generate(directory, engine):
    root = directory.resolve()
    if engine not in ("native", "wasm"):
        raise ValueError("engine must be native or wasm")
    if not root.is_dir():
        raise ValueError("fixture directory does not exist")
    entries = {}
    for kind in KINDS:
        path = root / NAMES[kind]
        if not path.is_file() or not path.resolve().is_relative_to(root):
            raise ValueError(f"missing or unsafe fixture: {kind}")
        if not 0 < path.stat().st_size <= 200_000_000:
            raise ValueError(f"empty or oversized fixture: {kind}")
        entries[kind] = {"path": NAMES[kind], "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    return {"engine": engine, "upstream_commit": PIN, "files": entries}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--engine", choices=("native", "wasm"), required=True)
    args = parser.parse_args()
    try:
        manifest = generate(args.directory, args.engine)
        target = args.directory / "manifest.json"
        if target.is_symlink():
            raise ValueError("refusing to overwrite symlink")
        target.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(target)
    except (OSError, ValueError) as error:
        parser.error(str(error))

if __name__ == "__main__":
    main()
