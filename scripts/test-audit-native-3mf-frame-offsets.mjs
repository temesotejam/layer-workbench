import assert from 'node:assert/strict';
import {auditNative3mfFrameOffsets as audit} from './audit-native-3mf-frame-offsets.mjs';
const row=(x,y,z,angle=0,sx=1,sy=1)=>{
  const c=Math.cos(angle),s=Math.sin(angle);
  return [sx*c,-sy*s,0,x,sx*s,sy*c,0,y,0,0,1,z,0,0,0,1];
};
const col=m=>Array.from({length:16},(_,i)=>m[(i%4)*4+Math.floor(i/4)]);
const n=matrices=>matrices.map(m=>({transform:{matrix:m}}));
const a=row(90,90,0,Math.PI/6,1.5,0.75),b=row(150,90,0);
const vA=col(row(-38,-38,0,Math.PI/6,1.5,0.75)),vB=col(row(22,-38,0));
assert.deepEqual(audit(n([a,b]),[vA,vB]),
  {frame:'common-offset',comparedInstances:2});
assert.deepEqual(audit(n([a,b]),[vB,vA]),
  {frame:'common-offset',comparedInstances:2},'Must not match by item order');
const moved=col(row(-28,-38,0,Math.PI/6,1.5,0.75));
assert.deepEqual(audit(n([a,b]),[moved,vB]),
  {frame:'instance-dependent',comparedInstances:2},'Per-item pivot shift is not a global bed offset');
assert.deepEqual(audit(n([a,b]),[col(row(-38,-38,0,0)),vB]),
  {frame:'linear-mismatch',comparedInstances:0});
assert.deepEqual(audit(n([row(90,90,0),b]),[col(row(-38,-38,0)),vB]),
  {frame:'ambiguous',comparedInstances:0},'Identical linear transforms do not identify items');
assert.deepEqual(audit(n([a,b]),[vA]),
  {frame:'unavailable',comparedInstances:0});
const invalid=a.slice();invalid[12]=1;
assert.equal(audit(n([invalid,b]),[vA,vB]).frame,'unavailable');
const singular=row(90,90,0,0,0,1);
assert.equal(audit(n([singular,b]),[vA,vB]).frame,'unavailable');
assert.equal(audit(n([a,b]),[vA,vB],-1).frame,'unavailable');
const report=audit(n([a,b]),[moved,vB]);
assert.ok(Object.isFrozen(report));
assert.ok(!JSON.stringify(report).includes('90') && !JSON.stringify(report).includes('38'),
  'Do not disclose real file coordinates in diagnostics');
console.log('PASS: unique affine linear matching distinguishes common bed offset, per-instance pivot change, ambiguous transforms, mismatches');
