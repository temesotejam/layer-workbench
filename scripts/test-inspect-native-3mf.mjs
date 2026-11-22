import assert from 'node:assert/strict';
import {inspectNative3mf, MAX_INSPECT_3MF_BYTES} from './inspect-native-3mf.mjs';

function makeFakeArchive() {
  const name=new TextEncoder().encode('3D/3dmodel.model');
  const localLength=30+name.length+1;
  const directoryLength=46+name.length;
  const bytes=new Uint8Array(localLength+directoryLength+22);
  const v=new DataView(bytes.buffer);
  v.setUint32(0,0x04034b50,true);
  v.setUint16(4,20,true);
  v.setUint32(18,1,true); v.setUint32(22,1,true);
  v.setUint16(26,name.length,true);
  bytes.set(name,30); bytes[30+name.length]=0x78;
  const p=localLength;
  v.setUint32(p,0x02014b50,true);
  v.setUint16(p+4,20,true); v.setUint16(p+6,20,true);
  v.setUint32(p+20,1,true); v.setUint32(p+24,1,true);
  v.setUint16(p+28,name.length,true);
  bytes.set(name,p+46);
  const e=p+directoryLength;
  v.setUint32(e,0x06054b50,true);
  v.setUint16(e+8,1,true); v.setUint16(e+10,1,true);
  v.setUint32(e+12,directoryLength,true);
  v.setUint32(e+16,p,true);
  return bytes;
}
const archive = makeFakeArchive();
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

// The inspector must run a REAL geometry comparator when a native converter
// exists, while returning only a classification (never private vertex data).
const face=[[90,90,0],[110,90,0],[90,110,0]];
const singleStl=new Uint8Array(134);
const dv=new DataView(singleStl.buffer);
dv.setUint32(80,1,true);
face.forEach((vertex,i)=>vertex.forEach((coord,axis)=>
  dv.setFloat32(84+12+i*12+axis*4,coord,true)));
const geometryEngine=fakeEngine();
geometryEngine.threeMfToStl=async bytes=>{
  assert.deepEqual(bytes,archive);
  return singleStl;
};
const geometryReport=await inspectNative3mf(geometryEngine,file(),{
  viewerFacets:[face.slice().reverse()],
});
assert.deepEqual(geometryReport.worldFacets,{facets:'consistent',comparedTriangles:1});
assert.ok(!JSON.stringify(geometryReport).includes('90'));
assert.equal(geometryEngine.calls.at(-1),'dispose');
const incompatible=await inspectNative3mf(geometryEngine,file(),{
  viewerFacets:[[[91,90,0],[111,90,0],[91,110,0]]],
});
assert.equal(incompatible.worldFacets.facets,'mismatch');


for(const [f,pattern] of [
  [file(archive,'not-stl.stl'),/3MF archive/],
  [file(archive,'project.3mf',MAX_INSPECT_3MF_BYTES+1),/8 MiB/],
  [file(new Uint8Array(8)),/ZIP signature/],
  [file(Uint8Array.from([...archive,0])),/unsafe 3MF ZIP/],
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
// Invalid ZIP is rejected before the WASM session is allocated.
const rejected=fakeEngine();
await assert.rejects(inspectNative3mf(rejected,file(Uint8Array.from([...archive,0]))),/unsafe 3MF ZIP/);
assert.deepEqual(rejected.calls,[]);
console.log('PASS: native 3MF read-only inspection, anchor spacing, linear parity, size/signature limits, privacy and session cleanup');
