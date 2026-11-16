from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from wrap_bridge_arch_3mf import pack, wrap, CORE_NS

class TestWrapBridgeArch(unittest.TestCase):
    def test_exact_shared_stl_and_build_placement(self):
        with tempfile.TemporaryDirectory() as td:
            stl=Path(td)/'bridge.stl'
            output=Path(td)/'bridge.3mf'
            subprocess.run(['node','scripts/export-bridge-arch-stl.mjs',str(stl)],check=True,capture_output=True)
            wrap(stl,output)
            with ZipFile(output) as z:
                self.assertEqual(set(z.namelist()),{'[Content_Types].xml','_rels/.rels','3D/3dmodel.model'})
                root=ET.fromstring(z.read('3D/3dmodel.model'))
                ns={'m':CORE_NS}
                verts=root.findall('m:resources/m:object/m:mesh/m:vertices/m:vertex',ns)
                faces=root.findall('m:resources/m:object/m:mesh/m:triangles/m:triangle',ns)
                items=root.findall('m:build/m:item',ns)
                self.assertEqual((len(verts),len(faces),len(items)),(16,28,1))
                self.assertEqual(items[0].attrib['transform'],'1 0 0 0 1 0 0 0 1 90 90 0')
                # Preserve triangle ordering and signed coordinates through the wrapper.
                actual=[tuple(float(v.attrib[k]) for k in 'xyz') for v in verts]
                raw=stl.read_bytes()
                for i,face in enumerate(faces):
                    original=struct.unpack_from('<9f',raw,84+i*50+12)
                    reconstructed=[actual[int(face.attrib[key])] for key in ('v1','v2','v3')]
                    self.assertEqual(tuple(x for tri in reconstructed for x in tri),original)

    def test_malformed_stl_rejected(self):
        with self.assertRaisesRegex(ValueError,'size'):
            pack(b'')
        sample=b'\0'*80+struct.pack('<I',28)+b'\0'*(28*50)
        with self.assertRaisesRegex(ValueError,'degenerate triangle'):
            pack(sample)
        with self.assertRaisesRegex(ValueError,'exactly 28'):
            pack(b'\0'*80+struct.pack('<I',27)+b'\0'*(28*50))

if __name__=='__main__':unittest.main()
