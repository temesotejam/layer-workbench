#!/usr/bin/env python3
"""Compare native OrcaSlicer and WASM G-code commands, without masking differences.

Only blank lines and semicolon comments are ignored. This is a strict ordered
command comparison; it cannot by itself prove complete feature parity.
"""
import argparse
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import sys

PARAM = re.compile(r'^([A-Za-z])([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$')
CODE = re.compile(r'^[GMT]\d+(?:\.\d+)?$|^T\d+$|^N\d+$', re.I)

def canonical(path):
    commands = []
    for n, line in enumerate(path.read_text(encoding='utf-8-sig', errors='strict').splitlines(), 1):
        text = line.split(';', 1)[0].strip()
        if not text:
            continue
        normalized = []
        for token in text.split():
            m = PARAM.fullmatch(token)
            if m:
                normalized.append(m[1].upper() + str(Decimal(m[2]).normalize()))
            elif CODE.fullmatch(token):
                normalized.append(token.upper())
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

def count_extrusion_moves(commands):
    """Count positive-E XY/arc moves as an optional fixture sanity check.

    This is a syntax heuristic, not modal extrusion or deposited-volume proof.
    E-only priming moves do not qualify.
    """
    count = 0
    for _, command in commands:
        tokens = command.split()
        if tokens and re.fullmatch(r'N\d+', tokens[0], re.I):
            tokens = tokens[1:]
        if not tokens or not EXTRUSION_MOTION.fullmatch(tokens[0]):
            continue
        code = str(int(Decimal(tokens[0][1:])))
        words = {}
        for token in tokens[1:]:
            match = PARAM.fullmatch(token)
            if match:
                words[match[1].upper()] = Decimal(match[2])
        if words.get('E', Decimal(0)) <= 0:
            continue
        if code == '1' and not ('X' in words or 'Y' in words):
            continue
        if code in ('2', '3') and not any(k in words for k in ('X', 'Y', 'I', 'J', 'R')):
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

def compare(native, wasm):
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
    issues = []
    if native_motion == 0:
        issues.append('native input has no G0/G1/G2/G3 motion commands')
    if wasm_motion == 0:
        issues.append('wasm input has no G0/G1/G2/G3 motion commands')
    return {
        'native': str(native), 'wasm': str(wasm),
        'native_commands': len(a), 'wasm_commands': len(b),
        'native_motion_commands': native_motion, 'wasm_motion_commands': wasm_motion,
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
    args = parser.parse_args()
    report = compare(args.native, args.wasm)
    output = json.dumps(report, ensure_ascii=False, indent=2)
    print(output)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(output + '\n', encoding='utf-8')
    return 0 if report['match'] else 1

if __name__ == '__main__':
    sys.exit(main())
