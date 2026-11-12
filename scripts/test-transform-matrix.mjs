import assert from 'node:assert/strict';
import {viewerMatrixToNative,nativePoint} from './transform-matrix.mjs';
const ID = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; // Three column-major
assert.deepEqual(viewerMatrixToNative(ID),[1,0,0,128, 0,1,0,128, 0,0,1,0, 0,0,0,1]);
const moved=[...ID]; moved[12]=15; moved[13]=-8; moved[14]=4;
assert.deepEqual(nativePoint(viewerMatrixToNative(moved),[2,3,4]),[145,123,8]);
// +90deg rotation Z in a Three.js matrix plus XY translation.
const rotated=[0,1,0,0, -1,0,0,0, 0,0,1,0, 10,20,0,1];
assert.deepEqual(nativePoint(viewerMatrixToNative(rotated),[10,0,0]),[138,158,0]);
// Non-uniform scaling, no transpose error.
const scaled=[2,0,0,0, 0,3,0,0, 0,0,4,0, 0,0,0,1];
assert.deepEqual(nativePoint(viewerMatrixToNative(scaled),[2,3,4]),[132,137,16]);
assert.throws(()=>viewerMatrixToNative(Array(16).fill(0)),/affine/);
assert.throws(()=>viewerMatrixToNative([...ID.slice(0,10),0,...ID.slice(11)]),/singular/);
console.log('PASS: identity, translation, rotation, scaling, and invalid transform guards');
