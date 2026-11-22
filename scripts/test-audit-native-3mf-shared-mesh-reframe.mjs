import assert from 'node:assert/strict';
import {auditNative3mfSharedMeshReframe as audit} from './audit-native-3mf-shared-mesh-reframe.mjs';
const nativeMatrix=(linear,t)=>[...linear.slice(0,3),t[0],...linear.slice(3,6),t[1],...linear.slice(6,9),t[2],0,0,0,1];
const viewerMatrix=(linear,t)=>[linear[0],linear[3],linear[6],0,linear[1],linear[4],linear[7],0,linear[2],linear[5],linear[8],0,...t,1];
const lin=[
  [1,0,0,0,1,0,0,0,1],
  [1.3,0.2,0,-0.3,1.1,0,0,0,0.8],
  [0.8,0.1,0,0.2,1.4,0,0,0,1.25],
];
const viewerT=[[10,20,0],[70,15,0],[100,80,0]];
const pivot=[5,7,9],root=[128,128,0];
const nativeT=lin.map((l,i)=>{
  const mv=[0,1,2].map(r=>l[r*3]*pivot[0]+l[r*3+1]*pivot[1]+l[r*3+2]*pivot[2]);
  return viewerT[i].map((v,k)=>v+root[k]+mv[k]);
});
const manifest={meshes:[{id:'m'}],objects:[{id:'o',meshId:'m'}],
  instances:lin.map((l,i)=>({objectId:'o',transform:{matrix:nativeMatrix(l,nativeT[i])}}))};
const viewer=lin.map((l,i)=>viewerMatrix(l,viewerT[i]));
assert.deepEqual(audit(manifest,[viewer[2],viewer[0],viewer[1]]),
  {reframe:'hypothesis-consistent',comparedInstances:3},
  'Distinct affine matrices must match independent of viewer build order');
const altered=structuredClone(manifest);altered.instances[2].transform.matrix[3]+=2;
assert.equal(audit(altered,viewer).reframe,'hypothesis-mismatch');
const duplicate=structuredClone(manifest);duplicate.instances[2].transform.matrix=nativeMatrix(lin[0],nativeT[2]);
assert.equal(audit(duplicate,viewer).reframe,'ambiguous');
const changedMesh=structuredClone(manifest);changedMesh.meshes.push({id:'other'});
changedMesh.objects.push({id:'otherObj',meshId:'other'});
changedMesh.instances[2].objectId='otherObj';
assert.equal(audit(changedMesh,viewer).reframe,'insufficient-shared-instances');
const bad=structuredClone(manifest);bad.instances[0].objectId='missing';
assert.equal(audit(bad,viewer).reframe,'unavailable');
assert.equal(audit({...manifest,instances:manifest.instances.slice(0,2)},viewer.slice(0,2)).reframe,'insufficient-shared-instances');
assert.equal(audit(manifest,viewer.slice(0,2)).reframe,'unavailable');
assert.equal(JSON.stringify(audit(manifest,viewer)).includes('128'),false);
assert.ok(Object.isFrozen(audit(manifest,viewer)));
console.log('PASS: independent native/viewer affine matching supports a read-only shared-mesh local reframe hypothesis with 3 witnesses; rejects ambiguity and drift');
