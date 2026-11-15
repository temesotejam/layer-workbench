// Local-only regression for the post-3MF-edit G-code geometry diagnostic.
// These toy commands are not printer instructions or native parity fixtures.
import assert from 'node:assert/strict';
import {inspectSyntheticCubeExtrusion,requireEditedCubeToolpathShift}
  from './diagnose-edited-3mf-toolpaths.mjs';

const make=(x)=> [
  'G21','G90','M82',
  'G1 X90 Y95 Z0.2','G1 X100 Y95 E1', // first-layer priming excluded
  'G1 X90 Y95 Z5','G1 X100 Y95 E2',
  'G1 X'+x+' Y95','G1 X'+(x+10)+' Y95 E3',
  ''
].join('\n');
const before=inspectSyntheticCubeExtrusion(make(150));
const after=inspectSyntheticCubeExtrusion(make(180));
assert.deepEqual(before.regions,{unchanged:1,original:1,moved:0});
assert.deepEqual(after.regions,{unchanged:1,original:0,moved:1});
assert.equal(requireEditedCubeToolpathShift(before,after),true);
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
