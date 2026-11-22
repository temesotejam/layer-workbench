import assert from 'node:assert/strict';
import {auditNative3mfStlNormalAlignment as audit} from './audit-native-3mf-stl-normals.mjs';
const face=[[90,90,0],[110,90,0],[90,110,0]];
const makeStl=items=>{
  const bytes=new Uint8Array(84+50*items.length);
  const view=new DataView(bytes.buffer);
  view.setUint32(80,items.length,true);
  items.forEach(({normal=[0,0,1],facet=face},i)=>{
    const values=[...normal,...facet.flat()];
    values.forEach((x,j)=>view.setFloat32(84+i*50+j*4,x,true));
  });
  return bytes;
};
assert.deepEqual(audit(makeStl([{}])),{normalAlignment:'aligned',comparedTriangles:1});
assert.deepEqual(audit(makeStl([{normal:[0,0,-1]}])),{normalAlignment:'opposed',comparedTriangles:1});
assert.equal(audit(makeStl([{}, {normal:[0,0,-1]}])).normalAlignment,'mixed');
assert.equal(audit(makeStl([{normal:[1,0,0]}])).normalAlignment,'inconsistent');
assert.equal(audit(makeStl([{normal:[0,0,0]}])).normalAlignment,'unavailable',
  'Valid STL with absent optional normals must not claim alignment');
assert.equal(audit(makeStl([{facet:[[0,0,0],[0.01,0,0],[0,0.01,0]]}])).normalAlignment,'unavailable');
assert.equal(audit(makeStl([{normal:[Infinity,0,0]}])).normalAlignment,'unavailable');
const tampered=makeStl([{}]);new DataView(tampered.buffer).setFloat32(84,NaN,true);
assert.equal(audit(tampered).normalAlignment,'unavailable');
assert.equal(audit(new Uint8Array([1,2,3])).normalAlignment,'unavailable');
assert.equal(audit(makeStl([{}]).subarray(1)).normalAlignment,'unavailable');
assert.equal(audit(makeStl([{}]),0).normalAlignment,'unavailable');
assert.equal(audit(makeStl([{}]),0.2).normalAlignment,'unavailable');
assert.equal(audit(makeStl(Array.from({length:257},()=>({})))).normalAlignment,'unavailable');
assert.equal(Object.isFrozen(audit(makeStl([{}]))),true);
assert.equal(JSON.stringify(audit(makeStl([{}]))).includes('90'),false,
  'No source-derived geometry or raw normal values leave the audit');
console.log('PASS: bounded binary STL normal-field orientation diagnostic (aligned, opposed, mixed, inconsistent, absent, degenerate, malformed)');
