// Strict isolated-Chrome acceptance for a newly rebuilt OrcaSlicer WASM
// candidate. Never publishes engine binaries, G-code or printer profiles.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {checkBrowserMultiObject3mf} from './test-browser-3mf-multiobject.mjs';
import {checkNativeManifestEditRoundTrip} from './test-browser-3mf-native-edit.mjs';
import {probeIndependentCore3mfImport} from './test-browser-3mf-independent-core-import.mjs';
import {checkImportedProjectReplacementGuard} from './test-browser-3mf-import-replacement-guard.mjs';

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
  console.log('PASS: real isolated Chrome v2.5.0 WASM retains 2 objects, 2 instances and exact XYZ bounds of both 20 mm cubes');
  const edited = await checkNativeManifestEditRoundTrip(page,cube);
  assert.equal(edited.triangles,24);
  console.log('PASS: native 3MF export/reimport after isolated instance-only rotation, scale and translation; source is synthetic STL, not desktop 3MF');
  const independent=await readFile('parity-output/independent-core-two-build.3mf');
  const external=await probeIndependentCore3mfImport(page,new Uint8Array(independent));
  console.log('DIAGNOSTIC: independently generated 3MF Core native import status='+external.nativeProjectImport.status+
    ', flattened STL conversion='+external.flattenedConversion.status);
  if (process.env.CHECK_REPLACEMENT_GUARD === '1') {
    await checkImportedProjectReplacementGuard(page,new Uint8Array(independent),new Uint8Array(cube));
  }
} finally {
  await browser.close();
}
