import assert from 'node:assert/strict';
import {auditNative3mfWorldFacets as audit,MAX_WORLD_FACETS} from './audit-native-3mf-world-facets.mjs';

const a=[[90,90,0],[110,90,0],[90,110,0]];
const b=[[150,90,0],[170,90,0],[150,110,0]];
const makeStl=facets => {
  const bytes=new Uint8Array(84+50*facets.length);
  const view=new DataView(bytes.buffer);
  view.setUint32(80,facets.length,true);
  facets.forEach((triangle,i)=>triangle.forEach((p,j)=>
    p.forEach((v,k)=>view.setFloat32(84+i*50+12+j*12+k*4,v,true))));
  return bytes;
};
const input=makeStl([a,b]);
const swapped=[b.slice().reverse(),[a[1],a[2],a[0]]];
assert.deepEqual(audit(input,swapped),{facets:'consistent',comparedTriangles:2},
  'Face/build order and winding must not determine world geometry parity');
assert.equal(Object.isFrozen(audit(input,swapped)),true);
const viewerNoise=structuredClone(swapped);
viewerNoise[0][0][0]+=0.018;
assert.equal(audit(input,viewerNoise).facets,'consistent');
const wrongPosition=structuredClone(swapped);
wrongPosition[0][0][0]+=0.3;
assert.equal(audit(input,wrongPosition).facets,'mismatch',
  'Identical transform linear parts can hide displaced world vertices');
const wrongRotate=structuredClone(swapped);
wrongRotate[0][0]=[151,90,0];
assert.equal(audit(input,wrongRotate).facets,'mismatch');
assert.equal(audit(input,[a]).facets,'mismatch','Missing faces must not match');
assert.equal(audit(input,[[[1,0,0],[2,0,0],[1,2,0]],b]).facets,'mismatch');
const corrupted=makeStl([a,b]);new DataView(corrupted.buffer).setFloat32(96,NaN,true);
assert.equal(audit(corrupted,[a,b]).facets,'unavailable');
assert.equal(audit(new Uint8Array([0x50,0x4b]),[a,b]).facets,'unavailable');
assert.equal(audit(input,[[[Infinity,0,0],[1,0,0],[0,1,0]],b]).facets,'unavailable');
assert.equal(audit(input,[a,b],0).facets,'unavailable');
assert.equal(audit(input,[a,b],0.11).facets,'unavailable');
assert.equal(audit(makeStl(Array.from({length:MAX_WORLD_FACETS+1},()=>a)),[a,b]).facets,'unavailable');
assert.equal(audit(input,Array.from({length:MAX_WORLD_FACETS+1},()=>a)).facets,'unavailable');
assert.equal(JSON.stringify(audit(input,swapped)).includes('150'),false);
console.log('PASS: bounded native STL vs Three.js world facets (affine placement, face order/winding, mismatch, malformed/oversized input, privacy)');

import {auditNative3mfWorldFacetGroups as auditGroups} from './audit-native-3mf-world-facets.mjs';
assert.deepEqual(auditGroups(input,[[a],[b]]),
  {partition:'separable',comparedBuilds:2,comparedTriangles:2},
  'Independent viewer builds must each own distinguishable native world facets');
assert.deepEqual(auditGroups(input,[[b],[a]]).partition,'separable',
  'Build-order reversal must not affect facet-group separability');
assert.equal(auditGroups(makeStl([a,a]),[[a],[a]]).partition,'ambiguous',
  'Two coincident native builds cannot be attributed by triangle order');
assert.equal(auditGroups(input,[[a],[wrongPosition[0]]]).partition,'mismatch');
assert.equal(auditGroups(input,[[],[b]]).partition,'unavailable');
assert.equal(auditGroups(input,[[a]]).partition,'unavailable');
assert.equal(auditGroups(new Uint8Array(4),[[a],[b]]).partition,'unavailable');
assert.equal(JSON.stringify(auditGroups(input,[[a],[b]])).includes('150'),false);
console.log('PASS: flattened 3MF native facets can be separated by viewer build only when unambiguous');

import {auditNative3mfWorldFacetWinding as auditWinding} from './audit-native-3mf-world-facets.mjs';
const sameWinding=[[b[1],b[2],b[0]],[a[2],a[0],a[1]]];
assert.deepEqual(auditWinding(input,sameWinding),
  {winding:'consistent',comparedTriangles:2},
  'Cyclic corner permutations and face/build order cannot change winding');
const reversedWinding=[[b[1],b[0],b[2]],[a[0],a[2],a[1]]];
assert.deepEqual(auditWinding(input,reversedWinding),
  {winding:'reversed',comparedTriangles:2},
  'A geometry-consistent reverse winding must NOT be called oriented parity');
assert.equal(auditWinding(input,[a,[b[1],b[0],b[2]]]).winding,'mixed',
  'A mixed oriented shell cannot be called consistent or wholly reversed');
assert.equal(auditWinding(input,wrongPosition).winding,'mismatch');
assert.equal(auditWinding(new Uint8Array(4),[a,b]).winding,'unavailable');
const degenerate=[[0,0,0],[0.01,0,0],[0.02,0,0]];
assert.equal(auditWinding(makeStl([degenerate]),[degenerate]).winding,'unavailable',
  'Degenerate faces lack reliable winding even when their coordinates match');
assert.equal(auditWinding(input,sameWinding,0.11).winding,'unavailable');
assert.equal(Object.isFrozen(auditWinding(input,sameWinding)),true);
assert.equal(JSON.stringify(auditWinding(input,sameWinding)).includes('150'),false);
console.log('PASS: bounded 3MF facet winding distinguishes cyclic orientation, reversed, mixed, mismatch, degenerate and unavailable without claiming native instance identity');
