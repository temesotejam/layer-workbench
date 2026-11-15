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

def count_extrusion_moves(commands):
    """Count positive E on actual XY/arc movement for fixture sanity.

    A present X/Y word alone does not prove movement: e.g. G1 X0 E1 at the
    initial position is priming, not deposited path. Track G90/G91, G92 and
    G20/G21 coordinates as well as M82/M83 and E resets. Arc center/radius
    words may indicate a full circle with no XY endpoint displacement.
    This is a conservative *fixture gate*, not a full firmware interpreter,
    watertightness test, deposited-volume or print-safety certification.
    """
    count = 0
    absolute_e = True
    absolute_xyz = True
    absolute_arc_centers = False
    plane = 'G17'
    units = Decimal(1)
    e_position = Decimal(0)
    xy = {'X': Decimal(0), 'Y': Decimal(0)}
    for _, command in commands:
        tokens = command.split()
        if tokens and re.fullmatch(r'N\d+', tokens[0], re.I):
            tokens = tokens[1:]
        if not tokens:
            continue
        opcode = tokens[0].upper()
        if opcode in ('M82', 'M083', 'M82.0'):
            absolute_e = True
            continue
        if opcode in ('M83', 'M083.0', 'M83.0'):
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
                    return 0
                continue
            letter = match[1].upper()
            if stateful and (letter in words or letter in ('G', 'M', 'N', 'T')):
                # Duplicate words or embedded opcodes have firmware-dependent
                # interpretation; the conservative deposition gate must fail.
                return 0
            words[letter] = Decimal(match[2])
        if opcode == 'G92':
            for axis in xy:
                if axis in words:
                    xy[axis] = words[axis] * units
            if 'E' in words:
                e_position = words['E'] * units
            continue
        if not MOTION.fullmatch(opcode):
            continue
        start_xy = xy.copy()
        moved_xy = False
        for axis in xy:
            if axis not in words:
                continue
            requested = words[axis] * units
            new_position = requested if absolute_xyz else xy[axis] + requested
            moved_xy |= new_position != xy[axis]
            xy[axis] = new_position
        if 'E' not in words:
            continue
        requested_e = words['E'] * units
        delta = requested_e - e_position if absolute_e else requested_e
        e_position = requested_e if absolute_e else e_position + requested_e
        if delta <= 0 or not EXTRUSION_MOTION.fullmatch(opcode):
            continue
        code = int(Decimal(opcode[1:]))
        if code == 1 and not moved_xy:
            continue
        if code in (2, 3) and (plane != 'G17' or not valid_g17_arc(
                start_xy, xy, words, units, absolute_arc_centers)):
            continue
        count += 1
    return count

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

def compare(native, wasm, min_extrusion_moves=0):
    if min_extrusion_moves < 0:
        raise ValueError('minimum extrusion moves must not be negative')
    a, b = canonical(native), canonical(wasm)
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
    native_extrusion = count_extrusion_moves(a)
    wasm_extrusion = count_extrusion_moves(b)
    issues = []
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
