import assert from 'node:assert/strict';
import {parseGcodeToolpaths} from './gcode-preview-parser.mjs';
import {compareFirstLayerTravelFeedrates} from './initial-layer-travel-diagnostic.mjs';
function sample(f=2400,f2=3600,offset=0){
  return ['G21','G90','M83','G1 Z0.2 F1200',
    'G1 X1 Y0 F1200','G1 X2 Y0 E0.15 F900','G1 X3 Y0 E0.15',
    'G1 X6 Y0 F'+f,'G1 X7 Y0 E0.15 F900','G1 X8 Y0 E0.15',
    'G1 X11 Y'+offset+' F'+f,'G1 X12 Y'+offset+' E0.15 F900',
    'G1 Z0.4 F1200','G1 X15 Y0 F'+f2,'G1 X16 Y0 E0.15 F900'].join('\n');
}
const parsed=(a,b,c)=>parseGcodeToolpaths(sample(a,b,c));
const result=compareFirstLayerTravelFeedrates(parsed(2400,3600,0),parsed(4800,3600,0));
assert.equal(result.first_deposition_z_mm,0.2);
assert.equal(result.same_deposition_geometry,true);
assert.equal(result.matched_travels,2);
assert.equal(result.changed_travels,2);
assert.equal(result.near_double_f_strokes,2);
assert.deepEqual(result.f50_unique_mm_min,[2400]);
assert.deepEqual(result.f100_unique_mm_min,[4800]);
assert.equal(result.printer_ready,false);
assert.equal(compareFirstLayerTravelFeedrates(
  parsed(2400,3600,0),parsed(2400,7200,0)).changed_travels,0,
  'Changed second-layer F is not first-layer evidence');
const geometry=compareFirstLayerTravelFeedrates(parsed(2400,3600,0),parsed(4800,3600,0.1));
assert.equal(geometry.same_deposition_geometry,false);
assert.equal(geometry.matched_travels,1);
assert.throws(()=>compareFirstLayerTravelFeedrates(
  {...parsed(2400,3600,0),skippedMalformedMotion:1},parsed(4800,3600,0)),/skipped/);
assert.throws(()=>compareFirstLayerTravelFeedrates(
  {...parsed(2400,3600,0),skippedArcs:1},parsed(4800,3600,0)),/skipped/);
console.log('PASS: first-layer travel percent diagnostic, XY matching and negative controls');
