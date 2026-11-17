import struct
import subprocess
import tempfile
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from wrap_parity_cube_3mf import BUILD_TRANSFORM, CORE_NS, make_model, wrap


class ParityPlacementTests(unittest.TestCase):
    def test_shared_source_triangulation_and_native_build_placement(self):
        with tempfile.TemporaryDirectory() as root:
            source, output = Path(root)/'cube.stl', Path(root)/'cube.3mf'
            subprocess.run(['node', 'scripts/parity-cube-fixture.mjs', str(source)],
                           check=True, capture_output=True)
            raw = source.read_bytes()
            wrap(source, output)
            self.assertEqual(source.read_bytes(), raw, '3MF creation must not modify STL input')
            with ZipFile(output) as archive:
                self.assertEqual(set(archive.namelist()),
                                 {'[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model'})
                model = ET.fromstring(archive.read('3D/3dmodel.model'))
            ns = {'m': CORE_NS}
            self.assertEqual(model.attrib['unit'], 'millimeter')
            items = model.findall('m:build/m:item', ns)
            self.assertEqual(len(items), 1)
            self.assertEqual(items[0].attrib['transform'], BUILD_TRANSFORM)
            verts = model.findall('m:resources/m:object/m:mesh/m:vertices/m:vertex', ns)
            faces = model.findall('m:resources/m:object/m:mesh/m:triangles/m:triangle', ns)
            self.assertEqual((len(verts),len(faces)), (8,12))
            vertices = [tuple(float(v.attrib[k]) for k in 'xyz') for v in verts]
            for i, face in enumerate(faces):
                native = [vertices[int(face.attrib[k])] for k in ('v1','v2','v3')]
                raw_face = struct.unpack_from('<9f', raw, 84+i*50+12)
                self.assertEqual(tuple(x for v in native for x in v), raw_face)
            for axis in range(3):
                self.assertEqual({p[axis] for p in vertices}, {0.0, 20.0})

    def test_fail_closed_on_tampered_or_truncated_source(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root)/'cube.stl'
            subprocess.run(['node', 'scripts/parity-cube-fixture.mjs', str(source)],
                           check=True, capture_output=True)
            original = source.read_bytes()
            altered = bytearray(original)
            altered[0] = 255
            with self.assertRaisesRegex(ValueError, 'byte-pinned'):
                make_model(bytes(altered))
            with self.assertRaisesRegex(ValueError, 'byte-pinned'):
                make_model(original[:-1])


if __name__ == '__main__':
    unittest.main()
