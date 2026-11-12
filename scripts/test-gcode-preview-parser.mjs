import assert from 'node:assert/strict';
import {parseGcodeToolpaths} from './gcode-preview-parser.mjs';
const sample=`G21
G90
M82
G92 E0
G0 X10 Y10 Z0.2
G1 X20 Y10 E1
G1 X20 Y20 E2
G0 X10 Y20
G1 X10 Y10 E3
G0 Z0.4
M83
G91
G1 X10 E0.6
G1 Y10 E0.6
G0 X-20
G92 E0
G2 X1 Y1 I1 J0
`;
const result=parseGcodeToolpaths(sample);
assert.equal(result.extrusions,5);
assert.equal(result.travels,3);
assert.equal(result.skippedArcs,1);
assert.deepEqual(result.layers.map(layer=>layer.z),[0.2,0.4]);
assert.equal(result.layers[0].segments[0].x2,10);
assert.equal(result.layers[1].segments[0].x2,30);
assert.throws(()=>parseGcodeToolpaths('G1 X10', {maxSegments:0}), /complex/);
assert.throws(()=>parseGcodeToolpaths('G1 X100001'), /limits/);
console.log('PASS: G-code linear extrusion, travel, layers, relative moves, safety limits');
