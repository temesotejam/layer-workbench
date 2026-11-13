#!/usr/bin/env python3
"""Fail-closed provenance gate for paired native/WASM G-code fixtures.

This validates self-reported fixture hashes; it does not prove producer identity.
"""
import argparse
import hashlib
import json
from pathlib import Path
from compare_gcode import compare

PIN = "40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19"
KINDS = ("model", "machine", "filament", "process", "gcode")

def read_manifest(path, role):
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("engine") != role or data.get("upstream_commit") != PIN:
        raise ValueError(f"{role}: incorrect engine or unpinned revision")
    files = data.get("files")
    if not isinstance(files, dict) or set(files) != set(KINDS):
        raise ValueError(f"{role}: expected model/machine/filament/process/gcode")
    out = {}
    for kind in KINDS:
        entry = files[kind]
        if not isinstance(entry, dict) or set(entry) != {"path", "sha256"}:
            raise ValueError(f"{role}: invalid {kind} entry")
        rel, sha = entry["path"], entry["sha256"]
        if not isinstance(rel, str) or not rel or Path(rel).is_absolute() or "\\" in rel:
            raise ValueError(f"{role}: invalid relative path for {kind}")
        full = (path.parent / rel).resolve()
        if not full.is_relative_to(path.parent.resolve()) or not full.is_file():
            raise ValueError(f"{role}: missing or outside-fixture {kind}")
        if not isinstance(sha, str) or len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
            raise ValueError(f"{role}: invalid sha256 for {kind}")
        if not 0 < full.stat().st_size <= 200_000_000:
            raise ValueError(f"{role}: empty or oversized {kind}")
        if hashlib.sha256(full.read_bytes()).hexdigest() != sha:
            raise ValueError(f"{role}: SHA256 mismatch for {kind}")
        out[kind] = (sha, full)
    return out

def verify(native_manifest, wasm_manifest, minimum=1):
    if minimum < 1:
        raise ValueError("minimum extrusion moves must be positive")
    n = read_manifest(native_manifest, "native")
    w = read_manifest(wasm_manifest, "wasm")
    different = [k for k in KINDS if k != "gcode" and n[k][0] != w[k][0]]
    report = {"upstream_commit": PIN, "different_inputs": different,
              "input_hashes_match": not different, "match": False}
    if different:
        return report
    result = compare(n["gcode"][1], w["gcode"][1], min_extrusion_moves=minimum)
    report["gcode_comparison"] = result
    report["match"] = result["match"]
    return report

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--native-manifest", required=True, type=Path)
    p.add_argument("--wasm-manifest", required=True, type=Path)
    p.add_argument("--min-extrusion-moves", type=int, default=1)
    p.add_argument("--report", type=Path)
    args = p.parse_args()
    try:
        report = verify(args.native_manifest, args.wasm_manifest, args.min_extrusion_moves)
    except (OSError, ValueError, UnicodeError, KeyError, TypeError) as exc:
        report = {"match": False, "error": str(exc)}
    output = json.dumps(report, ensure_ascii=False, indent=2, default=str)
    print(output)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(output + "\n", encoding="utf-8")
    return 0 if report.get("match") else 1

if __name__ == "__main__":
    raise SystemExit(main())
