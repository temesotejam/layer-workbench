#!/usr/bin/env python3
"""Compare native OrcaSlicer and WASM G-code commands, without masking differences.

Only blank lines and semicolon comments are ignored. This is a strict ordered
command comparison; it cannot by itself prove complete feature parity.
"""
import argparse
from decimal import Decimal
import hashlib
import json
import math
from pathlib import Path
import re
import sys

PARAM = re.compile(r'^([A-Za-z])([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$')
CODE = re.compile(r'^[GMT]\d+(?:\.\d+)?$|^T\d+$|^N\d+$', re.I)

# Only split common compact movement syntax (G1X10Y20E1). Do not reinterpret
# vendor M-codes, macros or opaque commands. A malformed compact movement is
# kept verbatim so the strict ordered comparison can expose the difference.
# In compact G-code "X1E2" means X1 followed by E2; exponent notation needs
# an explicit exponent sign ("X1E+2") to avoid stealing the E word.
COMPACT_MOTION_HEAD = re.compile(
    r'^(?:(N\d+)\s*)?(G0*[0123](?:\.0+)?)(?=[A-Za-z\s]|$)', re.I | re.ASCII
)
COMPACT_MOTION_WORD = re.compile(
    r'\s*([A-Za-z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]\d+)?)',
    re.I | re.ASCII
)

def split_motion_words(line):
    """Tokenize a whole compact G0-G3 line, or leave it strictly untouched."""
    head = COMPACT_MOTION_HEAD.match(line)
    if head is None:
        return line.split()
    result = ([head.group(1)] if head.group(1) else []) + [head.group(2)]
    index = head.end()
    while index < len(line):
        if line[index:].isspace():
            break
        word = COMPACT_MOTION_WORD.match(line, index)
        if word is None:
            return line.split()
        result.append(word[1].upper() + word[2])
        index = word.end()
    return result

def canonical(path):
    commands = []
    for n, line in enumerate(path.read_text(encoding='utf-8-sig', errors='strict').splitlines(), 1):
        text = line.split(';', 1)[0].strip()
        if not text:
            continue
        normalized = []
        for token in split_motion_words(text):
            # G20/G90/M100/T200/N10 also match the generic word pattern.
            # Keep opcodes intact: Decimal normalization would turn G20
            # into G2E+1 and break modal state tracking or hide mismatches.
            if CODE.fullmatch(token):
                normalized.append(token.upper())
            else:
                m = PARAM.fullmatch(token)
                if m:
                    normalized.append(m[1].upper() + str(Decimal(m[2]).normalize()))
                else:
                    normalized.append(token)
        commands.append((n, ' '.join(normalized)))
    return commands


# Use a finite, source-informed tag vocabulary. A free-text comment or
# unknown vendor label must never become a raw string in archived diagnostics.
KNOWN_FEATURE_TAGS = frozenset((
    'outer wall', 'inner wall', 'overhang wall', 'top surface',
    'bottom surface', 'internal solid infill', 'solid infill',
    'sparse infill', 'gap infill', 'bridge', 'external bridge',
    'internal bridge', 'bridge infill', 'internal bridge infill',
    'bridge over infill', 'skirt', 'brim', 'support', 'support interface',
))
FEATURE_DIRECTIVE = re.compile(r'^;\s*(?:TYPE|FEATURE)\s*:', re.I)
FEATURE_VALUE = re.compile(r'^;\s*(?:TYPE|FEATURE)\s*:\s*([^;\r\n]{1,80})\s*$', re.I)


def gcode_feature_context(path):
    """Recognized explicit comment label per physical command line.

    Malformed/unknown directives clear the old label rather than incorrectly
    inheriting it. The comparator still ignores every comment for equality.
    """
    active = None
    context = {}
    for line_no, line in enumerate(
            path.read_text(encoding='utf-8-sig', errors='strict').splitlines(), 1):
        stripped = line.strip()
        if FEATURE_DIRECTIVE.match(stripped):
            tag = FEATURE_VALUE.fullmatch(stripped)
            label = ' '.join(tag[1].lower().split()) if tag else None
            active = label if label in KNOWN_FEATURE_TAGS else None
        elif line.split(';', 1)[0].strip():
            context[line_no] = active
    return context


def feature_deposition_summary(stats):
    """Numeric planar positive-E G1 footprints; no raw G-code or unknown tags."""
    return {
        'known_tagged_moves': sum(v['moves'] for k, v in stats.items()
                                  if k != 'unclassified'),
        'unclassified_moves': stats.get('unclassified', {}).get('moves', 0),
        'by_feature': {
            key: {
                'moves': value['moves'],
                'linear_xy_mm': rounded_mm(value['xy']),
                'positive_e_mm': format(value['e'].normalize(), 'f'),
            }
            for key, value in sorted(stats.items())
        },
    }

MOTION = re.compile(r'^G0*[0123](?:\.0+)?$', re.I)

def count_motion(commands):
    """Minimal fixture sanity check; NOT a printer-safety or parity proof."""
    count = 0
    for _, command in commands:
        tokens = command.split()
        if tokens and re.fullmatch(r'N\d+', tokens[0], re.I):
            tokens = tokens[1:]
        if tokens and MOTION.fullmatch(tokens[0]):
            count += 1
    return count

EXTRUSION_MOTION = re.compile(r'^G0*[123](?:\.0+)?$', re.I)

def valid_g17_arc(start, end, words, units, absolute_arc_centers):
    """Conservatively require a geometrically possible XY arc for fixture counting.

    This only validates G17 planar circular geometry, not firmware semantics
    or extrusion volume. Unsupported/ambiguous arcs fail closed.
    """
    has_radius = 'R' in words
    has_center = 'I' in words or 'J' in words
    if has_radius == has_center:
        return False  # neither definition, or conflicting R and I/J
    dx, dy = end['X'] - start['X'], end['Y'] - start['Y']
    if has_radius:
        radius = abs(words['R'] * units)
        chord_sq = dx * dx + dy * dy
        return radius > 0 and chord_sq > 0 and chord_sq <= 4 * radius * radius
    if absolute_arc_centers:
        cx = words['I'] * units if 'I' in words else start['X']
        cy = words['J'] * units if 'J' in words else start['Y']
    else:
        cx = start['X'] + words.get('I', Decimal(0)) * units
        cy = start['Y'] + words.get('J', Decimal(0)) * units
    r0 = math.hypot(float(start['X'] - cx), float(start['Y'] - cy))
    r1 = math.hypot(float(end['X'] - cx), float(end['Y'] - cy))
    return (math.isfinite(r0) and math.isfinite(r1) and r0 > 0
            and abs(r0 - r1) <= max(0.05, r0 * 0.001))

def extrusion_move_metrics(commands, feature_context=None, feature_stats=None):
    """Summarize positive E and G1 XY path length for fixture sanity.

    A present X/Y word alone does not prove movement: e.g. G1 X0 E1 at the
    initial position is priming, not deposited path. Track G90/G91, G92 and
    G20/G21 coordinates as well as M82/M83 and E resets. Arc center/radius
    words may indicate a full circle with no XY endpoint displacement.
    This is a conservative *fixture gate*, not a full firmware interpreter,
    watertightness test, deposited-volume or print-safety certification.
    """
    count = 0
    counted_e_mm = Decimal(0)
    counted_linear_xy_mm = Decimal(0)
    counted_linear_moves = 0
    # Only deposition on a constant-Z move is assigned to a Z plane.
    # Simultaneous XY+Z extrusion remains counted, but not as a flat layer.
    planar_layer_moves = {}
    # Numeric-only footprint for each observed constant-Z deposited stratum.
    # G17 arc lengths and mid-arc extrema are deliberately NOT approximated.
    planar_linear_stats = {}
    nonplanar_deposition_moves = 0
    z_position = Decimal(0)
    absolute_e = True
    absolute_xyz = True
    absolute_arc_centers = False
    plane = 'G17'
    units = Decimal(1)
    e_position = Decimal(0)
    xy = {'X': Decimal(0), 'Y': Decimal(0)}
    for line_no, command in commands:
        tokens = command.split()
        if tokens and re.fullmatch(r'N\d+', tokens[0], re.I):
            tokens = tokens[1:]
        if not tokens:
            continue
        opcode = tokens[0].upper()
        # M82 is absolute E, M83 is relative E. Preserve padded
        # command spelling for *strict* comparison, but interpret only these
        # well-defined numeric aliases in the deposition sanity gate.
        # The former M083-in-M82 branch could count phantom extrusion after
        # a relative retract or silently miss a real relative deposition.
        if re.fullmatch(r'M0*82(?:\.0+)?', opcode):
            absolute_e = True
            continue
        if re.fullmatch(r'M0*83(?:\.0+)?', opcode):
            absolute_e = False
            continue
        if opcode == 'G90':
            absolute_xyz = True
            continue
        if opcode == 'G91':
            absolute_xyz = False
            continue
        if opcode in ('G17', 'G18', 'G19'):
            plane = opcode
            continue
        if opcode == 'G90.1':
            absolute_arc_centers = True
            continue
        if opcode == 'G91.1':
            absolute_arc_centers = False
            continue
        if opcode == 'G20':
            units = Decimal('25.4')
            continue
        if opcode == 'G21':
            units = Decimal(1)
            continue
        words = {}
        stateful = opcode == 'G92' or bool(MOTION.fullmatch(opcode))
        for token in tokens[1:]:
            match = PARAM.fullmatch(token)
            if not match:
                if stateful:
                    # Opaque move/reset syntax leaves the position unknown.
                    # Never use later moves to satisfy the fixture gate.
                    return 0, None, None, 0, None, None, None
                continue
            letter = match[1].upper()
            if stateful and (letter in words or letter in ('G', 'M', 'N', 'T')):
                # Duplicate words or embedded opcodes have firmware-dependent
                # interpretation; the conservative deposition gate must fail.
                return 0, None, None, 0, None, None, None
            words[letter] = Decimal(match[2])
        if opcode == 'G92':
            for axis in xy:
                if axis in words:
                    xy[axis] = words[axis] * units
            if 'E' in words:
                e_position = words['E'] * units
            if 'Z' in words:
                z_position = words['Z'] * units
            continue
        if not MOTION.fullmatch(opcode):
            continue
        start_xy = xy.copy()
        start_z = z_position
        moved_xy = False
        for axis in xy:
            if axis not in words:
                continue
            requested = words[axis] * units
            new_position = requested if absolute_xyz else xy[axis] + requested
            moved_xy |= new_position != xy[axis]
            xy[axis] = new_position
        if 'Z' in words:
            requested_z = words['Z'] * units
            z_position = requested_z if absolute_xyz else z_position + requested_z
        code = int(Decimal(opcode[1:]))
        # An impossible G17 arc changes the interpreted XY endpoint even
        # when E is absent or retracting. Silently ignoring it would let
        # later straight moves satisfy a false deposition/parity gate.
        # Unsupported non-XY planes retain their existing excluded status.
        if code in (2, 3) and plane == 'G17' and not valid_g17_arc(
                start_xy, xy, words, units, absolute_arc_centers):
            return 0, None, None, 0, None, None, None
        if 'E' not in words:
            continue
        requested_e = words['E'] * units
        delta = requested_e - e_position if absolute_e else requested_e
        e_position = requested_e if absolute_e else e_position + requested_e
        if delta <= 0 or not EXTRUSION_MOTION.fullmatch(opcode):
            continue
        if code == 1 and not moved_xy:
            continue
        if code in (2, 3) and plane != 'G17':
            continue
        count += 1
        counted_e_mm += delta
        if start_z == z_position:
            planar_layer_moves[z_position] = planar_layer_moves.get(z_position, 0) + 1
            footprint = planar_linear_stats.setdefault(
                z_position, {'linear_moves': 0, 'g17_arc_moves': 0,
                             'linear_xy_mm': Decimal(0),
                             'linear_positive_e_mm': Decimal(0),
                             'linear_xy_endpoint_bounds_mm': None})
            if code in (2, 3):
                footprint['g17_arc_moves'] += 1
        else:
            nonplanar_deposition_moves += 1
        if code == 1:
            # Only G1 XY deposition is a straight segment. G17 arcs remain
            # in the extrusion count/E total but are excluded from this metric.
            dx = xy['X'] - start_xy['X']
            dy = xy['Y'] - start_xy['Y']
            length = (dx * dx + dy * dy).sqrt()
            counted_linear_xy_mm += length
            counted_linear_moves += 1
            if start_z == z_position:
                footprint['linear_moves'] += 1
                footprint['linear_xy_mm'] += length
                footprint['linear_positive_e_mm'] += delta
                if feature_stats is not None:
                    label = (feature_context or {}).get(line_no) or 'unclassified'
                    entry = feature_stats.setdefault(
                        label, {'moves': 0, 'xy': Decimal(0), 'e': Decimal(0)})
                    entry['moves'] += 1
                    entry['xy'] += length
                    entry['e'] += delta
                bounds = footprint['linear_xy_endpoint_bounds_mm']
                for point in (start_xy, xy):
                    x, y = point['X'], point['Y']
                    if bounds is None:
                        bounds = [x, y, x, y]
                    else:
                        bounds = [min(bounds[0], x), min(bounds[1], y),
                                  max(bounds[2], x), max(bounds[3], y)]
                footprint['linear_xy_endpoint_bounds_mm'] = bounds
    return (count, counted_e_mm, counted_linear_xy_mm, counted_linear_moves,
            planar_layer_moves, nonplanar_deposition_moves, planar_linear_stats)


def count_extrusion_moves(commands):
    """Backward-compatible fixture count; diagnostics also sum positive E."""
    return extrusion_move_metrics(commands)[0]

def numeric_parameter_deltas(native_command, wasm_command):
    """Return diagnostic WASM-minus-native deltas for aligned numeric words."""
    if native_command is None or wasm_command is None:
        return []
    a, b = native_command[1].split(), wasm_command[1].split()
    if not a or not b or a[0] != b[0] or len(a) != len(b):
        return []
    deltas = []
    for original, candidate in zip(a[1:], b[1:]):
        x, y = PARAM.fullmatch(original), PARAM.fullmatch(candidate)
        if x and y and x[1].upper() == y[1].upper():
            delta = Decimal(y[2]) - Decimal(x[2])
            if delta:
                deltas.append({
                    'parameter': x[1].upper(),
                    'wasm_minus_native': str(delta.normalize()),
                })
    return deltas

def rounded_mm(value):
    """Format a rounded diagnostic length without scientific notation."""
    return format(value.quantize(Decimal('0.000001')).normalize(), 'f')


def only_z_footprints(heights, layers, footprints):
    """Bounded, numeric-only deposited G1 footprint at absent Z positions.

    Endpoint bounds omit arc interior points; lengths omit G17 curves.
    This deliberately cannot classify a feature, determine layer identity,
    prove equal settings or certify physical toolpaths.
    """
    if heights is None:
        return None
    result = []
    for z in heights[:15]:
        data = footprints[z]
        bounds = data['linear_xy_endpoint_bounds_mm']
        result.append({
            'z_mm': format(z.normalize(), 'f'),
            'deposition_moves': layers[z],
            'linear_moves': data['linear_moves'],
            'g17_arc_moves': data['g17_arc_moves'],
            'linear_xy_mm': rounded_mm(data['linear_xy_mm']),
            'linear_positive_e_mm': format(
                data['linear_positive_e_mm'].normalize(), 'f'),
            'linear_xy_endpoint_bounds_mm': None if bounds is None else [
                format(value.normalize(), 'f') for value in bounds],
        })
    return result



def shared_z_footprint_differences(native_layers, wasm_layers,
                                   native_footprints, wasm_footprints):
    """Find differing numeric G1 footprints at exact shared deposited Z values.

    Unlike one-sided Z diagnostics, this catches equal move counts with
    different XY lengths, positive E or endpoint bounds. The overall count
    is complete; only the first 15 numeric entries are returned. Do not
    infer feature identities or actual material volume from these metrics.
    """
    if native_layers is None or wasm_layers is None:
        return None, None
    total = 0
    examples = []
    for z in sorted(set(native_layers) & set(wasm_layers)):
        a, b = native_footprints[z], wasm_footprints[z]
        changed = (
            native_layers[z] != wasm_layers[z]
            or a['linear_moves'] != b['linear_moves']
            or a['g17_arc_moves'] != b['g17_arc_moves']
            or rounded_mm(a['linear_xy_mm']) != rounded_mm(b['linear_xy_mm'])
            or a['linear_positive_e_mm'] != b['linear_positive_e_mm']
            or a['linear_xy_endpoint_bounds_mm'] != b['linear_xy_endpoint_bounds_mm']
        )
        if not changed:
            continue
        total += 1
        if len(examples) < 15:
            examples.append({
                'z_mm': format(z.normalize(), 'f'),
                'native': only_z_footprints([z], native_layers, native_footprints)[0],
                'wasm': only_z_footprints([z], wasm_layers, wasm_footprints)[0],
                'wasm_minus_native_linear_xy_mm':
                    rounded_mm(b['linear_xy_mm'] - a['linear_xy_mm']),
                'wasm_minus_native_linear_positive_e_mm':
                    format((b['linear_positive_e_mm'] -
                            a['linear_positive_e_mm']).normalize(), 'f'),
            })
    return total, examples


def compare(native, wasm, min_extrusion_moves=0):
    if min_extrusion_moves < 0:
        raise ValueError('minimum extrusion moves must not be negative')
    a, b = canonical(native), canonical(wasm)
    native_features, wasm_features = {}, {}
    differences = []
    mismatch_count = 0
    for i in range(max(len(a), len(b))):
        x, y = a[i] if i < len(a) else None, b[i] if i < len(b) else None
        if x is None or y is None or x[1] != y[1]:
            mismatch_count += 1
            if len(differences) < 15:
                entry = {'command_index': i, 'native': x, 'wasm': y}
                deltas = numeric_parameter_deltas(x, y)
                if deltas:
                    entry['parameter_deltas'] = deltas
                differences.append(entry)
    native_motion, wasm_motion = count_motion(a), count_motion(b)
    (native_extrusion, native_e_mm, native_linear_xy_mm, native_linear_moves,
     native_layers, native_nonplanar, native_footprints) = extrusion_move_metrics(
         a, gcode_feature_context(native), native_features)
    (wasm_extrusion, wasm_e_mm, wasm_linear_xy_mm, wasm_linear_moves,
     wasm_layers, wasm_nonplanar, wasm_footprints) = extrusion_move_metrics(
         b, gcode_feature_context(wasm), wasm_features)
    # Bounded, read-only per-Z differences: do not imply that a Z plane
    # represents a complete OrcaSlicer layer or deposited volume.
    planar_layer_differences = None
    native_only_z = None
    wasm_only_z = None
    if native_layers is not None and wasm_layers is not None:
        # Set membership is independent of how many moves each shared Z has.
        # Keep exact Decimal heights; never silently round distinct planes.
        native_only_z = sorted(set(native_layers) - set(wasm_layers))
        wasm_only_z = sorted(set(wasm_layers) - set(native_layers))
        planar_layer_differences = [
            {'z_mm': format(z.normalize(), 'f'),
             'native_moves': native_layers.get(z, 0),
             'wasm_moves': wasm_layers.get(z, 0)}
            for z in sorted(set(native_layers) | set(wasm_layers))
            if native_layers.get(z, 0) != wasm_layers.get(z, 0)
        ][:15]
    (shared_z_footprint_difference_count,
     shared_z_footprint_examples) = shared_z_footprint_differences(
         native_layers, wasm_layers, native_footprints, wasm_footprints)
    issues = []
    # A malformed stateful command yields unknown deposition metrics, not
    # zero deposited material. Reject even when the optional minimum is 0:
    # two identical *invalid* files must never pass the strict fixture gate.
    if native_layers is None:
        issues.append('native has unsupported or malformed stateful geometry')
    if wasm_layers is None:
        issues.append('wasm has unsupported or malformed stateful geometry')
    if native_motion == 0:
        issues.append('native input has no G0/G1/G2/G3 motion commands')
    if wasm_motion == 0:
        issues.append('wasm input has no G0/G1/G2/G3 motion commands')
    if native_extrusion < min_extrusion_moves:
        issues.append(f'native has {native_extrusion} extrusion moves; expected at least {min_extrusion_moves}')
    if wasm_extrusion < min_extrusion_moves:
        issues.append(f'wasm has {wasm_extrusion} extrusion moves; expected at least {min_extrusion_moves}')
    return {
        'native': str(native), 'wasm': str(wasm),
        'native_commands': len(a), 'wasm_commands': len(b),
        'native_motion_commands': native_motion, 'wasm_motion_commands': wasm_motion,
        'native_extrusion_moves': native_extrusion, 'wasm_extrusion_moves': wasm_extrusion,
        # Positive commanded filament-axis E for counted XY deposition only.
        # This is not deposited material volume or an actual extrusion sensor.
        'native_counted_positive_e_mm': None if native_e_mm is None else str(native_e_mm.normalize()),
        'wasm_counted_positive_e_mm': None if wasm_e_mm is None else str(wasm_e_mm.normalize()),
        'counted_positive_e_delta_mm': None if native_e_mm is None or wasm_e_mm is None
            else str((wasm_e_mm - native_e_mm).normalize()),
        # Only positive-E G1 XY strokes (not G17 arc lengths or travels).
        # Rounded to 1 micrometre for a stable diagnostic display.
        'native_counted_linear_xy_moves': native_linear_moves,
        'wasm_counted_linear_xy_moves': wasm_linear_moves,
        'native_counted_linear_xy_mm': None if native_linear_xy_mm is None
            else rounded_mm(native_linear_xy_mm),
        'wasm_counted_linear_xy_mm': None if wasm_linear_xy_mm is None
            else rounded_mm(wasm_linear_xy_mm),
        'counted_linear_xy_delta_mm': None if native_linear_xy_mm is None or wasm_linear_xy_mm is None
            else rounded_mm(wasm_linear_xy_mm - native_linear_xy_mm),
        # Exact numeric Z locations of constant-height positive-E XY moves,
        # including valid G17 arcs. Changing Z during deposition is excluded.
        'native_counted_planar_z_levels': None if native_layers is None else len(native_layers),
        'wasm_counted_planar_z_levels': None if wasm_layers is None else len(wasm_layers),
        'native_counted_nonplanar_deposition_moves': native_nonplanar,
        'wasm_counted_nonplanar_deposition_moves': wasm_nonplanar,
        'first_counted_planar_z_differences': planar_layer_differences,
        # The 15-position preview of changed move counts does not tell us
        # whether an entire deposited Z plane is absent on one side.
        # Report full membership counts and bounded numeric-only examples.
        'native_only_counted_planar_z_levels': None if native_only_z is None else len(native_only_z),
        'wasm_only_counted_planar_z_levels': None if wasm_only_z is None else len(wasm_only_z),
        'first_native_only_counted_planar_z_mm': None if native_only_z is None
            else [format(z.normalize(), 'f') for z in native_only_z[:15]],
        'first_wasm_only_counted_planar_z_mm': None if wasm_only_z is None
            else [format(z.normalize(), 'f') for z in wasm_only_z[:15]],
        # Endpoint-only G1 footprint; arcs counted but not geometrically
        # reconstructed. Bounded by the existing 15 per-direction Z samples.
        'first_native_only_counted_planar_z_footprints':
            only_z_footprints(native_only_z, native_layers, native_footprints),
        'first_wasm_only_counted_planar_z_footprints':
            only_z_footprints(wasm_only_z, wasm_layers, wasm_footprints),
        # Shared exact Z levels can differ in geometry/E even when the
        # planar deposited move counts agree. Never classify these as prime
        # or model features; full-profile parity is still a separate gate.
        'shared_counted_planar_z_footprint_difference_count':
            shared_z_footprint_difference_count,
        'first_shared_counted_planar_z_footprint_differences':
            shared_z_footprint_examples,
        # Fixed-label, comment-attributed planar positive-E G1 footprint
        # census. Tag discrepancies are diagnostic only, NOT parity gates.
        'native_feature_tagged_planar_g1': None if native_layers is None
            else feature_deposition_summary(native_features),
        'wasm_feature_tagged_planar_g1': None if wasm_layers is None
            else feature_deposition_summary(wasm_features),
        'feature_category_differences': None if native_layers is None or wasm_layers is None
            else sorted(
                key for key in set(native_features) | set(wasm_features)
                if native_features.get(key) != wasm_features.get(key)
            ),
        'minimum_extrusion_moves': min_extrusion_moves,
        'input_issues': issues,
        'native_sha256': hashlib.sha256(native.read_bytes()).hexdigest(),
        'wasm_sha256': hashlib.sha256(wasm.read_bytes()).hexdigest(),
        'match': mismatch_count == 0 and not issues,
        'mismatched_commands': mismatch_count,
        'first_differences': differences,
    }

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', type=Path, required=True)
    parser.add_argument('--wasm', type=Path, required=True)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--min-extrusion-moves', type=int, default=0,
                        help='Optional minimum number of positive-E XY/arc moves on each side')
    args = parser.parse_args()
    if args.min_extrusion_moves < 0:
        parser.error('--min-extrusion-moves must be nonnegative')
    report = compare(args.native, args.wasm, min_extrusion_moves=args.min_extrusion_moves)
    output = json.dumps(report, ensure_ascii=False, indent=2)
    print(output)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(output + '\n', encoding='utf-8')
    return 0 if report['match'] else 1

if __name__ == '__main__':
    sys.exit(main())
