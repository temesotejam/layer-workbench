import assert from 'node:assert/strict';
import {makeMultiStlProject} from './multi-stl.mjs';

const cube = new Uint8Array(84 + 50 * 12);
new DataView(cube.buffer).setUint32(80,12,true);
const shifted=[1,0,0,0, 0,1,0,0, 0,0,1,0, 45,0,0,1];
const project=makeMultiStlProject([
  {bytes:cube},
  {bytes:cube,viewerElements:shifted},
]);
assert.equal(project.blob.length, cube.length*2);
assert.deepEqual(project.blob.slice(0,cube.length),cube);
assert.deepEqual(project.blob.slice(cube.length),cube);
assert.deepEqual(project.manifest.meshes.map(x=>x.dataRange),[
  {offset:0,length:cube.length},
  {offset:cube.length,length:cube.length},
]);
assert.deepEqual(project.manifest.objects.map(x=>x.meshId),['mesh-0','mesh-1']);
assert.deepEqual(project.manifest.instances.map(x=>x.objectId),['object-0','object-1']);
assert.equal(project.manifest.instances[0].transform.matrix[3],128);
assert.equal(project.manifest.instances[1].transform.matrix[3],173);
assert.throws(()=>makeMultiStlProject([]),/1–24/);
assert.throws(()=>makeMultiStlProject([{bytes:new Uint8Array(10)}]),/invalid/);
console.log('PASS: two unique meshes, byte offsets, object IDs and native placement');
