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
const sameLinear=n([row(90,90,0),b]);
const sameViewer=[col(row(-38,-38,0)),vB];
assert.deepEqual(audit(sameLinear,sameViewer),
  {frame:'common-offset',comparedInstances:2},
  'Distinct translations can disambiguate otherwise identical linear maps');
assert.deepEqual(audit(sameLinear,sameViewer.slice().reverse()),
  {frame:'common-offset',comparedInstances:2},
  'Matching repeated linear transforms must not use build order');
const sameMoved=[col(row(-28,-38,0)),vB];
assert.deepEqual(audit(sameLinear,sameMoved),
  {frame:'ambiguous',comparedInstances:0},
  'Do not invent instance identity when repeated transforms lack a common offset');
const overlapping=n([row(90,90,0),row(90,90,0)]);
assert.deepEqual(audit(overlapping,[col(row(-38,-38,0)),col(row(-38,-38,0))]),
  {frame:'ambiguous',comparedInstances:0},
  'Coincident placements still admit multiple equally valid assignments');
const triple=n([row(90,90,0),row(150,90,0),row(200,90,0)]);
const tripleViewer=[col(row(72,-38,0)),col(row(-38,-38,0)),col(row(22,-38,0))];
assert.deepEqual(audit(triple,tripleViewer),
  {frame:'common-offset',comparedInstances:3},
  'Three repeated linear maps must be matched by their unique shared translation');
const exhausted=n([a,row(150,90,0,Math.PI/6,1.5,0.75)]);
assert.deepEqual(audit(exhausted,[vA,vB]),
  {frame:'linear-mismatch',comparedInstances:0},
  'Two native instances cannot use the same one compatible viewer instance');
assert.deepEqual(audit(n([a,b]),[vA]),
  {frame:'unavailable',comparedInstances:0});
const invalid=a.slice();invalid[12]=1;
assert.equal(audit(n([invalid,b]),[vA,vB]).frame,'unavailable');
const singular=row(90,90,0,0,0,1);
assert.equal(audit(n([singular,b]),[vA,vB]).frame,'unavailable');
assert.equal(audit(n([a,b]),[vA,vB],-1).frame,'unavailable');
// Hall-deficient near-complete graph: all 64 native instances can match
// 63 viewer slots with the same linear map, but none can use the last slot.
// Exhaustive backtracking previously needed up to 63! dead-end assignments.
// The bounded matcher must return a genuine mismatch without hanging.
const hallNative=n(Array.from({length:64},(_,i)=>row(i*2,0,0)));
const hallView=Array.from({length:63},(_,i)=>col(row(i*2-128,0,0)))
  .concat([col(row(0,0,0,Math.PI/2))]);
assert.deepEqual(audit(hallNative,hallView),
  {frame:'linear-mismatch',comparedInstances:0},
  'Hall-deficient 64-instance affine graph must not trigger factorial search');
// A valid 64-item shared translation has exactly one full matching despite
// all 3x3 linear parts being identical and arbitrary viewer ordering.
const fullViewer=Array.from({length:64},(_,i)=>col(row((63-i)*2-128,0,0)));
assert.deepEqual(audit(hallNative,fullViewer),
  {frame:'common-offset',comparedInstances:64},
  'Polynomial search must retain valid 64-instance common-offset evidence');
// Exactly coincident geometry is still ambiguous, not a unique ID match.
const duplicates=n(Array.from({length:8},()=>row(0,0,0)));
assert.deepEqual(audit(duplicates,Array.from({length:8},()=>col(row(-128,0,0)))),
  {frame:'ambiguous',comparedInstances:0});

const report=audit(n([a,b]),[moved,vB]);
assert.ok(Object.isFrozen(report));
assert.ok(!JSON.stringify(report).includes('90') && !JSON.stringify(report).includes('38'),
  'Do not disclose real file coordinates in diagnostics');
console.log('PASS: affine frame offsets with uniquely anchored shared translations, repeated transforms, ambiguous placements and mismatches');
