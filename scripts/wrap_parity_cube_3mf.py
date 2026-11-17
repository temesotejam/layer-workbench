#!/usr/bin/env python3
"""Wrap the byte-pinned parity cube STL in an explicit 128,128,0 Core 3MF placement.

Only a geometric native-CLI diagnostic: not a real Orca project, equal profiles,
G-code parity or a printable model. Never mutate the original binary STL.
"""
import argparse
import hashlib
import struct
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

SOURCE_SHA256 = '7b59223183b5c34815cbf197e1207b108932779a650bd9e6c9a6d2be811f8e93'
CORE_NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'
BUILD_TRANSFORM = '1 0 0 0 1 0 0 0 1 128 128 0'
CONTENT_TYPES = b'''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>'''
RELS = b'''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/>
</Relationships>'''


def make_model(stl: bytes) -> bytes:
    if len(stl) != 684 or hashlib.sha256(stl).hexdigest() != SOURCE_SHA256 or struct.unpack_from('<I', stl, 80)[0] != 12:
        raise ValueError('not the exact byte-pinned 12-triangle shared parity STL')
    vertices, indices, faces = [], {}, []
    for i in range(12):
        base = 84 + i * 50 + 12
        face = []
        for j in range(3):
            point = struct.unpack_from('<fff', stl, base + j * 12)
            if not all(coord in (0., 20.) for coord in point):
                raise ValueError('unexpected parity-cube source coordinates')
            if point not in indices:
                indices[point] = len(vertices)
                vertices.append(point)
            face.append(indices[point])
        if len(set(face)) != 3:
            raise ValueError('degenerate parity-cube triangle')
        faces.append(face)
    if len(vertices) != 8 or any({p[axis] for p in vertices} != {0., 20.} for axis in range(3)):
        raise ValueError('unexpected parity-cube vertices')
    ET.register_namespace('', CORE_NS)
    model = ET.Element(f'{{{CORE_NS}}}model', {'unit': 'millimeter'})
    resources = ET.SubElement(model, f'{{{CORE_NS}}}resources')
    obj = ET.SubElement(resources, f'{{{CORE_NS}}}object', {'id': '1', 'type': 'model'})
    mesh = ET.SubElement(obj, f'{{{CORE_NS}}}mesh')
    verts = ET.SubElement(mesh, f'{{{CORE_NS}}}vertices')
    for point in vertices:
        ET.SubElement(verts, f'{{{CORE_NS}}}vertex', dict(zip('xyz', (str(int(x)) for x in point))))
    triangles = ET.SubElement(mesh, f'{{{CORE_NS}}}triangles')
    for face in faces:
        ET.SubElement(triangles, f'{{{CORE_NS}}}triangle', dict(zip(('v1','v2','v3'), map(str, face))))
    build = ET.SubElement(model, f'{{{CORE_NS}}}build')
    ET.SubElement(build, f'{{{CORE_NS}}}item', {'objectid': '1', 'transform': BUILD_TRANSFORM})
    return ET.tostring(model, encoding='utf-8', xml_declaration=True)


def wrap(source: Path, output: Path):
    model = make_model(source.read_bytes())
    with ZipFile(output, 'x', compression=ZIP_DEFLATED) as archive:
        for name, data in (('[Content_Types].xml', CONTENT_TYPES), ('_rels/.rels', RELS), ('3D/3dmodel.model', model)):
            metadata = ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            metadata.compress_type = ZIP_DEFLATED
            archive.writestr(metadata, data)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stl', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    wrap(args.stl, args.output)
    print('PASS: byte-pinned cube is in a Core 3MF with 128,128,0 placement (NOT G-code parity)')
