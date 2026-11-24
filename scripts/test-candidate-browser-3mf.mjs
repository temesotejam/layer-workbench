// Strict isolated-Chrome acceptance for a newly rebuilt OrcaSlicer WASM
// candidate. Never publishes engine binaries, G-code or printer profiles.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {checkBrowserMultiObject3mf} from './test-browser-3mf-multiobject.mjs';
import {checkNativeManifestEditRoundTrip} from './test-browser-3mf-native-edit.mjs';
import {probeIndependentCore3mfImport} from './test-browser-3mf-independent-core-import.mjs';
import {checkImportedProjectReplacementGuard} from './test-browser-3mf-import-replacement-guard.mjs';
import {checkBrowserPrivateImportedInstanceEdit} from './test-browser-3mf-private-instance-edit.mjs';

const base = process.env.ENGINE_PROBE_URL ?? 'http://127.0.0.1:8766/';
const artifactDir = process.env.ENGINE_ARTIFACT_DIR ?? 'engine-test-artifacts';
const triangles = [
  [[0,0,0],[20,0,0],[20,20,0]], [[0,0,0],[20,20,0],[0,20,0]],
  [[0,0,20],[20,20,20],[20,0,20]], [[0,0,20],[0,20,20],[20,20,20]],
  [[0,0,0],[20,0,20],[20,0,0]], [[0,0,0],[0,0,20],[20,0,20]],
  [[0,20,0],[20,20,0],[20,20,20]], [[0,20,0],[20,20,20],[0,20,20]],
  [[0,0,0],[0,20,0],[0,20,20]], [[0,0,0],[0,20,20],[0,0,20]],
  [[20,0,0],[20,0,20],[20,20,20]], [[20,0,0],[20,20,20],[20,20,0]],
];
const cube = Buffer.alloc(84 + 50 * triangles.length);
cube.writeUInt32LE(triangles.length,80);
triangles.forEach((triangle,i) => triangle.forEach((vertex,v) =>
  vertex.forEach((value,axis) =>
    cube.writeFloatLE(value,84 + i*50 + 12 + v*12 + axis*4))));

const browser = await chromium.launch({
  channel:'chrome',headless:true,
  args:['--no-sandbox','--disable-dev-shm-usage','--enable-webgl',
    '--use-angle=swiftshader','--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  const response = await page.goto(base + 'engine-probe.html',{waitUntil:'domcontentloaded'});
  assert.equal(response?.status(),200);
  assert.equal(await page.evaluate(() => crossOriginIsolated),true,'COOP/COEP missing');
  await page.locator('#engine-js').setInputFiles({
    name:'slicer-mt.js',mimeType:'text/javascript',
    buffer:await readFile(artifactDir+'/slicer-mt.js'),
  });
  await page.locator('#engine-wasm').setInputFiles({
    name:'slicer-mt.wasm',mimeType:'application/wasm',
    buffer:await readFile(artifactDir+'/slicer-mt.wasm'),
  });
  await page.locator('#probe').click();
  await page.waitForFunction(() => {
    const message = document.querySelector('#probe-output')?.textContent ?? '';
    return message.includes('"family": "OrcaSlicer"') || message.startsWith('FAILED:');
  },null,{timeout:90000});
  const output = await page.locator('#probe-output').innerText();
  if(output.startsWith('FAILED:'))throw new Error(output);
  const capability = JSON.parse(output);
  assert.equal(capability.engine.family,'OrcaSlicer');
  assert.equal(capability.engine.version,'2.5.0');
  assert.equal(capability.api.version,'0.7.0');
  const result = await checkBrowserMultiObject3mf(page,cube,'parity-output',{requireExactPlacement:true});
  assert.equal(result.supported,true,
    'Native 3MF reimport lost separate objects/instances; not parity');
  assert.equal(result.instances,2);
  assert.equal(result.triangles,24);
  assert.equal(result.placementVerified,true,'3MF per-object world-space positions must match input');
  console.log('PASS: real isolated Chrome v2.5.0 WASM retains 2 distinct objects, 2 instances and exact XYZ bounds');
  // The accepted binary uses a different export path than the legacy probe.
  // Record shared resource identity separately from successful placement.
  // This is a diagnostic: do not turn an expanded object graph into parity.
  if (process.env.CHECK_ACCEPTED_SHARED_MESH === '1') {
    const shared = await checkBrowserMultiObject3mf(page,cube,'parity-output',{
      sharedMesh:true,requireExactPlacement:false
    });
    console.log('DIAGNOSTIC: accepted shared-mesh export '+JSON.stringify(shared));
    // The same resource must support distinct per-instance linear transforms.
    // Keep the evidence even if the new, stricter affine gate fails in CI.
    const affine = await checkBrowserMultiObject3mf(page,cube,'parity-output',{
      sharedMesh:true,affineShared:true,requireExactPlacement:false
    });
    console.log('DIAGNOSTIC: accepted shared-mesh affine export '+JSON.stringify(affine));
  }
  const edited = await checkNativeManifestEditRoundTrip(page,cube);
  assert.equal(edited.triangles,24);
  console.log('PASS: native 3MF export/reimport after isolated instance-only rotation, scale and translation; source is synthetic STL, not desktop 3MF');
  // This verification also runs after a standalone successful WASM build.
  // Its CI job has a fresh filesystem; the build job's synthetic 3MF fixture
  // is NOT included in the uploaded WASM artifact. Recreate it explicitly
  // rather than accidentally depending on a previous job's working tree.
  const independentPath='parity-output/independent-core-two-build.3mf';
  execFileSync('python3',[
    'scripts/make_3mf_two_build_fixture.py','--output',independentPath
  ],{stdio:'inherit'});
  const independent=await readFile(independentPath);
  assert.ok(independent.length>300 && independent[0]===0x50 && independent[1]===0x4b,
    'Independent Core 3MF fixture generation failed');
  // Use the exact rebuilt candidate from CI to invoke the private C ABI
  // inside real isolated Chrome, not only in Node's direct WASM harness.
  // The helper asserts atomic rejection, sibling identity and lossy-export guard.
  const privateResult=await checkBrowserPrivateImportedInstanceEdit(
    page,new Uint8Array(independent));
  assert.equal(privateResult.reimportObjects,2);
  const external=await probeIndependentCore3mfImport(page,new Uint8Array(independent));
  // Validate a genuine modified Core 3MF archive in the accepted native WASM
  // importer. The offline edit changes exactly one build transform and leaves
  // every other decompressed ZIP member intact. Still not desktop 3MF parity.
  const changedCorePath='parity-output/edited-core-build.3mf';
  execFileSync('python3',[
    'scripts/edit_3mf_build_transform.py',
    '--input',independentPath,'--output',changedCorePath,
    '--build-index','1','--translate-mm','30','0','0'
  ],{stdio:'inherit'});
  const changedCore=await readFile(changedCorePath);
  assert.ok(changedCore.length>300 && !changedCore.equals(independent),
    'Surgical Core edit did not change archive');
  const changedImport=await probeIndependentCore3mfImport(
    page,new Uint8Array(changedCore),'parity-output/edited-core',180);
  assert.equal(changedImport.nativeProjectImport.preservationRequireByteIdentical,true);
  console.log('PASS: standalone one-build Core 3MF transform edit -> native WASM import -> changed XYZ placement and untouched archive export');
  // A second independent file edit exercises 3MF row-vector Z rotation
  // around the build item's translation, not around its mesh center.
  // The second cube's X bounds change from [150,170] to [130,150];
  // the first cube and both Y/Z bounds remain unchanged.
  const rotatedCorePath='parity-output/rotated-core-build.3mf';
  execFileSync('python3',[
    'scripts/edit_3mf_build_transform.py',
    '--input',independentPath,'--output',rotatedCorePath,
    '--build-index','1','--rotate-z-deg','90'
  ],{stdio:'inherit'});
  const rotatedCore=await readFile(rotatedCorePath);
  assert.ok(rotatedCore.length>300 && !rotatedCore.equals(independent),
    'Core build Z rotation did not change archive');
  const rotatedImport=await probeIndependentCore3mfImport(
    page,new Uint8Array(rotatedCore),'parity-output/rotated-core',130);
  assert.equal(rotatedImport.nativeProjectImport.preservationRequireByteIdentical,true);
  console.log('PASS: independent Core 3MF +90 degree Z build rotation -> native WASM import -> rotated XYZ bounds and untouched export');

  // Positive local-axis nonuniform scale changes only the selected build
  // instance. The first cube retains 90..110 mm XYZ bounds; the second
  // grows to 150..180 X, 90..105 Y, and 0..10 Z.
  const scaledCorePath='parity-output/scaled-core-build.3mf';
  execFileSync('python3',[
    'scripts/edit_3mf_build_transform.py',
    '--input',independentPath,'--output',scaledCorePath,
    '--build-index','1','--scale-local','1.5','0.75','0.5'
  ],{stdio:'inherit'});
  const scaledCore=await readFile(scaledCorePath);
  assert.ok(scaledCore.length>300 && !scaledCore.equals(independent),
    'Core build local scaling did not change archive');
  const scaledImport=await probeIndependentCore3mfImport(
    page,new Uint8Array(scaledCore),'parity-output/scaled-core',150,[30,15,10]);
  assert.equal(scaledImport.nativeProjectImport.preservationRequireByteIdentical,true);
  console.log('PASS: independent Core 3MF local-axis scaling -> WASM import -> nonuniform XYZ bounds and untouched export');

  console.log('DIAGNOSTIC: independently generated 3MF Core native import status='+external.nativeProjectImport.status+
    ', flattened STL conversion='+external.flattenedConversion.status);
  if (process.env.CHECK_REPLACEMENT_GUARD === '1') {
    await checkImportedProjectReplacementGuard(page,new Uint8Array(independent),new Uint8Array(cube));
  }
} finally {
  await browser.close();
}
