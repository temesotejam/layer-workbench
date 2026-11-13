// Fail-closed pure manifest edit tests. No native 3MF round-trip claim.
import assert from 'node:assert/strict';
import {editManifestInstanceTransform} from './native-manifest-edit.mjs';
const identity = x => [1,0,0,x, 0,1,0,90, 0,0,1,0, 0,0,0,1];
const original = {
  schemaVersion:'0.7.0', plates:[{id:'plate-0',index:0}],
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
console.log('PASS: isolated manifest edit updates only selected instance; invalid and duplicate inputs rejected');
