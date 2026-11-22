import assert from 'node:assert/strict';
import {auditNative3mfAnchorSpacing as audit} from './audit-native-3mf-anchor-spacing.mjs';
const matrix=(x,y,z)=>[1,0,0,x, 0,1,0,y, 0,0,1,z, 0,0,0,1];
const instances=(points)=>points.map(([x,y,z])=>({transform:{matrix:matrix(x,y,z)}}));
const reference=instances([[90,15,0],[150,15,0]]);
const viewer=[[-38,-113,0],[22,-113,0]];
assert.deepEqual(audit(reference,viewer),{spacing:'consistent',comparedPairs:1});
assert.deepEqual(audit(reference,[viewer[1],viewer[0]]),{spacing:'consistent',comparedPairs:1},
  'Build order must not silently serve as a native object ID mapping');
assert.equal(audit(reference,[viewer[0],[27,-113,0]]).spacing,'mismatch');
assert.equal(audit(reference,viewer.slice(0,1)).spacing,'unavailable');
assert.equal(audit([reference[0]],[viewer[0]]).spacing,'unavailable');
const triangle=instances([[0,0,0],[40,0,0],[0,30,0]]);
assert.deepEqual(audit(triangle,[[10,10,0],[10,40,0],[50,10,0]]),
  {spacing:'consistent',comparedPairs:3});
assert.equal(audit(triangle,[[10,10,0],[10,40,0],[51,10,0]]).spacing,'mismatch');
const corrupt=structuredClone(reference);corrupt[0].transform.matrix[3]=Infinity;
assert.equal(audit(corrupt,viewer).spacing,'unavailable');
const malformed=structuredClone(reference);malformed[0].transform.matrix[12]=2;
assert.equal(audit(malformed,viewer).spacing,'unavailable');
assert.equal(audit(reference,[[0,0,0],[Infinity,0,0]]).spacing,'unavailable');
assert.equal(audit(reference,viewer,-1).spacing,'unavailable');
assert.equal(audit(reference,viewer,1).spacing,'unavailable');
const report=audit(reference,viewer);
assert.ok(Object.isFrozen(report));
assert.ok(!JSON.stringify(report).includes('90'));
assert.ok(!JSON.stringify(report).includes('113'));
console.log('PASS: native/browser 3MF transform-anchor spacing classification, permutation, mismatch, privacy, bounds');
