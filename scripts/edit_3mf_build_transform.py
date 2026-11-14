#!/usr/bin/env python3
"""Surgical, offline Core-3MF build-item transform edit (diagnostic only).

The only modified *decompressed* ZIP member is 3D/3dmodel.model, and only one
explicit build-item transform attribute is changed. This is not an Orca-native
session mutation, full desktop 3MF edit, nor printer-ready conversion.
"""
import argparse
from pathlib import Path
import re
import sys
import zipfile
from xml.parsers import expat

from audit_3mf_scene import CORE, audit, parse_transform
from compare_3mf_metadata import inventory

MODEL_PART = '3D/3dmodel.model'
CORE_NS = CORE[1:-1]
TRANSFORM_ATTR = re.compile(rb'\s+transform\s*=\s*"([0-9eE+\.\- \t\r\n]+)"')
MAX_TAG_BYTES = 8192


def validated_matrix(raw):
    values = parse_transform(raw)
    a, b, c, d, e, f, g, h, i = values[:9]
    determinant = a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g)
    if not abs(determinant) >= 1e-10:
        raise ValueError('Singular 3MF build transform is unsupported')
    return values


def _start_tag_end(data, start):
    if start < 0 or data[start:start+1] != b'<':
        raise ValueError('Cannot locate XML start tag')
    quote = None
    for index in range(start, min(len(data), start + MAX_TAG_BYTES)):
        character = data[index]
        if quote is not None:
            if character == quote:
                quote = None
        elif character in (ord('"'), ord("'")):
            quote = character
        elif character == ord('>'):
            return index + 1
    raise ValueError('Unsupported long/unterminated 3MF build tag')


def _replace_one_build_transform(data, item_index, matrix):
    if not isinstance(item_index, int) or isinstance(item_index, bool) or item_index < 0:
        raise ValueError('Build item index must be zero-based nonnegative integer')
    upper = data.upper()
    if b'<!DOCTYPE' in upper or b'<!ENTITY' in upper:
        raise ValueError('DTD and entities are unsupported')
    parser = expat.ParserCreate(namespace_separator='}')
    path = []
    seen = 0
    hit = None

    def begin(tag, attributes):
        nonlocal seen, hit
        path.append(tag)
        if path == [CORE_NS+'}model', CORE_NS+'}build', CORE_NS+'}item']:
            if seen == item_index:
                if hit is not None:
                    raise ValueError('Ambiguous selected build item')
                if 'transform' not in attributes:
                    raise ValueError('Selected build item lacks explicit transform')
                start = parser.CurrentByteIndex
                end = _start_tag_end(data, start)
                tag_bytes = data[start:end]
                matches = list(TRANSFORM_ATTR.finditer(tag_bytes))
                if len(matches) != 1:
                    raise ValueError('Unsupported or ambiguous transform attribute syntax')
                old_value = matches[0].group(1).decode('ascii')
                if old_value != attributes['transform']:
                    raise ValueError('Escaped transform attribute is unsupported')
                validated_matrix(old_value)
                hit = (start, end, matches[0])
            seen += 1

    def end(tag):
        if not path or path[-1] != tag:
            raise ValueError('Unexpected XML stack')
        path.pop()

    parser.StartElementHandler = begin
    parser.EndElementHandler = end
    try:
        parser.Parse(data, True)
    except expat.ExpatError as exc:
        raise ValueError('Invalid 3MF model XML') from exc
    if hit is None:
        raise ValueError('Selected build item does not exist')
    start, end, found = hit
    encoded = ' '.join(format(value, '.17g') for value in matrix).encode('ascii')
    raw_tag = data[start:end]
    changed_tag = raw_tag[:found.start(1)] + encoded + raw_tag[found.end(1):]
    output = data[:start] + changed_tag + data[end:]
    if output == data:
        raise ValueError('No transform change requested')
    return output


def edit_core_build_item(source, destination, item_index, transform):
    """Write separate archive; reject unsupported structures without touching source."""
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve() or destination.exists():
        raise ValueError('Destination must be a new path distinct from source')
    matrix = validated_matrix(transform)
    before = inventory(source)
    report = audit(source)
    if report['modelParts'] != 1 or report['scenes'][0]['part'] != MODEL_PART:
        raise ValueError('Only a single 3D/3dmodel.model Core part is supported')
    items = report['scenes'][0]['buildItems']
    if item_index < 0 or item_index >= len(items):
        raise ValueError('Selected build item out of range')
    with zipfile.ZipFile(source) as original:
        edited = _replace_one_build_transform(original.read(MODEL_PART), item_index, matrix)
        try:
            with zipfile.ZipFile(destination, 'x') as output:
                output.comment = original.comment
                for entry in original.infolist():
                    if entry.is_dir():
                        output.writestr(entry, b'')
                    else:
                        data = edited if entry.filename == MODEL_PART else original.read(entry)
                        output.writestr(entry, data)
            after = inventory(destination)
            changed = sorted(name for name in before if before[name] != after.get(name))
            if set(before) != set(after) or changed != [MODEL_PART]:
                raise ValueError('Edited archive unexpectedly changed unrelated members')
            result = audit(destination)
            new_scene = result['scenes'][0]
            if result['totalBuildItems'] != report['totalBuildItems'] or \
               result['totalMeshTriangles'] != report['totalMeshTriangles'] or \
               result['totalObjects'] != report['totalObjects']:
                raise ValueError('Edited scene structure changed unexpectedly')
            for index, (old, new) in enumerate(zip(items, new_scene['buildItems'])):
                expected = matrix if index == item_index else old['transform3mf']
                if new['transform3mf'] != expected or new['objectId'] != old['objectId']:
                    raise ValueError('Edited scene changed other build placements')
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
    return {'editedBuildIndex': item_index, 'changedMember': MODEL_PART,
            'preservedMembers': len(before)-1, 'buildItems': len(items),
            'opaqueMetadataCaveat':
            'Unedited ZIP members are byte-identical after decompression; their semantics may depend on the edited transform. NOT desktop Orca-native 3MF parity.'}


def main():
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument('--input', required=True, type=Path)
    command.add_argument('--output', required=True, type=Path)
    command.add_argument('--build-index', type=int, required=True)
    command.add_argument('--transform', required=True, help='12 numbers in Core 3MF row-vector order (source model units)')
    args = command.parse_args()
    try:
        result = edit_core_build_item(args.input, args.output,
                                      args.build_index, args.transform)
    except (ValueError, OSError, zipfile.BadZipFile, RuntimeError, EOFError) as exc:
        print('Core 3MF transform edit refused:', exc, file=sys.stderr)
        return 2
    print('PASS:', result)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
