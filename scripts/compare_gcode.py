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
    for n, line in enumerate(path.read_text(encoding='utf-8-sig', errors='replace').splitlines(), 1):
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

def compare(native, wasm):
    a, b = canonical(native), canonical(wasm)
    differences = []
    for i in range(max(len(a), len(b))):
        x, y = a[i] if i < len(a) else None, b[i] if i < len(b) else None
        if x is None or y is None or x[1] != y[1]:
            differences.append({'command_index': i, 'native': x, 'wasm': y})
            if len(differences) == 15:
                break
    return {
        'native': str(native), 'wasm': str(wasm),
        'native_commands': len(a), 'wasm_commands': len(b),
        'native_sha256': hashlib.sha256(native.read_bytes()).hexdigest(),
        'wasm_sha256': hashlib.sha256(wasm.read_bytes()).hexdigest(),
        'match': not differences,
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
