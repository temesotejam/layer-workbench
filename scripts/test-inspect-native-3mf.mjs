import assert from 'node:assert/strict';
import {inspectNative3mf, MAX_INSPECT_3MF_BYTES} from './inspect-native-3mf.mjs';

const archive = new Uint8Array([0x50,0x4b,0x03,0x04,0,0,0,0]);
const file = (bytes=archive, name='project.3mf', size=bytes.length) => ({
  name, size, async arrayBuffer() {return bytes.slice().buffer;},
});
function fakeEngine({failAt=null, manifest={
  schemaVersion:'0.7.0',plates:[{id:'plate'}],meshes:[{id:'mesh'}],
  objects:[{id:'private-object'}],instances:[{id:'private-instance'}],
}}={}) {
  const calls=[];
  return {calls, createSession:async()=>({
    async initProfile(kind,bytes) {
      calls.push('init');
      assert.equal(kind,'project.3mf');
      assert.deepEqual(bytes,archive);
      if(failAt==='init') throw new Error('unsupported format');
    },
    async getManifest() {
      calls.push('manifest');
      if(failAt==='manifest') throw new Error('unsupported manifest');
      return manifest;
    },
    async dispose() {calls.push('dispose');},
  })};
}

const engine=fakeEngine();
const report=await inspectNative3mf(engine,file());
assert.deepEqual(report,{plates:1,meshes:1,objects:1,instances:1,
  archiveBytes:archive.byteLength,schemaVersion:'0.7.0',relations:{
    ids:'unique',references:'unavailable',affineMatrices:'unavailable'},
  placement:{spacing:'unavailable',comparedPairs:0},
  linear:{linear:'unavailable',comparedInstances:0},
  worldFacets:{facets:'unavailable',comparedTriangles:0}});
assert.equal(Object.isFrozen(report),true);
assert.equal(JSON.stringify(report).includes('private-'),false,'Do not leak object IDs or metadata');
assert.deepEqual(engine.calls,['init','manifest','dispose']);
const identityAt=x=>[1,0,0,x,0,1,0,0,0,0,1,0,0,0,0,1];
const placementEngine=fakeEngine({manifest:{
  schemaVersion:'0.7.0',plates:[{id:'p'}],meshes:[{id:'m'}],
  objects:[{id:'o',meshId:'m'}],instances:[
    {id:'a',objectId:'o',plateId:'p',transform:{matrix:identityAt(90)}},
    {id:'b',objectId:'o',plateId:'p',transform:{matrix:identityAt(150)}},
  ],
}});
const placementReport=await inspectNative3mf(placementEngine,file(),{
  viewerAnchors:[[-38,0,0],[22,0,0]],
  viewerMatrices:[identityAt(90),identityAt(150)].map(m=>
    Array.from({length:16},(_,i)=>m[(i%4)*4+Math.floor(i/4)])),
});
assert.deepEqual(placementReport.placement,{spacing:'consistent',comparedPairs:1});
assert.deepEqual(placementReport.linear,{linear:'consistent',comparedInstances:2});
assert.deepEqual(placementReport.worldFacets,{facets:'unavailable',comparedTriangles:0});
assert.ok(!JSON.stringify(placementReport).includes('"a"'));
assert.equal(placementEngine.calls.at(-1),'dispose');

for(const [f,pattern] of [
  [file(archive,'not-stl.stl'),/3MF archive/],
  [file(archive,'project.3mf',MAX_INSPECT_3MF_BYTES+1),/8 MiB/],
  [file(new Uint8Array(8)),/ZIP signature/],
  [file(new Uint8Array([0x50,0x4b,0x05,0x06,0,0,0,0])),/ZIP signature/],
]) await assert.rejects(inspectNative3mf(fakeEngine(),f),pattern);

for (const failAt of ['init','manifest']) {
  const failing=fakeEngine({failAt});
  await assert.rejects(inspectNative3mf(failing,file()),/unsupported/);
  assert.equal(failing.calls.at(-1),'dispose','Native session must always be disposed');
}
for(const invalid of [
  {schemaVersion:'0.6.0',plates:[],meshes:[{}],objects:[{}],instances:[{}]},
  {schemaVersion:'0.7.0',plates:[],meshes:[{}],objects:[],instances:[{}]},
  {schemaVersion:'0.7.0',plates:[],meshes:Array.from({length:257},()=>({})),objects:[{}],instances:[{}]},
]) {
  const e=fakeEngine({manifest:invalid});
  await assert.rejects(inspectNative3mf(e,file()),/schema|manifest/);
  assert.equal(e.calls.at(-1),'dispose');
}
console.log('PASS: native 3MF read-only inspection, anchor spacing, linear parity, size/signature limits, privacy and session cleanup');
