import assert from 'node:assert/strict';
import {auditSurfaceSkinPattern} from './surface-skin-diagnostic.mjs';

const stroke=(feature,x1=0,y1=0,x2=2,y2=0,z=0.4)=>({
  feature,extrusion:true,commandedPositiveEMm:0.12,
  x1,y1,x2,y2,z1:z,z2:z
});
const parsed=(segments, extra={})=>({
  layers:[{segments}],skippedArcs:0,skippedMalformedMotion:0,...extra
});
for (const feature of ['top surface','bottom surface']) {
  const a=parsed([stroke(feature),stroke('inner wall',10,0,12,0)]);
  const b=parsed([stroke(feature,0,0,0,2),stroke('inner wall',10,0,12,0)]);
  const result=auditSurfaceSkinPattern(a,b,feature);
  assert.equal(result.result,'observed_tagged_skin_geometry_difference');
  assert.deepEqual(result.changed_geometry_z_mm,[0.4]);
  assert.equal(result.baseline.tagged_positive_e_xy_strokes,1);
  assert.equal(result.candidate.tagged_xy_length_mm,2);
  assert.equal(result.desktop_native_parity,false);
  assert.equal(result.printer_safe,false);
  assert.equal(result.public_pages_enabled,false);

  // Different unrelated walls, G-code comments or header-only flags
  // cannot falsely prove an outer-skin geometry change.
  const unrelated=parsed([stroke(feature),stroke('inner wall',10,0,15,0)]);
  assert.equal(auditSurfaceSkinPattern(a,unrelated,feature).result,
    'inconclusive_no_tagged_skin_path_difference');
  const flipped=parsed([stroke(feature,2,0,0,0)]);
  const reverse=auditSurfaceSkinPattern(a,flipped,feature);
  assert.equal(reverse.changed_geometry_z_count,0);
  assert.equal(reverse.result,'observed_tagged_skin_sequence_difference_only');
  assert.equal(auditSurfaceSkinPattern(a,parsed([stroke('internal solid infill')]),feature).result,
    'inconclusive_no_tagged_skin_on_both_sides');
  for(const invalid of [
    {...stroke(feature),extrusion:false},
    {...stroke(feature),commandedPositiveEMm:0},
    {...stroke(feature),x2:0},
    {...stroke(feature),x2:NaN},
    {...stroke(feature),z2:0.5},
    stroke('not '+feature),
    stroke(feature.toUpperCase()),
  ]) {
    assert.equal(auditSurfaceSkinPattern(a,parsed([invalid]),feature).result,
      'inconclusive_no_tagged_skin_on_both_sides');
  }
  assert.throws(()=>auditSurfaceSkinPattern(parsed([],{skippedArcs:1}),a,feature),
    /Incomplete or malformed/);
  assert.throws(()=>auditSurfaceSkinPattern(parsed([],{skippedMalformedMotion:1}),a,feature),
    /Incomplete or malformed/);
  assert.throws(()=>auditSurfaceSkinPattern({layers:[{}],skippedArcs:0,
    skippedMalformedMotion:0},a,feature),/Malformed G-code layer/);
}
assert.throws(()=>auditSurfaceSkinPattern(parsed([]),parsed([]),'skin'),
  /Unsupported surface skin/);
console.log('PASS: skin pattern comparator requires genuine exact-tagged planar positive-E XY strokes and distinguishes geometry from sequence');
