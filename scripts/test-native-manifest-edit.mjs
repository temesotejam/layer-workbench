// Fail-closed pure manifest edit tests. No native 3MF round-trip claim.
import assert from 'node:assert/strict';
import {editManifestInstanceTransform} from './native-manifest-edit.mjs';
const identity = x => [1,0,0,x, 0,1,0,90, 0,0,1,0, 0,0,0,1];
const original = {
  schemaVersion:'0.7.0', plates:[{id:'plate-0',index:0}],
  meshes:[{id:'mesh-0',format:'stl',dataRange:{offset:0,length:684}},
    {id:'mesh-1',format:'stl',dataRange:{offset:684,length:684}}],
  objects:[{id:'object-0',meshId:'mesh-0'},{id:'object-1',meshId:'mesh-1'}],
  instances:[
    {id:'first',objectId:'object-0',plateId:'plate-0',transform:{matrix:identity(90)}},
    {id:'second',objectId:'object-1',plateId:'plate-0',transform:{matrix:identity(150)}},
  ],
};
const changed=[0,-1.5,0,175, 1,0,0,90, 0,0,1,0, 0,0,0,1];
const result=editManifestInstanceTransform(original,'second',changed);
assert.notEqual(result,original);
assert.deepEqual(result.instances[0],original.instances[0],'unselected sibling must be untouched');
assert.deepEqual(result.instances[1].transform.matrix,changed);
assert.deepEqual(original.instances[1].transform.matrix,identity(150),'source must remain unchanged');
assert.equal(result.instances[1].objectId,'object-1');
assert.notEqual(result.instances[0],original.instances[0],'avoid sharing mutable nested scene objects');
assert.throws(()=>editManifestInstanceTransform(original,'unknown',changed),/Unknown/);
assert.throws(()=>editManifestInstanceTransform(original,'second',[1,2]),/matrix/);
assert.throws(()=>editManifestInstanceTransform(original,'second',[...changed.slice(0,3),Infinity,...changed.slice(4)]),/matrix/);
assert.throws(()=>editManifestInstanceTransform(original,'second',[...changed.slice(0,12),1,0,0,1]),/Non-affine/);
assert.throws(()=>editManifestInstanceTransform(original,'second',[0,0,0,175, 0,0,0,90, 0,0,1,0, 0,0,0,1]),/Singular/);
assert.throws(()=>editManifestInstanceTransform({...original,instances:[original.instances[0],original.instances[0]]},'first',changed),/duplicate/);
assert.throws(()=>editManifestInstanceTransform({...original,instances:[]},'first',changed),/instances/);
// A valid native manifest may contain multiple instances of ONE object.
const sharedObject=structuredClone(original);
sharedObject.instances[1].objectId='object-0';
assert.equal(editManifestInstanceTransform(sharedObject,'second',changed).instances[1].objectId,'object-0');
// Multiple objects may legally share one mesh. The edit must preserve that
// source graph and must never invent a replacement mesh.
const sharedMesh=structuredClone(original);
sharedMesh.objects[1].meshId='mesh-0';
assert.equal(editManifestInstanceTransform(sharedMesh,'second',changed).objects[1].meshId,'mesh-0');
for (const [bad, error] of [
  [{...original,meshes:[]},/project meshes/],
  [{...original,meshes:[original.meshes[0],original.meshes[0]]},/duplicate project meshes/],
  [{...original,meshes:undefined},/project meshes/],
  [{...original,objects:[{...original.objects[0],meshId:'missing'},original.objects[1]]},/Orphaned project object mesh/],
  [{...original,objects:[original.objects[0],{...original.objects[1],meshId:null}]},/Orphaned project object mesh/],
  [{...original,objects:[original.objects[0],original.objects[0]]},/duplicate project objects/],
  [{...original,plates:[original.plates[0],original.plates[0]]},/duplicate project plates/],
  [{...original,instances:[{...original.instances[0],objectId:'missing'},original.instances[1]]},/Orphaned/],
  [{...original,instances:[original.instances[0],{...original.instances[1],plateId:'missing'}]},/Orphaned/],
  [{...original,objects:[]},/project objects/],
  [{...original,plates:[]},/project plates/],
  [{...original,instances:[original.instances[0],{
    ...original.instances[1],transform:{matrix:[...changed.slice(0,3),NaN,...changed.slice(4)]}
  }]},/affine instance matrix/],
  [{...original,instances:[original.instances[0],{
    ...original.instances[1],transform:{matrix:[...changed.slice(0,12),2,0,0,1]}
  }]},/Non-affine/],
  [{...original,instances:[original.instances[0],{
    ...original.instances[1],transform:{matrix:[0,0,0,175,0,0,0,90,0,0,1,0,0,0,0,1]}
  }]},/Singular/],
]) assert.throws(()=>editManifestInstanceTransform(bad,'first',changed),error);
console.log('PASS: isolated manifest edit preserves legal shared-object/shared-mesh graphs and rejects orphan mesh/object/plate references and invalid sibling transforms');
