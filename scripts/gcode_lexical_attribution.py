#!/usr/bin/env python3
"""Bounded lexical command attribution; does not change the strict parity gate."""
from collections import Counter
from decimal import Decimal, DecimalException, localcontext
import re
import math

from compare_gcode import canonical, extrusion_move_metrics, gcode_feature_context

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



# Fixed labels from the pinned upstream GCodeWriter.cpp. Never log raw
# comments, and never treat a missing comment as proof of absent Z-hop.
LIFT_COMMENTS = {
    "lift Z": "lift",
    "normal lift Z": "normal-lift",
    "spiral lift Z": "spiral-lift",
    "restore layer Z": "restore-layer",
}

def bounded_comment_labels(path, commands):
    raw = path.read_text(encoding="utf-8-sig", errors="strict").splitlines()
    result = []
    for line_no, _ in commands:
        _, sep, comment = raw[line_no - 1].partition(";")
        label = comment.strip()
        result.append(LIFT_COMMENTS.get(label, "other") if sep and label else "absent")
    return result


def numeric_word_delta_buckets(pairs):
    """Magnitude of lexical word differences, not modal or physical displacement."""
    counts = dict.fromkeys(("equal", "le_0_001", "le_0_01", "le_0_1",
                            "gt_0_1"), 0)
    try:
        for x, y in pairs:
            if x is None or y is None:
                continue
            if len(x) > 64 or len(y) > 64:
                return None
            a, b = Decimal(x), Decimal(y)
            if any(not d.is_finite() or abs(d.adjusted()) > 12
                   or abs(d.as_tuple().exponent) > 24 for d in (a, b)):
                return None
            delta = abs(b - a)
            key = ("equal" if not delta else "le_0_001" if delta <= Decimal("0.001")
                   else "le_0_01" if delta <= Decimal("0.01")
                   else "le_0_1" if delta <= Decimal("0.1") else "gt_0_1")
            counts[key] += 1
    except DecimalException:
        return None
    return counts


def unique_insertion_index(a, b):
    """Return the sole exact deletion that restores a, or None if ambiguous.

    Prefix/suffix overlap computes all admissible deletion positions in O(n).
    This does not align windows whose other commands also differ.
    """
    if len(b) != len(a) + 1:
        return None
    prefix = 0
    while prefix < len(a) and a[prefix] == b[prefix]:
        prefix += 1
    suffix = 0
    while suffix < len(a) and a[-1 - suffix] == b[-1 - suffix]:
        suffix += 1
    first = len(a) - suffix
    return prefix if first == prefix else None


def summarize_xy_anchor_offsets(ea, eb):
    """Compare explicit XY words, not modal positions or physical strokes.

    Count exact endpoint overlap independent of ordinal order, and repeated
    translation vectors by ordinal. Never emit coordinates or vector values.
    A dominant vector can suggest a placement/order difference, but cannot
    establish a physical object mapping or permit a parity PASS.
    """
    def point(values):
        if not all(axis in values for axis in "XY"):
            return None
        result = []
        for axis in "XY":
            token = values[axis]
            if len(token) > 64:
                raise ValueError("numeric bound")
            value = Decimal(token)
            if (not value.is_finite() or abs(value.adjusted()) > 12
                    or abs(value.as_tuple().exponent) > 24):
                raise ValueError("numeric bound")
            result.append(value)
        return tuple(result)

    try:
        with localcontext() as ctx:
            ctx.prec = 80
            a = [point(values) for _, values in ea]
            b = [point(values) for _, values in eb]
            offsets = Counter()
            longest = current = 0
            previous = None
            for x, y in zip(a, b):
                if x is None or y is None:
                    previous, current = None, 0
                    continue
                delta = tuple(v - u for u, v in zip(x, y))
                offsets[delta] += 1
                current = (current + 1 if delta == previous else 1)
                if any(delta):
                    longest = max(longest, current)
                previous = delta
            ca = Counter(p for p in a if p is not None)
            cb = Counter(p for p in b if p is not None)
            nonzero = [count for delta, count in offsets.items() if any(delta)]
            return {
                "status": "measured" if offsets else "unavailable",
                "native_explicit_xy_anchors": sum(ca.values()),
                "wasm_explicit_xy_anchors": sum(cb.values()),
                "exact_xy_endpoint_multiset_overlap": sum((ca & cb).values()),
                "paired_explicit_xy_anchors": sum(offsets.values()),
                "ordinal_equal_xy": offsets.get((Decimal(0), Decimal(0)), 0),
                "distinct_nonzero_ordinal_offsets": len(nonzero),
                "largest_nonzero_offset_group": max(nonzero, default=0),
                "longest_consecutive_same_nonzero_offset": longest,
                "semantic_equivalence_verified": False,
            }
    except (DecimalException, ValueError):
        return {"status": "numeric-bound", "semantic_equivalence_verified": False}


def summarize_g1_e_anchors(native, wasm, native_labels=None, wasm_labels=None):
    """Count explicit word masks and compare G1 windows by E-word ordinal.

    E is a lexical anchor, not necessarily extrusion: it can be a retract,
    reset-relative value, or prime. No modal positions or firmware state
    are inferred. Even matching windows do not establish path equivalence.
    """
    def collect(lines, labels):
        masks = Counter()
        anchors = []
        windows = [[]]
        comments = [[]]
        for index, command in enumerate(lines):
            if category(command) != "G1":
                continue
            words = command.split()
            parsed = [G1_WORD.fullmatch(word) for word in words[1:]]
            if (words[0] != "G1" or not parsed or not all(parsed)
                    or len({m[1] for m in parsed}) != len(parsed)):
                return None
            values = {m[1]: m[2] for m in parsed}
            mask = "".join(axis for axis in "XYZEF" if axis in values)
            masks[mask] += 1
            if "E" in values:
                anchors.append((mask, values))
                windows.append([])
                comments.append([])
            elif any(axis in values for axis in "XYZ"):
                # Include F and all explicit coordinates in this comparison.
                windows[-1].append(command)
                comments[-1].append(labels[index] if labels is not None else "unavailable")
        return masks, anchors, windows, comments

    a, b = collect(native, native_labels), collect(wasm, wasm_labels)
    result = {"projection_complete": a is not None and b is not None,
              "semantic_equivalence_verified": False}
    if a is None or b is None:
        return result
    na, ea, wa, ca = a
    nb, eb, wb, cb = b
    result["word_mask_deltas"] = [
        {"mask": k, "native": na[k], "wasm": nb[k]}
        for k in sorted(na.keys() | nb.keys()) if na[k] != nb[k]]
    result["native_e_word_commands"] = len(ea)
    result["wasm_e_word_commands"] = len(eb)
    result["ordinal_comparison"] = None
    if len(ea) != len(eb) or not ea:
        return result
    # Equal counts do not prove the anchors refer to the same physical move.
    # An ordinal comparison is strictly diagnostic and never a parity gate.
    mismatched_masks = sum(x[0] != y[0] for x, y in zip(ea, eb))
    axis_counts = {}
    for axis in "XYZEF":
        pairs = [(x[1].get(axis), y[1].get(axis)) for x, y in zip(ea, eb)]
        axis_counts[axis] = {
            "presence_mismatches": sum((x is None) != (y is None) for x, y in pairs),
            "value_mismatches_when_present_in_both": sum(
                x is not None and y is not None and x != y for x, y in pairs),
            "absolute_word_delta_buckets": numeric_word_delta_buckets(pairs),
        }
    # Attribute only unambiguous exact one-insertion windows. For windows
    # with other changes, summarize all XYZ-only labels without claiming
    # which command was inserted.
    inserted = Counter()
    longer_native_xyz = Counter()
    longer_wasm_xyz = Counter()
    single_extra = exact_unique = 0
    for x, y, nx, wy in zip(wa, wb, ca, cb):
        if len(y) != len(x) + 1:
            continue
        single_extra += 1
        for commands, labels, counts in ((x, nx, longer_native_xyz),
                                          (y, wy, longer_wasm_xyz)):
            for command, label in zip(commands, labels):
                words = command.split()[1:]
                if {word[0] for word in words} == set("XYZ"):
                    counts[label] += 1
        index = unique_insertion_index(x, y)
        if index is not None:
            exact_unique += 1
            inserted[wy[index]] += 1
    result["xy_anchor_offset_diagnostics"] = summarize_xy_anchor_offsets(ea, eb)
    result["single_extra_window_attribution"] = {
        "windows": single_extra,
        "empty_native_windows": sum(not x and len(y) == 1 for x, y in zip(wa, wb)),
        "nonempty_native_windows": sum(bool(x) and len(y) == len(x) + 1
                                       for x, y in zip(wa, wb)),
        "exact_unique_insertion_windows": exact_unique,
        "unresolved_windows": single_extra - exact_unique,
        "uniquely_inserted_comment_labels": dict(sorted(inserted.items())),
        "all_native_xyz_only_labels_in_these_windows": dict(sorted(longer_native_xyz.items())),
        "all_wasm_xyz_only_labels_in_these_windows": dict(sorted(longer_wasm_xyz.items())),
    }
    result["ordinal_comparison"] = {
        "e_word_mask_mismatches": mismatched_masks,
        "e_word_axis_counts": axis_counts,
        "non_e_coordinate_windows": len(wa),
        "window_count_mismatches": sum(len(x) != len(y) for x, y in zip(wa, wb)),
        "windows_with_more_wasm_commands": sum(len(x) < len(y) for x, y in zip(wa, wb)),
        "windows_with_more_native_commands": sum(len(x) > len(y) for x, y in zip(wa, wb)),
        "exact_window_mismatches": sum(x != y for x, y in zip(wa, wb)),
        "max_wasm_extra_commands_in_one_window": max(
            0, max(len(y) - len(x) for x, y in zip(wa, wb))),
    }
    return result


def summarize(native, wasm, native_labels=None, wasm_labels=None):
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
        "g1_e_anchor_diagnostics": summarize_g1_e_anchors(
            native, wasm, native_labels, wasm_labels),
        "semantic_equivalence_verified": False,
    }



def compare_collinear_coverage(a, b):
    """Exact planar line coverage with multiplicity, independent of splitting.

    Group by exact Z, recognized feature tag and infinite supporting line.
    Integer micrometre/1000 lattice (1e-6 mm), no tolerance or rounding of
    endpoints. Reject off-lattice coordinates rather than snap them. The
    interval sweep compares deposition traversal counts, not deposited volume
    or firmware semantics. Lengths are rounded only for the numeric report.
    """
    scale = 1_000_000
    def lattice(value):
        if not value.is_finite() or abs(value) > 1_000_000:
            raise ValueError("coordinate-bound")
        # Guard against huge exponents before converting to integer ratios.
        if value and value.adjusted() < -6:
            raise ValueError("coordinate-precision")
        n, d = value.as_integer_ratio()
        q, rem = divmod(n * scale, d)
        if rem:
            raise ValueError("coordinate-precision")
        return q

    groups = {}
    try:
        for side, strokes in enumerate((a, b)):
            for z, label, start, end, _ in strokes:
                z = lattice(z)
                x, y = map(lattice, start)
                xx, yy = map(lattice, end)
                dx, dy = xx - x, yy - y
                g = math.gcd(dx, dy)
                if not g:
                    raise ValueError("zero-stroke")
                u, v = dx // g, dy // g
                if u < 0 or (u == 0 and v < 0):
                    u, v = -u, -v
                # Cross-product fixes the supporting line, dot-product
                # provides an integer interval coordinate on that line.
                key = (z, label, u, v, u * y - v * x)
                lo, hi = sorted((u * x + v * y, u * xx + v * yy))
                events = groups.setdefault(key, {})
                for t, delta in ((lo, 1), (hi, -1)):
                    events.setdefault(t, [0, 0])[side] += delta
    except ValueError:
        return {"status": "unsupported-coordinate-lattice",
                "semantic_equivalence_verified": False}

    # Exact sparse directions and supporting lines at each Z, not rounded
    # angles or object identities. Missing parallel lines can have multiple
    # causes (phase, clipping, quantization, object assignment).
    directions = [set(), set()]
    presence = {}
    for key, events in groups.items():
        z, label, u, v, _ = key
        if label != "sparse infill":
            continue
        present = tuple(any(delta[side] > 0 for delta in events.values())
                        for side in (0, 1))
        presence[key] = present
        for side in (0, 1):
            if present[side]:
                directions[side].add((z, u, v))
    buckets = ("direction_absent_mm", "parallel_line_absent_mm",
               "shared_line_coverage_mm")
    sparse = [dict.fromkeys(buckets, 0.0) for _ in (0, 1)]
    # A shared supporting line can still have different spatial support or
    # traversal multiplicity. Track these independently of the prior buckets.
    shared_details = [dict.fromkeys(("exclusive_mm", "excess_traversal_mm"), 0.0)
                      for _ in (0, 1)]
    shared_group_counts = dict.fromkeys((
        "equal_total_length", "native_longer", "wasm_longer",
        "exclusive_only", "multiplicity_only", "mixed"), 0)
    by_feature = {}
    changed_planes = set()
    for key, events in groups.items():
        z, label, u, v, _ = key
        classes = None
        if label == "sparse infill":
            classes = [
                "shared_line_coverage_mm" if presence[key][1 - side] else
                "parallel_line_absent_mm" if (z, u, v) in directions[1 - side]
                else "direction_absent_mm"
                for side in (0, 1)]
        row = by_feature.setdefault(label, {
            "line_groups": 0, "different_line_groups": 0,
            "native_unmatched_mm": 0.0, "wasm_unmatched_mm": 0.0,
            "shared_mm": 0.0})
        row["line_groups"] += 1
        active = [0, 0]
        previous = None
        changed = False
        shared_sparse = classes is not None and all(presence[key])
        # Compare total lengths in the exact integer dot-product coordinate
        # of this single line, not rounded floating-point millimetres.
        line_totals = [0, 0]
        exclusive = multiplicity = False
        denominator = math.hypot(u, v) * scale
        for t, deltas in sorted(events.items()):
            if previous is not None:
                distance = (t - previous) / denominator
                row["shared_mm"] += min(active) * distance
                row["native_unmatched_mm"] += max(0, active[0] - active[1]) * distance
                row["wasm_unmatched_mm"] += max(0, active[1] - active[0]) * distance
                if classes is not None:
                    for side in (0, 1):
                        sparse[side][classes[side]] += (
                            max(0, active[side] - active[1 - side]) * distance)
                if shared_sparse:
                    for side in (0, 1):
                        line_totals[side] += active[side] * (t - previous)
                        excess = max(0, active[side] - active[1 - side])
                        if excess:
                            if active[1 - side] == 0:
                                exclusive = True
                                shared_details[side]["exclusive_mm"] += excess * distance
                            else:
                                multiplicity = True
                                shared_details[side]["excess_traversal_mm"] += excess * distance
                changed |= active[0] != active[1]
            active[0] += deltas[0]
            active[1] += deltas[1]
            previous = t
        if changed:
            row["different_line_groups"] += 1
            changed_planes.add(z)
            if shared_sparse:
                length_class = ("equal_total_length" if line_totals[0] == line_totals[1]
                                else "native_longer" if line_totals[0] > line_totals[1]
                                else "wasm_longer")
                shared_group_counts[length_class] += 1
                coverage_class = ("mixed" if exclusive and multiplicity
                                  else "exclusive_only" if exclusive else "multiplicity_only")
                shared_group_counts[coverage_class] += 1
    for row in by_feature.values():
        for key in ("native_unmatched_mm", "wasm_unmatched_mm", "shared_mm"):
            row[key] = round(row[key], 6)
    return {"status": "measured", "planes_with_different_coverage": len(changed_planes),
            "by_feature": dict(sorted(by_feature.items())),
            "sparse_line_alignment": {
                "status": "measured" if presence else "no-sparse-infill",
                "observed_planes": len({d[0] for d in directions[0] | directions[1]}),
                "planes_with_different_direction_sets": len({
                    d[0] for d in directions[0] ^ directions[1]}),
                "native_unmatched": {k: round(v, 6) for k, v in sparse[0].items()},
                "wasm_unmatched": {k: round(v, 6) for k, v in sparse[1].items()},
                "shared_line_detail": {
                    "native": {k: round(v, 6) for k, v in shared_details[0].items()},
                    "wasm": {k: round(v, 6) for k, v in shared_details[1].items()},
                    "changed_group_counts": shared_group_counts,
                },
                "semantic_equivalence_verified": False,
            },
            "semantic_equivalence_verified": False}


def compare_planar_strokes(native_path, wasm_path, native_commands, wasm_commands):
    """Count exact directed/undirected G1 positive-E strokes, including Z.

    Reuse the existing fixture modal parser rather than infer segments from
    adjacent E words (travel, G92 and primes intervene). Emit counts only.
    Arcs, nonplanar moves, timing, travel, homing and vendor-specific state
    are outside this projection. It cannot establish firmware equivalence.
    """
    traces = []
    for path, commands in ((native_path, native_commands), (wasm_path, wasm_commands)):
        strokes = []
        metrics = extrusion_move_metrics(
            commands, gcode_feature_context(path), planar_strokes=strokes)
        if metrics[1] is None:
            return {"status": "invalid-fixture-motion", "semantic_equivalence_verified": False}
        traces.append((strokes, metrics[0] - len(strokes)))
    (a, excluded_a), (b, excluded_b) = traces
    if not a or not b:
        return {"status": "no-planar-strokes", "semantic_equivalence_verified": False}

    def directed(s):
        z, _, start, end, _ = s
        return z, start, end

    def undirected(s):
        z, _, start, end, _ = s
        return z, *sorted((start, end))

    def shared(key):
        return sum((Counter(map(key, a)) & Counter(map(key, b))).values())

    # Multiset multiplicity matters; none of these projections is a PASS.
    ca, cb = Counter(map(undirected, a)), Counter(map(undirected, b))
    common = ca & cb
    layer_a = Counter(s[0] for s in a)
    layer_b = Counter(s[0] for s in b)
    layer_shared = Counter()
    for key, count in common.items():
        layer_shared[key[0]] += count
    layers = layer_a.keys() | layer_b.keys()
    return {
        "status": "measured",
        "native_planar_strokes": len(a), "wasm_planar_strokes": len(b),
        "native_other_counted_deposition": excluded_a,
        "wasm_other_counted_deposition": excluded_b,
        "exact_directed_overlap": shared(directed),
        "exact_undirected_overlap": sum(common.values()),
        "exact_directed_with_e_and_feature_overlap": shared(lambda s: s),
        "ordered_directed_equal": list(map(directed, a)) == list(map(directed, b)),
        "collinear_coverage": compare_collinear_coverage(a, b),
        "observed_z_planes": len(layers),
        "planes_with_different_undirected_multisets": sum(
            layer_shared[z] != layer_a[z] or layer_shared[z] != layer_b[z]
            for z in layers),
        "semantic_equivalence_verified": False,
    }


def compare_lexical(native, wasm):
    if any(p.stat().st_size > MAX_BYTES for p in (native, wasm)):
        return {"status": "byte-limit"}
    a, b = canonical(native), canonical(wasm)
    if max(len(a), len(b)) > MAX_COMMANDS:
        return {"status": "command-limit"}
    result = summarize([c for _, c in a], [c for _, c in b],
                       bounded_comment_labels(native, a), bounded_comment_labels(wasm, b))
    result['planar_stroke_diagnostics'] = compare_planar_strokes(native, wasm, a, b)
    return result
