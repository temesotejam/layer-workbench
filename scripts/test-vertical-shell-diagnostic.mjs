import assert from 'node:assert/strict';
import {auditVerticalShellDeposition} from './vertical-shell-diagnostic.mjs';
const seg=(feature,x1=0,x2=1,z=1)=>({
  feature,extrusion:true,commandedPositiveEMm:0.1,
  x1,x2,y1:0,y2:0,z1:z,z2:z
});
const parsed=(segments,extra={})=>({
  layers:[{segments}],skippedMalformedMotion:0,skippedArcs:0,...extra
});
const a=parsed([seg('Internal solid infill'),seg('Outer wall',0,2)]);
const b=parsed([seg('internal solid infill',0,2),seg('Outer wall',0,2)]);
const effect=auditVerticalShellDeposition(a,b);
assert.equal(effect.result,'observed_internal_solid_stroke_signature_difference');
assert.deepEqual(effect.changed_internal_solid_z_mm,[1]);
assert.equal(effect.baseline.internal_solid_positive_e_xy_strokes,1);
assert.equal(effect.candidate.internal_solid_xy_length_mm,2);
assert.equal(effect.native_desktop_parity,false);
assert.equal(effect.printer_safe,false);
assert.equal(effect.public_pages_enabled,false);
// Changing only a skirt, outer wall, metadata or feedrate cannot prove
// an internal-solid response; reversing endpoints/order cannot either.
const unrelated=parsed([seg('Internal solid infill'),seg('Outer wall',0,5)]);
assert.equal(auditVerticalShellDeposition(a,unrelated).result,
  'inconclusive_no_internal_solid_stroke_difference');
const orderA=parsed([seg('Internal solid infill',0,1),seg('Internal solid infill',1,2)]);
const orderB=parsed([seg('Internal solid infill',2,1),seg('Internal solid infill',1,0)]);
assert.equal(auditVerticalShellDeposition(orderA,orderB).result,
  'inconclusive_no_internal_solid_stroke_difference');
assert.equal(auditVerticalShellDeposition(a,parsed([seg('Internal bridge')])).result,
  'inconclusive_no_tagged_internal_solid_on_both_sides');
for (const impostor of ['not internal solid infill','solid infill','external solid infill']){
  assert.equal(auditVerticalShellDeposition(a,parsed([seg(impostor)])).result,
    'inconclusive_no_tagged_internal_solid_on_both_sides');
}
for (const invalid of [
  {...seg('Internal solid infill'),extrusion:false},
  {...seg('Internal solid infill'),commandedPositiveEMm:0},
  {...seg('Internal solid infill'),x2:0},
  {...seg('Internal solid infill'),x2:NaN},
  {...seg('Internal solid infill'),z2:2},
]){
  assert.equal(auditVerticalShellDeposition(a,parsed([invalid])).result,
    'inconclusive_no_tagged_internal_solid_on_both_sides');
}
assert.throws(()=>auditVerticalShellDeposition(parsed([], {skippedArcs:1}),a),
  /Incomplete or malformed/);
assert.throws(()=>auditVerticalShellDeposition(parsed([], {skippedMalformedMotion:1}),a),
  /Incomplete or malformed/);
assert.throws(()=>auditVerticalShellDeposition(null,a),/Incomplete or malformed/);
console.log('PASS: vertical shell diagnostic rejects unrelated/header-only/unsafe path evidence');
