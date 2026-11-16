#!/usr/bin/env python3
"""Wrap the EXACT 28-triangle WASM bridge arch STL into independent Core 3MF.

The v2.5.0 desktop CLI diagnostic uses 3MF input. This packaging adds one
explicit build translation but does not claim an Orca-native project or parity.
"""
import argparse
import math
from pathlib import Path
import struct
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
from xml.etree import ElementTree as ET

CONTENT_TYPES = '''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>'''
RELS = '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/>
</Relationships>'''
CORE_NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'

def pack(stl: bytes) -> bytes:
    if len(stl) < 84 or len(stl) > 200_000:
        raise ValueError('bridge STL size out of range')
    count = struct.unpack_from('<I',stl,80)[0]
    if count != 28 or len(stl) != 84 + count*50:
        raise ValueError('expected exactly 28 bounded bridge arch triangles')
    vertices,indices = [],{}
    triangles=[]
    for i in range(count):
        base=84+i*50
        face=[]
        for j in range(3):
            p=struct.unpack_from('<fff',stl,base+12+j*12)
            if not all(math.isfinite(x) for x in p):
                raise ValueError('nonfinite arch coordinate')
            if p not in indices:
                indices[p]=len(vertices)
                vertices.append(p)
            face.append(indices[p])
        if len(set(face)) != 3:
            raise ValueError('degenerate triangle')
        triangles.append(face)
    if len(vertices) != 16:
        raise ValueError('unexpected bridge arch vertex count')
    for axis,expected in enumerate(((0,12,28,40),(0,20),(0,10,15))):
        if tuple(sorted(set(p[axis] for p in vertices))) != expected:
            raise ValueError('incorrect arch bounding coordinates')
    ET.register_namespace('',CORE_NS)
    model=ET.Element(f'{{{CORE_NS}}}model',{'unit':'millimeter'})
    resource=ET.SubElement(model,f'{{{CORE_NS}}}resources')
    obj=ET.SubElement(resource,f'{{{CORE_NS}}}object',{'id':'1','type':'model'})
    mesh=ET.SubElement(obj,f'{{{CORE_NS}}}mesh')
    verts=ET.SubElement(mesh,f'{{{CORE_NS}}}vertices')
    for p in vertices:
        ET.SubElement(verts,f'{{{CORE_NS}}}vertex',dict(zip(('x','y','z'),(f'{x:.9g}' for x in p))))
    faces=ET.SubElement(mesh,f'{{{CORE_NS}}}triangles')
    for face in triangles:
        ET.SubElement(faces,f'{{{CORE_NS}}}triangle',dict(zip(('v1','v2','v3'),map(str,face))))
    build=ET.SubElement(model,f'{{{CORE_NS}}}build')
    ET.SubElement(build,f'{{{CORE_NS}}}item',{
        'objectid':'1','transform':'1 0 0 0 1 0 0 0 1 90 90 0'})
    return ET.tostring(model,encoding='utf-8',xml_declaration=True)

def wrap(input_path: Path, output_path: Path):
    model=pack(input_path.read_bytes())
    with ZipFile(output_path,'x',compression=ZIP_DEFLATED) as archive:
        for name,content in (
            ('[Content_Types].xml',CONTENT_TYPES.encode()),
            ('_rels/.rels',RELS.encode()),
            ('3D/3dmodel.model',model)):
            info=ZipInfo(name,(2020,1,1,0,0,0))
            info.compress_type=ZIP_DEFLATED
            archive.writestr(info,content)
    print('PASS: wrapped shared bridge arch mesh in independent, explicitly placed Core 3MF')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--stl',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    wrap(a.stl,a.output)

if __name__=='__main__':main()
