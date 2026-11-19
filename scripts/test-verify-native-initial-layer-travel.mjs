import assert from 'node:assert/strict';
import {verifyNativeFirstLayerTravel} from './verify-native-initial-layer-travel.mjs';
function sample(f=2400,offset=0,extra=''){
  return ['G21','G90','M83','G1 Z0.2 F1200',
    'G1 X1 Y0 F1200','G1 X2 Y0 E0.15 F900','G1 X3 Y0 E0.15',
    'G1 X6 Y0 F'+f,'G1 X7 Y0 E0.15 F900','G1 X8 Y0 E0.15',
    extra,'G1 X11 Y'+offset+' F'+f,'G1 X12 Y'+offset+' E0.15 F900',
    'G1 Z0.4 F1200','G1 X15 Y0 F3600','G1 X16 Y0 E0.15 F900'].filter(Boolean).join('\n');
}
const yes=verifyNativeFirstLayerTravel(sample(2400),sample(4800));
assert.equal(yes.same_deposition_geometry,true);
assert.equal(yes.matched_travels,3);
assert.equal(yes.changed_travels,2);
assert.equal(yes.near_double_f_strokes,2);
assert.equal(yes.native_wasm_parity,false);
assert.equal(yes.printer_ready,false);
assert.throws(()=>verifyNativeFirstLayerTravel(sample(2400),sample(2400)),/did not increase/);
assert.throws(()=>verifyNativeFirstLayerTravel(sample(2400),sample(4800,0.1)),/deposited geometry/);
assert.throws(()=>verifyNativeFirstLayerTravel(sample(2400),
  sample(4800).replace('G1 X7 Y0 E0.15 F900','G1 X7 Y0 E0.25 F900')),
  /deposited geometry/,
  'Changed extrusion amount cannot masquerade as unchanged deposition');
// An extra non-depositing path must not be hidden by three matching paths.
assert.throws(()=>verifyNativeFirstLayerTravel(sample(2400),
  sample(4800,0,'G1 X9 Y0 F4800')),/travel geometry\/count/);
assert.throws(()=>verifyNativeFirstLayerTravel(sample(2400),
  sample(4800,0,'G1 X9 Y0 K1 F4800')),/skipped/);
assert.throws(()=>verifyNativeFirstLayerTravel('',sample(4800)),/Missing or oversized/);
console.log('PASS: native first-layer travel modal F strict matching and negative cases');
