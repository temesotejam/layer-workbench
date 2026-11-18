import assert from 'node:assert/strict';
import { auditWasmCubeDeposition } from './audit-wasm-cube-deposition.mjs';

function cubePaths({dx=0,dy=0,count=99}={}) {
  const segments=[];
  for (let k=0;k<count;k++) {
    const z=0.2+19.6*k/(count-1);
    const corners=[[128.2+dx,128.2+dy],[147.8+dx,128.2+dy],
      [147.8+dx,147.8+dy],[128.2+dx,147.8+dy]];
    for (let i=0;i<4;i++) {
      const a=corners[i],b=corners[(i+1)%4];
      segments.push({x1:a[0],y1:a[1],z1:z,x2:b[0],y2:b[1],z2:z,extrusion:true});
    }
  }
  return {layers:[{segments}],skippedArcs:0,skippedMalformedMotion:0};
}
const valid=cubePaths();
const accepted=auditWasmCubeDeposition(valid);
assert.equal(accepted.passed,true);
assert.equal(accepted.parity_pass,false);
assert.equal(accepted.deposited_xy_segments,396);
assert.equal(accepted.inside_fraction,1);
assert.deepEqual(accepted.observed_inside_xyz_bounds_mm[0],[128.2,147.8]);
assert.equal(auditWasmCubeDeposition(cubePaths({dx:4})).passed,false,
  'A real four-millimeter displacement must fail even if the scene claims origin 128');
assert.equal(auditWasmCubeDeposition(cubePaths({count:5})).passed,false,
  'A few spoofed corner moves must not count as full deposited evidence');
const withPrime=cubePaths();
withPrime.layers[0].segments.push({x1:0,y1:0,z1:0.2,x2:120,y2:0,z2:0.2,extrusion:true});
assert.equal(auditWasmCubeDeposition(withPrime).passed,true,
  'A limited outside prime line is allowed but counted in the denominator');
const withOutside=cubePaths();
for(let i=0;i<100;i++) withOutside.layers[0].segments.push({x1:20,y1:20,z1:0.2,x2:30,y2:20,z2:0.2,extrusion:true});
assert.equal(auditWasmCubeDeposition(withOutside).passed,false,
  'Dominant deposition outside the cube envelope must fail');
assert.equal(auditWasmCubeDeposition({...valid,skippedArcs:1}).passed,false);
assert.equal(auditWasmCubeDeposition({...valid,skippedMalformedMotion:1}).passed,false);
assert.equal(auditWasmCubeDeposition({layers:[],skippedArcs:0,skippedMalformedMotion:0}).passed,false);
assert.throws(()=>auditWasmCubeDeposition({layers:[{segments:[{extrusion:true,x1:NaN,y1:1,z1:1,x2:2,y2:2,z2:2}]}],skippedArcs:0,skippedMalformedMotion:0}),/Nonfinite/);
console.log('PASS: synthetic WASM deposited cube geometry acceptance, displacement, sparse/spoofed movement, prime line, parse completeness');
