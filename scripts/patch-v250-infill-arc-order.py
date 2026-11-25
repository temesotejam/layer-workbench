#!/usr/bin/env python3
"""Stage a CI-only deterministic arc-sort candidate against pinned OrcaSlicer.

Not used by the accepted WASM build. Upstream source stays in CI; see
OrcaSlicer LICENSE.txt (AGPL-3.0) at the pinned revision.
"""
import argparse
import hashlib
from pathlib import Path

UPSTREAM_BLOB = "ce35b145d289b92fff2d75344366d82d334e8468"
OLD_PRIMARY = "[](const auto& l, const auto& r) { return l.arc_length < r.arc_length; }"
PRIMARY = """[&end_index](const auto& l, const auto& r) {
            if (l.arc_length != r.arc_length)
                return l.arc_length < r.arc_length;
            if (l.intersection->contour_idx != r.intersection->contour_idx)
                return l.intersection->contour_idx < r.intersection->contour_idx;
            if (l.intersection->param != r.intersection->param)
                return l.intersection->param < r.intersection->param;
            return end_index(l.intersection) < end_index(r.intersection);
        }"""
OLD_SECONDARY = """[bucket, backwards](const Arc &l, const Arc &r) {
                const long long bucket_l = std::llround(l.arc_length / bucket), bucket_r = std::llround(r.arc_length / bucket);
                if (bucket_l != bucket_r)
                    return bucket_l < bucket_r;
                if (l.intersection->contour_idx != r.intersection->contour_idx)
                    return l.intersection->contour_idx < r.intersection->contour_idx;
                return backwards ? l.intersection->param > r.intersection->param : l.intersection->param < r.intersection->param;
            }"""
SECONDARY = OLD_SECONDARY.replace("[bucket, backwards]", "[bucket, backwards, &end_index]").replace(
    "return backwards ? l.intersection->param > r.intersection->param : l.intersection->param < r.intersection->param;",
    """if (l.intersection->param != r.intersection->param)
                    return backwards ? l.intersection->param > r.intersection->param : l.intersection->param < r.intersection->param;
                return end_index(l.intersection) < end_index(r.intersection);""",
)

# The original two distance loops infer direction from equality with lprev.
# When both distances are identical, this tries the previous endpoint twice.
# Keep previous-first tie order, but explicitly visit the other side on retry.
DIRECTIONS = """[](double lprev, double lnext) {
        return std::array<bool, 2>{lprev <= lnext, lprev > lnext};
    }"""

def stage_neighbor_fallback(src):
    replacements = [
        ("#include <algorithm>\n", "#include <algorithm>\n#include <array>\n"),
        ("    struct Arc {\n", "    auto ordered_directions = " + DIRECTIONS + ";\n\n    struct Arc {\n"),
        ("for (const double l : { std::min(lprev, lnext), std::max(lprev, lnext) }) {",
         "for (const bool reversed : ordered_directions(lprev, lnext)) {\n                    const double l = reversed ? lprev : lnext;"),
        ("end_index(l == lprev ? cp.prev_on_contour : cp.next_on_contour)",
         "end_index(reversed ? cp.prev_on_contour : cp.next_on_contour)"),
        ("for (double l : { std::min(lprev, lnext), std::max(lprev, lnext) }) {",
         "for (const bool reversed : ordered_directions(lprev, lnext)) {\n                const double l = reversed ? lprev : lnext;"),
        ("                bool      reversed      = l == lprev;\n", ""),
    ]
    for before, after in replacements:
        if src.count(before) != 1:
            raise ValueError("Pinned equal-neighbor fallback site drifted")
        src = src.replace(before, after)
    return src

def stage(raw):
    if hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest() != UPSTREAM_BLOB:
        raise ValueError("Unexpected upstream FillBase.cpp blob")
    src = raw.decode("utf-8")
    primary = "std::sort(arches.begin(), arches.end(), " + OLD_PRIMARY + ");"
    secondary = "std::sort(along_contour.begin(), along_contour.end(), " + OLD_SECONDARY + ");"
    if src.count(primary) != 1 or src.count(secondary) != 1:
        raise ValueError("Expected exactly one of each pinned sort")
    src = src.replace(primary, "std::sort(arches.begin(), arches.end(), " + PRIMARY + ");").replace(
        secondary, "std::sort(along_contour.begin(), along_contour.end(), " + SECONDARY + ");"
    )
    return stage_neighbor_fallback(src)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("source", type=Path)
    p.add_argument("out", type=Path)
    args = p.parse_args()
    raw = args.source.read_bytes()
    candidate = stage(raw)
    # A stale or already-patched source must fail closed.
    try:
        stage(candidate.encode("utf-8"))
    except ValueError:
        pass
    else:
        raise AssertionError("Patched input was accepted")
    args.out.mkdir()
    (args.out / "FillBase.cpp").write_text(candidate, encoding="utf-8")
    # Compile the very same lambda bodies, not separately reimplemented tests.
    (args.out / "arc-order-comparators.inc").write_text(
        "auto primary = " + PRIMARY + ";\nauto secondary = " + SECONDARY + ";\n"
        + "auto ordered_directions = " + DIRECTIONS + ";\n",
        encoding="utf-8",
    )
    if args.source.read_bytes() != raw:
        raise AssertionError("Source changed")
    print("PASS: exact pinned blob; two sort sites and two equal-neighbor loops staged, original unchanged")

if __name__ == "__main__":
    main()
