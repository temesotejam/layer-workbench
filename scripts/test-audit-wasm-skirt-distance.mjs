import assert from 'node:assert/strict';
import {auditWasmSkirtDistance} from './audit-wasm-skirt-distance.mjs';

function scene({margin=1,feature='skirt',extrusion=true,z=0.2}={}) {
  const vertices=[[100-margin,110-margin],[130+margin,110-margin],
    [130+margin,140+margin],[100-margin,140+margin]];
  const segments=vertices.map((a,i)=>{
    const b=vertices[(i+1)%vertices.length];
    return {x1:a[0],y1:a[1],z1:z,x2:b[0],y2:b[1],z2:z,feature,extrusion};
  });
  // Unrelated outside travel and non-skirt extrusion must not fake growth.
  segments.push({x1:-100,y1:-100,z1:0.2,x2:200,y2:200,z2:0.2,feature:'skirt',extrusion:false});
  segments.push({x1:-100,y1:-100,z1:0.2,x2:200,y2:200,z2:0.2,feature:'outer wall',extrusion:true});
  return {layers:[{z,segments}],skippedArcs:0,skippedMalformedMotion:0};
}
const near=scene({margin:1}),far=scene({margin:8});
const valid=auditWasmSkirtDistance(near,far);
assert.equal(valid.passed,true);
assert.equal(valid.parity_pass,false);
assert.deepEqual(valid.xy_span_growth_mm,[14,14]);
assert.equal(valid.near_skirt_segments,4);
assert.equal(auditWasmSkirtDistance(near,near).passed,false);
assert.equal(auditWasmSkirtDistance(far,near).passed,false);
assert.equal(auditWasmSkirtDistance(near,scene({margin:8,feature:'outer wall'})).passed,false);
assert.equal(auditWasmSkirtDistance(near,scene({margin:8,extrusion:false})).passed,false);
assert.equal(auditWasmSkirtDistance(near,{...far,skippedArcs:1}).passed,false);
assert.equal(auditWasmSkirtDistance(near,{...far,skippedMalformedMotion:1}).passed,false);
const tilted=scene({margin:8});tilted.layers[0].segments.slice(0,4).forEach(s=>s.z2=0.4);
assert.equal(auditWasmSkirtDistance(near,tilted).passed,false);
const malformed=scene({margin:8});malformed.layers[0].segments[0].x2=NaN;
assert.throws(()=>auditWasmSkirtDistance(near,malformed),/Nonfinite/);
assert.throws(()=>auditWasmSkirtDistance({},far),/Expected bounded/);
console.log('PASS: exact-feature skirt envelope growth, negative controls and fail-closed parse guards');
