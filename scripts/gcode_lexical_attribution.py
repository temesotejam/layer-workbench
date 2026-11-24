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
        "semantic_equivalence_verified": False,
    }


def compare_lexical(native, wasm):
    if any(p.stat().st_size > MAX_BYTES for p in (native, wasm)):
        return {"status": "byte-limit"}
    return summarize([c for _, c in canonical(native)],
                     [c for _, c in canonical(wasm)])
