import tempfile
import unittest
from pathlib import Path
from verify_native_bridge_speed import verify

HEADER = 'G90\nM82\nG21\nG1 X0 Y0 E0 F2400\n; FEATURE: Bridge\n'

def fixture(path, feed, *, feature='Bridge', moves=16):
    text = HEADER.replace('; FEATURE: Bridge', '; FEATURE: '+feature)
    text += '\n'.join(f'G1 X{i+1} Y1 E{i+1} F{feed}' for i in range(moves)) + '\n'
    path.write_text(text,encoding='utf-8')

class TestNativeBridgeSpeed(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.a=Path(self.tmp.name)/'base.gcode'
        self.b=Path(self.tmp.name)/'slow.gcode'

    def test_positive(self):
        fixture(self.a,2400)
        fixture(self.b,120)
        report=verify(self.a,self.b)
        self.assertEqual(report['altered_F120_tagged_extrusions'],16)
        self.assertFalse(report['native_wasm_gcode_match'])

    def test_untagged_wall_never_counts(self):
        fixture(self.a,2400,feature='Outer wall')
        fixture(self.b,120,feature='Outer wall')
        with self.assertRaisesRegex(ValueError,'too few'):
            verify(self.a,self.b)

    def test_travel_only_never_counts(self):
        fixture(self.a,2400)
        self.b.write_text(HEADER+'\n'.join(f'G0 X{i+1} Y1 F120' for i in range(16))+'\n',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'too few'):
            verify(self.a,self.b)

    def test_no_effect_fails(self):
        fixture(self.a,2400)
        fixture(self.b,2400)
        with self.assertRaisesRegex(ValueError,'F120'):
            verify(self.a,self.b)

    def test_existing_F120_is_not_new_effect(self):
        fixture(self.a,120)
        fixture(self.b,120)
        with self.assertRaisesRegex(ValueError,'F120'):
            verify(self.a,self.b)

    def test_too_few_segments(self):
        fixture(self.a,2400,moves=3)
        fixture(self.b,120,moves=3)
        with self.assertRaisesRegex(ValueError,'too few'):
            verify(self.a,self.b)

if __name__=='__main__': unittest.main()
