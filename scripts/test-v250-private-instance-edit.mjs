// Rebuilt candidate only: prove one imported Core 3MF placement can be edited
// directly through a PRIVATE C entry point without setObjects/project replacement.
// It is not one-slicer-api 0.7.0, full Orca native Model editing, opaque metadata
// preservation, desktop round-trip parity, or machine-print validation.
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {
  loadModule, writeBytes, free, decodeError,
  projectGetManifestOnce, projectExportOnce, projectGetAssetOnce,
} from '../orcawasm/scripts/lib/engine-harness.mjs';

const module = await loadModule('orcawasm/artifacts', 'slicer-mt');
const fixture = new Uint8Array(readFileSync(
  'parity-output/independent-core-two-build.3mf'));
assert.ok(fixture.byteLength > 300 && fixture[0] === 0x50 && fixture[1] === 0x4b);
assert.equal(typeof module._orcawasm_project_edit_instance_transform, 'function',
  'private transform symbol must be exported by rebuilt candidate');

const report = {status:'FAIL', source:'independent synthetic Core 3MF',
  experimental:true, production:false, desktopParity:false, printApproved:false};
const session = module._oneslicer_session_create();
assert.ok(session, 'native session allocation');
const encoder = new TextEncoder();

function initNative3mf(handle, bytes) {
  const format = encoder.encode('project.3mf');
  const formatPtr = writeBytes(module, format);
  const bytesPtr = writeBytes(module, bytes);
  try {
    const rc = module._oneslicer_init_profile(
      handle, formatPtr, format.length, bytesPtr, bytes.length);
    assert.equal(rc, 0, 'init_profile: ' + decodeError(module, handle));
  } finally {
    free(module, bytesPtr);
    free(module, formatPtr);
  }
}
function editPrivate(handle, request) {
  const data = encoder.encode(JSON.stringify(request));
  const ptr = writeBytes(module, data);
  try {
    const rc = module._orcawasm_project_edit_instance_transform(
      handle, ptr, data.length);
    return {rc, error:decodeError(module,handle)};
  } finally {
    free(module, ptr);
  }
}
function exportProject(handle, preservation) {
  const descriptor = projectExportOnce(module, handle, 'project.3mf', {
    schemaVersion:'0.7.0', preservation, includeSliceArtifacts:false,
  });
  assert.equal(descriptor.asset?.mimeType, 'model/3mf');
  return {descriptor, bytes:projectGetAssetOnce(module,handle,descriptor.asset.id)};
}
const clone = value => JSON.parse(JSON.stringify(value));
try {
  initNative3mf(session, fixture);
  const before = projectGetManifestOnce(module, session);
  assert.equal(before.instances?.length, 2);
  assert.equal(before.objects?.length, 2);
  const sibling = clone(before.instances[0]);
  const target = before.instances[1];
  const shifted = [...target.transform.matrix];
  shifted[3] += 30; // native row-major 4×4 X translation, millimetres
  const edit = {instanceId:target.id, matrix:shifted};
  const invalids = [
    {instanceId:'no-such-instance',matrix:shifted},
    {instanceId:target.id,matrix:Array(16).fill(0)},
    {...edit,unknown:true},
    {instanceId:target.id,matrix:target.transform.matrix},
  ];
  for (const bad of invalids) {
    const outcome=editPrivate(session,bad);
    assert.notEqual(outcome.rc,0,'invalid operation must fail closed');
    assert.deepEqual(projectGetManifestOnce(module,session),before,
      'rejected operation must leave entire scene unchanged');
  }
  assert.equal(editPrivate(session,edit).rc,0,'private edit of selected imported instance');
  const changed = projectGetManifestOnce(module,session);
  assert.equal(changed.instances.length,2);
  assert.equal(changed.objects.length,2);
  assert.deepEqual(changed.instances[0],sibling,'unselected sibling identity/geometry/transform');
  assert.deepEqual(changed.instances[1].transform.matrix,shifted);
  assert.deepEqual(changed.objects,before.objects,'object hierarchy must remain unchanged');

  let strictFailure = '';
  try {
    exportProject(session,'require');
  } catch(error) {
    strictFailure=String(error?.message ?? error);
  }
  assert.match(strictFailure,/preservation=require.*metadata/i,
    'dirty imported project must reject falsely lossless export');
  const {descriptor,bytes} = exportProject(session,'best-effort');
  assert.ok(bytes instanceof Uint8Array && bytes.length > 100 &&
    bytes[0] === 0x50 && bytes[1] === 0x4b,'best effort must be a 3MF archive');
  // This lossy re-export is explicitly not described as preserved metadata.
  const reopened = module._oneslicer_session_create();
  assert.ok(reopened);
  try {
    initNative3mf(reopened,bytes);
    const after = projectGetManifestOnce(module,reopened);
    assert.equal(after.instances?.length,2);
    assert.equal(after.objects?.length,2);
    // Imported IDs may be regenerated. Verify native reimport's placement
    // multiset instead of assuming a stable string ID across 3MF roundtrips.
    const xs = after.instances.map(x => x.transform.matrix[3]).sort((a,b)=>a-b);
    const expected = [
      before.instances[0].transform.matrix[3],
      shifted[3],
    ].sort((a,b)=>a-b);
    for(let i=0;i<2;i++)
      assert.ok(Math.abs(xs[i]-expected[i]) < 0.1,
        'reimported native placement X must match modified project');
    report.reimportedX=xs;
  } finally {
    module._oneslicer_session_destroy(reopened);
  }
  report.selectedInstance=target.id;
  report.siblingKept=true;
  report.nativeSessionEditedWithoutSetObjects=true;
  report.strictPreservationRejected=true;
  report.bestEffortWarnings=descriptor.warnings ?? [];
  report.sourceBytes=fixture.length;
  report.lossyExportBytes=bytes.length;
  report.status='PASS';
  console.log('PASS: private C bridge edits imported native-session instance, retains sibling; strict export refuses');
} catch(error) {
  report.error=String(error?.stack ?? error).slice(0,2000);
  console.error(report.error);
  process.exitCode=1;
} finally {
  module._oneslicer_session_destroy(session);
  mkdirSync('parity-output',{recursive:true});
  writeFileSync('parity-output/private-imported-instance-edit.json',
    JSON.stringify(report,null,2)+'\n');
}
