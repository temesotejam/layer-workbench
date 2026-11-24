#!/usr/bin/env python3
"""Bounded lexical command attribution; does not change the strict parity gate."""
from collections import Counter
import re

from compare_gcode import canonical

# Fixed vocabulary: arbitrary vendor macros, comments, and paths never leave
# this diagnostic. Unknown commands still participate in exact comparisons.
MOTION = frozenset(("G0", "G1", "G2", "G3"))
KNOWN = MOTION | frozenset((
    "G4", "G17", "G18", "G19", "G20", "G21", "G28", "G90", "G91", "G92",
    "M73", "M82", "M83", "M104", "M106", "M107", "M109", "M140", "M141",
    "M190", "M191", "M201", "M203", "M204", "M205", "M220", "M221",
    "M400", "M486", "M900", "M572", "M975", "M600", "M84",
))
MAX_COMMANDS = 100_000
MAX_BYTES = 12_000_000


def category(command):
    words = command.split()
    if words and re.fullmatch(r"N[0-9]+", words[0], re.ASCII):
        words = words[1:]
    if not words:
        return "other"
    opcode = words[0]
    if opcode in KNOWN:
        return opcode
    if re.fullmatch(r"T[0-9]{1,3}", opcode, re.ASCII):
        return "tool-selector"
    return "other"


# Diagnostic projection only: never use a stripped stream as a parity gate.
# F sets modal feedrate, so deleting it would hide real motion timing changes.
G1_WORD = re.compile(r"([XYZEF])([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)", re.ASCII)


def g1_projection(lines):
    counts = Counter()
    residual = []
    coordinates = {axis: [] for axis in "XYZE"}
    for command in lines:
        if category(command) != "G1":
            continue
        words = command.split()
        # Do not reinterpret numbered, duplicate, opaque or nonstandard moves.
        parsed = [G1_WORD.fullmatch(word) for word in words[1:]]
        if (words[0] != "G1" or not parsed or not all(parsed)
                or len({m[1] for m in parsed}) != len(parsed)):
            counts["opaque"] += 1
            residual.append(command)
            continue
        axes = {m[1] for m in parsed}
        if axes == {"F"}:
            counts["feed_only"] += 1
            continue
        counts["with_coordinate_words"] += 1
        if "F" in axes:
            counts["coordinate_with_feed"] += 1
        kept = [word for word, m in zip(words[1:], parsed) if m[1] != "F"]
        residual.append("G1 " + " ".join(kept))
        for m in parsed:
            if m[1] != "F":
                coordinates[m[1]].append(m[2])
    return counts, residual, coordinates


def summarize_g1_feed_projection(native, wasm):
    """Separate explicit F-only/mixed G1 words from ordered XYZ/E spelling.

    No modal interpretation, numeric tolerance, or firmware equivalence is
    inferred. Opaque moves are retained and prevent a complete projection.
    """
    a, na, xa = g1_projection(native)
    b, wb, xb = g1_projection(wasm)
    keys = ("feed_only", "with_coordinate_words", "coordinate_with_feed", "opaque")
    complete = a["opaque"] == b["opaque"] == 0
    residual_equal = na == wb
    # Per-axis subsequences ignore inter-axis association: diagnosis only.
    per_axis = {axis: {
        "native_words": len(xa[axis]), "wasm_words": len(xb[axis]),
        "ordered_words_equal": xa[axis] == xb[axis],
        "positional_word_mismatches": (
            sum(x != y for x, y in zip(xa[axis], xb[axis]))
            if len(xa[axis]) == len(xb[axis]) else None),
    } for axis in "XYZE"}
    return {
        "native": {k: a[k] for k in keys},
        "wasm": {k: b[k] for k in keys},
        "projection_complete": complete,
        "ordered_g1_without_f_equal": residual_equal if complete else None,
        "coordinate_word_diagnostics": per_axis if complete else None,
        "semantic_equivalence_verified": False,
    }


def summarize(native, wasm):
    """Compare canonical lines exactly; do not infer firmware semantics.

    Multiset overlap is order-independent, and therefore cannot prove
    equivalence. Motion-only equality also ignores modal/interleaved commands.
    Neither is ever a replacement for strict full-stream comparison.
    """
    if max(len(native), len(wasm)) > MAX_COMMANDS:
        return {"status": "command-limit"}
    a, b = Counter(native), Counter(wasm)
    common = a & b
    missing, added = a - b, b - a
    prefix = 0
    for x, y in zip(native, wasm):
        if x != y:
            break
        prefix += 1
    suffix = 0
    # Do not count the same shared commands twice if the streams are equal.
    for x, y in zip(reversed(native[prefix:]), reversed(wasm[prefix:])):
        if x != y:
            break
        suffix += 1
    def counts(values):
        result = Counter()
        for command, count in values.items():
            result[category(command)] += count
        return result
    n, w, shared = counts(a), counts(b), counts(common)
    rows = []
    for k in sorted(set(n) | set(w)):
        if n[k] != shared[k] or w[k] != shared[k]:
            rows.append({"category": k, "native": n[k], "wasm": w[k],
                         "exact_shared": shared[k],
                         "native_unmatched": n[k] - shared[k],
                         "wasm_unmatched": w[k] - shared[k]})
    def motion(lines):
        return [line for line in lines if category(line) in MOTION]
    def nonmotion(lines):
        return [line for line in lines if category(line) not in MOTION]
    return {
        "status": "measured",
        "native_commands": len(native), "wasm_commands": len(wasm),
        "exact_multiset_shared": sum(common.values()),
        "native_multiset_unmatched": sum(missing.values()),
        "wasm_multiset_unmatched": sum(added.values()),
        "exact_common_prefix": prefix, "exact_common_suffix": suffix,
        "motion_subsequence_equal": motion(native) == motion(wasm),
        "nonmotion_subsequence_equal": nonmotion(native) == nonmotion(wasm),
        "category_deltas": rows,
        "g1_feed_projection": summarize_g1_feed_projection(native, wasm),
        "semantic_equivalence_verified": False,
    }


def compare_lexical(native, wasm):
    if any(p.stat().st_size > MAX_BYTES for p in (native, wasm)):
        return {"status": "byte-limit"}
    return summarize([c for _, c in canonical(native)],
                     [c for _, c in canonical(wasm)])
