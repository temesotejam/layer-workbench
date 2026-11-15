import assert from 'node:assert/strict';
import {objToBinaryStl} from './obj-to-stl.mjs';

const square = [
  'v 0 0 0', 'v 20 0 0', 'v 20 20 0', 'v 0 20 0',
  'vt 0 0', 'vn 0 0 1', 'usemtl ignored',
  'f 1/1/1 2/1/1 3/1/1 4/1/1',
].join('\n');
const bytes = objToBinaryStl(square);
assert.ok(bytes instanceof Uint8Array);
assert.equal(bytes.length,184);
const v = new DataView(bytes.buffer);
assert.equal(v.getUint32(80,true),2);
assert.deepEqual([v.getFloat32(96,true),v.getFloat32(100,true),v.getFloat32(104,true)],[0,0,0]);
assert.deepEqual([v.getFloat32(146,true),v.getFloat32(150,true),v.getFloat32(154,true)],[0,0,0]);
// Relative indices and face/vertex RGB values are accepted; output remains geometry-only.
assert.equal(new DataView(objToBinaryStl('v 0 0 0 1 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1').buffer).getUint32(80,true),1);
const rejected = [
  '', 'v 0 0 0', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 4',
  'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 0 2 3',
  'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 1 3',
  'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1/2/3/4 2 3',
  'v 0 0 0\nv NaN 0 0\nv 0 1 0\nf 1 2 3',
  'v 0 0 0\nv 1 0 0\nv 0 1 0\nf -4 -2 -1',
  'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\0',
];
for (const obj of rejected) assert.throws(()=>objToBinaryStl(obj));
const cube = [
  'v 0 0 0','v 20 0 0','v 20 20 0','v 0 20 0',
  'v 0 0 20','v 20 0 20','v 20 20 20','v 0 20 20',
  'f 1 4 3 2','f 5 6 7 8','f 1 2 6 5','f 2 3 7 6','f 3 4 8 7','f 4 1 5 8',
].join('\n');
assert.equal(new DataView(objToBinaryStl(cube).buffer).getUint32(80,true),12);
console.log('PASS: bounded OBJ face-fan geometry -> binary STL; limits and invalid triangles refused');
