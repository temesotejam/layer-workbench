import assert from 'node:assert/strict';
import {auditNative3mfRelations} from './audit-native-3mf-relations.mjs';
const identity=[1,0,0,128,0,1,0,128,0,0,1,0,0,0,0,1];
const fixture=()=>({
  plates:[{id:'plate-0'}],meshes:[{id:'mesh-0'}],
  objects:[{id:'object-0',meshId:'mesh-0'}],
  instances:[{id:'instance-0',objectId:'object-0',plateId:'plate-0',
    transform:{matrix:[...identity]}}],
});
const report=auditNative3mfRelations(fixture());
assert.deepEqual(report,{ids:'unique',references:'valid',affineMatrices:'valid'});
assert.ok(Object.isFrozen(report));
assert.ok(!JSON.stringify(report).includes('plate-0'),'Native IDs must remain private');
// An empty domain must not pass ID, link, or affine checks vacuously.
for(const domain of ['plates','meshes','objects','instances']) {
  const empty=fixture();empty[domain]=[];
  assert.deepEqual(auditNative3mfRelations(empty),{
    ids:'unavailable',references:'unavailable',affineMatrices:'unavailable'});
}
// Missing/primitive native transform evidence must not crash diagnostics.
const primitiveTransform=fixture();primitiveTransform.instances[0].transform='bad';
assert.equal(auditNative3mfRelations(primitiveTransform).affineMatrices,'unavailable');
const noTransform=fixture();delete noTransform.instances[0].transform;
assert.equal(auditNative3mfRelations(noTransform).affineMatrices,'unavailable');
const opaque=fixture();delete opaque.objects[0].meshId;
assert.equal(auditNative3mfRelations(opaque).references,'unavailable');
const broken=fixture();broken.instances[0].objectId='other';
assert.equal(auditNative3mfRelations(broken).references,'broken');
const duplicate=fixture();duplicate.instances.push({...duplicate.instances[0]});
assert.deepEqual(auditNative3mfRelations(duplicate),{
  ids:'duplicate',references:'unverified',affineMatrices:'valid'});
const invalid=fixture();invalid.instances[0].transform.matrix[12]=1;
assert.equal(auditNative3mfRelations(invalid).affineMatrices,'invalid');
const nan=fixture();nan.instances[0].transform.matrix[0]=NaN;
assert.equal(auditNative3mfRelations(nan).affineMatrices,'invalid');
// A finite 4x4 affine matrix can still be non-invertible, silently
// collapsing a native mesh and breaking round-trip editing.
const flat=fixture();flat.instances[0].transform.matrix[0]=0;
assert.equal(auditNative3mfRelations(flat).affineMatrices,'invalid');
const almostFlat=fixture();
almostFlat.instances[0].transform.matrix.splice(4,3,1,1e-12,0);
assert.equal(auditNative3mfRelations(almostFlat).affineMatrices,'invalid');
// Scale-relative determinant testing must permit small but invertible
// geometry and legal mirrored/negative-determinant transforms.
const tiny=fixture();tiny.instances[0].transform.matrix[0]=1e-8;
assert.equal(auditNative3mfRelations(tiny).affineMatrices,'valid');
const mirrored=fixture();mirrored.instances[0].transform.matrix[0]=-1;
assert.equal(auditNative3mfRelations(mirrored).affineMatrices,'valid');
const shear=fixture();shear.instances[0].transform.matrix.splice(4,3,1,1e-6,0);
assert.equal(auditNative3mfRelations(shear).affineMatrices,'valid');
const absentId=fixture();delete absentId.instances[0].id;
assert.deepEqual(auditNative3mfRelations(absentId),{
  ids:'unavailable',references:'unverified',affineMatrices:'valid'});
assert.deepEqual(auditNative3mfRelations(null),{
  ids:'unavailable',references:'unavailable',affineMatrices:'unavailable'});
console.log('PASS: native manifest IDs, nonempty references, invertible affine transforms, malformed data and privacy');
