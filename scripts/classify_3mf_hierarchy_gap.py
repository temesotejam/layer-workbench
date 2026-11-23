#!/usr/bin/env python3
"""Classify the first observable loss of 3MF hierarchy in the isolated WASM probe.

Consumes independently generated native manifest and Core 3MF ZIP scene
reports; this is a diagnostic, not an exporter repair or parity certificate.
"""
import argparse
import json
from pathlib import Path


def _count(data, name):
    value = data.get(name)
    if type(value) is not int or value < 0 or value > 100_000:
        raise ValueError(f"Missing or invalid count: {name}")
    return value


def classify_hierarchy_gap(summary, scene):
    """Locate loss at native export or subsequent native reimport.

    3MF's Core build item may be a components object, so count expanded mesh
    instances rather than build items alone. Input mesh/object counts still
    distinguish independent resources from shared mesh instances.
    """
    if not isinstance(summary, dict) or not isinstance(scene, dict):
        raise ValueError("Expected object reports")
    initial = {name: _count(summary, 'initial' + name) for name in
               ('Objects', 'Meshes', 'Instances')}
    imported = {name: _count(summary, 'reimported' + name) for name in
                ('Objects', 'Meshes', 'Instances')}
    archive = {
        'Objects': _count(scene, 'totalObjects'),
        'Instances': _count(scene, 'totalResolvedMeshInstances'),
    }
    triangles = _count(scene, 'totalResolvedTriangleInstances')
    stl_triangles = _count(summary, 'flattenedTriangles')
    model_parts = _count(scene, 'modelParts')
    build_items = _count(scene, 'totalBuildItems')
    if not model_parts or not build_items or not all(initial.values()) or \
            not all(imported.values()) or not all(archive.values()) or \
            not triangles or not stl_triangles:
        raise ValueError("Empty evidence is not a valid hierarchy diagnostic")
    if triangles != stl_triangles:
        stage = 'inconclusive-geometry-mismatch'
    elif archive['Objects'] < initial['Objects'] or \
            archive['Instances'] < initial['Instances']:
        stage = 'exported-core-hierarchy-lost'
    elif archive['Objects'] > initial['Objects'] or \
            archive['Instances'] > initial['Instances']:
        stage = 'inconclusive-core-expansion'
    elif any(imported[name] < initial[name] for name in initial):
        stage = 'reimport-manifest-hierarchy-lost'
    elif any(imported[name] > initial[name] for name in initial):
        stage = 'inconclusive-manifest-expansion'
    else:
        # Mesh IDs and Core resources do not map 1:1 in every 3MF, and the
        # spatial placement verification is a separate gate.
        stage = 'counts-retained-placement-unverified'
    return {
        'firstObservedGap': stage,
        'nativeInput': initial,
        'exportedCore': {'Objects': archive['Objects'],
                         'ResolvedMeshInstances': archive['Instances'],
                         'BuildItems': build_items,
                         'ResolvedTriangleInstances': triangles},
        'nativeReimport': imported,
        'convertedStlTriangles': stl_triangles,
        'isNativeParity': False,
        'limitations': 'Core count evidence only; component paths, geometric placement, identity, metadata, desktop 3MF compatibility and printer safety are not certified.'
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--summary', type=Path, required=True)
    parser.add_argument('--scene', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    try:
        result = classify_hierarchy_gap(
            json.loads(args.summary.read_text(encoding='utf-8')),
            json.loads(args.scene.read_text(encoding='utf-8')))
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    except (ValueError, OSError, TypeError, json.JSONDecodeError) as error:
        parser.exit(2, f'3MF hierarchy diagnostic failed: {error}\n')
    print('3MF_HIERARCHY_STAGE ' + result['firstObservedGap'])
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
