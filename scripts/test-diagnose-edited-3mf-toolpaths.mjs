// Local-only regression for the post-3MF-edit G-code geometry diagnostic.
// These toy commands are not printer instructions or native parity fixtures.
import assert from 'node:assert/strict';
import {inspectSyntheticCubeExtrusion,requireEditedCubeToolpathShift}
  from './diagnose-edited-3mf-toolpaths.mjs';

const make=(x,levels=[5,10,15])=> {
  let e=1;
  return [
    'G21','G90','M82',
    'G1 X90 Y95 Z0.2','G1 X100 Y95 E1', // first-layer priming excluded
    ...levels.flatMap(z=>[
      'G0 X90 Y95 Z'+z,'G1 X100 Y95 E'+(++e),
      'G0 X'+x+' Y95','G1 X'+(x+10)+' Y95 E'+(++e),
    ]),
    ''
  ].join('\n');
};
const before=inspectSyntheticCubeExtrusion(make(150));
const after=inspectSyntheticCubeExtrusion(make(180));
assert.deepEqual(before.regions,{unchanged:3,original:3,moved:0});
assert.deepEqual(after.regions,{unchanged:3,original:0,moved:3});
assert.deepEqual(before.regionLayers,{unchanged:3,original:3,moved:0});
assert.deepEqual(after.regionLayers,{unchanged:3,original:0,moved:3});
assert.deepEqual(before.regionZSpanMm,{unchanged:10,original:10,moved:0});
assert.deepEqual(after.regionZSpanMm,{unchanged:10,original:0,moved:10});
assert.equal(requireEditedCubeToolpathShift(before,after),true);
// A lone extrusion or many strokes packed into a shallow slab cannot
// establish the 3D relocation of a 20-mm-tall cube.
const lone=inspectSyntheticCubeExtrusion(make(150,[5]));
assert.throws(()=>requireEditedCubeToolpathShift(lone,after),/Insufficient.*coverage/);
const shallow=inspectSyntheticCubeExtrusion(make(150,[5,6,7]));
assert.throws(()=>requireEditedCubeToolpathShift(shallow,after),/Insufficient.*coverage/);
const incomplete=structuredClone(before);
delete incomplete.regionLayers;
assert.throws(()=>requireEditedCubeToolpathShift(incomplete,after),/Invalid.*evidence/);
assert.throws(()=>requireEditedCubeToolpathShift(before,before),/did not relocate/);
assert.throws(()=>requireEditedCubeToolpathShift(after,after),/did not relocate/);
assert.throws(()=>requireEditedCubeToolpathShift({},after),/Invalid/);
const noExtrusion=inspectSyntheticCubeExtrusion('G90\nG1 X90 Y95 Z5\nG1 X100 Y95\n');
assert.equal(noExtrusion.regions.unchanged,0);
// Long deposited strokes must not look like independent printable cubes
// just because their midpoints fall inside one of the fixture ROIs.
const crossingMidpoints=inspectSyntheticCubeExtrusion([
  'G21','G90','M82','G1 X120 Y95 Z5',
  'G1 X200 Y95 E1', // X midpoint=160, but crosses the entire original ROI
  'G1 X160 Y50', 'G1 X160 Y140 E2', // Y midpoint=95, but outside cube Y limits
  'G1 X0 Y95','G1 X200 Y95 E3', // X midpoint=100, not an unchanged cube
].join('\n'));
assert.deepEqual(crossingMidpoints.regions,{unchanged:0,original:0,moved:0});
assert.equal(crossingMidpoints.extrusionSegments,3);
assert.throws(()=>requireEditedCubeToolpathShift(crossingMidpoints,after),
  /did not relocate/);
// Conversely, a real deposited segment whose endpoints are both within
// the bounded cube region must still be counted.
const bounded=inspectSyntheticCubeExtrusion(
  'G90\nM82\nG1 X150 Y90 Z5\nG1 X170 Y110 E1\n');
assert.equal(bounded.regions.original,1);

assert.throws(()=>requireEditedCubeToolpathShift(noExtrusion,after),/did not relocate/);
console.log('PASS: synthetic edited-3MF reslice region checker detects relocation and rejects unchanged or travel-only paths');
