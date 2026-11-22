import assert from 'node:assert/strict';
import {auditNative3mfLinearParity as audit} from './audit-native-3mf-linear-parity.mjs';
const id=[1,0,0,0,1,0,0,0,1];
const rotated=[0,-1,0,1,0,0,0,0,1];
const scaled=[1.5,0,0,0,0.75,0,0,0,1];
function row(a,x=0,y=0,z=0) {
  return [a[0],a[1],a[2],x,a[3],a[4],a[5],y,a[6],a[7],a[8],z,0,0,0,1];
}
const column=m=>Array.from({length:16},(_,i)=>m[(i%4)*4+Math.floor(i/4)]);
const instance=m=>({transform:{matrix:m}});
const native=[instance(row(id,90,0,0)),instance(row(rotated,150,0,0)),
  instance(row(scaled,10,0,0))];
const viewer=[column(row(scaled,-118,-128,0)),
  column(row(id,-38,-128,0)),column(row(rotated,22,-128,0))];
assert.deepEqual(audit(native,viewer),{linear:'consistent',comparedInstances:3});
assert.deepEqual(audit([native[0]],[viewer[1]]),{linear:'consistent',comparedInstances:1});
const wrongRotation=structuredClone(viewer);
wrongRotation[2]=column(row(id,22,-128,0));
assert.equal(audit(native,wrongRotation).linear,'mismatch',
  'Identical anchor spacing must not hide a changed rotation');
const wrongScale=structuredClone(viewer);
wrongScale[0]=column(row([1.6,0,0,0,0.75,0,0,0,1],-118,-128,0));
assert.equal(audit(native,wrongScale).linear,'mismatch');
const smallNoise=structuredClone(viewer);
smallNoise[1][0]+=4e-6;
assert.equal(audit(native,smallNoise).linear,'consistent');
smallNoise[1][0]+=3e-5;
assert.equal(audit(native,smallNoise).linear,'mismatch');
const badNative=structuredClone(native);
badNative[0].transform.matrix[15]=0;
assert.equal(audit(badNative,viewer).linear,'unavailable');
const singular=structuredClone(native);
singular[0].transform.matrix[0]=0;
assert.equal(audit(singular,viewer).linear,'unavailable');
const nonFinite=structuredClone(viewer);
nonFinite[0][0]=Infinity;
assert.equal(audit(native,nonFinite).linear,'unavailable');
const perspective=structuredClone(viewer);
perspective[0][3]=0.1;
assert.equal(audit(native,perspective).linear,'unavailable');
assert.equal(audit(native,viewer.slice(0,2)).linear,'unavailable');
assert.equal(audit([],[]).linear,'unavailable');
assert.equal(audit(native,viewer,-1).linear,'unavailable');
const report=audit(native,viewer);
assert.ok(Object.isFrozen(report));
assert.ok(!JSON.stringify(report).includes('128'));
assert.ok(!JSON.stringify(report).includes('150'));
console.log('PASS: native/Three.js linear 3MF transform parity: rotation, scale, permutation, tolerance, invalidity and privacy');
