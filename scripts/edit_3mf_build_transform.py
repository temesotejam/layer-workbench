#!/usr/bin/env python3
"""Surgical, offline Core-3MF build-item transform edit (diagnostic only).

The only modified *decompressed* ZIP member is 3D/3dmodel.model, and only one
explicit build-item transform attribute is changed. This is not an Orca-native
session mutation, full desktop 3MF edit, nor printer-ready conversion.
"""
import argparse
from pathlib import Path
import math
import re
import sys
import zipfile
from xml.parsers import expat

from audit_3mf_scene import CORE, audit, parse_transform
from compare_3mf_metadata import inventory
from three_mf_instance_expansion import compose_3mf

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


def translate_core_build_item(source, destination, item_index, delta_mm):
    """Relative world-axis mm edit retaining the original rotation and scale.

    A Core 3MF model's unit applies to both its vertex and build translations.
    Only the last three coordinates of the selected 12-value transform change.
    """
    if not isinstance(item_index, int) or isinstance(item_index, bool) or item_index < 0:
        raise ValueError('Build item index must be zero-based nonnegative integer')
    if not isinstance(delta_mm, (list, tuple)) or len(delta_mm) != 3 or any(
        isinstance(v, bool) or not isinstance(v, (int, float))
        or not math.isfinite(v) or abs(v) > 1000000 for v in delta_mm
    ):
        raise ValueError('Relative translation requires three bounded finite mm values')
    if not any(v != 0 for v in delta_mm):
        raise ValueError('No relative translation requested')
    scene = audit(source)
    if scene['modelParts'] != 1 or scene['scenes'][0]['part'] != MODEL_PART:
        raise ValueError('Only a single 3D/3dmodel.model Core part is supported')
    part = scene['scenes'][0]
    if item_index >= len(part['buildItems']):
        raise ValueError('Selected build item out of range')
    matrix = part['buildItems'][item_index]['transform3mf'][:]
    unit_mm = part['millimetersPerUnit']
    for axis in range(3):
        matrix[9 + axis] += delta_mm[axis] / unit_mm
    serialized = ' '.join(format(value, '.17g') for value in matrix)
    validated_matrix(serialized)
    result = edit_core_build_item(source, destination, item_index, serialized)
    result['relativeTranslationMm'] = list(delta_mm)
    result['modelUnit'] = part['unit']
    return result


def rotate_core_build_item_z(source, destination, item_index, angle_degrees):
    """Rotate one Core build placement around its own translation anchor.

    This is a WORLD-axis Z rotation using 3MF row-vector composition. The
    existing linear matrix is post-multiplied by Rz; its translation is
    restored so the pivot stays at the build item's current origin, NOT the
    mesh center. A source STL is not recentered or edited in this operation.
    """
    if not isinstance(item_index, int) or isinstance(item_index, bool) or item_index < 0:
        raise ValueError('Build item index must be zero-based nonnegative integer')
    if isinstance(angle_degrees, bool) or not isinstance(angle_degrees, (int, float)) or \
       not math.isfinite(angle_degrees) or abs(angle_degrees) > 360:
        raise ValueError('Z rotation requires a finite angle within -360..360 degrees')
    if angle_degrees % 360 == 0:
        raise ValueError('No relative rotation requested')
    scene = audit(source)
    if scene['modelParts'] != 1 or scene['scenes'][0]['part'] != MODEL_PART:
        raise ValueError('Only a single 3D/3dmodel.model Core part is supported')
    items = scene['scenes'][0]['buildItems']
    if item_index >= len(items):
        raise ValueError('Selected build item out of range')
    original = items[item_index]['transform3mf']
    radians = math.radians(angle_degrees)
    cosine, sine = math.cos(radians), math.sin(radians)
    # Core 3MF uses row vectors: (x,y) -> (x*cos-y*sin, x*sin+y*cos).
    rotation = [cosine, sine, 0, -sine, cosine, 0, 0, 0, 1, 0, 0, 0]
    rotated = compose_3mf(original, rotation)
    rotated[9:12] = original[9:12]  # Rotation about the existing origin.
    serialized = ' '.join(format(value, '.17g') for value in rotated)
    validated_matrix(serialized)
    result = edit_core_build_item(source, destination, item_index, serialized)
    result['relativeRotationZDegrees'] = angle_degrees
    result['pivot'] = 'existing build translation (not mesh center)'
    return result


def scale_core_build_item_local(source, destination, item_index, factors):
    """Scale a Core build placement on its LOCAL axes, keeping its origin fixed.

    For 3MF row-vector transforms this is S @ existing_transform. The local
    mesh origin remains at the same build translation, and any existing
    rotation/shear is preserved by composition (not decomposed). This is
    independent of model units and is NOT a native session operation.
    Negative/mirrored or nearly singular factors are intentionally excluded.
    """
    if not isinstance(item_index, int) or isinstance(item_index, bool) or item_index < 0:
        raise ValueError('Build item index must be zero-based nonnegative integer')
    if not isinstance(factors, (list, tuple)) or len(factors) != 3 or any(
        isinstance(v, bool) or not isinstance(v, (int, float))
        or not math.isfinite(v) or not 0.01 <= v <= 100 for v in factors
    ):
        raise ValueError('Local scale requires three positive finite factors in 0.01..100')
    if all(v == 1 for v in factors):
        raise ValueError('No relative scale requested')
    scene = audit(source)
    if scene['modelParts'] != 1 or scene['scenes'][0]['part'] != MODEL_PART:
        raise ValueError('Only a single 3D/3dmodel.model Core part is supported')
    part = scene['scenes'][0]
    if item_index >= len(part['buildItems']):
        raise ValueError('Selected build item out of range')
    original = part['buildItems'][item_index]['transform3mf']
    sx, sy, sz = factors
    scale = [sx, 0, 0, 0, sy, 0, 0, 0, sz, 0, 0, 0]
    scaled = compose_3mf(scale, original)
    scaled[9:12] = original[9:12]  # Explicitly keep the build origin.
    serialized = ' '.join(format(value, '.17g') for value in scaled)
    validated_matrix(serialized)
    result = edit_core_build_item(source, destination, item_index, serialized)
    result['relativeLocalScale'] = list(factors)
    result['pivot'] = 'existing build translation (not mesh center)'
    return result


def main():
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument('--input', required=True, type=Path)
    command.add_argument('--output', required=True, type=Path)
    command.add_argument('--build-index', type=int, required=True)
    edits = command.add_mutually_exclusive_group(required=True)
    edits.add_argument('--transform', help='12 numbers in Core 3MF row-vector order (source model units)')
    edits.add_argument('--translate-mm', nargs=3, type=float, metavar=('DX','DY','DZ'),
                       help='Relative world-axis mm move; preserve existing rotation and scale')
    edits.add_argument('--rotate-z-deg', type=float,
                       help='World-axis Z rotation around existing build translation (not mesh center)')
    edits.add_argument('--scale-local', nargs=3, type=float, metavar=('SX','SY','SZ'),
                       help='Positive local-axis XYZ scale around the existing build translation')
    args = command.parse_args()
    try:
        if args.translate_mm is not None:
            result = translate_core_build_item(args.input, args.output,
                                               args.build_index, args.translate_mm)
        elif args.rotate_z_deg is not None:
            result = rotate_core_build_item_z(args.input, args.output,
                                              args.build_index, args.rotate_z_deg)
        elif args.scale_local is not None:
            result = scale_core_build_item_local(args.input, args.output,
                                                 args.build_index, args.scale_local)
        else:
            result = edit_core_build_item(args.input, args.output,
                                          args.build_index, args.transform)
    except (ValueError, OSError, zipfile.BadZipFile, RuntimeError, EOFError) as exc:
        print('Core 3MF transform edit refused:', exc, file=sys.stderr)
        return 2
    print('PASS:', result)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
