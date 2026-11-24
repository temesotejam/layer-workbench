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


def _single_mesh_build_counts(scene, model_parts, build_items, mesh_instances):
    """Use build roots, not component wrapper resources, for simple scenes.

    Only one same-part mesh occurrence per build item is comparable to the
    one-mesh-per-object manifest fixtures. Other layouts stay inconclusive.
    """
    if model_parts != 1 or 'scenes' not in scene:
        return None
    scenes = scene['scenes']
    if not isinstance(scenes, list) or len(scenes) != 1 or not isinstance(scenes[0], dict):
        raise ValueError("Invalid Core scene detail")
    items = scenes[0].get('buildItems')
    resolved = scenes[0].get('resolvedMeshInstances')
    if not isinstance(items, list) or not isinstance(resolved, list) or \
            len(items) != build_items or len(resolved) != mesh_instances:
        raise ValueError("Core scene detail disagrees with aggregate counts")
    if build_items != mesh_instances:
        return None
    roots = []
    for item in items:
        root = item.get('objectId') if isinstance(item, dict) else None
        if not isinstance(root, str) or not root:
            raise ValueError("Invalid Core build root")
        roots.append(root)
    leaves = set()
    seen = set()
    for instance in resolved:
        if not isinstance(instance, dict):
            raise ValueError("Invalid resolved Core instance")
        index = instance.get('buildItemIndex')
        leaf = instance.get('objectId')
        path = instance.get('objectPath')
        if type(index) is not int or not 0 <= index < build_items or \
                not isinstance(leaf, str) or not leaf or \
                not isinstance(path, list) or not path or \
                path[0] != roots[index] or path[-1] != leaf:
            raise ValueError("Invalid resolved Core instance identity")
        if index in seen:
            return None  # Multiple mesh occurrences in one build are not comparable.
        seen.add(index)
        leaves.add(leaf)
    return len(set(roots)), len(leaves)


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
    simple_counts = _single_mesh_build_counts(
        scene, model_parts, build_items, archive['Instances'])
    # A component wrapper and its mesh leaf are two XML resources but may
    # represent just one native object. Keep raw inventory in the report.
    comparable_objects = simple_counts[0] if simple_counts else archive['Objects']
    comparable_meshes = simple_counts[1] if simple_counts else None
    if triangles != stl_triangles:
        stage = 'inconclusive-geometry-mismatch'
    elif comparable_objects < initial['Objects'] or \
            (comparable_meshes is not None and comparable_meshes < initial['Meshes']) or \
            archive['Instances'] < initial['Instances']:
        stage = 'exported-core-hierarchy-lost'
    elif comparable_objects > initial['Objects'] or \
            (comparable_meshes is not None and comparable_meshes > initial['Meshes']) or \
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
                         'DistinctBuildRoots': simple_counts[0] if simple_counts else None,
                         'DistinctResolvedMeshResources': comparable_meshes,
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
