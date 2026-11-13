#!/usr/bin/env python3
"""Fail-closed, read-only 3MF ZIP member preservation audit; not semantic 3MF parity."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import sys
import zipfile

MAX_MEMBERS = 4096
MAX_MEMBER_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 256 * 1024 * 1024


def inventory(path):
    if not zipfile.is_zipfile(path):
        raise ValueError(f"Invalid ZIP/3MF archive: {path}")
    result = {}
    total = 0
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        if len(infos) > MAX_MEMBERS:
            raise ValueError("Too many 3MF ZIP members")
        for info in infos:
            name = info.filename
            pure = PurePosixPath(name)
            if (not name or name.startswith("/") or "\\" in name or "\x00" in name
                or any(p in ("", ".", "..") for p in name.rstrip("/").split("/"))
                or pure.is_absolute()):
                raise ValueError(f"Unsafe 3MF ZIP member path: {name!r}")
            mode = info.external_attr >> 16
            if stat.S_IFMT(mode) == stat.S_IFLNK:
                raise ValueError(f"Symlink in 3MF ZIP: {name!r}")
            if info.flag_bits & 1:
                raise ValueError("Encrypted 3MF ZIP member is unsupported")
            if info.is_dir():
                continue
            if name in result:
                raise ValueError(f"Duplicate 3MF ZIP member: {name!r}")
            total += info.file_size
            if info.file_size > MAX_MEMBER_BYTES or total > MAX_TOTAL_BYTES:
                raise ValueError("3MF ZIP uncompressed size exceeds audit limits")
            digest = hashlib.sha256()
            size = 0
            with archive.open(info) as handle:
                while block := handle.read(1024 * 1024):
                    size += len(block)
                    if size > MAX_MEMBER_BYTES:
                        raise ValueError("3MF ZIP member exceeds streaming limit")
                    digest.update(block)
            if size != info.file_size:
                raise ValueError("3MF ZIP member size differs from directory")
            result[name] = {"bytes": size, "sha256": digest.hexdigest()}
    if "[Content_Types].xml" not in result or not any(
        name.startswith("3D/") and name.endswith(".model") for name in result
    ):
        raise ValueError("Archive lacks required 3MF content-types or model part")
    return result


def compare(baseline, candidate, scope="all"):
    if scope not in ("all", "metadata"):
        raise ValueError("Invalid 3MF comparison scope")
    before, after = inventory(baseline), inventory(candidate)
    select = lambda name: scope == "all" or name.startswith("Metadata/")
    selected_before = {k: v for k, v in before.items() if select(k)}
    selected_after = {k: v for k, v in after.items() if select(k)}
    if not selected_before or not selected_after:
        raise ValueError("No selected 3MF members; refusing vacuous match")
    old, new = set(selected_before), set(selected_after)
    missing = sorted(old - new)
    added = sorted(new - old)
    changed = sorted(k for k in old & new if selected_before[k] != selected_after[k])
    return {
        "baseline": str(baseline), "candidate": str(candidate), "scope": scope,
        "baseline_members": len(before), "candidate_members": len(after),
        "checked_members": len(old | new),
        "missing": missing, "added": added,
        "changed": [{"path": k, "baseline_sha256": selected_before[k]["sha256"],
                     "candidate_sha256": selected_after[k]["sha256"]} for k in changed],
        "match": not (missing or added or changed),
        "limitations": "Raw member-byte preservation only; metadata scope excludes model geometry, relationships and textures outside Metadata/. No native round-trip or print-safety certification."
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--scope", choices=("all", "metadata"), default="all")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        report = compare(args.baseline, args.candidate, args.scope)
    except (ValueError, OSError, zipfile.BadZipFile, RuntimeError, EOFError) as exc:
        print(f"3MF validation error: {exc}", file=sys.stderr)
        return 2
    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.write_text(output + "\n", encoding="utf-8")
    else:
        print(output)
    return 0 if report["match"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
