// Real browser smoke: probe the archived v2.5.0 candidate only on isolated
// localhost, never by publishing a WASM engine to GitHub Pages.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseGcodeToolpaths} from './gcode-preview-parser.mjs';
import {makeGapRingObj} from './gap-ring-fixture.mjs';
import {makeBridgeArchObj} from './bridge-arch-fixture.mjs';
import {makeSupportSphereObj} from './support-sphere-fixture.mjs';
import {auditVerticalShellDeposition} from './vertical-shell-diagnostic.mjs';
import {auditSurfaceSkinPattern} from './surface-skin-diagnostic.mjs';
import {compareFirstLayerTravelFeedrates} from './initial-layer-travel-diagnostic.mjs';
import {makeParityCubeStl, PARITY_CUBE_STL_SHA256} from './parity-cube-fixture.mjs';
import {auditWasmCubeDeposition} from './audit-wasm-cube-deposition.mjs';
import {auditWasmSkirtDistance} from './audit-wasm-skirt-distance.mjs';
import {auditBridgeSpeedSegments,auditInternalBridgeFlowSegments} from './bridge-feature-diagnostic.mjs';
import {auditSupportDeposition,auditSupportSpeedEffect} from './support-feature-diagnostic.mjs';
import {auditSupportWidthEffect} from './support-extrusion-diagnostic.mjs';
import {checkBrowser3mfRoundTrip} from './test-browser-3mf-roundtrip.mjs';
import {checkBrowserMultiObject3mf} from './test-browser-3mf-multiobject.mjs';
const base = process.env.ENGINE_PROBE_URL || 'http://127.0.0.1:8766/';
const artifactDir = process.env.ENGINE_ARTIFACT_DIR || 'engine-test-artifacts';
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', m => {
  if (m.type() === 'error') console.error('[browser]', m.text());
});
try {
  const response = await page.goto(base + 'engine-probe.html', {waitUntil:'domcontentloaded'});
  assert.equal(response.status(), 200);
  assert.equal(await page.evaluate(() => crossOriginIsolated), true, 'COOP/COEP isolation missing');
  await page.locator('#engine-js').setInputFiles({
    name: 'slicer-mt.js',
    mimeType: 'text/javascript',
    buffer: await readFile(artifactDir + '/slicer-mt.js'),
  });
  await page.locator('#engine-wasm').setInputFiles({
    name: 'slicer-mt.wasm',
    mimeType: 'application/wasm',
    buffer: await readFile(artifactDir + '/slicer-mt.wasm'),
  });
  await page.locator('#probe').click();
  await page.waitForFunction(() => {
    const text = document.querySelector('#probe-output')?.textContent ?? '';
    return text.includes('"family": "OrcaSlicer"') || text.startsWith('FAILED:');
  }, null, {timeout: 90000});
  const text = await page.locator('#probe-output').innerText();
  if (text.startsWith('FAILED:')) throw new Error(text);
  const capabilities = JSON.parse(text);
  assert.equal(capabilities.api.version, '0.7.0');
  assert.equal(capabilities.engine.family, 'OrcaSlicer');
  assert.equal(capabilities.engine.version, '2.5.0');
  console.log('PASS: browser loaded pthread WASM engine with isolated headers and v2.5.0 capabilities');
  // A reproducible 12-triangle cube, identical to the standalone Prepare
  // browser smoke fixture. Verify the actual engine exports a G-code asset.
  // Exact same source STL bytes are also used by the official native CLI
  // fixture; profile/placement equivalence is NOT implied by a shared model.
  const cube = makeParityCubeStl();
  // Real 3MF archive path through the same trusted browser-loaded WASM:
  // native export -> native project reimport -> geometry conversion ->
  // preservation=require export. This is deliberately a synthetic fixture.
  const native3mf = await checkBrowser3mfRoundTrip(page,cube);
  const multi3mf = await checkBrowserMultiObject3mf(page,cube);
  console.log('MULTIOBJECT_3MF_DIAGNOSTIC '+JSON.stringify(multi3mf));
  if (!multi3mf.supported) console.log('KNOWN GAP: native two-object 3MF reimport parity not established');
  else console.log('PASS: two-object WASM native 3MF reimport and conversion');
  // Same native mesh/object referenced by TWO separate placed instances.
  // This detects an exporter that silently flattens instancing while still
  // keeping all 24 triangles in the converted STL.
  const shared3mf = await checkBrowserMultiObject3mf(page,cube,'parity-output',{sharedMesh:true});
  console.log('SHARED_MESH_3MF_DIAGNOSTIC '+JSON.stringify(shared3mf));
  if (!shared3mf.supported) console.log('KNOWN GAP: shared-mesh 3MF instance hierarchy not retained');
  else console.log('PASS: shared-mesh native WASM 3MF hierarchy and geometry preserved');
  console.log('PASS: browser native WASM 3MF round-trip, ' +
    native3mf.triangles+' converted geometry triangles, mapped preview supported='+
    native3mf.mappedPreviewSupported+', sha256='+native3mf.sha256);
  await page.locator('#slice-stl').setInputFiles({
    name: 'cube-test.stl', mimeType: 'model/stl', buffer: cube,
  });
  await page.locator('#slice-model').click();
  await page.waitForFunction(() => {
    const text = document.querySelector('#slice-output')?.textContent ?? '';
    return text.startsWith('PASS:') || text.startsWith('FAILED:');
  }, null, {timeout: 120000});
  const sliceResult = await page.locator('#slice-output').innerText();
  if (sliceResult.startsWith('FAILED:')) throw new Error(sliceResult);
  assert.match(sliceResult, /PASS: G-code generated/);
  assert.equal(await page.locator('#download-gcode').isVisible(), true);
  // Validate the ACTUAL G-code bytes returned by the engine, not only the
  // presence of a download link. The fixture is generic/test-only, not printable.
  const wasmGcode = await page.locator('#download-gcode').evaluate(async anchor => {
    if (!anchor.href.startsWith('blob:')) throw new Error('Expected local G-code blob URL');
    const response = await fetch(anchor.href);
    if (!response.ok) throw new Error('Cannot read generated G-code');
    return response.text();
  });
  assert.ok(wasmGcode.length > 1000 && wasmGcode.length < 20_000_000,
    'Actual WASM G-code is empty or exceeds diagnostic limits');
  const parsedGcode = parseGcodeToolpaths(wasmGcode);
  // Independent output-side witness: scene/manifest may claim translation
  // (128,128,0) without the engine actually depositing at that position.
  const wasmPlacement = auditWasmCubeDeposition(parsedGcode);
  console.log('WASM_CUBE_DEPOSITION_AUDIT '+JSON.stringify(wasmPlacement));
  assert.equal(wasmPlacement.passed,true,
    'Actual browser G-code deposition does not occupy the pinned placed cube envelope');
  assert.ok(parsedGcode.layers.length >= 2, 'Expected multiple sliced Z layers');
  assert.ok(parsedGcode.extrusions > 10, 'Expected positive extrusion toolpaths');
  const commandedRates=parsedGcode.layers.flatMap(layer=>layer.segments)
    .filter(segment=>segment.extrusion && Number.isFinite(segment.feedrateMmMin))
    .map(segment=>segment.feedrateMmMin);
  assert.ok(commandedRates.length > 10 && commandedRates.every(f=>f>0),
    'Actual WASM G-code must expose positive modal F on deposited segments');
  console.log('PASS: actual native WASM G-code deposited segments expose bounded commanded F, not measured velocity');
  const actualGcodeHash = createHash('sha256').update(wasmGcode, 'utf8').digest('hex');
  const parityDir = process.env.PARITY_OUTPUT_DIR || 'parity-output';
  await mkdir(parityDir, {recursive:true});
  await writeFile(parityDir + '/wasm.gcode', wasmGcode, 'utf8');
  await writeFile(parityDir + '/wasm-gcode-summary.json', JSON.stringify({
    engine:'OrcaSlicer WASM candidate', version:'2.5.0', api:'0.7.0',
    fixture:'synthetic 12-triangle cube; generic PLA development profile only',
    source_stl_sha256:PARITY_CUBE_STL_SHA256,
    gcode_sha256:actualGcodeHash, bytes:Buffer.byteLength(wasmGcode,'utf8'),
    layers:parsedGcode.layers.length, extrusion_segments:parsedGcode.extrusions,
    travel_segments:parsedGcode.travels,
    gcode_deposition_placement_witness:wasmPlacement
  }, null, 2) + '\n');

  console.log('PASS: actual WASM G-code content: ' +
    parsedGcode.layers.length + ' layers, ' + parsedGcode.extrusions +
    ' extrusion segments; sha256=' + actualGcodeHash);
  console.log('PASS: browser STL → WASM project → slice → G-code asset');

  // Integration gate: the exact STL imported into the Prepare WebGL view
  // is the file passed to WASM in an opt-in local-only test.
  const prepare = await browser.newPage({ viewport: {width: 1440, height: 900} });
  try {
    const response = await prepare.goto(base + '?engineLab=1', {waitUntil: 'domcontentloaded'});
    assert.equal(response.status(), 200);
    await prepare.locator('#viewport-canvas canvas').waitFor({state:'visible', timeout:90000});
    await prepare.locator('#model-file').setInputFiles({
      name: 'prepare-cube.stl', mimeType: 'model/stl', buffer: cube,
    });
    await prepare.locator('#object-count').getByText('1 object').waitFor({timeout:30000});
    await prepare.locator('#lab-js').setInputFiles({
      name:'slicer-mt.js', mimeType:'text/javascript',
      buffer:await readFile(artifactDir + '/slicer-mt.js'),
    });
    await prepare.locator('#lab-wasm').setInputFiles({
      name:'slicer-mt.wasm', mimeType:'application/wasm',
      buffer:await readFile(artifactDir + '/slicer-mt.wasm'),
    });
    await prepare.locator('#lab-load').click();
    await prepare.waitForFunction(() => {
      const text = document.querySelector('#lab-status')?.textContent || '';
      return text.startsWith('Ready:') || text.startsWith('FAILED');
    }, null, {timeout:120000});
    const loaded = await prepare.locator('#lab-status').innerText();
    assert.match(loaded, /^Ready: OrcaSlicer 2\.5\.0/);
    await prepare.locator('#lab-slice').click();
    await prepare.waitForFunction(() => {
      const text = document.querySelector('#lab-status')?.textContent || '';
      return text.startsWith('PASS:') || text.startsWith('FAILED');
    }, null, {timeout:120000});
    const result = await prepare.locator('#lab-status').innerText();
    assert.match(result, /^PASS: 1 STL model\(s\)/);
    assert.equal(await prepare.locator('#lab-download').isVisible(), true);
    assert.equal(await prepare.locator('.gcode-layer-preview').isVisible(),true);
    const previewLayerCount=await prepare.locator('#lab-layer-range').getAttribute('max');
    assert.ok(Number(previewLayerCount)>0,'Expected multiple G-code layers');
    const initialPreviewStats=await prepare.locator('#lab-preview-stats').innerText();
    assert.match(initialPreviewStats,/extrusion segments/);
    assert.ok(Number(await prepare.locator('#lab-toolpath-canvas').getAttribute('data-segment-count'))>0);
    await prepare.locator('#lab-layer-range').fill('0');
    assert.match(await prepare.locator('#lab-layer-info').innerText(),/^1\//);
    assert.equal(await prepare.locator('#lab-3d-layer-range').inputValue(),'0',
      'Selecting 2D layer must update the 3D layer picker');
    assert.equal(await prepare.locator('.gcode-3d-preview').isVisible(),true);
    assert.equal(await prepare.locator('#lab-3d-canvas canvas').isVisible(),true);
    assert.ok(Number(await prepare.locator('#lab-3d-canvas').getAttribute('data-segment-count'))>0);
    const initial3DMax=Number(await prepare.locator('#lab-3d-layer-range').getAttribute('max'));
    assert.ok(initial3DMax>0);
    await prepare.locator('#lab-3d-layer-range').fill('0');
    assert.equal(await prepare.locator('#lab-layer-range').inputValue(),'0',
      'Selecting 3D layer must update the 2D layer picker');
    assert.equal(await prepare.locator('#lab-3d-canvas').getAttribute('data-visible-layers'),'1');
    await prepare.locator('#lab-3d-layer-range').fill(String(initial3DMax));
    assert.equal(await prepare.locator('#lab-layer-range').inputValue(),String(initial3DMax));
    assert.equal(await prepare.locator('#lab-3d-canvas').getAttribute('data-visible-layers'),String(initial3DMax+1));
    // The isolated 3D viewer can inspect one Z layer without mutating the
    // actual WASM G-code or rebuilding its toolpath geometries.
    const fullLayerSegments=Number(await prepare.locator('#lab-3d-canvas').getAttribute('data-visible-segments'));
    assert.ok(fullLayerSegments>0);
    const middleLayer=Math.floor(initial3DMax/2);
    await prepare.locator('#lab-3d-layer-range').fill(String(middleLayer));
    assert.equal(await prepare.locator('#lab-layer-range').inputValue(),String(middleLayer));
    assert.match(await prepare.locator('#lab-layer-info').innerText(),new RegExp(`^${middleLayer+1}/`));
    const cumulativeSegments=Number(await prepare.locator('#lab-3d-canvas').getAttribute('data-visible-segments'));
    await prepare.locator('#lab-3d-layer-mode').selectOption('single');
    assert.equal(await prepare.locator('#lab-3d-canvas').getAttribute('data-layer-mode'),'single');
    assert.equal(await prepare.locator('#lab-3d-canvas').getAttribute('data-visible-layers'),'1');
    const singleLayerSegments=Number(await prepare.locator('#lab-3d-canvas').getAttribute('data-visible-segments'));
    assert.ok(singleLayerSegments>0&&singleLayerSegments<=cumulativeSegments&&cumulativeSegments<=fullLayerSegments);
    // Palette changes should preserve the chosen Z layer and display mode.
    await prepare.locator('#lab-3d-color-mode').selectOption('speed');
    assert.equal(await prepare.locator('#lab-3d-layer-range').inputValue(),String(middleLayer));
    assert.equal(await prepare.locator('#lab-3d-canvas').getAttribute('data-layer-mode'),'single');
    assert.equal(Number(await prepare.locator('#lab-3d-canvas').getAttribute('data-visible-segments')),singleLayerSegments);
    await prepare.locator('#lab-3d-color-mode').selectOption('tool');
    await prepare.locator('#lab-3d-layer-mode').selectOption('through');
    assert.equal(await prepare.locator('#lab-3d-canvas').getAttribute('data-visible-layers'),String(middleLayer+1));
    assert.equal(Number(await prepare.locator('#lab-3d-canvas').getAttribute('data-visible-segments')),cumulativeSegments);
    await prepare.locator('#lab-3d-layer-range').fill(String(initial3DMax));
    assert.equal(Number(await prepare.locator('#lab-3d-canvas').getAttribute('data-visible-segments')),fullLayerSegments);
    console.log('PASS: real Chrome/WASM synchronized 2D/3D layer pickers, single-layer visibility and palette switch');
    // Exercise the actual localhost 2D -> 3D feature selector with real
    // WASM-generated G-code. A selected type must filter deposition without
    // treating all travels as part of the selected type.
    const featureChoices=await prepare.locator('#lab-feature-filter option').count();
    assert.ok(featureChoices>=2,'Expected at least one deposition category');
    const featureKey=await prepare.locator('#lab-feature-filter option').nth(1).getAttribute('value');
    assert.notEqual(featureKey,'all');
    const all3DSegments=Number(await prepare.locator('#lab-3d-canvas').getAttribute('data-segment-count'));
    assert.ok(all3DSegments>0);
    await prepare.locator('#lab-feature-filter').selectOption(featureKey);
    const selected3DSegments=Number(await prepare.locator('#lab-3d-canvas').getAttribute('data-segment-count'));
    assert.ok(selected3DSegments>0 && selected3DSegments<all3DSegments,
      'Selecting deposition type must hide non-matching toolpaths (including travel)');
    assert.equal(await prepare.locator('#lab-3d-canvas').getAttribute('data-feature-filter'),featureKey);
    await prepare.locator('#lab-feature-filter').selectOption('all');
    assert.equal(Number(await prepare.locator('#lab-3d-canvas').getAttribute('data-segment-count')),all3DSegments,
      'Restoring all paths must restore full 3D diagnostic geometry');
    console.log('PASS: actual Chrome feature select filters both 2D and 3D G-code previews without changing WASM output');
    // Palette changes must not mutate toolpaths actually generated by WASM.
    await prepare.locator('#lab-3d-color-mode').selectOption('speed');
    assert.equal(await prepare.locator('#lab-3d-canvas').getAttribute('data-color-mode'),'speed');
    assert.equal(Number(await prepare.locator('#lab-3d-canvas').getAttribute('data-segment-count')),all3DSegments);
    assert.ok(Number(await prepare.locator('#lab-3d-canvas').getAttribute('data-active-color-classes'))>0);
    assert.match(await prepare.locator('#lab-3d-color-legend').innerText(),/not measured/);
    await prepare.locator('#lab-feature-filter').selectOption(featureKey);
    assert.equal(Number(await prepare.locator('#lab-3d-canvas').getAttribute('data-segment-count')),selected3DSegments);
    assert.equal(await prepare.locator('#lab-3d-canvas').getAttribute('data-color-mode'),'speed');
    await prepare.locator('#lab-feature-filter').selectOption('all');
    await prepare.locator('#lab-3d-color-mode').selectOption('tool');
    assert.equal(await prepare.locator('#lab-3d-canvas').getAttribute('data-color-mode'),'tool');
    assert.equal(Number(await prepare.locator('#lab-3d-canvas').getAttribute('data-segment-count')),all3DSegments);
    console.log('PASS: real Chrome 3D commanded-F palette toggles without mutating WASM toolpaths');
    console.log('PASS: 3D WASM G-code toolpaths, orbit canvas, and adjustable visible layer range');
    console.log('PASS: actual WASM G-code rendered as navigable layer toolpaths');
    console.log('PASS: Prepare UI selected STL → local WASM → G-code download');
    const initialHash = await prepare.locator('#lab-download').evaluate(async link => {
      const bytes = await (await fetch(link.href)).arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256',bytes);
      return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
    });
    // Make a genuine UI edit and ensure it affects the native WASM result.
    await prepare.locator('#transform-x').fill('10');
    await prepare.locator('#transform-x').press('Tab');
    await prepare.locator('#transform-rz').fill('90');
    await prepare.locator('#transform-rz').press('Tab');
    await prepare.locator('#transform-sx').fill('1.2');
    await prepare.locator('#transform-sx').press('Tab');
    assert.equal(await prepare.locator('#lab-slice').isEnabled(),true);
    await prepare.locator('#lab-slice').click();
    await prepare.waitForFunction(() => {
      const text = document.querySelector('#lab-status')?.textContent || '';
      return text.startsWith('PASS:') || text.startsWith('FAILED');
    }, null, {timeout:120000});
    const transformedResult = await prepare.locator('#lab-status').innerText();
    assert.ok(transformedResult.startsWith('PASS: 1 STL model(s)'), transformedResult);
    const transformedHash = await prepare.locator('#lab-download').evaluate(async link => {
      const bytes = await (await fetch(link.href)).arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256',bytes);
      return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
    });
    assert.notEqual(transformedHash,initialHash,'Native output must change after Prepare transform');
    console.log('PASS: numeric Prepare position/rotation/scale alter real WASM G-code');
    // A second STL must appear as another native object, and change the
    // generated G-code. Keep the translated objects separated on the plate.
    await prepare.locator('#model-file').setInputFiles({
      name: 'second-cube.stl', mimeType: 'model/stl', buffer: cube,
    });
    await prepare.locator('#object-count').getByText('2 objects').waitFor({timeout:30000});
    await prepare.locator('#transform-x').fill('45');
    await prepare.locator('#transform-x').press('Tab');
    assert.equal(await prepare.locator('#lab-slice').isEnabled(), true);
    await prepare.locator('#lab-slice').click();
    await prepare.waitForFunction(() => {
      const text = document.querySelector('#lab-status')?.textContent || '';
      return text.startsWith('PASS:') || text.startsWith('FAILED');
    }, null, {timeout:120000});
    const multiStatus = await prepare.locator('#lab-status').innerText();
    assert.ok(multiStatus.startsWith('PASS: 2 STL model(s)'), multiStatus);
    const multiHash = await prepare.locator('#lab-download').evaluate(async link => {
      const bytes = await (await fetch(link.href)).arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
    });
    assert.notEqual(multiHash,transformedHash,'Adding second native model must change G-code');
    console.log('PASS: two Prepare STL objects → one native plate → distinct WASM G-code');
    // Browser-only duplicate/drop-to-bed editing must also reach the real
    // local WASM one-plate manifest, not merely change a Three.js object.
    // Keep the existing two-independent-file test above, and restore two
    // objects afterwards so all later process-profile cases remain unchanged.
    const sourceX=Number(await prepare.locator('#transform-x').inputValue());
    const sourceY=Number(await prepare.locator('#transform-y').inputValue());
    const sourceZ=Number(await prepare.locator('#transform-z').inputValue());
    assert.equal(await prepare.locator('#duplicate-object').isEnabled(),true);
    const twoModelGcode=await prepare.locator('#lab-download').evaluate(async link=>
      (await fetch(link.href)).text());
    await prepare.locator('#duplicate-object').click();
    await prepare.locator('#object-count').getByText('3 objects').waitFor({timeout:30000});
    assert.ok(Math.abs(Number(await prepare.locator('#transform-x').inputValue())-sourceX-20)<0.001);
    assert.ok(Math.abs(Number(await prepare.locator('#transform-y').inputValue())-sourceY-20)<0.001);
    await prepare.locator('#transform-z').fill('31');
    await prepare.locator('#transform-z').press('Tab');
    await prepare.locator('#drop-to-bed').click();
    assert.ok(Math.abs(Number(await prepare.locator('#transform-z').inputValue())-sourceZ)<0.001,
      'Drop to bed must restore the duplicated cube to its original physical Z');
    assert.equal(await prepare.locator('#lab-slice').isEnabled(),true);
    await prepare.locator('#lab-slice').click();
    await prepare.waitForFunction(()=>{
      const state=document.querySelector('#lab-status')?.textContent||'';
      return state.startsWith('PASS:')||state.startsWith('FAILED');
    },null,{timeout:120000});
    const clonedStatus=await prepare.locator('#lab-status').innerText();
    assert.match(clonedStatus,/^PASS: 3 STL model\(s\)/);
    const threeModelGcode=await prepare.locator('#lab-download').evaluate(async link=>
      (await fetch(link.href)).text());
    // Compare actual deposited XY extents above the initial skirt/layer:
    // the duplicate is offset +20 mm in X and Y, so its toolpaths must
    // expand both envelopes. Headers, mesh counts and G-code hashes alone
    // are insufficient evidence that the third object was really sliced.
    const upperDepositionEnvelope=code=>{
      const paths=parseGcodeToolpaths(code).layers.flatMap(layer=>layer.segments)
        .filter(s=>s.extrusion && Number.isFinite(s.z2) &&
          s.z2>2 && s.z2<18 &&
          [s.x1,s.y1,s.x2,s.y2].every(Number.isFinite));
      assert.ok(paths.length>50,'Insufficient upper-layer XY deposition for duplication witness');
      return paths.reduce((out,s)=>({
        x:Math.max(out.x,s.x1,s.x2), y:Math.max(out.y,s.y1,s.y2),
      }),{x:-Infinity,y:-Infinity});
    };
    const beforeClone=upperDepositionEnvelope(twoModelGcode);
    const afterClone=upperDepositionEnvelope(threeModelGcode);
    assert.ok(afterClone.x>beforeClone.x+8 && afterClone.y>beforeClone.y+8,
      'Duplicated STL must expand real WASM deposition XY extents; '+
      JSON.stringify({beforeClone,afterClone}));
    await prepare.locator('#remove-object').click();
    await prepare.locator('#object-count').getByText('2 objects').waitFor({timeout:30000});
    assert.ok(Math.abs(Number(await prepare.locator('#transform-x').inputValue())-sourceX)<0.001,
      'Deleting duplicate must preserve the source STL transform');
    assert.equal(await prepare.locator('#lab-slice').isEnabled(),true);
    console.log('PASS: Prepare duplicate + Drop to bed → 3 real native WASM STL instances, expanded deposited XY, source preserved');
    // Process override must be applied through the actual one-slicer-api
    // profile operation, not merely reflected in the DOM.
    await prepare.locator('#lab-process').setInputFiles({
      name:'test-process.json', mimeType:'application/json',
      buffer:Buffer.from(JSON.stringify({layer_height:0.3,wall_loops:3})),
    });
    await prepare.locator('#lab-slice').click();
    await prepare.waitForFunction(() => {
      const text=document.querySelector('#lab-status')?.textContent || '';
      return text.startsWith('PASS:') || text.startsWith('FAILED');
    },null,{timeout:120000});
    const overrideStatus=await prepare.locator('#lab-status').innerText();
    assert.ok(overrideStatus.startsWith('PASS: 2 STL model(s)'),overrideStatus);
    const overrideGcode=await prepare.locator('#lab-download').evaluate(async link =>
      (await fetch(link.href)).text());
    const overrideHash = await prepare.locator('#lab-download').evaluate(async link => {
      const digest=await crypto.subtle.digest('SHA-256',await (await fetch(link.href)).arrayBuffer());
      return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
    });
    assert.notEqual(overrideHash,multiHash,'Process override must alter actual native G-code');
    assert.equal(await prepare.locator('.gcode-layer-preview').isVisible(),true);
    const afterOverrideLayers=Number(await prepare.locator('#lab-layer-range').getAttribute('max'))+1;
    assert.ok(afterOverrideLayers>0);
    console.log('PASS: process override produces fresh layer preview ('+afterOverrideLayers+' Z levels)');
    console.log('PASS: local process override → native applyProfile → distinct G-code');
    // Real one-slicer-api application: change ONLY process speed fields while
    // retaining the existing layer/shell settings, then compare native output.
    // This does not establish any machine's real print speed or G-code parity.
    await prepare.locator('#lab-process').setInputFiles({
      name:'test-process-speeds.json',mimeType:'application/json',
      buffer:Buffer.from(JSON.stringify({
        layer_height:0.3,wall_loops:3,
        outer_wall_speed:5,inner_wall_speed:8,travel_speed:20,
      })),
    });
    await prepare.locator('#lab-slice').click();
    await prepare.waitForFunction(() => {
      const text=document.querySelector('#lab-status')?.textContent || '';
      return text.startsWith('PASS:') || text.startsWith('FAILED');
    },null,{timeout:120000});
    const speedStatus=await prepare.locator('#lab-status').innerText();
    assert.ok(speedStatus.startsWith('PASS: 2 STL model(s)'),speedStatus);
    const speedHash=await prepare.locator('#lab-download').evaluate(async link=>{
      const digest=await crypto.subtle.digest('SHA-256',await (await fetch(link.href)).arrayBuffer());
      return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
    });
    assert.notEqual(speedHash,overrideHash,'Native output must respond to speed-only process changes');
    // Intentionally set speed ceilings below measured original extrusion F
    // (which was ~12–25 mm/s) to make this a meaningful engine test.
    // A G-code SHA change could be *only* a profile comment. Inspect the
    // commanded extrusion feedrate words parsed from the actual native output.
    const positiveExtrusionFeedrates=code=>[...new Set(
      parseGcodeToolpaths(code).layers.flatMap(layer=>layer.segments)
        .filter(s=>s.extrusion && Number.isFinite(s.feedrateMmMin) && s.feedrateMmMin>0)
        .map(s=>Math.round(s.feedrateMmMin*100)/100)
    )].sort((a,b)=>a-b);
    const overrideFeeds=positiveExtrusionFeedrates(overrideGcode);
    const speedGcode=await prepare.locator('#lab-download').evaluate(async link=>
      (await fetch(link.href)).text());
    const speedFeeds=positiveExtrusionFeedrates(speedGcode);
    assert.ok(overrideFeeds.length>0 && speedFeeds.length>0,'Missing deposited feedrates in native output');
    assert.notDeepEqual(speedFeeds,overrideFeeds,
      'Process speed overrides changed only headers, not deposited G-code F values');
    console.log('PASS: native WASM process speed overrides change commanded extrusion F values, not just metadata');
    // Narrow real-engine gate for one newly bridged v2.5.0 speed key.
    // Hold every other process setting fixed; a header/hash-only change must
    // not pass. The two 20 mm cubes include top-solid deposition, but the
    // resulting G-code is diagnostic and must never be used for printing.
    await prepare.locator('#lab-process').setInputFiles({
      name:'test-top-surface-speed.json',mimeType:'application/json',
      buffer:Buffer.from(JSON.stringify({
        layer_height:0.3,wall_loops:3,
        outer_wall_speed:5,inner_wall_speed:8,travel_speed:20,
        top_surface_speed:2,
      })),
    });
    await prepare.locator('#lab-slice').click();
    await prepare.waitForFunction(() => {
      const text=document.querySelector('#lab-status')?.textContent || '';
      return text.startsWith('PASS:') || text.startsWith('FAILED');
    },null,{timeout:120000});
    const topSpeedStatus=await prepare.locator('#lab-status').innerText();
    assert.ok(topSpeedStatus.startsWith('PASS: 2 STL model(s)'),topSpeedStatus);
    const topSpeedGcode=await prepare.locator('#lab-download').evaluate(async link=>
      (await fetch(link.href)).text());
    const topFeeds=positiveExtrusionFeedrates(topSpeedGcode);
    assert.ok(topFeeds.length>0,'Top-surface override produced no deposited G-code');
    assert.notDeepEqual(topFeeds,speedFeeds,
      'Top-surface override changed metadata only, not actual extrusion F values');
    const newSlowTopFeeds=topFeeds.filter(f=>f>0 && f<=150 &&
      !speedFeeds.some(baseline=>Math.abs(baseline-f)<0.01));
    assert.ok(newSlowTopFeeds.length>0,
      'top_surface_speed=2 mm/s produced no new low commanded extrusion F; '+
      'baseline='+JSON.stringify(speedFeeds)+' candidate='+JSON.stringify(topFeeds));
    console.log('PASS: real Chrome/WASM top_surface_speed=2 mm/s changes deposited F, newly slow mm/min='+
      JSON.stringify(newSlowTopFeeds));
    // Check a second newly bridged native v2.5.0 deposition-speed key.
    // Both runs use the same two-cube STL plate and process settings, with
    // explicit nonzero sparse infill density. ONLY sparse_infill_speed changes.
    // Inspect deposited F commands: a changed G-code hash or header is not proof.
    const sparseInfillSettings={
      layer_height:0.3,wall_loops:3,
      outer_wall_speed:5,inner_wall_speed:8,travel_speed:20,
      sparse_infill_density:35,
    };
    const sliceSparseInfill=async(name,settings)=>{
      await prepare.locator('#lab-process').setInputFiles({
        name,mimeType:'application/json',
        buffer:Buffer.from(JSON.stringify(settings)),
      });
      await prepare.locator('#lab-slice').click();
      await prepare.waitForFunction(() => {
        const text=document.querySelector('#lab-status')?.textContent || '';
        return text.startsWith('PASS:') || text.startsWith('FAILED');
      },null,{timeout:120000});
      const status=await prepare.locator('#lab-status').innerText();
      assert.ok(status.startsWith('PASS: 2 STL model(s)'),status);
      return prepare.locator('#lab-download').evaluate(async link=>
        (await fetch(link.href)).text());
    };
    const sparseBaselineGcode=await sliceSparseInfill(
      'test-sparse-infill-baseline.json',sparseInfillSettings);
    // Source-pinned v2.5.0 Creality stores crosshatch in its common preset
    // and grid in the CR-10 0.20mm child. Prove the selected setting reaches
    // actual WASM XY deposition geometry; a changed profile footer/hash alone
    // does not establish that the infill algorithm was exercised.
    const gridGcode=await sliceSparseInfill('test-native-grid-infill.json',
      {...sparseInfillSettings,sparse_infill_pattern:'grid'});
    const crosshatchGcode=await sliceSparseInfill('test-native-crosshatch-infill.json',
      {...sparseInfillSettings,sparse_infill_pattern:'crosshatch'});
    const depositionXY=code=>parseGcodeToolpaths(code).layers.flatMap(layer=>layer.segments)
      .filter(segment=>segment.extrusion &&
        Math.hypot(segment.x2-segment.x1,segment.y2-segment.y1)>0.0001)
      .map(segment=>[segment.x1,segment.y1,segment.x2,segment.y2,segment.z2]
        .map(n=>Math.round(n*1000)/1000).join(','));
    const gridPaths=depositionXY(gridGcode);
    const crosshatchPaths=depositionXY(crosshatchGcode);
    assert.ok(gridPaths.length>=100 && crosshatchPaths.length>=100,
      'Native infill-pattern check requires real deposited XY paths for both enum values');
    assert.notDeepEqual(gridPaths,crosshatchPaths,
      'grid/crosshatch must alter deposited XY geometry, not only G-code metadata');
    console.log('PASS: source-pinned grid vs crosshatch reaches real Chrome WASM deposited XY geometry; '+
      'segments='+gridPaths.length+'/'+crosshatchPaths.length);
    // Exercise bridge_speed against the real isolated candidate. A pair of
    // independent cubes has no guaranteed bridge geometry, so this probes
    // acceptance and nonempty deposition only, NOT bridge F or native parity.
    const bridgeProbe=await sliceSparseInfill(
      'test-bridge-speed-opt-in.json',
      {...sparseInfillSettings,bridge_speed:2});
    assert.ok(parseGcodeToolpaths(bridgeProbe).extrusions>10,
      'Real WASM rejected bridge_speed or generated no deposited geometry');
    console.log('PASS: isolated Chrome/WASM accepts bounded bridge_speed and slices; '+
      'bridge-feature speed effects remain unverified');
    const sparseSlowGcode=await sliceSparseInfill(
      'test-sparse-infill-slow.json',
      {...sparseInfillSettings,sparse_infill_speed:2});
    const sparseBaselineFeeds=positiveExtrusionFeedrates(sparseBaselineGcode);
    const sparseSlowFeeds=positiveExtrusionFeedrates(sparseSlowGcode);
    assert.ok(sparseBaselineFeeds.length>0 && sparseSlowFeeds.length>0,
      'Sparse-infill profile test produced no deposited G-code feedrates');
    const newSlowSparseFeeds=sparseSlowFeeds.filter(f=>f>0 && f<=150 &&
      !sparseBaselineFeeds.some(baseline=>Math.abs(baseline-f)<0.01));
    assert.ok(newSlowSparseFeeds.length>0,
      'sparse_infill_speed=2 mm/s produced no new low deposited F value; '+
      'baseline='+JSON.stringify(sparseBaselineFeeds)+
      ' candidate='+JSON.stringify(sparseSlowFeeds));
    console.log('PASS: real Chrome/WASM sparse_infill_speed=2 mm/s changes deposited F, new slow mm/min='+
      JSON.stringify(newSlowSparseFeeds));
    // Third newly bridged process-speed option: use the same two-cube
    // geometry and identical diagnostic settings as the sparse baseline.
    // Only internal_solid_infill_speed changes. Require actual XY+E feedrate
    // change rather than accepting profile comments or a G-code hash.
    // This fixture has top/bottom solid shells and interior solid infill;
    // a production printer profile or desktop-native parity is NOT asserted.
    const internalSolidSlowGcode=await sliceSparseInfill(
      'test-internal-solid-infill-slow.json',
      {...sparseInfillSettings,internal_solid_infill_speed:2});
    const internalSolidBaselineFeeds=positiveExtrusionFeedrates(sparseBaselineGcode);
    const internalSolidSlowFeeds=positiveExtrusionFeedrates(internalSolidSlowGcode);
    assert.ok(internalSolidBaselineFeeds.length>0&&internalSolidSlowFeeds.length>0,
      'Internal-solid-speed test produced no deposited G-code feedrates');
    const newSlowInternalSolidFeeds=internalSolidSlowFeeds.filter(f=>f>0&&f<=150&&
      !internalSolidBaselineFeeds.some(baseline=>Math.abs(baseline-f)<0.01));
    assert.ok(newSlowInternalSolidFeeds.length>0,
      'internal_solid_infill_speed=2 mm/s produced no new low deposited F value; '+
      'baseline='+JSON.stringify(internalSolidBaselineFeeds)+
      ' candidate='+JSON.stringify(internalSolidSlowFeeds));
    console.log('PASS: real Chrome/WASM internal_solid_infill_speed=2 mm/s changes deposited F, new slow mm/min='+
      JSON.stringify(newSlowInternalSolidFeeds));
    // Change ONLY the first-layer height while retaining the previous layer,
    // wall and speed settings. Verify a changed physical extrusion Z, not just
    // a G-code hash/header difference. Generic test PLA; never printer-ready.
    const firstExtrusionZ = code => parseGcodeToolpaths(code).layers
      .find(layer => layer.segments.some(segment => segment.extrusion))?.z;
    const baselineSpeedGcode=await prepare.locator('#lab-download').evaluate(async link =>
      (await fetch(link.href)).text());
    const baselineFirstZ=firstExtrusionZ(baselineSpeedGcode);
    assert.ok(Number.isFinite(baselineFirstZ),'Missing baseline deposited G-code layer');
    await prepare.locator('#lab-process').setInputFiles({
      name:'test-first-layer-height.json',mimeType:'application/json',
      buffer:Buffer.from(JSON.stringify({
        layer_height:0.3,wall_loops:3,
        outer_wall_speed:35,inner_wall_speed:65,travel_speed:110,
        initial_layer_print_height:0.26,
      })),
    });
    await prepare.locator('#lab-slice').click();
    await prepare.waitForFunction(() => {
      const text=document.querySelector('#lab-status')?.textContent || '';
      return text.startsWith('PASS:') || text.startsWith('FAILED');
    },null,{timeout:120000});
    const firstHeightStatus=await prepare.locator('#lab-status').innerText();
    assert.ok(firstHeightStatus.startsWith('PASS: 2 STL model(s)'),firstHeightStatus);
    const heightGcode=await prepare.locator('#lab-download').evaluate(async link =>
      (await fetch(link.href)).text());
    const firstHeightZ=firstExtrusionZ(heightGcode);
    assert.ok(Number.isFinite(firstHeightZ),'Missing overridden deposited G-code layer');
    assert.ok(Math.abs(firstHeightZ-0.26)<0.03,
      'Native first deposited Z does not match selected first-layer height: '+firstHeightZ);
    assert.ok(Math.abs(firstHeightZ-baselineFirstZ)>0.03,
      'Native first deposited Z did not respond to first-layer-only override: '+baselineFirstZ+' -> '+firstHeightZ);
    console.log('PASS: native first-layer-only override changed deposited Z from '+baselineFirstZ+' to '+firstHeightZ+' mm');
    // Resolve 3 levels of a restricted Orca-style inherited process bundle,
    // apply its final settings and prove the actual output differs.
    await prepare.locator('#lab-process').setInputFiles([]);
    await prepare.locator('#lab-preset-bundle').setInputFiles({
      name:'process-bundle.json',mimeType:'application/json',
      buffer:Buffer.from(JSON.stringify({presets:[
        {name:'Base',type:'process',settings:{layer_height:0.2,wall_loops:2}},
        {name:'Fine',type:'process',inherits:'Base',settings:{layer_height:0.12}},
        {name:'Strong Fine',type:'process',inherits:'Fine',settings:{wall_loops:4,sparse_infill_density:24}},
      ]})),
    });
    await prepare.locator('#lab-preset-name').fill('Strong Fine');
    await prepare.locator('#lab-slice').click();
    await prepare.waitForFunction(() => {
      const text=document.querySelector('#lab-status')?.textContent || '';
      return text.startsWith('PASS:') || text.startsWith('FAILED');
    },null,{timeout:120000});
    const inheritedStatus=await prepare.locator('#lab-status').innerText();
    assert.ok(inheritedStatus.startsWith('PASS: 2 STL model(s)'),inheritedStatus);
    assert.match(inheritedStatus,/Base > Fine > Strong Fine/);
    const inheritedHash=await prepare.locator('#lab-download').evaluate(async link=>{
      const digest=await crypto.subtle.digest('SHA-256',await(await fetch(link.href)).arrayBuffer());
      return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
    });
    assert.notEqual(inheritedHash,overrideHash,'Inherited preset must alter actual WASM G-code');
    console.log('PASS: 3-level process inheritance → native applyProfile → distinct G-code');
    // Select actual Orca-style flat machine/filament/process JSON record shapes,
    // inherited from named bases. Unsupported executable G-code keys excluded.
    await prepare.locator('#lab-preset-bundle').setInputFiles([]);
    const rawOrca = [
      {type:'machine',name:'test machine base',nozzle_diameter:'0.4',printable_height:'250',machine_start_gcode:'G28'},
      {type:'machine',name:'TestPrinter 0.4 nozzle',inherits:'test machine base'},
      {type:'filament',name:'Generic PLA @System',filament_diameter:['1.75'],nozzle_temperature:'210',nozzle_temperature_initial_layer:['235'],bed_temperature:'55',hot_plate_temp:['65'],hot_plate_temp_initial_layer:['75']},
      {type:'filament',name:'Generic PLA @TestPrinter',inherits:'Generic PLA @System',nozzle_temperature:'215',compatible_printers:['TestPrinter 0.4 nozzle']},
      {type:'process',name:'process base',layer_height:'0.2',wall_loops:'2'},
      {type:'process',name:'0.16 Fine @TestPrinter',inherits:'process base',layer_height:'0.16',wall_loops:'4',compatible_printers:['TestPrinter 0.4 nozzle']},
    ];
    const indexedRawOrca={
        vendor_index:{
          name:'Test Vendor',version:'01.00.00.00',
          machine_model_list:[],
          machine_list:rawOrca.filter(p=>p.type==='machine').map(p=>({name:p.name,sub_path:'machine/'+p.name+'.json'})),
          filament_list:rawOrca.filter(p=>p.type==='filament').map(p=>({name:p.name,sub_path:'filament/'+p.name+'.json'})),
          process_list:rawOrca.filter(p=>p.type==='process').map(p=>({name:p.name,sub_path:'process/'+p.name+'.json'})),
        },
        files:Object.fromEntries(rawOrca.map(p=>[p.type+'/'+p.name+'.json',p])),
    };
    const uploadRawOrca=async()=>prepare.locator('#lab-orca-profiles').setInputFiles({
      name:'orca-records.json',mimeType:'application/json',
      buffer:Buffer.from(JSON.stringify(indexedRawOrca)),
    });
    await uploadRawOrca();
    await prepare.locator('#lab-orca-machine').fill('TestPrinter 0.4 nozzle');
    await prepare.locator('#lab-orca-filament').fill('Generic PLA @TestPrinter');
    await prepare.locator('#lab-orca-process').fill('0.16 Fine @TestPrinter');
    await prepare.locator('#lab-slice').click();
    await prepare.waitForFunction(() => {
      const text=document.querySelector('#lab-status')?.textContent || '';
      return text.startsWith('PASS:') || text.startsWith('FAILED');
    },null,{timeout:120000});
    const nativeStatus=await prepare.locator('#lab-status').innerText();
    assert.ok(nativeStatus.startsWith('PASS: 2 STL model(s)'),nativeStatus);
    assert.match(nativeStatus,/Orca raw preset selection/);
    assert.match(nativeStatus,/3 unsupported keys excluded/);
    const nativeHash=await prepare.locator('#lab-download').evaluate(async link=>{
      const digest=await crypto.subtle.digest('SHA-256',await(await fetch(link.href)).arrayBuffer());
      return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
    });
    assert.notEqual(nativeHash,inheritedHash,'Three-domain raw Orca settings must change WASM output');
    console.log('PASS: indexed Orca vendor machine+filament+process inheritance → WASM G-code');

    // These two real Orca process options were previously discarded as
    // unsupported. Confirm that an inherited bounded override changes the
    // sliced MOTION commands, not only G-code configuration comments.
    const baselineShellGcode=await prepare.locator('#lab-download').evaluate(async link=>
      await(await fetch(link.href)).text());
    rawOrca[4].top_shell_layers='5';
    rawOrca[4].bottom_shell_layers='4';
    await uploadRawOrca();
    await prepare.locator('#lab-slice').click();
    await prepare.waitForFunction(() => {
      const text=document.querySelector('#lab-status')?.textContent||'';
      return text.startsWith('PASS:')||text.startsWith('FAILED');
    },null,{timeout:120000});
    const shellStatus=await prepare.locator('#lab-status').innerText();
    assert.match(shellStatus,/^PASS: 2 STL model\(s\)/);
    assert.match(shellStatus,/3 unsupported keys excluded/);
    const shellGcode=await prepare.locator('#lab-download').evaluate(async link=>
      await(await fetch(link.href)).text());
    const motionOnly=text=>text.split(/\r?\n/).map(line=>line.split(';')[0].trim())
      .filter(line=>/^(?:N\d+\s+)?G[0123]\b/i.test(line));
    assert.notDeepEqual(motionOnly(shellGcode),motionOnly(baselineShellGcode),
      'Inherited top/bottom solid shell settings must affect actual WASM movement, not only comments');
    console.log('PASS: inherited Orca top/bottom shell counts change WASM G-code motion commands');
    delete rawOrca[4].top_shell_layers;
    delete rawOrca[4].bottom_shell_layers;
    await uploadRawOrca();

    // A source-pinned CR-10 process uses absolute line_width=0.42 mm.
    // The restricted localhost adapter accepts only millimetres; prove the
    // real engine changes deposited motion, not just a header or JSON echo.
    const sliceWithLineWidth=async (width,key='line_width')=>{
      rawOrca[4][key]=width;
      await uploadRawOrca();
      await prepare.locator('#lab-slice').click();
      await prepare.waitForFunction(()=>{
        const state=document.querySelector('#lab-status')?.textContent||'';
        return state.startsWith('PASS:')||state.startsWith('FAILED');
      },null,{timeout:120000});
      assert.match(await prepare.locator('#lab-status').innerText(),/^PASS: 2 STL model\(s\)/);
      return prepare.locator('#lab-download').evaluate(async link=>
        await(await fetch(link.href)).text());
    };

    // Source-pinned CR-10 child explicitly uses ensure_all; demonstrate that
    // the localhost-isolated WASM engine accepts the exact enum and generates
    // actual positive-E XY deposition. This does NOT prove a geometry change:
    // the current two-STL fixture lacks a controlled sloped-wall witness.
    const protectedShell=await sliceWithLineWidth('ensure_all',
      'ensure_vertical_shell_thickness');
    const protectedPaths=parseGcodeToolpaths(protectedShell);
    assert.equal(protectedPaths.skippedMalformedMotion,0,
      'Protected-shell proof cannot accept malformed movements');
    assert.ok(protectedPaths.layers.flatMap(l=>l.segments)
      .filter(s=>s.extrusion && Number.isFinite(s.commandedPositiveEMm)
        && s.commandedPositiveEMm>0 &&
        Math.hypot(s.x2-s.x1,s.y2-s.y1)>0.0001).length>100,
      'Native vertical-shell enum must be accepted by real WASM slicing with genuine XY deposition');
    delete rawOrca[4].ensure_vertical_shell_thickness;
    await uploadRawOrca();
    console.log('PASS: source-pinned vertical shell ensure_all accepted by isolated WASM (no path-parity claim)');

    // Source-pinned native PrintConfig.cpp includes both monotonic and
    // rectilinear for INTERNAL SOLID infill; the CR-10 child selects monotonic.
    // Hold the exact same two-STL scene and other settings constant. Accept
    // only actual feature-tagged horizontal, positive-filament-E G1 XY strokes;
    // a changed header/hash or a sparse/top-surface path must not pass.
    const monotonicSolid=await sliceWithLineWidth('monotonic','internal_solid_infill_pattern');
    const rectilinearSolid=await sliceWithLineWidth('rectilinear','internal_solid_infill_pattern');
    const internalSolidDeposition=code=>{
      const parsed=parseGcodeToolpaths(code);
      assert.equal(parsed.skippedMalformedMotion,0,
        'Internal solid comparison cannot ignore malformed motion');
      assert.equal(parsed.skippedArcs,0,
        'Internal solid comparison cannot silently omit arcs');
      return parsed.layers.flatMap(layer=>layer.segments)
        .filter(s=>s.extrusion && s.feature==='internal solid infill'
          && Number.isFinite(s.commandedPositiveEMm) && s.commandedPositiveEMm>0
          && Number.isFinite(s.z1) && Number.isFinite(s.z2)
          && Math.abs(s.z1-s.z2)<1e-7
          && Math.hypot(s.x2-s.x1,s.y2-s.y1)>0.0001)
        .map(s=>[s.x1,s.y1,s.x2,s.y2,s.z2].map(n=>
          Math.round(n*1000)/1000).join(','));
    };
    const solidMonotonicPaths=internalSolidDeposition(monotonicSolid);
    const solidRectilinearPaths=internalSolidDeposition(rectilinearSolid);
    assert.ok(solidMonotonicPaths.length>10 && solidRectilinearPaths.length>10,
      'Both native internal solid patterns require real tagged positive-E XY deposition: '
        +solidMonotonicPaths.length+'/'+solidRectilinearPaths.length);
    assert.notDeepEqual(solidMonotonicPaths,solidRectilinearPaths,
      'Internal solid monotonic vs rectilinear must change tagged deposition stroke sequence, not only metadata');
    await writeFile(parityDir+'/internal-solid-pattern-deposition.json',
      JSON.stringify({
        fixture:'same isolated two-STL Prepare scene; generic PLA; diagnostic only',
        native_key:'internal_solid_infill_pattern',
        baseline:'monotonic',candidate:'rectilinear',
        feature:'internal solid infill',
        baseline_tagged_positive_e_xy_strokes:solidMonotonicPaths.length,
        candidate_tagged_positive_e_xy_strokes:solidRectilinearPaths.length,
        tagged_stroke_sequence_changed:true,
        full_native_profile_parity:false,printer_safe:false,public_pages_enabled:false
      },null,2)+'\n');
    delete rawOrca[4].internal_solid_infill_pattern;
    await uploadRawOrca();
    console.log('PASS: native internal solid monotonic/rectilinear changes real feature-tagged WASM G1 deposition sequence');

    // Independent v2.5.0 top/bottom surface patterns from the pinned CR-10
    // child. This is a real two-STL localhost engine acceptance witness,
    // not yet a controlled per-feature pattern-response or native parity test.
    for (const [surfaceKey,token] of [
      ['top_surface_pattern','monotonic'],
      ['bottom_surface_pattern','monotonic']
    ]) {
      const surfaceCode=await sliceWithLineWidth(token,surfaceKey);
      const surfacePaths=parseGcodeToolpaths(surfaceCode);
      assert.equal(surfacePaths.skippedMalformedMotion,0,
        'Native surface pattern acceptance must not skip malformed G-code');
      assert.ok(surfacePaths.layers.flatMap(l=>l.segments)
        .filter(seg=>seg.extrusion && Number.isFinite(seg.commandedPositiveEMm)
          && seg.commandedPositiveEMm>0 &&
          Math.hypot(seg.x2-seg.x1,seg.y2-seg.y1)>0.0001).length>100,
        surfaceKey+' must generate real deposited XY motion in isolated Chrome');
      delete rawOrca[4][surfaceKey];
      await uploadRawOrca();
    }
    console.log('PASS: native top/bottom surface skin pattern values accepted in real isolated WASM');
    // Diagnostic follow-up: unlike the source-pinned ingestion test above,
    // compare real tagged outer-skin positive-E XY paths on an IDENTICAL
    // two-STL scene, changing exactly one enum at a time. Monotonic is the
    // official CR-10 child token; rectilinear is another native coEnum token.
    // Record a missing/no-change effect as inconclusive, never as a parity PASS.
    for (const [surfaceKey,feature] of [
      ['top_surface_pattern','top surface'],
      ['bottom_surface_pattern','bottom surface'],
    ]) {
      const monotonic=await sliceWithLineWidth('monotonic',surfaceKey);
      const rectilinear=await sliceWithLineWidth('rectilinear',surfaceKey);
      const audit=auditSurfaceSkinPattern(
        parseGcodeToolpaths(monotonic),parseGcodeToolpaths(rectilinear),feature);
      assert.ok(audit.baseline.all_feature_positive_e_xy_strokes>100 &&
        audit.candidate.all_feature_positive_e_xy_strokes>100,
        surfaceKey+' A/B runs must both contain actual WASM planar positive-E XY motion');
      const report={
        fixture:'identical two STL objects, fixed other development-profile keys',
        engine:'pinned v2.5.0 WASM; isolated localhost opt-in',
        changed_native_key:surfaceKey,baseline:'monotonic',candidate:'rectilinear',
        ...audit
      };
      await writeFile(parityDir+'/'+surfaceKey.replaceAll('_','-')+'-deposition.json',
        JSON.stringify(report,null,2)+'\n');
      console.log('SURFACE_SKIN_PATTERN_DIAGNOSTIC '+JSON.stringify(report));
      // The pinned candidate/fixture has now demonstrated changes in both
      // independent outer-skin roles. Treat a lost/missing tag or an unchanged
      // geometry signature as a regression, not as a silently green smoke.
      assert.equal(audit.result,'observed_tagged_skin_geometry_difference',
        surfaceKey+' must change genuine tagged skin geometry: '+JSON.stringify(report));
      assert.equal(audit.changed_geometry_z_count>0,true,
        surfaceKey+' must have at least one changed deposited Z stratum');
      console.log('PASS: '+surfaceKey+' changes exact feature-tagged skin XY geometry (not desktop parity)');
      delete rawOrca[4][surfaceKey];
      await uploadRawOrca();
    }

    // Pinned GCode.cpp multiplies erBottomSurface extrusion by this scalar.
    // Compare actual positive E per XY mm, not metadata, against an
    // independent top-surface control. Keep the single-nozzle scene fixed.
    {
      const key='bottom_solid_infill_flow_ratio', prior=rawOrca[4][key];
      try {
        const measure=code=>{
          const p=parseGcodeToolpaths(code);
          assert.equal(p.skippedMalformedMotion,0);
          assert.equal(p.skippedArcs,0);
          const roles=Object.fromEntries(['bottom surface','top surface'].map(role=>
            [role,{strokes:0,xy_mm:0,e_mm:0}]));
          for(const layer of p.layers)for(const seg of layer.segments){
            if(!Object.hasOwn(roles,seg.feature)||!seg.extrusion)continue;
            assert.equal(seg.sourceMotion,'G1');
            assert.ok([seg.x1,seg.x2,seg.y1,seg.y2,seg.z1,seg.z2,seg.commandedPositiveEMm].every(Number.isFinite));
            assert.ok(seg.commandedPositiveEMm>0);
            const len=Math.hypot(seg.x2-seg.x1,seg.y2-seg.y1);
            if(Math.abs(seg.z2-seg.z1)>0.0005||len<0.001)continue;
            const v=roles[seg.feature];v.strokes++;v.xy_mm+=len;v.e_mm+=seg.commandedPositiveEMm;
          }
          for(const v of Object.values(roles)){
            assert.ok(v.strokes>=12&&v.xy_mm>0&&v.e_mm>0,'Need real tagged skin deposition');
            v.e_per_xy_mm=v.e_mm/v.xy_mm;
          }
          return roles;
        };
        const base=measure(await sliceWithLineWidth('1',key));
        const reduced=measure(await sliceWithLineWidth('0.75',key));
        const ratio=role=>reduced[role].e_per_xy_mm/base[role].e_per_xy_mm;
        const report={base,reduced,bottom_ratio:ratio('bottom surface'),
          top_ratio:ratio('top surface'),desktop_native_parity:false,printer_ready:false};
        await writeFile(parityDir+'/bottom-surface-flow.json',JSON.stringify(report,null,2)+'\n');
        console.log('WASM_BOTTOM_SURFACE_FLOW '+JSON.stringify(report));
        for(const role of Object.keys(base)){
          assert.ok(Math.abs(reduced[role].xy_mm/base[role].xy_mm-1)<0.005,
            role+' XY length must remain within 0.5%');
        }
        assert.ok(Math.abs(report.bottom_ratio-0.75)<0.02,'Bottom positive E/XY must track flow multiplier');
        assert.ok(Math.abs(report.top_ratio-1)<0.02,'Top positive E/XY must remain independent');
        console.log('PASS: bottom surface flow changes real tagged E/XY without changing top flow');
      } finally {
        if(prior===undefined)delete rawOrca[4][key];else rawOrca[4][key]=prior;
        await uploadRawOrca();
      }
    }

    // Pinned top flow is a nullable nozzle option, unlike bottom scalar.
    // Compare actual tagged deposition on the single-tool fixture.
    {
      const key='top_solid_infill_flow_ratio', prior=rawOrca[4][key];
      try {
        const measure=code=>{
          const p=parseGcodeToolpaths(code);
          assert.equal(p.skippedMalformedMotion,0);
          assert.equal(p.skippedArcs,0);
          const roles=Object.fromEntries(['bottom surface','top surface'].map(role=>
            [role,{strokes:0,xy_mm:0,e_mm:0}]));
          for(const layer of p.layers)for(const seg of layer.segments){
            if(!Object.hasOwn(roles,seg.feature)||!seg.extrusion)continue;
            assert.equal(seg.sourceMotion,'G1');
            assert.ok([seg.x1,seg.x2,seg.y1,seg.y2,seg.z1,seg.z2,seg.commandedPositiveEMm].every(Number.isFinite));
            assert.ok(seg.commandedPositiveEMm>0);
            const len=Math.hypot(seg.x2-seg.x1,seg.y2-seg.y1);
            if(Math.abs(seg.z2-seg.z1)>0.0005||len<0.001)continue;
            const v=roles[seg.feature];v.strokes++;v.xy_mm+=len;v.e_mm+=seg.commandedPositiveEMm;
          }
          for(const v of Object.values(roles)){
            assert.ok(v.strokes>=12&&v.xy_mm>0&&v.e_mm>0,'Need real tagged skin deposition');
            v.e_per_xy_mm=v.e_mm/v.xy_mm;
          }
          return roles;
        };
        const base=measure(await sliceWithLineWidth('1',key));
        const reduced=measure(await sliceWithLineWidth(['0.75'],key));
        const ratio=role=>reduced[role].e_per_xy_mm/base[role].e_per_xy_mm;
        const report={base,reduced,bottom_ratio:ratio('bottom surface'),
          top_ratio:ratio('top surface'),desktop_native_parity:false,printer_ready:false};
        await writeFile(parityDir+'/top-surface-flow.json',JSON.stringify(report,null,2)+'\n');
        console.log('WASM_TOP_SURFACE_FLOW '+JSON.stringify(report));
        for(const role of Object.keys(base)){
          assert.ok(Math.abs(reduced[role].xy_mm/base[role].xy_mm-1)<0.005,
            role+' XY length must remain within 0.5%');
        }
        assert.ok(Math.abs(report.top_ratio-0.75)<0.02,'Top positive E/XY must track nozzle multiplier');
        assert.ok(Math.abs(report.bottom_ratio-1)<0.02,'Bottom positive E/XY must remain independent');
        console.log('PASS: top surface nozzle flow changes actual E/XY without changing bottom flow');
      } finally {
        if(prior===undefined)delete rawOrca[4][key];else rawOrca[4][key]=prior;
        await uploadRawOrca();
      }
    }

    // Simultaneous scalar bottom and single-slot top flow: factorial
    // witness, with the walls as an independent negative control. Compare
    // actual unoriented XYZ stroke multisets, not just total path length.
    {
      const bottomKey='bottom_solid_infill_flow_ratio';
      const topKey='top_solid_infill_flow_ratio';
      const prior=Object.fromEntries([bottomKey,topKey].map(k=>[k,rawOrca[4][k]]));
      try {
        const measure=code=>{
          const p=parseGcodeToolpaths(code);
          assert.equal(p.skippedMalformedMotion,0);
          assert.equal(p.skippedArcs,0);
          const roles=Object.fromEntries(['bottom surface','top surface','outer wall','inner wall']
            .map(role=>[role,{strokes:0,xy_mm:0,e_mm:0,geometry:[]}]));
          for(const layer of p.layers)for(const seg of layer.segments){
            if(!Object.hasOwn(roles,seg.feature)||!seg.extrusion)continue;
            assert.equal(seg.sourceMotion,'G1');
            const xyz=[seg.x1,seg.y1,seg.z1,seg.x2,seg.y2,seg.z2];
            assert.ok([...xyz,seg.commandedPositiveEMm].every(Number.isFinite));
            assert.ok(seg.commandedPositiveEMm>0);
            const len=Math.hypot(seg.x2-seg.x1,seg.y2-seg.y1);
            if(Math.abs(seg.z2-seg.z1)>0.0005||len<0.001)continue;
            const points=[xyz.slice(0,3),xyz.slice(3)].map(point=>
              point.map(v=>Math.round(v*1000)).join(',')).sort();
            const v=roles[seg.feature];
            v.strokes++;v.xy_mm+=len;v.e_mm+=seg.commandedPositiveEMm;
            v.geometry.push(points.join('/'));
          }
          for(const v of Object.values(roles)){
            assert.ok(v.strokes>=12&&v.xy_mm>0&&v.e_mm>0,'Need actual skin and wall deposition');
            v.geometry.sort();
            v.e_per_xy_mm=v.e_mm/v.xy_mm;
          }
          return roles;
        };
        const slice=async(bottom,top)=>{
          rawOrca[4][bottomKey]=bottom;
          return measure(await sliceWithLineWidth([top],topKey));
        };
        const base=await slice('1','1');
        const bottomOnly=await slice('0.75','1');
        const topOnly=await slice('1','1.25');
        const combined=await slice('0.75','1.25');
        const results={};
        for(const [label,run,expectedBottom,expectedTop] of [
          ['bottom_only',bottomOnly,0.75,1],
          ['top_only',topOnly,1,1.25],
          ['combined',combined,0.75,1.25]
        ]){
          results[label]={};
          for(const role of Object.keys(base)){
            const b=base[role],v=run[role];
            const expected=role==='bottom surface'?expectedBottom:role==='top surface'?expectedTop:1;
            const ratio=v.e_per_xy_mm/b.e_per_xy_mm;
            const geometryEqual=v.geometry.length===b.geometry.length&&
              v.geometry.every((stroke,i)=>stroke===b.geometry[i]);
            results[label][role]={strokes:v.strokes,xy_mm:v.xy_mm,e_mm:v.e_mm,
              ratio,expected,geometry_equal:geometryEqual};
          }
        }
        const report={fixture:'same two STL controls; explicit bottom scalar and top one-slot array',
          base:Object.fromEntries(Object.entries(base).map(([role,{geometry,...metrics}])=>[role,metrics])),
          results,desktop_native_parity:false,printer_ready:false};
        await writeFile(parityDir+'/combined-surface-flow.json',JSON.stringify(report,null,2)+'\n');
        console.log('WASM_COMBINED_SURFACE_FLOW '+JSON.stringify(report));
        for(const [label,roles] of Object.entries(results))for(const [role,v] of Object.entries(roles)){
          assert.ok(v.geometry_equal,label+' '+role+' must preserve unoriented XYZ geometry at 1 um');
          assert.ok(Math.abs(v.ratio-v.expected)<0.02,label+' '+role+' E/XY must track independent multiplier');
        }
        console.log('PASS: simultaneous top/bottom flow independently changes real tagged E/XY with unchanged wall controls');
      } finally {
        for(const key of [bottomKey,topKey]){
          if(prior[key]===undefined)delete rawOrca[4][key];else rawOrca[4][key]=prior[key];
        }
        await uploadRawOrca();
      }
    }

    // Native 2.5.0 thickness settings are a minimum solid depth in mm,
    // independent of top/bottom solid-layer counts. Use one-layer shells
    // and contrast 0 mm (off) vs 1.6 mm (on) over the SAME two-STL scene.
    // Require real positive-E toolpath geometry, never header/hash alone.
    rawOrca[4].top_shell_layers='1';
    rawOrca[4].bottom_shell_layers='1';
    rawOrca[4].sparse_infill_density='15%';
    const thinShell=await sliceWithLineWidth('0','top_shell_thickness');
    const thickShell=await sliceWithLineWidth('1.6','top_shell_thickness');
    const realDepositedStrokes=gcode=>{
      const parsed=parseGcodeToolpaths(gcode);
      assert.equal(parsed.skippedMalformedMotion,0,'Cannot compare malformed shell toolpaths');
      assert.equal(parsed.skippedArcs,0,'Cannot silently discard shell arcs');
      return parsed.layers.flatMap(l=>l.segments).filter(s=>s.extrusion &&
        Number.isFinite(s.commandedPositiveEMm) && s.commandedPositiveEMm>0 &&
        Math.hypot(s.x2-s.x1,s.y2-s.y1)>1e-5).map(s=>
          [s.feature,s.z2,s.x1,s.y1,s.x2,s.y2].map(x=>typeof x==='number'
            ? Math.round(x*1000)/1000 : x).join(','));
    };
    const thinStrokes=realDepositedStrokes(thinShell);
    const thickStrokes=realDepositedStrokes(thickShell);
    assert.ok(thinStrokes.length>100 && thickStrokes.length>100,
      'Both shell thickness tests require substantial deposited lines');
    assert.notDeepEqual(thinStrokes,thickStrokes,
      'Minimum top thickness 0 -> 1.6 mm must change real deposited XY G1 paths');
    delete rawOrca[4].top_shell_thickness;
    delete rawOrca[4].top_shell_layers;
    delete rawOrca[4].bottom_shell_layers;
    delete rawOrca[4].sparse_infill_density;
    await uploadRawOrca();
    console.log('PASS: minimum top shell thickness changes actual isolated Chrome/WASM deposited XY toolpaths');

    // The official CR-10 bottom_shell_thickness=0 means "no minimum floor",
    // not "remove the bottom". Exercise the independent minimum explicitly
    // with both solid-layer counts fixed to one and top thickness fixed at 0.
    // Only deposited, planar, positive-E XY paths in the first 1.6 mm count;
    // upper-layer differences or configuration/header echoes cannot pass.
    rawOrca[4].top_shell_layers='1';
    rawOrca[4].bottom_shell_layers='1';
    rawOrca[4].top_shell_thickness='0';
    rawOrca[4].sparse_infill_density='15%';
    const bottomFloorOff=await sliceWithLineWidth('0','bottom_shell_thickness');
    const bottomFloorOn=await sliceWithLineWidth('1.6','bottom_shell_thickness');
    const bottomLayerStrokes=gcode=>{
      const parsed=parseGcodeToolpaths(gcode);
      assert.equal(parsed.skippedMalformedMotion,0,
        'Bottom shell probe cannot ignore malformed motion');
      assert.equal(parsed.skippedArcs,0,
        'Bottom shell probe cannot silently ignore arc deposition');
      const layers=new Map();
      for(const layer of parsed.layers)for(const s of layer.segments){
        if(!s.extrusion || !Number.isFinite(s.commandedPositiveEMm) ||
          s.commandedPositiveEMm<=0 || !Number.isFinite(s.z1) ||
          !Number.isFinite(s.z2) || Math.abs(s.z1-s.z2)>1e-6 ||
          s.z2>1.600001 || ![s.x1,s.y1,s.x2,s.y2].every(Number.isFinite) ||
          Math.hypot(s.x2-s.x1,s.y2-s.y1)<=1e-5)continue;
        const z=Math.round(s.z2*1000)/1000;
        const stroke=[s.feature||'(unlabelled)',s.x1,s.y1,s.x2,s.y2]
          .map(v=>typeof v==='number'?Math.round(v*1000)/1000:v).join(',');
        if(!layers.has(z))layers.set(z,[]);
        layers.get(z).push(stroke);
      }
      return [...layers.entries()].sort((a,b)=>a[0]-b[0])
        .map(([z,strokes])=>({z,strokes:strokes.sort()}));
    };
    const bottomOffLayers=bottomLayerStrokes(bottomFloorOff);
    const bottomOnLayers=bottomLayerStrokes(bottomFloorOn);
    const offCount=bottomOffLayers.reduce((n,l)=>n+l.strokes.length,0);
    const onCount=bottomOnLayers.reduce((n,l)=>n+l.strokes.length,0);
    assert.ok(bottomOffLayers.length>=4 && bottomOnLayers.length>=4 &&
      offCount>100 && onCount>100,
      'Both bottom shell slices need substantial real XY+E paths near the build plate');
    const offByZ=new Map(bottomOffLayers.map(l=>[l.z,l.strokes]));
    const onByZ=new Map(bottomOnLayers.map(l=>[l.z,l.strokes]));
    const changedBottomZ=[...new Set([...offByZ.keys(),...onByZ.keys()])]
      .sort((a,b)=>a-b).filter(z=>
        JSON.stringify(offByZ.get(z)||[])!==JSON.stringify(onByZ.get(z)||[]));
    const bottomShellReport={
      fixture:'same two-STL localhost-only scene; generic test PLA',
      changed_native_key:'bottom_shell_thickness',baseline_mm:0,candidate_mm:1.6,
      fixed_top_shell_thickness_mm:0,fixed_top_shell_layers:1,
      fixed_bottom_shell_layers:1,fixed_sparse_infill_density_percent:15,
      inspected_deposition_z_max_mm:1.6,
      baseline_inspected_layers:bottomOffLayers.length,
      candidate_inspected_layers:bottomOnLayers.length,
      baseline_positive_e_xy_strokes:offCount,
      candidate_positive_e_xy_strokes:onCount,
      changed_deposition_z_mm:changedBottomZ,
      native_desktop_parity:false,print_safe:false,public_pages_enabled:false,
    };
    await writeFile(parityDir+'/bottom-shell-thickness-deposition.json',
      JSON.stringify(bottomShellReport,null,2)+'\n');
    console.log('BOTTOM_SHELL_THICKNESS_DEPOSITION '+JSON.stringify(bottomShellReport));
    assert.ok(changedBottomZ.some(z=>z>0.300001 && z<=1.600001),
      'Bottom thickness 0 -> 1.6 mm must change genuine XY+E paths ABOVE the first layer and near the bed: '+
      JSON.stringify(bottomShellReport));
    for(const key of ['bottom_shell_thickness','top_shell_thickness',
      'top_shell_layers','bottom_shell_layers','sparse_infill_density'])
      delete rawOrca[4][key];
    await uploadRawOrca();
    console.log('PASS: independent minimum bottom shell thickness changes deposited lower-layer XY paths');

    // The pinned 0.20mm CR-10 child specifies skirt_loops=2. On the same
    // two-STL isolated scene, compare actual G0/G1 paths with only skirt count
    // changed (0 -> 2). A settings echo, G-code comment or SHA is insufficient.
    const skirtOffMotion=motionOnly(await sliceWithLineWidth('0','skirt_loops'));
    const skirtOnMotion=motionOnly(await sliceWithLineWidth('2','skirt_loops'));
    assert.ok(skirtOffMotion.length>100&&skirtOnMotion.length>100,
      'Skirt probe requires substantive real G-code paths');
    assert.ok(skirtOnMotion.length>skirtOffMotion.length,
      'Two skirt loops must add G0/G1 movements rather than only metadata');
    assert.notDeepEqual(skirtOffMotion,skirtOnMotion,
      'Native skirt_loops must change isolated WASM motion commands');
    delete rawOrca[4].skirt_loops;
    await uploadRawOrca();
    console.log('PASS: source-pinned skirt_loops 0 -> 2 adds real WASM G-code moves');

    // Keep two source-pinned loops on the same two-STL bed and change ONLY
    // skirt_distance (upstream coFloat, mm). Verify actual G0/G1 trajectories,
    // not profile comments, metadata echoes, or G-code hashes.
    rawOrca[4].skirt_loops='2';
    const nearSkirtGcode=await sliceWithLineWidth('1','skirt_distance');
    const farSkirtGcode=await sliceWithLineWidth('8','skirt_distance');
    const nearSkirtMotion=motionOnly(nearSkirtGcode);
    const farSkirtMotion=motionOnly(farSkirtGcode);
    assert.ok(nearSkirtMotion.length>100&&farSkirtMotion.length>100,
      'Skirt distance test needs substantive real WASM paths');
    assert.notDeepEqual(nearSkirtMotion,farSkirtMotion,
      'Native skirt_distance 1 -> 8 mm must alter real G0/G1 paths, not only metadata');
    // Independent geometric witness: only explicit Skirt-tagged positive-E
    // planar XY paths count. Exclude header echoes, prime lines and travel.
    const skirtGeometry=auditWasmSkirtDistance(
      parseGcodeToolpaths(nearSkirtGcode),parseGcodeToolpaths(farSkirtGcode));
    console.log('WASM_SKIRT_DISTANCE_GEOMETRY '+JSON.stringify(skirtGeometry));
    await writeFile(parityDir+'/skirt-distance-geometry.json',
      JSON.stringify({fixture:'two synthetic STLs; localhost only; 2 skirts; 1 vs 8 mm',
        ...skirtGeometry},null,2)+'\n');
    assert.equal(skirtGeometry.passed,true,
      'Skirt-tagged deposited XY envelope did not expand with skirt_distance');
    delete rawOrca[4].skirt_distance;
    delete rawOrca[4].skirt_loops;
    await uploadRawOrca();
    console.log('PASS: source-pinned skirt_distance 1 -> 8 mm changes real WASM motion G-code');

    // Fixed two-STL plate and two loops, 2mm skirt distance; vary ONLY
    // native skirt_height 1 vs 3. Count actual positive-E, Skirt-tagged
    // horizontal XY deposition by Z; travel, comments, and non-skirt
    // extrusions must not be counted as evidence.
    rawOrca[4].skirt_loops='2';
    rawOrca[4].skirt_distance='2';
    const skirtOne=await sliceWithLineWidth('1','skirt_height');
    const skirtThree=await sliceWithLineWidth('3','skirt_height');
    const depositedSkirtLayers=gcode=>{
      const parsed=parseGcodeToolpaths(gcode);
      assert.equal(parsed.skippedArcs,0,'Cannot verify skirt height when arcs are skipped');
      assert.equal(parsed.skippedMalformedMotion,0,'Cannot verify skirt height with malformed motion');
      const byZ=new Map();
      for(const layer of parsed.layers)for(const s of layer.segments){
        if(s.feature!=='skirt'||s.extrusion!==true||!Number.isFinite(s.z1)||
           !Number.isFinite(s.z2)||Math.abs(s.z2-s.z1)>0.0005||
           Math.hypot(s.x2-s.x1,s.y2-s.y1)<=1e-6)continue;
        const key=(Math.round(s.z2*1000)/1000).toFixed(3);
        const record=byZ.get(key)||{segments:0,bounds:[[Infinity,-Infinity],[Infinity,-Infinity]]};
        record.segments++;
        for(const pt of [[s.x1,s.y1],[s.x2,s.y2]])for(let axis=0;axis<2;axis++){
          record.bounds[axis][0]=Math.min(record.bounds[axis][0],pt[axis]);
          record.bounds[axis][1]=Math.max(record.bounds[axis][1],pt[axis]);
        }
        byZ.set(key,record);
      }
      return [...byZ].sort((a,b)=>Number(a[0])-Number(b[0]));
    };
    const shortSkirt=depositedSkirtLayers(skirtOne);
    const tallSkirt=depositedSkirtLayers(skirtThree);
    const sameFirst=shortSkirt.length>0&&tallSkirt.length>0&&
      shortSkirt[0][0]===tallSkirt[0][0]&&
      [0,1].every(a=>[0,1].every(b=>
        Math.abs(shortSkirt[0][1].bounds[a][b]-tallSkirt[0][1].bounds[a][b])<=0.1));
    const skirtHeightWitness={short_layers_mm:shortSkirt.map(x=>Number(x[0])),
      tall_layers_mm:tallSkirt.map(x=>Number(x[0])),
      short_segments:shortSkirt.map(x=>x[1].segments),
      tall_segments:tallSkirt.map(x=>x[1].segments),
      same_first_layer_envelope:sameFirst,parity_pass:false};
    console.log('WASM_SKIRT_HEIGHT_DEPOSITION '+JSON.stringify(skirtHeightWitness));
    await writeFile(parityDir+'/skirt-height-deposition.json',
      JSON.stringify({fixture:'two synthetic STLs; 2 loops; 2 mm distance; 1 vs 3 layers',
        ...skirtHeightWitness},null,2)+'\n');
    assert.equal(shortSkirt.length,1,'One-layer skirt must deposit on exactly one Z level');
    assert.equal(tallSkirt.length,3,'Three-layer skirt must deposit on exactly three Z levels');
    assert.ok(shortSkirt.every(x=>x[1].segments>=4)&&tallSkirt.every(x=>x[1].segments>=4),
      'Require multiple genuinely deposited segments on every Skirt-tagged level');
    assert.ok(sameFirst,'Skirt height must preserve first-layer XY envelope');
    delete rawOrca[4].skirt_height;
    delete rawOrca[4].skirt_distance;
    delete rawOrca[4].skirt_loops;
    await uploadRawOrca();
    console.log('PASS: isolated WASM skirt_height adds real Skirt-tagged deposited Z levels');

    // Pinned CR-10 0.20mm process specifies native skirt_speed=20 mm/s.
    // Keep scene, loop count, distance and height constant. Only this
    // absolute speed changes to 3 mm/s. A header-only difference cannot pass.
    rawOrca[4].skirt_loops='2';
    rawOrca[4].skirt_distance='2';
    rawOrca[4].skirt_height='1';
    const normalSkirtSpeed=await sliceWithLineWidth('20','skirt_speed');
    const slowSkirtSpeed=await sliceWithLineWidth('3','skirt_speed');
    const skirtSpeedWitness=code=>{
      const parsed=parseGcodeToolpaths(code);
      assert.equal(parsed.skippedArcs,0,'Skirt speed audit must parse every arc');
      assert.equal(parsed.skippedMalformedMotion,0,'Skirt speed audit must parse every motion');
      const deposited=parsed.layers.flatMap(layer=>layer.segments).filter(s=>
        s.feature==='skirt' && s.extrusion===true &&
        Number.isFinite(s.z1) && Number.isFinite(s.z2) &&
        Math.abs(s.z2-s.z1)<0.0005 &&
        Math.hypot(s.x2-s.x1,s.y2-s.y1)>0.000001);
      assert.ok(deposited.length>=8,'Need genuine tagged skirt deposition, not comments/travel');
      assert.ok(deposited.every(s=>Number.isFinite(s.feedrateMmMin)&&s.feedrateMmMin>0),
        'Missing commanded F on skirt deposition');
      const bounds=[Infinity,-Infinity,Infinity,-Infinity];
      let xyLength=0;
      const feedrates=new Set();
      for(const s of deposited){
        xyLength+=Math.hypot(s.x2-s.x1,s.y2-s.y1);
        bounds[0]=Math.min(bounds[0],s.x1,s.x2);
        bounds[1]=Math.max(bounds[1],s.x1,s.x2);
        bounds[2]=Math.min(bounds[2],s.y1,s.y2);
        bounds[3]=Math.max(bounds[3],s.y1,s.y2);
        feedrates.add(Math.round(s.feedrateMmMin*100)/100);
      }
      return {segments:deposited.length,xy_length_mm:xyLength,
        xy_bounds_mm:bounds,feedrates_mm_min:[...feedrates].sort((a,b)=>a-b)};
    };
    const normalSkirt=skirtSpeedWitness(normalSkirtSpeed);
    const slowSkirt=skirtSpeedWitness(slowSkirtSpeed);
    assert.equal(slowSkirt.segments,normalSkirt.segments,
      'Changing only skirt speed should preserve deposited segment count');
    assert.ok(Math.abs(slowSkirt.xy_length_mm-normalSkirt.xy_length_mm)<=0.02,
      'Speed-only override changed geometric skirt path length');
    assert.ok(slowSkirt.xy_bounds_mm.every((v,i)=>
      Math.abs(v-normalSkirt.xy_bounds_mm[i])<=0.05),
      'Speed-only override changed skirt XY envelope');
    const newlySlow=slowSkirt.feedrates_mm_min.filter(f=>f>0&&f<=240&&
      !normalSkirt.feedrates_mm_min.some(b=>Math.abs(b-f)<0.01));
    const skirtSpeedDiagnostic={fixture:'two synthetic STL; 2 skirt loops; 2mm distance; 1 layer',
      baseline_speed_mm_s:20,experiment_speed_mm_s:3,
      baseline:normalSkirt,experiment:slowSkirt,new_low_feedrates_mm_min:newlySlow,
      desktop_native_parity:false,printer_ready:false};
    console.log('WASM_SKIRT_SPEED_DEPOSITION '+JSON.stringify(skirtSpeedDiagnostic));
    await writeFile(parityDir+'/skirt-speed-deposition.json',
      JSON.stringify(skirtSpeedDiagnostic,null,2)+'\n');
    assert.ok(newlySlow.length>0,
      'Skirt speed 3 mm/s must introduce a new slower F on genuinely deposited skirt-tagged XY paths');
    delete rawOrca[4].skirt_speed;
    delete rawOrca[4].skirt_height;
    delete rawOrca[4].skirt_distance;
    delete rawOrca[4].skirt_loops;
    await uploadRawOrca();
    console.log('PASS: native skirt_speed independently changes actual skirt-tagged positive-E XY feedrate');

    // Source-pinned CR-10 v2.5.0 has a native 45-degree infill direction.
    // Hold two-STL geometry, 35% density and grid pattern constant; change
    // only infill_direction. Metadata/header/hash-only changes cannot pass.
    rawOrca[4].sparse_infill_pattern='grid';
    rawOrca[4].sparse_infill_density='35%';
    const infillAtZero=await sliceWithLineWidth('0','infill_direction');
    const infillAtThirty=await sliceWithLineWidth('30','infill_direction');
    const infillOrientationWitness=code=>{
      const parsed=parseGcodeToolpaths(code);
      assert.equal(parsed.skippedArcs,0,'Cannot verify infill angle with skipped arcs');
      assert.equal(parsed.skippedMalformedMotion,0,'Cannot verify infill angle with malformed motion');
      const histogram=new Map();
      let depositedSegments=0;
      for(const layer of parsed.layers)for(const s of layer.segments){
        const feature=String(s.feature||'');
        if(!s.extrusion||!feature.includes('infill')||
           /solid|bridge|surface|gap|support/.test(feature)||
           !Number.isFinite(s.z1)||!Number.isFinite(s.z2)||
           Math.abs(s.z1-s.z2)>0.0005)continue;
        const dx=s.x2-s.x1,dy=s.y2-s.y1;
        if(Math.hypot(dx,dy)<1)continue;
        const degrees=(Math.atan2(dy,dx)*180/Math.PI+360)%180;
        const bin=(Math.round(degrees/5)*5)%180;
        histogram.set(bin,(histogram.get(bin)||0)+1);
        depositedSegments++;
      }
      assert.ok(depositedSegments>=12,'Need actual feature-tagged sparse-infill XY extrusion');
      return {depositedSegments,angle_bins_degrees:Object.fromEntries(
        [...histogram.entries()].sort((a,b)=>a[0]-b[0]).map(([a,n])=>[String(a),n]))};
    };
    const infillWitness={baseline_angle_degrees:0,test_angle_degrees:30,
      baseline:infillOrientationWitness(infillAtZero),
      test:infillOrientationWitness(infillAtThirty),
      desktop_native_parity:false,printer_ready:false};
    assert.notDeepEqual(infillWitness.baseline.angle_bins_degrees,
      infillWitness.test.angle_bins_degrees,
      'Native infill_direction must change positive-E sparse-infill XY orientation, not metadata');
    await writeFile(parityDir+'/infill-direction-deposition.json',
      JSON.stringify(infillWitness,null,2)+'\n');
    console.log('PASS: isolated WASM sparse-infill deposition rotates with native infill_direction');
    delete rawOrca[4].infill_direction;
    delete rawOrca[4].sparse_infill_pattern;
    delete rawOrca[4].sparse_infill_density;
    await uploadRawOrca();

    // Pinned v2.5.0 PerimeterGenerator.cpp uses the overlap percentage
    // when expanding the infill region on interior layers. Keep geometry,
    // density, pattern and widths fixed; vary only this native coPercent.
    Object.assign(rawOrca[4],{
      sparse_infill_pattern:'grid',sparse_infill_density:'35%',
      line_width:'0.42',inner_wall_line_width:'0.45',outer_wall_line_width:'0.42',
      sparse_infill_line_width:'0.45'
    });
    const noOverlap=await sliceWithLineWidth('0%','infill_wall_overlap');
    const pinnedOverlap=await sliceWithLineWidth('30%','infill_wall_overlap');
    const overlapWitness=(code,side='all')=>{
      const parsed=parseGcodeToolpaths(code);
      assert.equal(parsed.skippedMalformedMotion,0,'Overlap witness cannot ignore malformed motion');
      assert.equal(parsed.skippedArcs,0,'Overlap witness cannot omit unsupported arcs');
      const paths=[];
      let totalLength=0;
      for(const layer of parsed.layers)for(const s of layer.segments){
        const feature=String(s.feature||'');
        if(!s.extrusion||!feature.includes('infill')||
           /solid|bridge|surface|gap|support/.test(feature))continue;
        assert.equal(s.sourceMotion,'G1','Need linear sparse-infill deposition, not tessellated arcs');
        assert.ok(Number.isFinite(s.commandedPositiveEMm)&&s.commandedPositiveEMm>0,
          'Need positive commanded filament-axis E');
        assert.ok(Number.isFinite(s.z1)&&Number.isFinite(s.z2),'Missing sparse-infill Z');
        if(Math.abs(s.z1-s.z2)>0.0005)continue;
        const length=Math.hypot(s.x2-s.x1,s.y2-s.y1);
        if(length<0.001)continue;
        const point=(x,y)=>[Math.round(x*1000),Math.round(y*1000)].join(',');
        if(side!=='all'){
          assert.ok(Math.max(s.x1,s.x2)<165||Math.min(s.x1,s.x2)>165,
            'Combined infill witness requires disjoint left/right deposition');
          if((s.x1>165?'right':'left')!==side)continue;
        }
        // Ignore traversal direction and ordering. A reorder or F/E-only
        // change must not masquerade as a change to XY stroke geometry.
        const ends=[point(s.x1,s.y1),point(s.x2,s.y2)].sort();
        paths.push(Math.round(s.z2*1000)+':'+ends.join(':'));
        totalLength+=length;
      }
      assert.ok(paths.length>=12,'Need feature-tagged sparse-infill XY deposition in both runs');
      return {paths:paths.sort(),totalLength};
    };
    const overlap0=overlapWitness(noOverlap),overlap30=overlapWitness(pinnedOverlap);
    const overlapReport={
      fixture:'same two-STL localhost Prepare scene; grid 35%; fixed line widths',
      native_key:'infill_wall_overlap',baseline:'0%',candidate:'30%',
      baseline_sparse_xy_strokes:overlap0.paths.length,
      candidate_sparse_xy_strokes:overlap30.paths.length,
      baseline_sparse_path_mm:overlap0.totalLength,
      candidate_sparse_path_mm:overlap30.totalLength,
      geometry_changed:JSON.stringify(overlap0.paths)!==JSON.stringify(overlap30.paths),
      desktop_native_parity:false,physical_overlap_verified:false,printer_ready:false
    };
    await writeFile(parityDir+'/infill-wall-overlap-deposition.json',
      JSON.stringify(overlapReport,null,2)+'\n');
    console.log('WASM_INFILL_WALL_OVERLAP_DEPOSITION '+JSON.stringify(overlapReport));
    assert.ok(overlapReport.geometry_changed,
      '0% -> 30% infill/wall overlap must change real unordered sparse-infill XY stroke geometry');
    for(const key of ['infill_wall_overlap','sparse_infill_pattern','sparse_infill_density',
      'line_width','inner_wall_line_width','outer_wall_line_width','sparse_infill_line_width'])
      delete rawOrca[4][key];
    await uploadRawOrca();
    console.log('PASS: native infill_wall_overlap changes real tagged WASM sparse-infill geometry');

    // Pinned v2.5.0 PrintConfig.cpp: minimum_sparse_infill_area replaces
    // small sparse regions by internal solid infill. Contrast zero with a
    // deliberately high threshold, not the production CR-10 value of 10.
    // Same existing two-STL scene, density, pattern and shell counts.
    Object.assign(rawOrca[4],{
      sparse_infill_pattern:'grid',sparse_infill_density:'35%',
      top_shell_layers:'1',bottom_shell_layers:'1',
      top_shell_thickness:'0',bottom_shell_thickness:'0'
    });
    const areaOff=await sliceWithLineWidth('0','minimum_sparse_infill_area');
    const areaOn=await sliceWithLineWidth('10000','minimum_sparse_infill_area');
    const areaWitness=(code,side='all')=>{
      const parsed=parseGcodeToolpaths(code);
      assert.equal(parsed.skippedArcs,0,'Sparse area witness cannot ignore arcs');
      assert.equal(parsed.skippedMalformedMotion,0,'Sparse area witness cannot ignore malformed motion');
      const byZ=new Map();
      for(const layer of parsed.layers)for(const seg of layer.segments){
        const role=seg.feature==='sparse infill'?'sparse':
          seg.feature==='internal solid infill'?'solid':null;
        if(!role||!seg.extrusion)continue;
        assert.equal(seg.sourceMotion,'G1','Require actual linear infill strokes');
        assert.ok(Number.isFinite(seg.commandedPositiveEMm)&&seg.commandedPositiveEMm>0,
          'Require positive commanded filament E');
        assert.ok([seg.x1,seg.y1,seg.x2,seg.y2,seg.z1,seg.z2].every(Number.isFinite),
          'Require finite XYZ coordinates');
        if(Math.abs(seg.z2-seg.z1)>0.0005)continue;
        const length=Math.hypot(seg.x2-seg.x1,seg.y2-seg.y1);
        if(length<0.001)continue;
        if(side!=='all'){
          // The two original Prepare placements are separated by native X=165.
          // Do not silently assign a stroke crossing that empty gap.
          assert.ok(Math.max(seg.x1,seg.x2)<165||Math.min(seg.x1,seg.x2)>165,
            'Selective area witness requires disjoint left/right deposition');
          if((seg.x1>165?'right':'left')!==side)continue;
        }
        const z=Math.round(seg.z2*1000)/1000;
        const counts=byZ.get(z)||{sparse:0,solid:0,sparse_mm:0,solid_mm:0};
        counts[role]++;
        counts[role+'_mm']+=length;
        byZ.set(z,counts);
      }
      return byZ;
    };
    const area0=areaWitness(areaOff),area10000=areaWitness(areaOn);
    const areaTotals=byZ=>[...byZ.values()].reduce((sum,v)=>({
      sparse:sum.sparse+v.sparse,solid:sum.solid+v.solid,
      sparse_mm:sum.sparse_mm+v.sparse_mm,solid_mm:sum.solid_mm+v.solid_mm
    }),{sparse:0,solid:0,sparse_mm:0,solid_mm:0});
    const areaBaseline=areaTotals(area0),areaCandidate=areaTotals(area10000);
    const switchedZ=[...area0.keys()].filter(z=>{
      const a=area0.get(z),b=area10000.get(z);
      return b&&a.sparse>=3&&a.sparse_mm-b.sparse_mm>1&&b.solid_mm-a.solid_mm>1;
    }).sort((a,b)=>a-b);
    const areaReport={
      fixture:'same two synthetic STLs; grid 35%; one top/bottom shell; isolated Chrome',
      native_key:'minimum_sparse_infill_area',baseline_mm2:0,candidate_mm2:10000,
      baseline:areaBaseline,candidate:areaCandidate,
      sparse_decreased_solid_increased_z_mm:switchedZ,
      cr10_threshold_10_verified:false,desktop_native_parity:false,printer_ready:false
    };
    await writeFile(parityDir+'/minimum-sparse-infill-area-deposition.json',
      JSON.stringify(areaReport,null,2)+'\n');
    console.log('WASM_MINIMUM_SPARSE_INFILL_AREA_DEPOSITION '+JSON.stringify(areaReport));
    assert.ok(areaBaseline.sparse>=12,'Need actual baseline sparse deposition');
    assert.ok(areaCandidate.sparse_mm<areaBaseline.sparse_mm&&
      areaCandidate.solid_mm>areaBaseline.solid_mm&&switchedZ.length>=2,
      'High area threshold must decrease sparse and increase internal solid XY deposition on multiple shared Z levels: '+JSON.stringify(areaReport));
    // The official CR-10 process uses 10 mm². LayerRegion.cpp applies the
    // threshold to post-perimeter ExPolygon area (<=), not STL XY area.
    // Shrink only the second cube's XY dimensions to 4.6 mm, keep the large
    // separated cube as a same-slice negative control, and fix two walls.
    // This is a selective response witness, not an exact polygon-area audit.
    await prepare.locator('#object-tree [data-object-id]').nth(1).click();
    assert.equal(Number(await prepare.locator('#transform-x').inputValue()),45,
      'The right-hand cube must be selected');
    const setAreaScale=async(axis,value)=>{
      const field=prepare.locator('#transform-s'+axis);
      await field.fill(String(value));
      await field.press('Tab');
      assert.equal(Number(await field.inputValue()),Number(value));
    };
    const priorSx=await prepare.locator('#transform-sx').inputValue();
    const priorSy=await prepare.locator('#transform-sy').inputValue();
    const priorWalls=rawOrca[5].wall_loops;
    try {
      await setAreaScale('x',0.23);
      await setAreaScale('y',0.23);
      rawOrca[5].wall_loops='2';
      const selectiveOff=await sliceWithLineWidth('0','minimum_sparse_infill_area');
      const selectiveTen=await sliceWithLineWidth('10','minimum_sparse_infill_area');
      const small0=areaWitness(selectiveOff,'right'),small10=areaWitness(selectiveTen,'right');
      const large0=areaWitness(selectiveOff,'left'),large10=areaWitness(selectiveTen,'left');
      const selectiveZ=[...small0.keys()].filter(z=>{
        const a=small0.get(z),b=small10.get(z),c=large0.get(z),d=large10.get(z);
        return b&&c&&d&&a.sparse_mm>0.1&&b.sparse_mm<0.001&&
          b.solid_mm>a.solid_mm+0.1&&c.sparse_mm>1&&d.sparse_mm>1&&
          Math.abs(d.sparse_mm-c.sparse_mm)<=Math.max(0.01,c.sparse_mm*0.01)&&
          Math.abs(d.solid_mm-c.solid_mm)<=Math.max(0.01,c.solid_mm*0.01);
      }).sort((a,b)=>a-b);
      const selectiveReport={
        fixture:'same large left cube and scaled 4.6 mm XY right cube; two walls; grid 35%',
        native_key:'minimum_sparse_infill_area',baseline_mm2:0,candidate_mm2:10,
        small_baseline:areaTotals(small0),small_candidate:areaTotals(small10),
        large_baseline:areaTotals(large0),large_candidate:areaTotals(large10),
        selective_switch_z_mm:selectiveZ,exact_region_area_verified:false,
        desktop_native_parity:false,printer_ready:false
      };
      await writeFile(parityDir+'/minimum-sparse-infill-area-cr10-selectivity.json',
        JSON.stringify(selectiveReport,null,2)+'\n');
      console.log('WASM_MINIMUM_SPARSE_INFILL_AREA_CR10_SELECTIVITY '+JSON.stringify(selectiveReport));
      assert.ok(selectiveZ.length>=2,
        'At 10 mm² the small region must switch while the large control retains sparse deposition: '+JSON.stringify(selectiveReport));
      console.log('PASS: 10 mm² native threshold selectively switches small-region WASM deposition');

      // Exercise both source-pinned CR-10 values together, not just isolated
      // key toggles. Keep the same geometry and other overrides fixed.
      // At 30% overlap, compare 0 vs 10 mm²; at 10 mm² compare 0 vs 30%.
      // Large-object sparse geometry is a negative control for the area
      // threshold and a positive control for overlap.
      const priorOverlap=rawOrca[4].infill_wall_overlap;
      try {
        rawOrca[4].infill_wall_overlap='30%';
        const overlap30Area0=await sliceWithLineWidth('0','minimum_sparse_infill_area');
        const overlap30Area10=await sliceWithLineWidth('10','minimum_sparse_infill_area');
        rawOrca[4].infill_wall_overlap='0%';
        const overlap0Area10=await sliceWithLineWidth('10','minimum_sparse_infill_area');
        const small30Area0=areaWitness(overlap30Area0,'right');
        const small30Area10=areaWitness(overlap30Area10,'right');
        const large30Area0=overlapWitness(overlap30Area0,'left');
        const large30Area10=overlapWitness(overlap30Area10,'left');
        const large0Area10=overlapWitness(overlap0Area10,'left');
        const bothZ=[...small30Area0.keys()].filter(z=>{
          const a=small30Area0.get(z),b=small30Area10.get(z);
          return b&&a.sparse_mm>0.1&&b.sparse_mm<0.001&&b.solid_mm>a.solid_mm+0.1;
        }).sort((a,b)=>a-b);
        const geometryPreserved=JSON.stringify(large30Area0.paths)===JSON.stringify(large30Area10.paths);
        const overlapChangesGeometry=JSON.stringify(large0Area10.paths)!==JSON.stringify(large30Area10.paths);
        const combinedReport={
          fixture:'same two STL controls; two walls; grid 35%; isolated Chrome',
          overlap_percent:[0,30],minimum_area_mm2:[0,10],
          small_30pct_area0:areaTotals(small30Area0),
          small_30pct_area10:areaTotals(small30Area10),
          small_switch_z_mm:bothZ,
          large_30pct_area0_mm:large30Area0.totalLength,
          large_30pct_area10_mm:large30Area10.totalLength,
          large_0pct_area10_mm:large0Area10.totalLength,
          large_threshold_geometry_preserved:geometryPreserved,
          large_overlap_geometry_changed:overlapChangesGeometry,
          exact_region_area_verified:false,full_profile_applied:false,
          desktop_native_parity:false,printer_ready:false
        };
        await writeFile(parityDir+'/combined-cr10-infill-overlap-area.json',
          JSON.stringify(combinedReport,null,2)+'\n');
        console.log('WASM_COMBINED_CR10_INFILL_OVERLAP_AREA '+JSON.stringify(combinedReport));
        assert.ok(bothZ.length>=2,
          '30% overlap plus 10 mm² area must selectively solidify the small control: '+JSON.stringify(combinedReport));
        assert.ok(geometryPreserved,
          'Area threshold alone must preserve large control sparse stroke multiset');
        assert.ok(overlapChangesGeometry,
          'Overlap must change large sparse stroke geometry with the area threshold enabled');
        console.log('PASS: combined CR-10 overlap and minimum area independently affect real WASM deposition');
      } finally {
        if(priorOverlap===undefined)delete rawOrca[4].infill_wall_overlap;
        else rawOrca[4].infill_wall_overlap=priorOverlap;
      }
    } finally {
      rawOrca[5].wall_loops=priorWalls;
      await setAreaScale('x',priorSx);
      await setAreaScale('y',priorSy);
    }
    for(const key of ['minimum_sparse_infill_area','sparse_infill_pattern',
      'sparse_infill_density','top_shell_layers','bottom_shell_layers',
      'top_shell_thickness','bottom_shell_thickness'])delete rawOrca[4][key];
    await uploadRawOrca();
    console.log('PASS: native sparse area threshold changes real sparse/solid tagged WASM deposition');

    // Pinned Fill.cpp converts relative anchor lengths using spacing and
    // clamps length to max; FillParams::dont_connect() selects the legacy
    // connection path at max=0. Keep both settings explicit, including zeros.
    // The 20 mm pair uses the source-pinned CR-10 max. If that geometry
    // permits all joins, a 1 mm positive max probes the open-anchor fallback.
    const anchorKeys=['infill_anchor','infill_anchor_max','sparse_infill_pattern',
      'sparse_infill_density','sparse_infill_line_width','infill_wall_overlap',
      'minimum_sparse_infill_area'];
    const anchorPrior=new Map(anchorKeys.map(k=>[k,rawOrca[4][k]]));
    try {
      Object.assign(rawOrca[4],{sparse_infill_pattern:'grid',
        sparse_infill_density:'35%',sparse_infill_line_width:'0.45',
        infill_wall_overlap:'30%',minimum_sparse_infill_area:'0'});
      const anchorCase=async(length,max)=>{
        rawOrca[4].infill_anchor_max=max;
        const gcode=await sliceWithLineWidth(length,'infill_anchor');
        return overlapWitness(gcode);
      };
      const sameAnchorGeometry=(a,b)=>JSON.stringify(a.paths)===JSON.stringify(b.paths);
      const bothZero=await anchorCase('0','0');
      const lengthOnly=await anchorCase('400%','0');
      const maxOnly=await anchorCase('0','20');
      const pinnedBoth=await anchorCase('400%','20');
      const zeroMaxInvariant=sameAnchorGeometry(bothZero,lengthOnly);
      const maxResponse=!sameAnchorGeometry(lengthOnly,pinnedBoth);
      const pinnedLengthResponse=!sameAnchorGeometry(maxOnly,pinnedBoth);
      const summarizeAnchor=a=>({strokes:a.paths.length,xy_length_mm:a.totalLength});
      const anchorReport={
        fixture:'same two synthetic STLs; grid 35%; overlap 30%; fixed sparse width',
        both_zero:summarizeAnchor(bothZero),length400_max0:summarizeAnchor(lengthOnly),
        length0_max20:summarizeAnchor(maxOnly),length400_max20:summarizeAnchor(pinnedBoth),
        zero_max_geometry_invariant:zeroMaxInvariant,
        pinned_max_geometry_changed:maxResponse,
        pinned_length_geometry_changed:pinnedLengthResponse,
        desktop_native_parity:false,full_profile_applied:false,printer_ready:false
      };
      if(!pinnedLengthResponse){
        const shortMaxOnly=await anchorCase('0','1');
        const shortMaxBoth=await anchorCase('400%','1');
        anchorReport.length0_max1=summarizeAnchor(shortMaxOnly);
        anchorReport.length400_max1=summarizeAnchor(shortMaxBoth);
        anchorReport.short_max_length_geometry_changed=!sameAnchorGeometry(shortMaxOnly,shortMaxBoth);
      }
      await writeFile(parityDir+'/sparse-infill-anchor-deposition.json',
        JSON.stringify(anchorReport,null,2)+'\n');
      console.log('WASM_SPARSE_INFILL_ANCHOR_DEPOSITION '+JSON.stringify(anchorReport));
      assert.ok(zeroMaxInvariant,
        'Zero max must bypass open-anchor length on the same synthetic scene');
      assert.ok(maxResponse,
        '0 to 20 mm max must change actual sparse XY stroke geometry at fixed 400% length');
      assert.ok(pinnedLengthResponse||anchorReport.short_max_length_geometry_changed,
        'Open-anchor length must change actual sparse XY geometry at a fixed positive max: '+JSON.stringify(anchorReport));
      console.log('PASS: native sparse anchor max and open-anchor length affect tagged WASM XY geometry');
    } finally {
      for(const [key,value] of anchorPrior){
        if(value===undefined)delete rawOrca[4][key];
        else rawOrca[4][key]=value;
      }
      await uploadRawOrca();
    }

    // Pinned PrintObject::combine_infill skips the first layer, groups
    // adjacent sparse regions up to the nozzle/cap height, and keeps walls
    // at their original layer heights. Here 0.16 mm layers and the 0.4 mm
    // nozzle permit pairs (0.32 mm) with the native default 100% cap.
    const combinationKeys=['infill_combination','infill_combination_max_layer_height','sparse_infill_pattern',
      'sparse_infill_density','minimum_sparse_infill_area','top_shell_layers',
      'bottom_shell_layers','top_shell_thickness','bottom_shell_thickness'];
    const combinationPrior=new Map(combinationKeys.map(k=>[k,rawOrca[4][k]]));
    try {
      assert.equal(rawOrca[5].layer_height,'0.16');
      assert.equal(rawOrca[0].nozzle_diameter,'0.4');
      Object.assign(rawOrca[4],{sparse_infill_pattern:'grid',
        sparse_infill_density:'35%',minimum_sparse_infill_area:'0',
        top_shell_layers:'1',bottom_shell_layers:'1',
        top_shell_thickness:'0',bottom_shell_thickness:'0'});
      const combinationLayers=code=>{
        const parsed=parseGcodeToolpaths(code);
        assert.equal(parsed.skippedMalformedMotion,0,'Cannot omit malformed motion');
        assert.equal(parsed.skippedArcs,0,'Cannot omit unsupported arcs');
        const sparse=new Set(),walls=new Set();
        let sparseStrokes=0,wallStrokes=0;
        for(const layer of parsed.layers)for(const s of layer.segments){
          const role=s.feature==='sparse infill'?sparse:
            (s.feature==='outer wall'||s.feature==='inner wall')?walls:null;
          if(!role||!s.extrusion)continue;
          assert.equal(s.sourceMotion,'G1');
          assert.ok(Number.isFinite(s.commandedPositiveEMm)&&s.commandedPositiveEMm>0);
          assert.ok([s.x1,s.y1,s.x2,s.y2,s.z1,s.z2].every(Number.isFinite));
          if(Math.abs(s.z2-s.z1)>0.0005||Math.hypot(s.x2-s.x1,s.y2-s.y1)<0.001)continue;
          role.add(Math.round(s.z2*1000));
          if(role===sparse)sparseStrokes++;else wallStrokes++;
        }
        const sorted=set=>[...set].sort((a,b)=>a-b);
        return {sparse:sorted(sparse),walls:sorted(walls),sparseStrokes,wallStrokes};
      };
      const off=combinationLayers(await sliceWithLineWidth('0','infill_combination'));
      const on=combinationLayers(await sliceWithLineWidth('1','infill_combination'));
      const onSparse=new Set(on.sparse),offSparse=new Set(off.sparse);
      const offWalls=new Set(off.walls),onWalls=new Set(on.walls);
      // Count complete interior triplets: baseline sparse deposition at all
      // three 0.16-mm levels, combined sparse at both ends but not middle,
      // and walls at all three levels in both slices.
      const combinedGaps=off.sparse.filter(z=>!onSparse.has(z)&&
        offSparse.has(z-160)&&offSparse.has(z+160)&&
        onSparse.has(z-160)&&onSparse.has(z+160)&&
        [z-160,z,z+160].every(v=>offWalls.has(v)&&onWalls.has(v)));
      const report={fixture:'same two synthetic STLs; 0.16 mm layers; 0.4 mm nozzle; grid 35%',
        native_key:'infill_combination',baseline:'0',candidate:'1',
        off,on,combined_gap_z_mm:combinedGaps.map(z=>z/1000),
        desktop_native_parity:false,combined_extrusion_height_verified:false,printer_ready:false};
      await writeFile(parityDir+'/sparse-infill-combination-deposition.json',
        JSON.stringify(report,null,2)+'\n');
      console.log('WASM_SPARSE_INFILL_COMBINATION '+JSON.stringify(report));
      assert.ok(off.sparseStrokes>=12&&on.sparseStrokes>=12&&off.wallStrokes>=12&&on.wallStrokes>=12,
        'Need actual sparse and wall deposition in both runs');
      assert.deepEqual(on.walls,off.walls,'Wall deposition Z levels must remain unchanged');
      assert.ok(on.sparse.length<off.sparse.length&&combinedGaps.length>=2,
        'Combination must omit sparse deposition at interior Z levels while retaining adjacent sparse and walls: '+JSON.stringify(report));
      console.log('PASS: native infill_combination changes real sparse deposition Z cadence without removing wall levels');

      // Keep combination enabled. The 0.4 mm nozzle makes 50% equivalent
      // to 0.20 mm (one 0.16 mm layer); 100% and zero use the full nozzle.
      const capKey='infill_combination_max_layer_height';
      const half=combinationLayers(await sliceWithLineWidth('50%',capKey));
      const absolute=combinationLayers(await sliceWithLineWidth('0.20',capKey));
      const full=combinationLayers(await sliceWithLineWidth('100%',capKey));
      const zero=combinationLayers(await sliceWithLineWidth('0',capKey));
      for(const result of [half,absolute,full,zero]){
        assert.deepEqual(result.walls,off.walls,'Cap must not remove wall Z levels');
        assert.ok(result.sparseStrokes>=12&&result.wallStrokes>=12);
      }
      assert.deepEqual(half.sparse,off.sparse,'50% must prevent two-layer combination');
      assert.deepEqual(absolute.sparse,half.sparse,'Equivalent absolute and percent cap must match Z levels');
      assert.deepEqual(full.sparse,on.sparse,'100% must reproduce default combined Z levels');
      assert.deepEqual(zero.sparse,full.sparse,'Zero must use nozzle diameter, not disable combination');
      const capReport={half,absolute,full,zero,desktop_native_parity:false,printer_ready:false};
      await writeFile(parityDir+'/sparse-infill-combination-cap.json',JSON.stringify(capReport,null,2)+'\n');
      console.log('WASM_SPARSE_INFILL_COMBINATION_CAP '+JSON.stringify(capReport));
      console.log('PASS: combination height cap controls real sparse Z levels; equivalent units and zero sentinel verified');
    } finally {
      for(const [key,value] of combinationPrior){
        if(value===undefined)delete rawOrca[4][key];
        else rawOrca[4][key]=value;
      }
      await uploadRawOrca();
    }

    const narrowWidthMotion=motionOnly(await sliceWithLineWidth('0.35'));
    const broadWidthMotion=motionOnly(await sliceWithLineWidth('0.65'));
    assert.ok(narrowWidthMotion.length>100&&broadWidthMotion.length>100,
      'Line-width probe requires actual G0/G1 deposited trajectories');
    assert.notDeepEqual(narrowWidthMotion,broadWidthMotion,
      'Changing only native line_width must alter actual WASM motion/extrusion, not metadata');
    delete rawOrca[4].line_width;
    await uploadRawOrca();
    console.log('PASS: absolute process line_width 0.35 -> 0.65 changes real localhost WASM motion G-code');

    // Hold the common width constant and change ONLY the native outer-wall
    // width. This specifically tests one extra source-pinned CR-10 key, not
    // an alias of line_width. Compare real motion commands, not metadata.
    rawOrca[4].line_width='0.42';
    const narrowOuterMotion=motionOnly(await sliceWithLineWidth('0.32','outer_wall_line_width'));
    const broadOuterMotion=motionOnly(await sliceWithLineWidth('0.72','outer_wall_line_width'));
    assert.ok(narrowOuterMotion.length>100&&broadOuterMotion.length>100,
      'Outer-wall width probe needs substantive real G-code motion');
    assert.notDeepEqual(narrowOuterMotion,broadOuterMotion,
      'Changing only outer_wall_line_width must change actual WASM motion, not headers');
    delete rawOrca[4].outer_wall_line_width;
    delete rawOrca[4].line_width;
    await uploadRawOrca();
    console.log('PASS: outer_wall_line_width 0.32 -> 0.72 changes real isolated WASM G-code');

    // Hold both the common and outer-wall widths fixed. Vary only inner
    // walls and compare real motion paths, not source JSON or G-code headers.
    rawOrca[4].line_width='0.42';
    rawOrca[4].outer_wall_line_width='0.42';
    const narrowInnerMotion=motionOnly(await sliceWithLineWidth('0.32','inner_wall_line_width'));
    const broadInnerMotion=motionOnly(await sliceWithLineWidth('0.72','inner_wall_line_width'));
    assert.ok(narrowInnerMotion.length>100&&broadInnerMotion.length>100,
      'Inner-wall width probe needs substantive real G-code motion');
    assert.notDeepEqual(narrowInnerMotion,broadInnerMotion,
      'Changing only inner_wall_line_width must change WASM motion, not headers');
    delete rawOrca[4].inner_wall_line_width;
    delete rawOrca[4].outer_wall_line_width;
    delete rawOrca[4].line_width;
    await uploadRawOrca();
    console.log('PASS: inner_wall_line_width 0.32 -> 0.72 changes real isolated WASM G-code');

    // Pin the other native widths and ensure actual sparse infill paths
    // respond to this independent source-pinned CR-10 process setting.
    rawOrca[4].line_width='0.42';
    rawOrca[4].outer_wall_line_width='0.42';
    rawOrca[4].inner_wall_line_width='0.45';
    rawOrca[4].sparse_infill_density='25%';
    const narrowSparseMotion=motionOnly(await sliceWithLineWidth('0.32','sparse_infill_line_width'));
    const broadSparseMotion=motionOnly(await sliceWithLineWidth('0.72','sparse_infill_line_width'));
    assert.ok(narrowSparseMotion.length>100&&broadSparseMotion.length>100,
      'Sparse-infill width probe needs substantive real G-code motion');
    assert.notDeepEqual(narrowSparseMotion,broadSparseMotion,
      'Changing only sparse_infill_line_width must change WASM motion, not headers');
    for(const key of ['sparse_infill_line_width','sparse_infill_density',
      'inner_wall_line_width','outer_wall_line_width','line_width'])delete rawOrca[4][key];
    await uploadRawOrca();
    console.log('PASS: sparse_infill_line_width 0.32 -> 0.72 changes real isolated WASM G-code');

    // Pinned v2.5.0 CR-10 top-surface width must affect actual G0/G1 motion.
    // Hold every other width and top-shell count constant during comparison.
    rawOrca[4].line_width='0.42';
    rawOrca[4].outer_wall_line_width='0.42';
    rawOrca[4].inner_wall_line_width='0.45';
    rawOrca[4].sparse_infill_line_width='0.45';
    rawOrca[4].top_shell_layers='5';
    const narrowTopMotion=motionOnly(await sliceWithLineWidth('0.32','top_surface_line_width'));
    const broadTopMotion=motionOnly(await sliceWithLineWidth('0.72','top_surface_line_width'));
    assert.ok(narrowTopMotion.length>100&&broadTopMotion.length>100,
      'Top-surface width probe needs substantive motion commands');
    assert.notDeepEqual(narrowTopMotion,broadTopMotion,
      'Changing only top_surface_line_width must change real WASM motion');
    for(const key of ['top_surface_line_width','top_shell_layers','sparse_infill_line_width',
      'inner_wall_line_width','outer_wall_line_width','line_width'])delete rawOrca[4][key];
    await uploadRawOrca();
    console.log('PASS: top_surface_line_width 0.32 -> 0.72 changes real isolated WASM G-code');

    // Pin independent widths and solid-shell counts; vary only the pinned
    // CR-10 internal solid infill width, and inspect G0/G1 motion rather than
    // relying on metadata, G-code comments or hash changes.
    rawOrca[4].line_width='0.42';
    rawOrca[4].outer_wall_line_width='0.42';
    rawOrca[4].inner_wall_line_width='0.45';
    rawOrca[4].sparse_infill_line_width='0.45';
    rawOrca[4].top_surface_line_width='0.42';
    rawOrca[4].sparse_infill_density='25%';
    rawOrca[4].top_shell_layers='5';
    rawOrca[4].bottom_shell_layers='4';
    const narrowSolidMotion=motionOnly(await sliceWithLineWidth('0.32','internal_solid_infill_line_width'));
    const broadSolidMotion=motionOnly(await sliceWithLineWidth('0.72','internal_solid_infill_line_width'));
    assert.ok(narrowSolidMotion.length>100&&broadSolidMotion.length>100,
      'Internal-solid width probe needs substantive real motion');
    assert.notDeepEqual(narrowSolidMotion,broadSolidMotion,
      'Changing only internal_solid_infill_line_width must alter WASM G-code motion');
    for(const key of ['internal_solid_infill_line_width','bottom_shell_layers',
      'top_shell_layers','sparse_infill_density','top_surface_line_width',
      'sparse_infill_line_width','inner_wall_line_width','outer_wall_line_width',
      'line_width'])delete rawOrca[4][key];
    await uploadRawOrca();
    console.log('PASS: internal_solid_infill_line_width 0.32 -> 0.72 changes real isolated WASM G-code');

    // Source-pinned CR-10 first-layer width differs from common line_width.
    // Keep all other widths and the first-layer height unchanged; require a
    // difference in real G0/G1 motion, not only a config echo or G-code header.
    rawOrca[4].line_width='0.42';
    rawOrca[4].outer_wall_line_width='0.42';
    rawOrca[4].inner_wall_line_width='0.45';
    rawOrca[4].initial_layer_print_height='0.2';
    const narrowFirstMotion=motionOnly(await sliceWithLineWidth('0.32','initial_layer_line_width'));
    const broadFirstMotion=motionOnly(await sliceWithLineWidth('0.72','initial_layer_line_width'));
    assert.ok(narrowFirstMotion.length>100&&broadFirstMotion.length>100,
      'First-layer width probe needs substantive real motion commands');
    assert.notDeepEqual(narrowFirstMotion,broadFirstMotion,
      'Changing only initial_layer_line_width must alter real WASM G-code motion');
    for(const key of ['initial_layer_line_width','initial_layer_print_height',
      'inner_wall_line_width','outer_wall_line_width','line_width'])delete rawOrca[4][key];
    await uploadRawOrca();
    console.log('PASS: initial_layer_line_width 0.32 -> 0.72 changes real isolated WASM G-code');

    // First-layer perimeter speed is an independent source-pinned process
    // setting (CR-10: 15mm/s). Compare actual modal F on positive-E first
    // layer toolpaths, not header comments, config echoes or G-code SHA.
    const firstLayerFeeds=code=>{
      const layer=parseGcodeToolpaths(code).layers.find(l=>
        l.segments.some(s=>s.extrusion&&Number.isFinite(s.feedrateMmMin)));
      assert.ok(layer,'First-layer speed test requires deposited toolpaths');
      const speeds=layer.segments.filter(s=>s.extrusion&&
        Number.isFinite(s.feedrateMmMin)&&s.feedrateMmMin>0)
        .map(s=>Math.round(s.feedrateMmMin*100)/100);
      assert.ok(speeds.length>10,'First-layer speed test requires substantive extrusion');
      return [...new Set(speeds)].sort((a,b)=>a-b);
    };
    const slowFirstGcode=await sliceWithLineWidth('5','initial_layer_speed');
    const pinnedFirstGcode=await sliceWithLineWidth('15','initial_layer_speed');
    const slowFirstFeeds=firstLayerFeeds(slowFirstGcode);
    const pinnedFirstFeeds=firstLayerFeeds(pinnedFirstGcode);
    assert.notDeepEqual(slowFirstFeeds,pinnedFirstFeeds,
      'Changing only initial_layer_speed must affect real first-layer extrusion F values');
    delete rawOrca[4].initial_layer_speed;
    await uploadRawOrca();
    console.log('PASS: source-pinned initial_layer_speed 5 -> 15 changes real first-layer WASM extrusion feedrates',
      JSON.stringify({slowFirstFeeds,pinnedFirstFeeds}));

    // Keep geometry and other process settings fixed; compare actual modal
    // travel F at identical first-layer planar XY paths (not hash/comments).
    rawOrca[4].travel_speed='80';
    rawOrca[4].initial_layer_print_height='0.2';
    const relativeTravelCode=await sliceWithLineWidth('50%','initial_layer_travel_speed');
    const fullTravelCode=await sliceWithLineWidth('100%','initial_layer_travel_speed');
    const travelWitness=compareFirstLayerTravelFeedrates(
      parseGcodeToolpaths(relativeTravelCode),parseGcodeToolpaths(fullTravelCode));
    console.log('WASM_INITIAL_LAYER_TRAVEL_F '+JSON.stringify(travelWitness));
    await writeFile(parityDir+'/first-layer-travel-feedrates.json',
      JSON.stringify({fixture:'same two synthetic STL; travel_speed 80 mm/s',
        percent_50:'50%',percent_100:'100%',...travelWitness},null,2)+'\n');
    assert.ok(travelWitness.same_deposition_geometry,
      'Speed-only A/B must preserve first-layer deposited geometry');
    assert.ok(travelWitness.matched_travels>=2,
      'Require paired first-layer XY travel, not metadata differences');
    assert.ok(travelWitness.faster_at_100_percent>0,
      '50% -> 100% did not increase actual first-layer travel modal F');
    delete rawOrca[4].initial_layer_travel_speed;
    delete rawOrca[4].initial_layer_print_height;
    delete rawOrca[4].travel_speed;
    await uploadRawOrca();
    console.log('PASS: first-layer 50% vs 100% changes real isolated WASM commanded travel F (desktop parity unproven)');

    // Independent native first-layer infill speed (CR-10 20 mm/s) must
    // affect actual first-layer deposited feedrates while first-layer
    // perimeter speed stays fixed at the pinned 15 mm/s. Compare G-code
    // motion, not profile text or file hashes; this is localhost-only.
    rawOrca[4].initial_layer_speed='15';
    const slowInfillGcode=await sliceWithLineWidth('5','initial_layer_infill_speed');
    const pinnedInfillGcode=await sliceWithLineWidth('20','initial_layer_infill_speed');
    const slowInfillFeeds=firstLayerFeeds(slowInfillGcode);
    const pinnedInfillFeeds=firstLayerFeeds(pinnedInfillGcode);
    assert.notDeepEqual(slowInfillFeeds,pinnedInfillFeeds,
      'Changing only first-layer infill speed must change actual deposited first-layer feedrates');
    delete rawOrca[4].initial_layer_infill_speed;
    delete rawOrca[4].initial_layer_speed;
    await uploadRawOrca();
    console.log('PASS: source-pinned initial_layer_infill_speed 5 -> 20 changes real first-layer WASM extrusion feedrates',
      JSON.stringify({slowInfillFeeds,pinnedInfillFeeds}));

    // Ingestion-only probe: these two cubes do NOT require support, and
    // enable_support is deliberately blocked. Never call this support parity.
    rawOrca[4].support_line_width='0.42';
    rawOrca[4].support_interface_speed='30';
    const supportConfiguredGcode=await sliceWithLineWidth('30','support_speed');
    assert.ok(motionOnly(supportConfiguredGcode).length>100,
      'Native-json support parameter ingestion failed in the real WASM engine');
    // A guarded baseline for future support-enabled test fixtures: the
    // source-pinned CR-10 child has enable_support=0, and the localhost
    // override allow-list intentionally forbids enabling it. Record actual
    // feature-tagged G-code (not the profile comment) as a negative control.
    const supportDisabledAudit=auditSupportDeposition(
      parseGcodeToolpaths(supportConfiguredGcode));
    await writeFile(parityDir+'/support-disabled-feature-diagnostic.json',
      JSON.stringify({
        fixture:'two synthetic cubes; source-pinned support generation disabled',
        ...supportDisabledAudit
      },null,2)+'\n');
    assert.equal(supportDisabledAudit.result,'no_tagged_support_body_or_interface',
      'Support-off baseline unexpectedly contains tagged support deposition');
    console.log('PASS: real WASM support-disabled negative control has no tagged support body/interface XY extrusion');

    for(const key of ['support_line_width','support_speed',
      'support_interface_speed'])delete rawOrca[4][key];
    await uploadRawOrca();
    console.log('PASS: real isolated WASM accepts native support width and body/interface speed (support disabled; no support toolpath proof)');

    // Test the deliberately opt-in plate mapping through the *real* engine.
    // Default profile used 55C. Inherited upstream-style hot_plate_temp=65C
    // should be passed into session.init only after selecting the hot plate.
    await prepare.locator('#lab-orca-plate').selectOption('hot');
    await prepare.locator('#lab-slice').click();
    await prepare.waitForFunction(() => {
      const text=document.querySelector('#lab-status')?.textContent || '';
      return text.startsWith('PASS:') || text.startsWith('FAILED');
    },null,{timeout:120000});
    const hotStatus=await prepare.locator('#lab-status').innerText();
    assert.ok(hotStatus.startsWith('PASS: 2 STL model(s)'),hotStatus);
    assert.match(hotStatus,/explicitly mapped hot bed 65/);
    assert.match(hotStatus,/native first-layer hot bed 75/);
    assert.match(hotStatus,/1 unsupported keys excluded/);
    const hotHash=await prepare.locator('#lab-download').evaluate(async link=>{
      const digest=await crypto.subtle.digest('SHA-256',await(await fetch(link.href)).arrayBuffer());
      return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
    });
    assert.notEqual(hotHash,nativeHash,'Explicit hot-plate temperature must change actual WASM output');
    console.log('PASS: explicit selected hot plate (65 C) changes real WASM G-code');

    // Change ONLY the explicit initial layer hot-bed temperature. A SHA
    // difference alone does not prove the G-code contains thermal commands:
    // the generated header can include config text without driving heaters.
    const hotText=await prepare.locator('#lab-download').evaluate(async link=>await(await fetch(link.href)).text());
    rawOrca[2].hot_plate_temp_initial_layer=['85'];
    await uploadRawOrca();
    await prepare.locator('#lab-slice').click();
    await prepare.waitForFunction(() => {
      const text=document.querySelector('#lab-status')?.textContent||'';
      return text.startsWith('PASS:')||text.startsWith('FAILED');
    },null,{timeout:120000});
    const warmerStatus=await prepare.locator('#lab-status').innerText();
    assert.match(warmerStatus,/native first-layer hot bed 85/);
    const warmerText=await prepare.locator('#lab-download').evaluate(async link=>await(await fetch(link.href)).text());
    const thermalCommands=text=>text.split(/\r?\n/).filter(line=>/^M(?:140|190)\b/i.test(line.trim()));
    const before=thermalCommands(hotText);
    const after=thermalCommands(warmerText);
    console.log('HOT_PLATE_THERMAL_COMMANDS',JSON.stringify({before:before.slice(0,8),after:after.slice(0,8)}));
    assert.notDeepEqual(after,before,'Initial layer hot plate temperature must change real bed heater G-code (not merely metadata)');
    console.log('PASS: explicit first-layer hot plate temperature changes real WASM bed heater commands');

    // The non-hot plate must be selectable through the REAL isolated Prepare UI,
    // and cause actual bed-heater instructions. A changed hash/header alone is
    // insufficient evidence; this fixture is never approved for printing.
    rawOrca[2].textured_plate_temp=['50'];
    rawOrca[2].textured_plate_temp_initial_layer=['70'];
    await uploadRawOrca();
    await prepare.locator('#lab-orca-plate').selectOption('textured');
    await prepare.locator('#lab-slice').click();
    await prepare.waitForFunction(() => {
      const text=document.querySelector('#lab-status')?.textContent||'';
      return text.startsWith('PASS:')||text.startsWith('FAILED');
    },null,{timeout:120000});
    const texturedStatus=await prepare.locator('#lab-status').innerText();
    assert.match(texturedStatus,/^PASS: 2 STL model\(s\)/);
    assert.match(texturedStatus,/explicitly mapped textured bed 50/);
    assert.match(texturedStatus,/native first-layer textured bed 70/);
    const texturedText=await prepare.locator('#lab-download').evaluate(async link=>await(await fetch(link.href)).text());
    const texturedHeaters=thermalCommands(texturedText);
    assert.ok(texturedHeaters.length>0,'Expected native bed-heater commands on textured plate');
    assert.ok(texturedHeaters.some(line=>/\bS70\b/.test(line)),
      'Textured first-layer setting did not produce actual 70 C heater command');
    assert.notDeepEqual(texturedHeaters,after,
      'Switching hot to textured plate must change actual bed-heater commands');
    console.log('TEXTURED_PLATE_THERMAL_COMMANDS',JSON.stringify(texturedHeaters.slice(0,8)));
    console.log('PASS: local-only textured PEI plate selection changes real WASM heater commands');
    // The v2.5.0 profile resolver supports six bed enums; prove that each
    // remaining enum actually drives first-layer AND steady heater commands
    // in the isolated Chrome WASM engine. These are controlled synthetic
    // temperatures, NOT manufacturer-approved printer settings.
    const additionalBedFixtures = [
      ["cool", "cool_plate_temp", 32, 36],
      ["engineering", "eng_plate_temp", 60, 65],
      ["textured-cool", "textured_cool_plate_temp", 38, 42],
      ["supertack", "supertack_plate_temp", 40, 44],
    ];
    for (const [plateType, nativeKey, steady, firstLayer] of additionalBedFixtures) {
      rawOrca[2][nativeKey] = [String(steady)];
      rawOrca[2][nativeKey + "_initial_layer"] = [String(firstLayer)];
      await uploadRawOrca();
      await prepare.locator('#lab-orca-plate').selectOption(plateType);
      await prepare.locator('#lab-slice').click();
      await prepare.waitForFunction(() => {
        const text = document.querySelector('#lab-status')?.textContent || '';
        return text.startsWith('PASS:') || text.startsWith('FAILED');
      }, null, {timeout:120000});
      const plateStatus = await prepare.locator('#lab-status').innerText();
      assert.ok(plateStatus.startsWith('PASS: 2 STL model(s)'), plateStatus);
      assert.ok(plateStatus.includes('explicitly mapped ' + plateType + ' bed ' + steady),
        'Selected ' + plateType + ' steady bed temperature not acknowledged: ' + plateStatus);
      assert.ok(plateStatus.includes('native first-layer ' + plateType + ' bed ' + firstLayer),
        'Selected ' + plateType + ' first-layer bed temperature not acknowledged: ' + plateStatus);
      const plateText = await prepare.locator('#lab-download').evaluate(async link =>
        await (await fetch(link.href)).text());
      const heaters = thermalCommands(plateText).join('\n');
      assert.match(heaters, new RegExp('^M190\\s+S' + firstLayer + '(?:\\s|$)', 'm'),
        'First-layer M190 heater command missing for ' + plateType);
      assert.match(heaters, new RegExp('^M140\\s+S' + steady + '(?:\\s|$)', 'm'),
        'Steady M140 heater command missing for ' + plateType);
      assert.notDeepEqual(thermalCommands(plateText), texturedHeaters,
        'Different bed types must not reuse textured PEI heater commands');
      console.log('PASS: ' + plateType + ' real WASM bed commands M190 S' +
        firstLayer + ' and M140 S' + steady);
    }
    console.log('PASS: all six opt-in v2.5.0 bed types exercised in isolated Chrome (synthetic temperatures)');
    // Restore hot plate for the independent first-layer nozzle test below.
    await prepare.locator('#lab-orca-plate').selectOption('hot');

    // Independent initial nozzle temperature. The WASM test must observe
    // M104/M109 tool-heater commands, not merely config comments or a new
    // generated G-code hash. The steady nozzle temperature stays unchanged.
    rawOrca[2].nozzle_temperature_initial_layer=['245'];
    await uploadRawOrca();
    await prepare.locator('#lab-slice').click();
    await prepare.waitForFunction(() => {
      const text=document.querySelector('#lab-status')?.textContent||'';
      return text.startsWith('PASS:')||text.startsWith('FAILED');
    },null,{timeout:120000});
    const warmerNozzleStatus=await prepare.locator('#lab-status').innerText();
    assert.ok(warmerNozzleStatus.startsWith('PASS: 2 STL model(s)'),warmerNozzleStatus);
    const warmerNozzleText=await prepare.locator('#lab-download').evaluate(async link=>await(await fetch(link.href)).text());
    const toolHeaterCommands=text=>text.split(/\r?\n/).filter(line=>/^M(?:104|109)\b/i.test(line.trim()));
    const toolBefore=toolHeaterCommands(warmerText);
    const toolAfter=toolHeaterCommands(warmerNozzleText);
    console.log('FIRST_LAYER_NOZZLE_COMMANDS',JSON.stringify({before:toolBefore.slice(0,10),after:toolAfter.slice(0,10)}));
    // Actual pinned WASM logs show generated M104 S235 → M104 S245 for
    // the initial layer, while the later steady M104 S215 is unchanged.
    // Match commands specifically: a different file hash or G-code comment
    // is NOT proof of a real tool-heater command.
    assert.match(toolBefore.join('\n'),/^M104 S235\b/m);
    assert.match(toolAfter.join('\n'),/^M104 S245\b/m);
    assert.match(toolBefore.join('\n'),/^M104 S215\b/m);
    assert.match(toolAfter.join('\n'),/^M104 S215\b/m);
    assert.notDeepEqual(toolAfter,toolBefore,'Initial layer nozzle temperature must change real M104/M109 commands (not just metadata)');
    console.log('PASS: initial-layer M104 S235 -> S245; later M104 S215 unchanged in real WASM G-code');
    // Verify actual numeric extrusion instead of merely a changed config
    // footer/header or SHA. This controlled two-STL print differs ONLY in the
    // single-extruder inherited native filament_flow_ratio (0.80 -> 1.20).
    const sliceWithFlowRatio=async ratio=>{
      rawOrca[2].filament_flow_ratio=[ratio];
      await uploadRawOrca();
      await prepare.locator('#lab-slice').click();
      await prepare.waitForFunction(()=>{
        const text=document.querySelector('#lab-status')?.textContent||'';
        return text.startsWith('PASS:')||text.startsWith('FAILED');
      },null,{timeout:120000});
      const state=await prepare.locator('#lab-status').innerText();
      assert.ok(state.startsWith('PASS: 2 STL model(s)'),state);
      return prepare.locator('#lab-download').evaluate(async link=>await(await fetch(link.href)).text());
    };
    const lowFlowText=await sliceWithFlowRatio('0.80');
    const highFlowText=await sliceWithFlowRatio('1.20');
    // Select XY extrusion motions, not M104/M140 commands, header metadata,
    // pure E retracts or travel-only moves.
    const extrusionValues=text=>text.split(/\r?\n/).map(line=>{
      const code=line.split(';')[0].trim();
      if(!/^G1\s/i.test(code)||!/\b[XY]-?\d/.test(code))return null;
      const match=code.match(/(?:^|\s)E(-?\d+(?:\.\d+)?)/i);
      return match?Number(match[1]):null;
    }).filter(n=>n!==null&&Number.isFinite(n));
    const lowE=extrusionValues(lowFlowText).slice(0,120);
    const highE=extrusionValues(highFlowText).slice(0,120);
    console.log('FLOW_RATIO_EXTRUSION_SAMPLES',JSON.stringify({
      lowCount:lowE.length,highCount:highE.length,low:lowE.slice(0,8),high:highE.slice(0,8)
    }));
    assert.ok(lowE.length>=30,'Expected genuine XY extrusion movements for flow check');
    assert.equal(lowE.length,highE.length,'Same print should retain comparable XY extrusion movements');
    const changed=lowE.filter((value,i)=>Math.abs(value-highE[i])>0.00001).length;
    assert.ok(changed>=10,'Actual numeric E extrusion values must respond to native flow ratio; G-code metadata alone is insufficient');
    console.log('PASS: native filament_flow_ratio 0.80 -> 1.20 changes '+changed+' real XY G1 E extrusion numbers');

    // Native filament_diameter is a physical filament cross-section option.
    // Verify an actual difference in XY G1 E commands, not only config text
    // or a G-code hash, while the remaining test conditions stay fixed.
    rawOrca[2].filament_flow_ratio=['0.98'];
    const sliceWithDiameter=async diameter=>{
      rawOrca[2].filament_diameter=[diameter];
      await uploadRawOrca();
      await prepare.locator('#lab-slice').click();
      await prepare.waitForFunction(()=>{
        const status=document.querySelector('#lab-status')?.textContent||'';
        return status.startsWith('PASS:')||status.startsWith('FAILED');
      },null,{timeout:120000});
      const state=await prepare.locator('#lab-status').innerText();
      assert.ok(state.startsWith('PASS: 2 STL model(s)'),state);
      return prepare.locator('#lab-download').evaluate(async link=>await(await fetch(link.href)).text());
    };
    const smallDiameterE=extrusionValues(await sliceWithDiameter('1.75')).slice(0,120);
    const largeDiameterE=extrusionValues(await sliceWithDiameter('2.85')).slice(0,120);
    assert.ok(smallDiameterE.length>=30,'Filament diameter probe needs real XY E extrusion');
    assert.equal(smallDiameterE.length,largeDiameterE.length,
      'Diameter-only change should preserve comparable XY deposition commands');
    const diameterChanged=smallDiameterE.filter((v,i)=>Math.abs(v-largeDiameterE[i])>0.00001).length;
    assert.ok(diameterChanged>=10,
      'Native filament_diameter must affect actual XY G1 E, not only G-code metadata');
    console.log('PASS: filament_diameter 1.75 -> 2.85 alters '+diameterChanged+
      ' real XY E values in accepted Chrome WASM');
    rawOrca[2].filament_diameter=['1.75'];

    // The official v2.5.0 Generic PLA multi-value max flow setting uses
    // extruder VARIANTS, not multiple filament slots. Test the actual WASM
    // G-code F feedrate, not the config trailer/hash or a fake session.
    rawOrca[3].filament_extruder_variant=[
      'Direct Drive Standard','Direct Drive High Flow','Direct Drive Extra High Flow',
      'Bowden Standard','Bowden High Flow','Bowden Extra High Flow',
    ];
    // Use two far-apart, bounded diagnostic caps to expose a real slowdown.
    rawOrca[3].filament_max_volumetric_speed=['0.7','40','40','0.7','40','40'];
    rawOrca[2].filament_flow_ratio=['0.98'];
    await uploadRawOrca();
    const sliceWithVariant=async variant=>{
      await prepare.locator('#lab-orca-filament-variant').fill(variant);
      await prepare.locator('#lab-slice').click();
      await prepare.waitForFunction(()=>{
        const s=document.querySelector('#lab-status')?.textContent||'';
        return s.startsWith('PASS:')||s.startsWith('FAILED');
      },null,{timeout:120000});
      const state=await prepare.locator('#lab-status').innerText();
      assert.ok(state.startsWith('PASS: 2 STL model(s)'),state);
      return prepare.locator('#lab-download').evaluate(async link=>await(await fetch(link.href)).text());
    };
    const limitedText=await sliceWithVariant('Direct Drive Standard');
    const fastText=await sliceWithVariant('Direct Drive High Flow');
    // Track modal F of XY+E moves; Orca often sets F on only the first move
    // of a path. Exclude travel-only and pure E retract commands.
    const extrusionFeeds=text=>{
      let feed=NaN;
      const rates=[];
      for(const line of text.split(/\r?\n/)){
        const code=line.split(';')[0].trim();
        if(!/^G1(?:\s|$)/i.test(code))continue;
        const f=code.match(/(?:^|\s)F(\d+(?:\.\d+)?)/i);
        if(f)feed=Number(f[1]);
        if(/(?:^|\s)E-?\d/.test(code)&&/(?:^|\s)[XY]-?\d/.test(code)&&Number.isFinite(feed))
          rates.push(feed);
      }
      return rates;
    };
    const slow=extrusionFeeds(limitedText),quick=extrusionFeeds(fastText);
    const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
    console.log('MAX_VOLUMETRIC_SPEED_FEEDS',JSON.stringify({
      slowCount:slow.length,quickCount:quick.length,
      slowMedian:median(slow),quickMedian:median(quick),
      slowMax:Math.max(...slow),quickMax:Math.max(...quick),
      slowSample:slow.slice(0,8),quickSample:quick.slice(0,8)
    }));
    assert.ok(slow.length>=20&&quick.length>=20,'Missing real extrusion feedrates');
    assert.ok(median(slow)<median(quick),
      'Selected native volumetric cap must change actual XY extrusion F rate, not merely metadata');
    console.log('PASS: explicit extruder-variant 0.7 vs 40 mm3/s changes median native G1 extrusion feedrate');

    // Selecting a native bed without raw Orca profiles must never fall back
    // to generic PLA output while silently ignoring the selected heater.
    await prepare.locator('#lab-orca-profiles').setInputFiles([]);
    await prepare.locator('#lab-orca-plate').selectOption('textured');
    await prepare.locator('#lab-slice').click();
    await prepare.waitForFunction(() =>
      (document.querySelector('#lab-status')?.textContent||'').startsWith('FAILED slicing:'),
      null,{timeout:120000});
    assert.match(await prepare.locator('#lab-status').innerText(),
      /Explicit bed selection requires a raw Orca profile collection/);
    assert.equal(await prepare.locator('#lab-download').isVisible(),false);
    console.log('PASS: explicit bed selection without profiles fails closed; no test G-code download');

    // Geometry-only OBJ is now converted into bounded binary STL locally,
    // then passed to the SAME accepted OrcaSlicer WASM engine. Materials and
    // OBJ units remain outside this diagnostic acceptance scope.
    await prepare.locator('#lab-orca-plate').selectOption('none');
    await prepare.locator('#lab-orca-filament-variant').fill('');
    await prepare.locator('#lab-preset-bundle').setInputFiles([]);
    await prepare.locator('#lab-process').setInputFiles([]);
    await prepare.locator('#remove-object').click();
    await prepare.locator('#remove-object').click();
    await prepare.locator('#object-count').getByText('0 objects').waitFor({timeout:30000});
    const cubeObj = [
      'v 0 0 0','v 20 0 0','v 20 20 0','v 0 20 0',
      'v 0 0 20','v 20 0 20','v 20 20 20','v 0 20 20',
      'f 1 4 3 2','f 5 6 7 8','f 1 2 6 5',
      'f 2 3 7 6','f 3 4 8 7','f 4 1 5 8',
    ].join('\n');
    await prepare.locator('#model-file').setInputFiles({
      name:'cube-from-obj.obj',mimeType:'text/plain',buffer:Buffer.from(cubeObj),
    });
    await prepare.locator('#object-count').getByText('1 object').waitFor({timeout:30000});
    assert.equal(await prepare.locator('#lab-slice').isEnabled(),true);
    await prepare.locator('#lab-slice').click();
    await prepare.waitForFunction(() => {
      const s=document.querySelector('#lab-status')?.textContent||'';
      return s.startsWith('PASS:') || s.startsWith('FAILED');
    },null,{timeout:120000});
    const objStatus=await prepare.locator('#lab-status').innerText();
    assert.match(objStatus,/^PASS: 1 STL\/OBJ mesh model\(s\)/);
    assert.equal(await prepare.locator('#lab-download').isVisible(),true);
    const objGcode=await prepare.locator('#lab-download').evaluate(async link=>
      await (await fetch(link.href)).text());
    const objPaths=parseGcodeToolpaths(objGcode);
    assert.ok(objPaths.layers.length>=3 && objPaths.extrusions>100,
      'OBJ geometry must produce actual multilayer native G-code deposition');
    console.log('PASS: OBJ displayed in Prepare -> bounded mesh-only STL conversion -> real WASM multilayer G-code ('+
      objPaths.layers.length+' layers, '+objPaths.extrusions+' extrusion segments; not print-ready)');

    // The pinned Orca documentation describes a narrow classic-wall gap
    // between perimeters. Probe a watertight 1.5 mm hollow ring rather than
    // assuming that an unrelated solid wedge contains gap-fill toolpaths.
    // This shape remains diagnostic-only; wall-generation mode is not proven.
    await prepare.locator('#remove-object').click();
    await prepare.locator('#object-count').getByText('0 objects').waitFor();
    await prepare.locator('#model-file').setInputFiles({
      name:'gap-test-ring.obj',mimeType:'text/plain',
      buffer:Buffer.from(makeGapRingObj()),
    });
    await prepare.locator('#object-count').getByText('1 object').waitFor({timeout:30000});
    const gapSettings={
      layer_height:0.3,wall_loops:2,outer_wall_speed:5,
      inner_wall_speed:8,travel_speed:20,sparse_infill_density:35,
      // Explicit classic walls can expose narrow-perimeter gap fill that
      // Arachne's adaptive width might absorb. This is a diagnostic probe,
      // not evidence of gap paths until feature-tagged G-code confirms them.
      wall_generator:'classic',gap_fill_target:'everywhere',
    };
    const sliceRing=async(name,settings,expectedStatus=/^PASS: 1 STL\/OBJ mesh model\(s\)/)=>{
      await prepare.locator('#lab-process').setInputFiles({
        name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(settings)),
      });
      await prepare.locator('#lab-slice').click();
      await prepare.waitForFunction(()=>{
        const status=document.querySelector('#lab-status')?.textContent||'';
        return status.startsWith('PASS:')||status.startsWith('FAILED');
      },null,{timeout:120000});
      assert.match(await prepare.locator('#lab-status').innerText(),expectedStatus);
      return prepare.locator('#lab-download').evaluate(async link=>
        await(await fetch(link.href)).text());
    };
    const ringBaseline=await sliceRing('gap-ring-baseline.json',gapSettings);
    const ringSlow=await sliceRing('gap-ring-slow.json',
      {...gapSettings,gap_infill_speed:2});
    const baselineFeeds=positiveExtrusionFeedrates(ringBaseline);
    const candidateFeeds=positiveExtrusionFeedrates(ringSlow);
    const newSlowFeeds=candidateFeeds.filter(f=>f>0&&f<=150&&
      !baselineFeeds.some(baseline=>Math.abs(baseline-f)<0.01));
    // Any new low F in generic extrusion is insufficient evidence of gap
    // speed support. An explicit ;TYPE: or ;FEATURE: marker must accompany
    // actual positive-E geometry before accepting a feature-specific PASS.
    const taggedGapMoves=code=>parseGcodeToolpaths(code).layers.flatMap(layer=>layer.segments)
      .filter(segment=>segment.extrusion&&
        (segment.feature==='gap infill'||segment.feature==='gap fill')&&
        Number.isFinite(segment.feedrateMmMin)&&segment.feedrateMmMin>0);
    const baselineGap=taggedGapMoves(ringBaseline);
    const candidateGap=taggedGapMoves(ringSlow);
    const gapRates=moves=>[...new Set(moves.map(s=>
      Math.round(s.feedrateMmMin*100)/100))].sort((a,b)=>a-b);
    const baselineGapFeeds=gapRates(baselineGap);
    const candidateGapFeeds=gapRates(candidateGap);
    const newSlowGapFeeds=candidateGapFeeds.filter(f=>f<=150&&
      !baselineGapFeeds.some(v=>Math.abs(v-f)<0.01));
    const verified=baselineGap.length>0&&candidateGap.length>0&&
      newSlowGapFeeds.length>0;
    const status=verified?'observed_tagged_gap_feedrate_effect':
      candidateGap.length>0||baselineGap.length>0?
      'gap_paths_observed_but_feedrate_unverified':
      newSlowFeeds.length>0?'inconclusive_unattributed_feedrate_change':
      'inconclusive_no_tagged_gap_paths';
    const gapReport={
      fixture:'watertight 40 x 40 x 8 mm OBJ ring with 1.5 mm walls (localhost only)',
      explicit_wall_generator:'classic',explicit_gap_fill_target:'everywhere',
      setting:'gap_infill_speed',candidate_mm_s:2,
      baseline_feedrates_mm_min:baselineFeeds,
      candidate_feedrates_mm_min:candidateFeeds,
      new_slow_feedrates_mm_min:newSlowFeeds,
      baseline_tagged_gap_extrusion_segments:baselineGap.length,
      candidate_tagged_gap_extrusion_segments:candidateGap.length,
      baseline_tagged_gap_feedrates_mm_min:baselineGapFeeds,
      candidate_tagged_gap_feedrates_mm_min:candidateGapFeeds,
      new_slow_tagged_gap_feedrates_mm_min:newSlowGapFeeds,
      result:status,native_desktop_parity:false,printer_safe:false,
    };
    await writeFile(parityDir+'/gap-ring-feature-diagnostic.json',
      JSON.stringify(gapReport,null,2)+'\n');
    console.log('GAP_RING_DIAGNOSTIC '+JSON.stringify(gapReport));
    // Classic/everywhere produced tagged gap deposition in the accepted
    // pinned Chrome run. Regressions must now FAIL rather than returning an
    // inconclusive green CI, including if only unrelated feedrates change.
    assert.ok(baselineGap.length>0 && candidateGap.length>0,
      'Expected real tagged gap-fill deposition in BOTH classic-mode slices: '+
      JSON.stringify(gapReport));
    assert.ok(verified && newSlowGapFeeds.some(f=>Math.abs(f-120)<0.01),
      'Expected target gap-feature extrusion feedrate F120 (2 mm/s): '+
      JSON.stringify(gapReport));
    console.log('PASS: tagged WASM gap-fill extrusion responds with F120 when gap_infill_speed=2; '+
      'baseline/candidate feature segments='+baselineGap.length+'/'+candidateGap.length);


    // Pinned classic thin walls are emitted as external perimeters.
    // Connected 0.30 mm wide, 12 mm long spur on a 10 mm square body;
    // explicit triangles (not concave OBJ n-gons) form a closed prism.
    {
      const xy=[[0,0],[10,0],[10,4.85],[22,4.85],[22,5.15],[10,5.15],[10,10],[0,10]];
      const cap=[[0,1,2],[0,2,5],[0,5,6],[0,6,7],[2,3,4],[2,4,5]];
      const obj=[0,3].flatMap(z=>xy.map(([x,y])=>'v '+x+' '+y+' '+z));
      for(const [a,b,c] of cap){
        obj.push('f '+[c+1,b+1,a+1].join(' '));
        obj.push('f '+[a+9,b+9,c+9].join(' '));
      }
      for(let i=0;i<xy.length;i++){
        const j=(i+1)%xy.length;
        obj.push('f '+[i+1,j+1,j+9].join(' '),'f '+[i+1,j+9,i+9].join(' '));
      }
      await prepare.locator('#remove-object').click();
      await prepare.locator('#object-count').getByText('0 objects').waitFor();
      await prepare.locator('#model-file').setInputFiles({
        name:'classic-thin-wall-spur.obj',mimeType:'text/plain',buffer:Buffer.from(obj.join('\n')+'\n'),
      });
      await prepare.locator('#object-count').getByText('1 object').waitFor({timeout:30000});
      const settings={layer_height:0.2,initial_layer_print_height:0.2,wall_loops:2,
        wall_generator:'classic',line_width:0.42,outer_wall_line_width:0.42,
        inner_wall_line_width:0.42,outer_wall_speed:12,inner_wall_speed:16,
        travel_speed:50,sparse_infill_density:20};
      const outer=code=>{
        const p=parseGcodeToolpaths(code);
        assert.equal(p.skippedMalformedMotion,0);
        assert.equal(p.skippedArcs,0);
        return p.layers.flatMap(layer=>layer.segments).filter(s=>
          s.feature==='outer wall'&&s.extrusion&&s.sourceMotion==='G1'&&
          [s.x1,s.x2,s.y1,s.y2,s.z1,s.z2,s.commandedPositiveEMm].every(Number.isFinite)&&
          s.commandedPositiveEMm>0&&Math.abs(s.z2-s.z1)<0.0005&&s.z2>=0.4-0.0005&&
          Math.hypot(s.x2-s.x1,s.y2-s.y1)>0.001);
      };
      const off=outer(await sliceRing('classic-thin-wall-off.json',{...settings,detect_thin_wall:'0'}));
      const on=outer(await sliceRing('classic-thin-wall-on.json',{...settings,detect_thin_wall:'1'}));
      assert.ok(off.length>=12&&on.length>=12,'Both slices require actual outer-wall deposition');
      // The same geometry is not moved. Relative X from the broad body's
      // left outer wall removes the global bed offset. Clip crossing strokes
      // at the distal threshold rather than requiring both endpoints inside.
      const left=segments=>segments.reduce((x,s)=>Math.min(x,s.x1,s.x2),Infinity);
      const x0=left(off),cut=x0+12;
      assert.ok(Math.abs(left(on)-x0)<0.25,'Broad body reference shifted unexpectedly');
      const summary=segments=>{
        const body=segments.filter(s=>Math.max(s.x1,s.x2)<x0+8);
        const distalLength=s=>{
          const lo=Math.min(s.x1,s.x2),hi=Math.max(s.x1,s.x2);
          const len=Math.hypot(s.x2-s.x1,s.y2-s.y1);
          return hi<=cut?0:lo>=cut?len:len*(hi-cut)/(hi-lo);
        };
        const spur=segments.filter(s=>distalLength(s)>0.001);
        const levels=ss=>[...new Set(ss.map(s=>Math.round(s.z2*1000)))].sort((a,b)=>a-b);
        return {body_strokes:body.length,body_z_um:levels(body),spur_strokes:spur.length,
          spur_z_um:levels(spur),spur_xy_mm:spur.reduce((n,s)=>n+distalLength(s),0)};
      };
      const report={off:summary(off),on:summary(on),native_desktop_parity:false,printer_ready:false};
      await writeFile(parityDir+'/classic-thin-wall-deposition.json',JSON.stringify(report,null,2)+'\n');
      console.log('CLASSIC_THIN_WALL_DEPOSITION '+JSON.stringify(report));
      assert.ok(report.off.body_z_um.length>=3&&report.on.body_strokes>=12,
        'Broad body needs real multilayer control deposition');
      assert.deepEqual(report.off.body_z_um,report.on.body_z_um,'Broad body layer cadence must remain fixed');
      assert.equal(report.off.spur_strokes,0,'Disabled classic thin wall must not deposit distal spur');
      assert.ok(report.on.spur_z_um.length>=3&&report.on.spur_xy_mm>5,
        'Enabled classic thin wall must deposit actual tagged distal spur strokes');
      console.log('PASS: classic thin-wall switch adds real distal outer-wall deposition; not native parity');
    }

    // A single ordinary cube isolates chronological wall order from thin-wall,
    // brim-first-layer and multiple-island effects. Inspect actual positive-E
    // strokes in parser insertion order, NOT just comments or role totals.
    {
      await prepare.locator('#remove-object').click();
      await prepare.locator('#object-count').getByText('0 objects').waitFor();
      await prepare.locator('#model-file').setInputFiles({
        name:'wall-order-cube.stl',mimeType:'model/stl',buffer:cube,
      });
      await prepare.locator('#object-count').getByText('1 object').waitFor({timeout:30000});
      const settings={layer_height:0.2,initial_layer_print_height:0.2,wall_loops:2,
        wall_generator:'classic',line_width:0.42,outer_wall_line_width:0.42,
        inner_wall_line_width:0.42,outer_wall_speed:12,inner_wall_speed:16,
        travel_speed:50,sparse_infill_density:20,top_shell_layers:2,bottom_shell_layers:2};
      const summarize=code=>{
        const p=parseGcodeToolpaths(code);
        assert.equal(p.skippedMalformedMotion,0);
        assert.equal(p.skippedArcs,0);
        const layers=[];
        for(const layer of p.layers){
          const strokes=layer.segments.filter(s=>s.extrusion&&s.sourceMotion==='G1'&&
            (s.feature==='outer wall'||s.feature==='inner wall')&&
            [s.x1,s.x2,s.y1,s.y2,s.z1,s.z2,s.commandedPositiveEMm].every(Number.isFinite)&&
            s.commandedPositiveEMm>0&&Math.abs(s.z2-s.z1)<0.0005&&s.z2>1&&s.z2<19&&
            Math.hypot(s.x2-s.x1,s.y2-s.y1)>0.001);
          if(!strokes.length)continue;
          const roles=strokes.map(s=>s.feature);
          assert.ok(roles.includes('inner wall')&&roles.includes('outer wall'),
            'Both wall roles must deposit in each sampled interior layer');
          layers.push({z_um:Math.round(strokes[0].z2*1000),first:roles[0],
            inner:roles.filter(r=>r==='inner wall').length,outer:roles.filter(r=>r==='outer wall').length});
        }
        return layers;
      };
      const innerFirst=summarize(await sliceRing('wall-order-inner-first.json',
        {...settings,wall_sequence:'inner wall/outer wall'},/^PASS: 1 STL model\(s\)/));
      const outerFirst=summarize(await sliceRing('wall-order-outer-first.json',
        {...settings,wall_sequence:'outer wall/inner wall'},/^PASS: 1 STL model\(s\)/));
      const report={inner_first:innerFirst,outer_first:outerFirst,native_desktop_parity:false,printer_ready:false};
      await writeFile(parityDir+'/classic-wall-order.json',JSON.stringify(report,null,2)+'\n');
      console.log('CLASSIC_WALL_ORDER '+JSON.stringify({inner_layers:innerFirst.length,outer_layers:outerFirst.length,
        inner_first_matches:innerFirst.filter(l=>l.first==='inner wall').length,
        outer_first_matches:outerFirst.filter(l=>l.first==='outer wall').length}));
      assert.ok(innerFirst.length>=10&&outerFirst.length>=10,'Need multiple interior layers');
      assert.deepEqual(innerFirst.map(l=>l.z_um),outerFirst.map(l=>l.z_um),'Wall layer cadence changed');
      assert.ok(innerFirst.every(l=>l.first==='inner wall'),'Inner/outer must start with actual inner deposition');
      assert.ok(outerFirst.every(l=>l.first==='outer wall'),'Outer/inner must start with actual outer deposition');
      console.log('PASS: actual classic wall deposition order responds to native enum; no native parity asserted');

      // Three classic walls: the pinned sandwich algorithm places the deeper
      // inner loop before the outer loop and the adjacent inner loop after it.
      // Keep this separate from the established two-wall gate above.
      const summarizeThree=code=>{
        const p=parseGcodeToolpaths(code);
        assert.equal(p.skippedMalformedMotion,0);
        assert.equal(p.skippedArcs,0);
        const layers=[];
        for(const layer of p.layers){
          const strokes=layer.segments.filter(s=>s.extrusion&&s.sourceMotion==='G1'&&
            (s.feature==='outer wall'||s.feature==='inner wall')&&
            [s.x1,s.x2,s.y1,s.y2,s.z1,s.z2,s.commandedPositiveEMm].every(Number.isFinite)&&
            s.commandedPositiveEMm>0&&Math.abs(s.z2-s.z1)<0.0005&&s.z2>1&&s.z2<19&&
            Math.hypot(s.x2-s.x1,s.y2-s.y1)>0.001);
          if(!strokes.length)continue;
          const runs=[];
          for(const s of strokes){
            if(runs.at(-1)?.role!==s.feature)runs.push({role:s.feature,strokes:[]});
            runs.at(-1).strokes.push(s);
          }
          layers.push({z_um:Math.round(strokes[0].z2*1000),runs:runs.map(run=>{
            const xs=run.strokes.flatMap(s=>[s.x1,s.x2]);
            const ys=run.strokes.flatMap(s=>[s.y1,s.y2]);
            return {role:run.role,count:run.strokes.length,
              span_x_um:Math.round((Math.max(...xs)-Math.min(...xs))*1000),
              span_y_um:Math.round((Math.max(...ys)-Math.min(...ys))*1000)};
          })});
        }
        return layers;
      };
      const modes=['inner wall/outer wall','outer wall/inner wall','inner-outer-inner wall'];
      const results=[];
      for(let i=0;i<modes.length;i++){
        results.push(summarizeThree(await sliceRing('wall-order-three-'+i+'.json',
          {...settings,wall_loops:3,wall_sequence:modes[i]},/^PASS: 1 STL model\(s\)/)));
      }
      const expected=['inner wall|outer wall','outer wall|inner wall','inner wall|outer wall|inner wall'];
      const observed=results.map((layers,i)=>({mode:modes[i],layers:layers.length,
        role_matches:layers.filter(l=>l.runs.map(r=>r.role).join('|')===expected[i]).length}));
      const hasNestedSpans=l=>{
        if(l.runs.length!==3)return false;
        const [deep,outer,adjacent]=l.runs;
        return ['span_x_um','span_y_um'].every(k=>
          outer[k]>adjacent[k]+100&&adjacent[k]>deep[k]+100&&deep[k]>0);
      };
      const nestedMatches=results[2].filter(hasNestedSpans).length;
      await writeFile(parityDir+'/classic-three-wall-order.json',JSON.stringify({
        modes,results,observed,nested_matches:nestedMatches,native_desktop_parity:false,printer_ready:false
      },null,2)+'\n');
      console.log('CLASSIC_THREE_WALL_ORDER '+JSON.stringify({observed,nested_matches:nestedMatches}));
      for(let i=0;i<results.length;i++){
        assert.ok(results[i].length>=10,'Need multiple three-wall interior layers');
        assert.deepEqual(results[i].map(l=>l.z_um),results[0].map(l=>l.z_um),'Three-wall cadence changed');
        assert.equal(observed[i].role_matches,results[i].length,'Unexpected three-wall chronological role runs: '+modes[i]);
      }
      assert.equal(nestedMatches,results[2].length,
        'Sandwich must deposit the deeper inner loop, outer loop, then adjacent inner loop');
      console.log('PASS: classic three-wall sandwich role and nested-span witness; no native parity asserted');

      // Independent surface toggles on the same flat-topped cube, with
      // nonzero top/bottom shells and explicit classic two-wall mode.
      const surfaceLayers=code=>{
        const p=parseGcodeToolpaths(code);
        assert.equal(p.skippedMalformedMotion,0);
        assert.equal(p.skippedArcs,0);
        const layers=[];
        for(const layer of p.layers){
          const strokes=layer.segments.filter(s=>s.extrusion&&s.sourceMotion==='G1'&&
            (s.feature==='outer wall'||s.feature==='inner wall')&&
            [s.x1,s.x2,s.y1,s.y2,s.z1,s.z2,s.commandedPositiveEMm].every(Number.isFinite)&&
            s.commandedPositiveEMm>0&&Math.abs(s.z2-s.z1)<0.0005&&
            Math.hypot(s.x2-s.x1,s.y2-s.y1)>0.001);
          if(!strokes.length)continue;
          const length=role=>strokes.filter(s=>s.feature===role)
            .reduce((total,s)=>total+Math.hypot(s.x2-s.x1,s.y2-s.y1),0);
          layers.push({z_um:Math.round(strokes[0].z2*1000),
            inner_mm:length('inner wall'),outer_mm:length('outer wall')});
        }
        return layers.sort((a,b)=>a.z_um-b.z_um);
      };
      const surfaceResults=[];
      for(const [top,first] of [['0','0'],['1','0'],['0','1']]){
        const code=await sliceRing('single-wall-surfaces-'+top+first+'.json',
          {...settings,wall_sequence:'inner wall/outer wall',
            only_one_wall_top:top,only_one_wall_first_layer:first},/^PASS: 1 STL model\(s\)/);
        surfaceResults.push(surfaceLayers(code));
      }
      const [bothOff,topOnly,firstOnly]=surfaceResults;
      await writeFile(parityDir+'/classic-single-wall-surfaces.json',JSON.stringify({
        both_off:bothOff,top_only:topOnly,first_only:firstOnly,
        native_desktop_parity:false,printer_ready:false
      },null,2)+'\n');
      console.log('CLASSIC_SINGLE_WALL_SURFACES '+JSON.stringify(surfaceResults.map(layers=>({
        layers:layers.length,first:layers[0],last:layers.at(-1)
      }))));
      assert.ok(bothOff.length>=10,'Need first, last and interior wall layers');
      for(const layers of surfaceResults){
        assert.deepEqual(layers.map(l=>l.z_um),bothOff.map(l=>l.z_um),'Surface toggle changed wall Z cadence');
        assert.ok(layers.every(l=>l.outer_mm>1),'Outer wall must remain present');
      }
      assert.ok(bothOff[0].inner_mm>1&&bothOff.at(-1).inner_mm>1,'Both-off control must have inner walls at both ends');
      assert.equal(topOnly.at(-1).inner_mm,0,'Top-only must remove the last-layer inner wall');
      assert.equal(firstOnly[0].inner_mm,0,'First-only must remove the first-layer inner wall');
      assert.ok(topOnly[0].inner_mm>1&&firstOnly.at(-1).inner_mm>1,'Opposite surface must retain its inner wall');
      for(let i=1;i<bothOff.length-1;i++){
        assert.ok(bothOff[i].inner_mm>1&&topOnly[i].inner_mm>1&&firstOnly[i].inner_mm>1,
          'Interior of flat cube must retain inner walls');
      }
      console.log('PASS: independent top and first layer classic single-wall deposition; not native parity');

      // Complete the nonzero-shell factorial, then compare matched zero-shell
      // controls. The source-pinned has_*_shell_layers gates depend on layer
      // count, not fill density. Never infer a wall effect from a profile echo.
      const bothOn=surfaceLayers(await sliceRing('single-wall-surfaces-11.json',
        {...settings,wall_sequence:'inner wall/outer wall',
          only_one_wall_top:'1',only_one_wall_first_layer:'1'},/^PASS: 1 STL model\(s\)/));
      const assertCadence=(actual,control)=>{
        assert.deepEqual(actual.map(l=>l.z_um),control.map(l=>l.z_um),
          'Single-wall shell gate changed wall Z cadence');
        assert.ok(actual.every(l=>l.outer_mm>1),'Outer wall must remain present');
      };
      assertCadence(bothOn,bothOff);
      assert.equal(bothOn[0].inner_mm,0,'Both-on must remove first-layer inner wall');
      assert.equal(bothOn.at(-1).inner_mm,0,'Both-on must remove last-layer inner wall');
      assert.ok(bothOn.slice(1,-1).every(l=>l.inner_mm>1),'Both-on must retain interior inner walls');
      const gated=[];
      for(const [topShell,bottomShell] of [[0,2],[2,0]]){
        const shellSettings={...settings,wall_sequence:'inner wall/outer wall',
          top_shell_layers:topShell,bottom_shell_layers:bottomShell,
          top_shell_thickness:0,bottom_shell_thickness:0};
        const pair=[];
        for(const toggle of ['0','1']){
          pair.push(surfaceLayers(await sliceRing('single-wall-shell-'+topShell+bottomShell+'-'+toggle+'.json',
            {...shellSettings,only_one_wall_top:toggle,only_one_wall_first_layer:toggle},
            /^PASS: 1 STL model\(s\)/)));
        }
        const [off,on]=pair;
        assert.ok(off.length>=10,'Zero-shell control must contain first, last and interior walls');
        assertCadence(off,bothOff);
        assertCadence(on,off);
        assert.ok(off.every(l=>l.inner_mm>1),'Zero-shell OFF control must have actual inner deposition');
        for(let i=0;i<off.length;i++){
          const remove=(i===0&&bottomShell>0)||(i===off.length-1&&topShell>0);
          if(remove)assert.equal(on[i].inner_mm,0,'Nonzero shell must permit the corresponding single-wall toggle');
          else assert.ok(Math.abs(on[i].inner_mm-off[i].inner_mm)<0.0001,
            'Disabled shell or interior must preserve inner-wall XY length');
          assert.ok(Math.abs(on[i].outer_mm-off[i].outer_mm)<0.0001,
            'Outer-wall XY length must remain unchanged');
        }
        gated.push({top_shell_layers:topShell,bottom_shell_layers:bottomShell,off,on});
      }
      await writeFile(parityDir+'/classic-single-wall-shell-gates.json',JSON.stringify({
        both_on:bothOn,gated,native_desktop_parity:false,printer_ready:false
      },null,2)+'\n');
      console.log('CLASSIC_SINGLE_WALL_SHELL_GATES '+JSON.stringify(gated.map(g=>({
        top:g.top_shell_layers,bottom:g.bottom_shell_layers,layers:g.on.length,
        off_first:g.off[0],on_first:g.on[0],off_last:g.off.at(-1),on_last:g.on.at(-1)
      }))));
      console.log('PASS: classic simultaneous toggles and independent zero-shell gates; not native parity');

      // Arachne has a separate perimeter generator; do not infer its behavior
      // from the classic result. Test the flat cube before stepped surfaces.
      const arachneResults=[];
      for(const [top,first] of [['0','0'],['1','0'],['0','1'],['1','1']]){
        const code=await sliceRing('arachne-single-wall-'+top+first+'.json',
          {...settings,wall_generator:'arachne',wall_sequence:'inner wall/outer wall',
            only_one_wall_top:top,only_one_wall_first_layer:first},/^PASS: 1 STL model\(s\)/);
        arachneResults.push({top,first,layers:surfaceLayers(code)});
      }
      const arachneControl=arachneResults[0].layers;
      const arachneSummary=arachneResults.map(({top,first,layers})=>({
        top,first,layers:layers.length,first_layer:layers[0],last_layer:layers.at(-1),
        interior_with_inner:layers.slice(1,-1).filter(l=>l.inner_mm>1).length
      }));
      await writeFile(parityDir+'/arachne-single-wall-surfaces.json',JSON.stringify({
        results:arachneResults,native_desktop_parity:false,printer_ready:false
      },null,2)+'\n');
      console.log('ARACHNE_SINGLE_WALL_SURFACES '+JSON.stringify(arachneSummary));
      assert.ok(arachneControl.length>=10&&arachneControl.every(l=>l.inner_mm>1),
        'Arachne control must deposit actual inner walls on all cube layers');
      for(const {top,first,layers} of arachneResults){
        assertCadence(layers,arachneControl);
        assert.equal(layers[0].inner_mm===0,first==='1',
          'Arachne first layer must follow its own toggle');
        assert.equal(layers.at(-1).inner_mm===0,top==='1',
          'Arachne final layer must follow its own toggle');
        if(first==='0')assert.ok(layers[0].inner_mm>1,'Arachne first-layer inner deposition missing');
        if(top==='0')assert.ok(layers.at(-1).inner_mm>1,'Arachne top-layer inner deposition missing');
        assert.ok(layers.slice(1,-1).every(l=>l.inner_mm>1),
          'Arachne flat cube must retain interior inner deposition');
      }
      console.log('PASS: Arachne independent and simultaneous flat-cube surface toggles; not native parity');
    }

    // A through-tunnel bridge arch gives the slicer a real unsupported roof.
    // Unlike the earlier two cubes this shape has a geometric bridge region,
    // but evidence must still come from tagged positive-E native G-code.
    await prepare.locator('#remove-object').click();
    await prepare.locator('#object-count').getByText('0 objects').waitFor();
    await prepare.locator('#model-file').setInputFiles({
      name:'bridge-arch-diagnostic.obj',mimeType:'text/plain',
      buffer:Buffer.from(makeBridgeArchObj()),
    });
    await prepare.locator('#object-count').getByText('1 object').waitFor({timeout:30000});
    const bridgeSettings={
      layer_height:0.25,wall_loops:2,outer_wall_speed:12,
      inner_wall_speed:16,travel_speed:50,sparse_infill_density:20,
      wall_generator:'classic',bridge_speed:40,
    };
    const bridgeBaseline=await sliceRing('bridge-arch-baseline.json',bridgeSettings);
    const bridgeSlow=await sliceRing('bridge-arch-2mm-s.json',
      {...bridgeSettings,bridge_speed:2});
    const bridgeBaselinePaths=parseGcodeToolpaths(bridgeBaseline);
    const bridgeSlowPaths=parseGcodeToolpaths(bridgeSlow);
    assert.ok(bridgeBaselinePaths.extrusions>50&&bridgeSlowPaths.extrusions>50,
      'Bridge arch must produce real multilayer deposited G-code in BOTH runs');
    const allSegments=paths=>paths.layers.flatMap(layer=>layer.segments);
    const bridgeReport={
      fixture:'watertight 40x20x15 mm OBJ arch; 16x20 mm open tunnel to Z10',
      setting:'bridge_speed',baseline_mm_s:40,candidate_mm_s:2,
      ...auditBridgeSpeedSegments(allSegments(bridgeBaselinePaths),
        allSegments(bridgeSlowPaths),120),
      baseline_layers:bridgeBaselinePaths.layers.length,
      candidate_layers:bridgeSlowPaths.layers.length,
      baseline_total_extrusions:bridgeBaselinePaths.extrusions,
      candidate_total_extrusions:bridgeSlowPaths.extrusions,
    };
    await writeFile(parityDir+'/bridge-arch-feature-diagnostic.json',
      JSON.stringify(bridgeReport,null,2)+'\n');
    console.log('BRIDGE_ARCH_DIAGNOSTIC '+JSON.stringify(bridgeReport));
    // Both slices have now emitted 279 explicit bridge-tagged segments in
    // real isolated Chrome. Treat losing tagged bridge deposition or the new
    // F120 response as a regression, not an inconclusive green build.
    assert.ok(bridgeReport.baseline_tagged_bridge_extrusion_segments>0 &&
      bridgeReport.candidate_tagged_bridge_extrusion_segments>0 &&
      bridgeReport.target_feedrate_observed,
      'Expected new F120 on genuine tagged bridge extrusion: '+
      JSON.stringify(bridgeReport));
    console.log('PASS: tagged WASM bridge extrusion changes to F120 on actual arch geometry');

    // Native bridge_flow independently scales extrusion, NOT bridge F.
    // Use the exact same unsupported-roof arch, speeds and process options.
    // Evaluate real tagged positive-E XY G1 lines; a changed header, total
    // unclassified E, or G-code SHA is not a flow witness.
    const bridgeFlowLow=await sliceRing('bridge-arch-flow-055.json',
      {...bridgeSettings,bridge_flow:0.55});
    const bridgeLowPaths=parseGcodeToolpaths(bridgeFlowLow);
    const bridgeLinearE=paths=>paths.layers.flatMap(layer=>layer.segments)
      .filter(s=>s.extrusion && String(s.feature||'').includes('bridge') &&
        Number.isFinite(s.commandedPositiveEMm) && s.commandedPositiveEMm>0)
      .map(s=>s.commandedPositiveEMm);
    const baselineBridgeE=bridgeLinearE(bridgeBaselinePaths);
    const reducedBridgeE=bridgeLinearE(bridgeLowPaths);
    assert.ok(baselineBridgeE.length>10 && reducedBridgeE.length>10,
      'Both slices must contain actual bridge-tagged G1 XY+E paths');
    const sumBridgeE=items=>items.reduce((sum,value)=>sum+value,0);
    const baselineBridgeESum=sumBridgeE(baselineBridgeE);
    const reducedBridgeESum=sumBridgeE(reducedBridgeE);
    assert.ok(reducedBridgeESum>0 &&
      reducedBridgeESum<baselineBridgeESum*0.95,
      'bridge_flow=0.55 must reduce actual tagged bridge positive E, not only metadata: '+
      JSON.stringify({baselineBridgeESum,reducedBridgeESum}));
    console.log('PASS: isolated WASM bridge_flow=0.55 reduces tagged bridge G1 commanded E; '+
      JSON.stringify({baselineBridgeESum,reducedBridgeESum,
        baselineTaggedSegments:baselineBridgeE.length,
        candidateTaggedSegments:reducedBridgeE.length}));


    // Internal bridging is a distinct native flow option. Probe two
    // identical actual Chrome/WASM arch slices with explicit fixed regular
    // bridge_flow=0.95 and only internal_bridge_flow changed (1 -> 0.55).
    // The arch may have *no* internal-bridge deposition: record that as
    // inconclusive, never as a PASS on conventional Bridge paths.
    const internalFlowSettings={...bridgeSettings,bridge_flow:0.95};
    const internalFlowBase=await sliceRing('bridge-arch-internal-flow-100.json',
      {...internalFlowSettings,internal_bridge_flow:1});
    const internalFlowReduced=await sliceRing('bridge-arch-internal-flow-055.json',
      {...internalFlowSettings,internal_bridge_flow:0.55});
    const internalFlowReport={
      fixture:'same watertight 40x20x15 mm arch (localhost only)',
      changed_native_key:'internal_bridge_flow',
      baseline_multiplier:1,candidate_multiplier:0.55,
      fixed_bridge_flow:0.95,
      ...auditInternalBridgeFlowSegments(
        allSegments(parseGcodeToolpaths(internalFlowBase)),
        allSegments(parseGcodeToolpaths(internalFlowReduced))),
    };
    await writeFile(parityDir+'/bridge-arch-internal-flow-diagnostic.json',
      JSON.stringify(internalFlowReport,null,2)+'\n');
    console.log('INTERNAL_BRIDGE_FLOW_DIAGNOSTIC '+JSON.stringify(internalFlowReport));
    // This pinned real-engine arch emitted 180 internal and 107 ordinary
    // bridge-positive-E G1 segments in the first accepted run. Promote
    // the independently measured effect to a hard CI acceptance gate:
    // a header/hash-only or ordinary-bridge-only change must now FAIL.
    assert.equal(internalFlowReport.result,'observed_internal_bridge_flow_effect',
      'Expected reduced *internal* tagged E and unchanged external bridge control: '+
      JSON.stringify(internalFlowReport));
    console.log('PASS: actual tagged internal bridge E decreases while external bridge control remains stable');

    // A first REAL positive support-generation gate. This is an explicitly
    // opted-in native enable_support=1 on the isolated localhost fixture,
    // NEVER the default public experience or a physical-printer setting.
    // Reuse the *same* watertight arch with an unsupported horizontal roof;
    // compare tagged positive-E XY deposition with only the support toggle
    // changed. A header flag or a bridge feature cannot count as support.
    const supportArchSettings={
      ...bridgeSettings,
      support_line_width:0.42,support_speed:30,support_interface_speed:30,
    };
    const archSupportOff=await sliceRing('bridge-arch-support-off.json',
      {...supportArchSettings,enable_support:'0'});
    const archSupportOn=await sliceRing('bridge-arch-support-on.json',
      {...supportArchSettings,enable_support:'1'});
    const supportOffAudit=auditSupportDeposition(parseGcodeToolpaths(archSupportOff));
    const supportOnAudit=auditSupportDeposition(parseGcodeToolpaths(archSupportOn));
    const supportArchReport={
      fixture:'watertight 40x20x15 mm OBJ arch; 16x20 mm unsupported tunnel to Z10',
      engine:'pinned v2.5.0 WASM candidate; isolated localhost opt-in',
      changed_native_key:'enable_support',baseline:'0',candidate:'1',
      baseline_audit:supportOffAudit,candidate_audit:supportOnAudit,
      native_desktop_parity:false,printer_safe:false,public_pages_enabled:false,
    };
    await writeFile(parityDir+'/bridge-arch-support-on-feature-diagnostic.json',
      JSON.stringify(supportArchReport,null,2)+'\n');
    console.log('BRIDGE_ARCH_SUPPORT_DIAGNOSTIC '+JSON.stringify(supportArchReport));
    assert.equal(supportOffAudit.result,'no_tagged_support_body_or_interface',
      'Disabled support produced positive-E XY support feature paths');
    // A fully bridged arch need not generate auto-support, even when enabled.
    // Keep this diagnostic as a NEGATIVE/INCONCLUSIVE control instead of
    // turning legitimate bridge behavior into a false positive or CI failure.
    console.log('BRIDGE_SUPPORT_CLASSIFICATION '+supportOnAudit.result);

    // The pinned native support-modifier smoke uses a sphere underside at
    // support_threshold_angle=10. The source-pinned PrintConfig tooltip
    // clarifies that only slopes BELOW the threshold request support;
    // the prior 10-degree probe gave zero. Probe a sphere with 70 degrees
    // using identical geometry and all process keys for OFF and ON runs.
    // No G-code hash, config metadata, or bridge-only tag can pass this gate.
    await prepare.locator('#remove-object').click();
    await prepare.locator('#object-count').getByText('0 objects').waitFor();
    await prepare.locator('#model-file').setInputFiles({
      name:'low-poly-support-sphere.obj',mimeType:'text/plain',
      buffer:Buffer.from(makeSupportSphereObj()),
    });
    await prepare.locator('#object-count').getByText('1 object').waitFor({timeout:30000});
    // Previously ensure_all only proved profile acceptance on two cubes.
    // The sphere has real sloped sidewalls. Hold the same geometry and all
    // process values fixed, varying ONLY the pinned native vertical-shell
    // enum. Compare explicit internal-solid tagged positive-E planar XY lines,
    // never a changed header, total G-code hash or unrelated wall feature.
    // A lack of an observed path difference is an INCONCLUSIVE measurement,
    // not an invented pass; the geometry may not trigger this native mode.
    const slopeShellSettings={
      ...supportArchSettings,enable_support:'0',
      top_shell_layers:1,bottom_shell_layers:1,
      top_shell_thickness:0,bottom_shell_thickness:0,
      sparse_infill_density:15,
    };
    const slopeNoEnsure=await sliceRing('sphere-vertical-shell-none.json',
      {...slopeShellSettings,ensure_vertical_shell_thickness:'none'});
    const slopeEnsureAll=await sliceRing('sphere-vertical-shell-all.json',
      {...slopeShellSettings,ensure_vertical_shell_thickness:'ensure_all'});
    const slopeShellAudit=auditVerticalShellDeposition(
      parseGcodeToolpaths(slopeNoEnsure),parseGcodeToolpaths(slopeEnsureAll));
    const slopeShellReport={
      fixture:'unchanged watertight sloped 20 mm low-poly sphere OBJ, single plate',
      engine:'pinned v2.5.0 WASM; isolated localhost opt-in',
      changed_native_key:'ensure_vertical_shell_thickness',
      baseline:'none',candidate:'ensure_all',
      fixed_process:{
        enable_support:'0',top_shell_layers:1,bottom_shell_layers:1,
        top_shell_thickness_mm:0,bottom_shell_thickness_mm:0,
        sparse_infill_density_percent:15,
      },
      ...slopeShellAudit,
    };
    await writeFile(parityDir+'/sphere-vertical-shell-mode-deposition.json',
      JSON.stringify(slopeShellReport,null,2)+'\n');
    console.log('VERTICAL_SHELL_SLOPE_DIAGNOSTIC '+JSON.stringify(slopeShellReport));
    assert.ok(slopeShellAudit.baseline.positive_e_xy_strokes_all_features>100 &&
      slopeShellAudit.candidate.positive_e_xy_strokes_all_features>100,
      'Both sloped geometry modes must generate genuine positive-E planar XY paths');
    // The pinned candidate produced distinct, explicitly tagged internal
    // solid deposition in both runs in the first accepted real Chrome job.
    // Guard against regressions: no inconclusive green for this fixture.
    assert.equal(slopeShellAudit.result,
      'observed_internal_solid_stroke_signature_difference',
      'Changing only vertical-shell mode must alter genuine internal-solid XY deposition: '+
      JSON.stringify(slopeShellReport));
    assert.ok(slopeShellAudit.changed_internal_solid_z_count>0,
      'Expected at least one changed internal-solid Z stratum');
    console.log('PASS: vertical shell enum changes tagged internal-solid XY strokes on the sloped sphere (not native parity)');

    const sphereSupportOff=await sliceRing('sphere-support-off.json',
      {...supportArchSettings,enable_support:'0'});
    const sphereSupportOn=await sliceRing('sphere-support-on.json',
      {...supportArchSettings,enable_support:'1'});
    const sphereOffAudit=auditSupportDeposition(parseGcodeToolpaths(sphereSupportOff));
    const sphereOnAudit=auditSupportDeposition(parseGcodeToolpaths(sphereSupportOn));
    // Archive bounded evidence about the actual G-code as well as parsed
    // feature paths. This distinguishes an ignored toggle from a parser
    // classification gap without retaining printer-executable G-code.
    const summarizeSphereGcode=text=>{
      const parsed=parseGcodeToolpaths(text);
      const byFeature=Object.create(null);
      for(const layer of parsed.layers)for(const segment of layer.segments){
        if(!segment.extrusion)continue;
        const feature=String(segment.feature||'(unlabelled)').toLowerCase();
        byFeature[feature]=(byFeature[feature]||0)+1;
      }
      const lines=text.split(/\r?\n/);
      const comments=lines.filter(line=>
        /^\s*;\s*(?:TYPE|FEATURE)\s*:/i.test(line));
      const motion=lines.map(line=>line.split(';')[0].trim())
        .filter(line=>/^G(?:0|1|2|3)(?:\s|$)/i.test(line))
        .map(line=>line.replace(/\s+/g,' '));
      return {
        sha256:createHash('sha256').update(text).digest('hex'),
        utf8_bytes:Buffer.byteLength(text),
        extrusion_segments:parsed.extrusions,
        gcode_motion_commands:motion.length,
        gcode_motion_sha256:createHash('sha256').update(motion.join(String.fromCharCode(10))).digest('hex'),
        parsed_positive_e_features:Object.fromEntries(
          Object.entries(byFeature).sort((a,b)=>b[1]-a[1]).slice(0,24)),
        tagged_comment_count:comments.length,
        support_tagged_comment_count:comments.filter(line=>/support/i.test(line)).length,
      };
    };
    const sphereOutputDifference={
      disabled:summarizeSphereGcode(sphereSupportOff),
      enabled:summarizeSphereGcode(sphereSupportOn),
      exact_gcode_equal:sphereSupportOff===sphereSupportOn,
    };
    console.log('SPHERE_SUPPORT_GCODE_SUMMARY '+JSON.stringify(sphereOutputDifference));
    const sphereReport={
      fixture:'watertight 20 mm diameter low-poly sphere, lower point at Z0',
      engine:'pinned v2.5.0 WASM candidate; isolated localhost opt-in',
      fixed_native_support_type:'normal(auto)',fixed_threshold_angle_degrees:70,
      changed_native_key:'enable_support',baseline:0,candidate:1,
      baseline_audit:sphereOffAudit,candidate_audit:sphereOnAudit,
      gcode_evidence:sphereOutputDifference,
      native_desktop_parity:false,printer_safe:false,public_pages_enabled:false,
    };
    await writeFile(parityDir+'/sphere-support-on-feature-diagnostic.json',
      JSON.stringify(sphereReport,null,2)+'\n');
    console.log('SPHERE_SUPPORT_DIAGNOSTIC '+JSON.stringify(sphereReport));
    assert.equal(sphereOffAudit.result,'no_tagged_support_body_or_interface',
      'Disabled sphere auto-support produced positive-E XY support deposition');
    assert.equal(sphereOnAudit.result,'tagged_support_body_or_interface_observed',
      'Enabled sphere must generate genuine tagged support body/interface XY deposition');
    assert.ok(sphereOnAudit.roles.body.extrusion_xy_segments>0 ||
      sphereOnAudit.roles.interface.extrusion_xy_segments>0,
      'Support-enabled sphere changed only metadata or unrelated toolpaths');

    // Source-pinned v2.5.0 speed settings were previously accepted by the
    // native-json adapter while support was OFF. Here require real tagged
    // positive-E XY support movement with support ON and a changed role-
    // specific F, leaving the sphere, support toggle, width, threshold,
    // and every other process key identical to the positive baseline.
    // Low 3 mm/s is deliberately diagnostic: capped high speeds in the
    // support-on baseline need not equal the configured 30 mm/s.
    const sphereBodySlow=await sliceRing('sphere-support-body-3mm-s.json',
      {...supportArchSettings,enable_support:'1',support_speed:3});
    const sphereInterfaceSlow=await sliceRing('sphere-support-interface-3mm-s.json',
      {...supportArchSettings,enable_support:'1',support_interface_speed:3});
    const referenceSupportPaths=parseGcodeToolpaths(sphereSupportOn);
    const bodySlowPaths=parseGcodeToolpaths(sphereBodySlow);
    const interfaceSlowPaths=parseGcodeToolpaths(sphereInterfaceSlow);
    const bodySpeedEffect=auditSupportSpeedEffect(
      referenceSupportPaths,bodySlowPaths,'body',180);
    const interfaceSpeedEffect=auditSupportSpeedEffect(
      referenceSupportPaths,interfaceSlowPaths,'interface',180);
    const speedReport={
      fixture:'same watertight 20 mm diameter support-enabled sphere',
      engine:'pinned v2.5.0 WASM; isolated localhost opt-in',
      fixed_enable_support:'1',fixed_support_threshold_angle_degrees:70,
      baseline_support_body_mm_s:30,baseline_support_interface_mm_s:30,
      body_candidate:{changed_native_key:'support_speed',value_mm_s:3,
        ...bodySpeedEffect},
      interface_candidate:{changed_native_key:'support_interface_speed',value_mm_s:3,
        ...interfaceSpeedEffect},
      native_desktop_parity:false,printer_safe:false,public_pages_enabled:false,
    };
    await writeFile(parityDir+'/sphere-support-role-speed-diagnostic.json',
      JSON.stringify(speedReport,null,2)+'\n');
    console.log('SPHERE_SUPPORT_ROLE_SPEED_DIAGNOSTIC '+JSON.stringify(speedReport));
    assert.equal(bodySpeedEffect.result,'observed_tagged_support_feedrate_effect',
      'Support body 3 mm/s must produce a new tagged F180 on unchanged gross geometry: '+
      JSON.stringify(bodySpeedEffect));
    assert.equal(interfaceSpeedEffect.result,'observed_tagged_support_feedrate_effect',
      'Support interface 3 mm/s must produce a new tagged F180 on unchanged gross geometry: '+
      JSON.stringify(interfaceSpeedEffect));
    console.log('PASS: actual isolated WASM support body and interface independently respond to low-speed overrides with role-tagged F180; no native parity asserted');

    // The previous pass only proved support speed. Compare support-line
    // width using two identical support-enabled sphere sessions, changing
    // ONLY the absolute support_line_width 0.32 -> 0.72 mm. Require a real
    // role-tagged positive-E G1 XY material-feed change; reject header-only
    // differences. The scanner accounts for M82/M83 and G92 E. This
    // represents commanded filament length, not volume or desktop parity.
    const sphereWidthNarrow=await sliceRing('sphere-support-width-032mm.json',
      {...supportArchSettings,enable_support:'1',support_line_width:0.32});
    const sphereWidthWide=await sliceRing('sphere-support-width-072mm.json',
      {...supportArchSettings,enable_support:'1',support_line_width:0.72});
    const supportWidthEffect=auditSupportWidthEffect(
      sphereWidthNarrow,sphereWidthWide);
    const widthReport={
      fixture:'same watertight 20 mm support-enabled sphere',
      fixed_enable_support:'1',fixed_support_threshold_angle_degrees:70,
      changed_native_key:'support_line_width',
      narrow_width_mm:0.32,wide_width_mm:0.72,
      ...supportWidthEffect,
      public_pages_enabled:false,
    };
    await writeFile(parityDir+'/sphere-support-width-filament-diagnostic.json',
      JSON.stringify(widthReport,null,2)+'\n');
    console.log('SPHERE_SUPPORT_WIDTH_FILAMENT_DIAGNOSTIC '+
      JSON.stringify(widthReport));
    assert.equal(supportWidthEffect.result,
      'observed_support_body_filament_feed_difference',
      'Support line width must alter actually deposited, role-tagged G1 XY filament E: '+
      JSON.stringify(supportWidthEffect));
    console.log('PASS: actual isolated WASM support line width changes role-tagged positive-E XY filament feed; no native parity asserted');

    console.log('PASS: actual isolated WASM sphere produces support-tagged positive-E XY motion only when explicitly enabled; no native parity asserted');



  } finally {
    await prepare.close();
  }
  // Separate isolated, explicitly opted-in 3MF viewport acceptance gate.
  // Use the ACTUAL two-cube 3MF emitted by the pinned WASM candidate above.
  // The browser renders this via ThreeMFLoader: it does not edit a native
  // C++ project, and the candidate exporter has already flattened objects.
  const mfPage = await browser.newPage({viewport:{width:1440,height:900}});
  try {
    const response = await mfPage.goto(base + '?engineLab=1', {waitUntil:'domcontentloaded'});
    assert.equal(response.status(),200);
    await mfPage.locator('#viewport-canvas canvas').waitFor({state:'visible',timeout:90000});
    await mfPage.locator('#model-file').setInputFiles({
      name:'wasm-multiobject-native.3mf',mimeType:'model/3mf',
      buffer:await readFile('parity-output/wasm-multiobject-3mf.3mf'),
    });
    await mfPage.locator('#object-count').getByText('1 object').waitFor({timeout:30000});
    assert.match(await mfPage.locator('#file-status').innerText(),/isolated 3MF build-item selection/);
    const bounds = await mfPage.evaluate(() => globalThis.__layer3mfViewportAudit?.());
    assert.ok(Array.isArray(bounds) && bounds.length===1,'Isolated 3MF diagnostics missing');
    const item=bounds[0];
    assert.ok(item.meshCount>=1,'ThreeMFLoader produced no visible mesh');
    assert.equal(item.mode,'isolated-3mf-plate-origin-only');
    assert.ok(Math.abs(item.viewerPosition[0]+128)<1e-5);
    assert.ok(Math.abs(item.viewerPosition[1]+128)<1e-5);
    assert.ok(item.boundsMm.min.every(Number.isFinite) && item.boundsMm.max.every(Number.isFinite));
    const xExtent=item.boundsMm.max[0]-item.boundsMm.min[0];
    assert.ok(Math.abs(xExtent-80)<2,'Unexpected 3MF build transform X extent: '+xExtent);
    assert.ok(item.boundsMm.min[0]<-30 && item.boundsMm.max[0]>30,
      'Two WASM 3MF geometry clusters did not map to expected centered plate coordinates');
    console.log('PASS: isolated 3MF viewport native build placement (80 mm X extent, lower-left to centered plate mapping); grouping limitation remains');

    // Independent 3MF Core fixture with TWO distinct <build> placements.
    // Unlike the native exporter above, this scene preserves both build
    // entries. Test opt-in viewer selection/transform on each separately.
    await mfPage.locator('#remove-object').click();
    await mfPage.locator('#object-count').getByText('0 objects').waitFor();
    await mfPage.locator('#model-file').setInputFiles({
      name:'synthetic-two-build.3mf',mimeType:'model/3mf',
      buffer:await readFile('parity-output/two-build-items.3mf'),
    });
    await mfPage.locator('#object-count').getByText('2 objects').waitFor({timeout:30000});
    const before=await mfPage.evaluate(()=>globalThis.__layer3mfViewportAudit?.());
    assert.deepEqual(before.map(item=>item.buildIndex),[1,2]);
    // Real end-to-end test for the read-only Prepare 3MF inspector. Unlike
    // its mock unit tests, this loads the pinned pthread WASM candidate and
    // sends the original selected Core archive through the actual UI button.
    // The browser viewer remains independent of the native engine.
    assert.equal(await mfPage.locator('#lab-inspect-3mf').isDisabled(),true,
      '3MF inspection must require an explicitly loaded local engine');
    assert.equal(await mfPage.locator('#lab-slice').isDisabled(),true,
      'Native 3MF inspection must never enable unvalidated slicing');
    await mfPage.locator('#lab-js').setInputFiles({
      name:'slicer-mt.js',mimeType:'text/javascript',
      buffer:await readFile(artifactDir+'/slicer-mt.js'),
    });
    await mfPage.locator('#lab-wasm').setInputFiles({
      name:'slicer-mt.wasm',mimeType:'application/wasm',
      buffer:await readFile(artifactDir+'/slicer-mt.wasm'),
    });
    await mfPage.locator('#lab-load').click();
    await mfPage.waitForFunction(()=>{
      const state=document.querySelector('#lab-status')?.textContent??'';
      return state.startsWith('Ready:')||state.startsWith('FAILED');
    },null,{timeout:120000});
    assert.match(await mfPage.locator('#lab-status').innerText(),
      /^Ready: OrcaSlicer 2\.5\.0/);
    assert.equal(await mfPage.locator('#lab-inspect-3mf').isEnabled(),true,
      'A selected 3MF must enable read-only native inspection');
    await mfPage.locator('#lab-inspect-3mf').click();
    await mfPage.waitForFunction(()=>{
      const state=document.querySelector('#lab-status')?.textContent??'';
      return state.startsWith('Native 3MF read-only import:')||
        state.startsWith('Native 3MF inspection FAILED:');
    },null,{timeout:90000});
    const inspection=await mfPage.locator('#lab-status').innerText();
    assert.match(inspection,/^Native 3MF read-only import: .*2 instances,/,
      'Native WASM must expose both independent Core 3MF build placements');
    assert.match(inspection,/Browser build items: 2\. Counts agree/);
    assert.match(inspection,/Native manifest relations: IDs (unique|duplicate|unavailable), links (valid|broken|unavailable|unverified), affine matrices (valid|invalid|unavailable)\./,
      'The real WASM response must disclose only bounded relation classifications');
    // This particular two-build Core fixture has matching transform-anchor
    // separation, independent of the global -128 mm browser bed offset.
    // This is NOT a general object/mesh placement identity test.
    assert.match(inspection,/Native\/viewer anchor spacing: consistent \(1 pairs\)/);
    // A second, independent real-browser gate compares native and viewer
    // 3x3 affine linear parts; no instance-ID correspondence is assumed.
    assert.match(inspection,/Native\/viewer linear parts: consistent \(2 instances\)/);
    assert.match(inspection,/Native\/viewer affine frame offsets: common-offset \(2 uniquely matched instances\)/,
      'Two identical linear maps with distinct anchors require a unique common-translation assignment');
    assert.match(inspection,/Shared native mesh local-origin hypothesis: ambiguous \(0 matched shared-mesh instances; not proof\)\./,
      'Duplicate linear transformations do not identify native/viewer mesh frame pairs');
    assert.match(inspection,/Native-converted\/viewer world facets: consistent \(24 triangles\)/);
    assert.match(inspection,/Viewer build-facet partition: separable \(2 viewer builds\)/);
    console.log('NATIVE_3MF_LINEAR_PARITY '+
      inspection.match(/Native\/viewer linear parts: [^.]+\./)[0]);
    console.log('NATIVE_3MF_ANCHOR_SPACING '+
      inspection.match(/Native\/viewer anchor spacing: [^.]+\./)[0]);
    console.log('NATIVE_3MF_RELATION_AUDIT '+inspection.match(/Native manifest relations: IDs [^.]+\./)[0]);
    assert.match(inspection,/No edit, export or print approval\./);
    assert.deepEqual(await mfPage.evaluate(()=>globalThis.__layer3mfViewportAudit?.()),before,
      'Read-only native 3MF inspection must not alter the Three.js viewport');
    assert.equal(await mfPage.locator('#lab-slice').isDisabled(),true,
      'Inspecting a 3MF must not enable unsupported native slicing');
    console.log('PASS: selected original two-build 3MF -> real isolated Prepare WASM inspector -> two native instances; viewport unchanged and no slice enabled');
    assert.ok(before.every(item=>item.meshCount>0),'Expected a renderable mesh per build entry');
    assert.ok(Math.abs(before[0].boundsMm.min[0]+38)<0.01);
    assert.ok(Math.abs(before[0].boundsMm.max[0]+18)<0.01);
    assert.ok(Math.abs(before[1].boundsMm.min[0]-22)<0.01);
    assert.ok(Math.abs(before[1].boundsMm.max[0]-42)<0.01);
    await mfPage.locator('#object-tree [data-object-id]').nth(1).click();
    assert.ok(Math.abs(Number(await mfPage.locator('#transform-x').inputValue())-150)<0.01,
      'Build 2 transform input must expose its original 3MF X position');
    await mfPage.locator('#transform-x').fill('155');
    await mfPage.locator('#transform-x').press('Tab');
    const edited=await mfPage.evaluate(()=>globalThis.__layer3mfViewportAudit?.());
    assert.ok(Math.abs(edited[1].boundsMm.min[0]-before[1].boundsMm.min[0]-5)<0.01,
      'Editing build 2 must translate only its own mesh in the viewer');
    assert.deepEqual(edited[0].boundsMm,before[0].boundsMm,
      'Editing build 2 must not move build 1');
    await mfPage.locator('#remove-object').click();
    await mfPage.locator('#object-count').getByText('1 object').waitFor();
    const afterDelete=await mfPage.evaluate(()=>globalThis.__layer3mfViewportAudit?.());
    assert.equal(afterDelete.length,1);
    assert.equal(afterDelete[0].buildIndex,1);
    assert.deepEqual(afterDelete[0].boundsMm,before[0].boundsMm);
    console.log('PASS: isolated two-build 3MF viewport has separate selectable/editable viewer instances; native export/save remains unavailable');

    // The previous fixture was translation-only. Test a genuinely rotated,
    // nonuniformly scaled Core 3MF in real Chrome and with the real pthread
    // WASM engine, not only with synthetic JavaScript audit matrices.
    await mfPage.locator('#remove-object').click();
    await mfPage.locator('#object-count').getByText('0 objects').waitFor();
    await mfPage.locator('#model-file').setInputFiles({
      name:'two-build-rotated-scaled.3mf',mimeType:'model/3mf',
      buffer:await readFile('parity-output/two-build-rotated-scaled.3mf'),
    });
    await mfPage.locator('#object-count').getByText('2 objects').waitFor({timeout:30000});
    const rotatedBefore=await mfPage.evaluate(()=>globalThis.__layer3mfViewportAudit?.());
    assert.deepEqual(rotatedBefore.map(item=>item.buildIndex),[1,2]);
    assert.ok(rotatedBefore.every(item=>item.meshCount>0),'Each affine fixture build must render');
    const approx=(actual,expected)=>Math.abs(actual-expected)<0.02;
    // Independent corners of a 20-mm cube under local (1.5,.75,1.25)
    // scale, 30-degree Z rotation and Core translation (90,90,0);
    // the viewer then subtracts the centered 128-mm plate offset.
    const first=rotatedBefore[0].boundsMm;
    assert.ok(approx(first.min[0],-45.5) && approx(first.max[0],-12.01923789) &&
      approx(first.min[1],-38) && approx(first.max[1],-10.00961894) &&
      approx(first.min[2],0) && approx(first.max[2],25),
      'Rotated/scaled 3MF first build must retain its independent world-space bounds');
    const second=rotatedBefore[1].boundsMm;
    assert.ok(approx(second.min[0],22) && approx(second.max[0],42) &&
      approx(second.min[1],-38) && approx(second.max[1],-18) &&
      approx(second.min[2],0) && approx(second.max[2],20),
      'Unedited sibling build must preserve its original bounds');
    assert.equal(await mfPage.locator('#lab-inspect-3mf').isEnabled(),true);
    await mfPage.locator('#lab-inspect-3mf').click();
    await mfPage.waitForFunction(()=>{
      const state=document.querySelector('#lab-status')?.textContent??'';
      return state.startsWith('Native 3MF read-only import:')||
        state.startsWith('Native 3MF inspection FAILED:');
    },null,{timeout:90000});
    const rotatedReport=await mfPage.locator('#lab-status').innerText();
    assert.match(rotatedReport,/^Native 3MF read-only import: .*2 instances,/);
    // Real WASM normalizes the imported rotated/scaled Core transform so
    // its exposed instance translation anchors do NOT retain the same
    // separation as ThreeMFLoader build-item anchors. Record this as a
    // reproducible known gap; never label the complete placement as parity.
    assert.match(rotatedReport,/Native\/viewer anchor spacing: mismatch \(1 pairs\)/);
    console.log('KNOWN GAP: rotated/nonuniform Core 3MF native/viewer transform-anchor spacing mismatch; mesh-level world parity unverified');
    assert.match(rotatedReport,/Native\/viewer linear parts: consistent \(2 instances\)/);
    assert.match(rotatedReport,/Native\/viewer affine frame offsets: instance-dependent \(2 uniquely matched instances\)/,
      'Rotated native/viewer anchor gap cannot be explained by one global bed translation');
    assert.match(rotatedReport,/Shared native mesh local-origin hypothesis: insufficient-shared-instances \(0 matched shared-mesh instances; not proof\)\./,
      'Two transforms cannot independently validate a shared local mesh reframe hypothesis');
    assert.match(rotatedReport,/Native-converted\/viewer world facets: consistent \(24 triangles\)/,
      'Rotated Core triangles must match native WASM converted geometry');
    assert.match(rotatedReport,/Viewer build-facet partition: separable \(2 viewer builds\)/,
      'Rotated native facets must remain separable by their visible builds');
    console.log('NATIVE_3MF_WORLD_FACETS '+
      rotatedReport.match(/Native-converted\/viewer world facets: [^.]+\./)[0]);
    assert.deepEqual(await mfPage.evaluate(()=>globalThis.__layer3mfViewportAudit?.()),
      rotatedBefore,'Read-only inspection of rotated/scaled 3MF must not modify the viewport');
    assert.equal(await mfPage.locator('#lab-slice').isDisabled(),true,
      'Rotated/scaled 3MF diagnostics must not enable unsupported slicing');
    console.log('PASS: real isolated Chrome/WASM rotated/nonuniform Core 3MF: linear terms consistent, independent Three.js world bounds verified; native anchor spacing MISMATCH explicitly retained, no print approval');

    // The two previous builds reference the SAME cube mesh. That cannot
    // reveal every wrong objectid -> mesh mapping. In this independent test
    // the second resource has a different size, while the <build> item order
    // is reversed (object 2 first, transformed object 1 second).
    for (const remaining of [1, 0]) {
      await mfPage.locator('#object-tree [data-object-id]').first().click();
      await mfPage.locator('#remove-object').click();
      await mfPage.locator('#object-count')
        .getByText(remaining === 1 ? '1 object' : '0 objects').waitFor();
    }
    await mfPage.locator('#model-file').setInputFiles({
      name:'two-build-distinct-reversed.3mf', mimeType:'model/3mf',
      buffer:await readFile('parity-output/two-build-distinct-reversed.3mf'),
    });
    await mfPage.locator('#object-count').getByText('2 objects').waitFor({timeout:30000});
    const distinctBefore=await mfPage.evaluate(()=>globalThis.__layer3mfViewportAudit?.());
    assert.deepEqual(distinctBefore.map(item=>item.buildIndex),[1,2]);
    assert.ok(distinctBefore.every(item=>item.meshCount>0));
    // Build item 1 now uses object 2: (10 x 15 x 25) mm at (150,90,0).
    // Build item 2 uses object 1: rotated/nonuniform 20-mm cube at (90,90,0).
    const distinctFirst=distinctBefore[0].boundsMm;
    const distinctSecond=distinctBefore[1].boundsMm;
    assert.ok(approx(distinctFirst.min[0],22) && approx(distinctFirst.max[0],32) &&
      approx(distinctFirst.min[1],-38) && approx(distinctFirst.max[1],-23) &&
      approx(distinctFirst.min[2],0) && approx(distinctFirst.max[2],25),
      'Reordered first build must use the distinct second resource, not the original cube');
    assert.ok(approx(distinctSecond.min[0],-45.5) && approx(distinctSecond.max[0],-12.01923789) &&
      approx(distinctSecond.min[1],-38) && approx(distinctSecond.max[1],-10.00961894) &&
      approx(distinctSecond.min[2],0) && approx(distinctSecond.max[2],25),
      'Reordered second build must retain the rotated/scaled original resource');
    await mfPage.locator('#lab-inspect-3mf').click();
    await mfPage.waitForFunction(()=>{
      const state=document.querySelector('#lab-status')?.textContent??'';
      return state.startsWith('Native 3MF read-only import:')||
        state.startsWith('Native 3MF inspection FAILED:');
    },null,{timeout:90000});
    const distinctReport=await mfPage.locator('#lab-status').innerText();
    assert.match(distinctReport,/^Native 3MF read-only import: .*2 instances,/);
    assert.match(distinctReport,/Native-converted\/viewer world facets: consistent \(24 triangles\)/,
      'Real WASM and viewer must agree on BOTH distinct resources after build reordering');
    assert.match(distinctReport,/Viewer build-facet partition: separable \(2 viewer builds\)/,
      'Distinct/reordered builds must be separable without relying on item order');
    assert.deepEqual(await mfPage.evaluate(()=>globalThis.__layer3mfViewportAudit?.()),
      distinctBefore,'Distinct/reversed Core inspection must not change the viewport');
    assert.equal(await mfPage.locator('#lab-slice').isDisabled(),true,
      'Unverified 3MF project slicing must remain disabled');
    console.log('PASS: real Chrome/WASM distinct two-resource 3MF with reversed build order: 24 world triangles consistent; no edit/export/print approval');


    // Three different affine transforms referencing a single shared Core
    // mesh make the reframe residual test independent of a two-instance fit.
    // This is still a read-only local diagnostic, NOT 3MF save/slice parity.
    for (const remaining of [1, 0]) {
      await mfPage.locator('#object-tree [data-object-id]').first().click();
      await mfPage.locator('#remove-object').click();
      await mfPage.locator('#object-count')
        .getByText(remaining === 1 ? '1 object' : '0 objects').waitFor();
    }
    await mfPage.locator('#model-file').setInputFiles({
      name:'three-build-shared-mesh.3mf', mimeType:'model/3mf',
      buffer:await readFile('parity-output/three-build-shared-mesh.3mf'),
    });
    await mfPage.locator('#object-count').getByText('3 objects').waitFor({timeout:30000});
    const threeBefore=await mfPage.evaluate(()=>globalThis.__layer3mfViewportAudit?.());
    assert.deepEqual(threeBefore.map(item=>item.buildIndex),[1,2,3]);
    assert.ok(threeBefore.every(item=>item.meshCount>0));
    const thirdBounds=threeBefore[2].boundsMm;
    assert.ok(approx(thirdBounds.min[0],67) && approx(thirdBounds.max[0],83) &&
      approx(thirdBounds.min[1],-38) && approx(thirdBounds.max[1],-14) &&
      approx(thirdBounds.min[2],0) && approx(thirdBounds.max[2],18),
      'Independent third Core transform bounds must match a 0.8/1.2/0.9 scale');
    await mfPage.locator('#lab-inspect-3mf').click();
    await mfPage.waitForFunction(()=>{
      const state=document.querySelector('#lab-status')?.textContent??'';
      return state.startsWith('Native 3MF read-only import:')||
        state.startsWith('Native 3MF inspection FAILED:');
    },null,{timeout:90000});
    const threeReport=await mfPage.locator('#lab-status').innerText();
    assert.match(threeReport,/^Native 3MF read-only import: .*3 instances,/);
    assert.match(threeReport,/Native\/viewer linear parts: consistent \(3 instances\)/);
    assert.match(threeReport,/Native-converted\/viewer world facets: consistent \(36 triangles\)/);
    assert.match(threeReport,/Viewer build-facet partition: separable \(3 viewer builds\)/);
    // The previous geometry check deliberately ignored face orientation.
    // Real pinned WASM must now report an independent, bounded winding
    // classification. Mixed/reversed is a diagnostic gap, never parity PASS.
    assert.match(threeReport,
      /Native-converted\/viewer facet winding \(vertex order only\): (consistent|reversed|mixed|ambiguous) \(36 triangles; not mesh-ID parity\)/,
      'The real Chrome/WASM winding witness must evaluate all 36 converted facets');
    console.log('NATIVE_3MF_WORLD_WINDING '+
      threeReport.match(/Native-converted\/viewer facet winding \(vertex order only\): [^.]+\./)[0]);

    // Independent source-of-truth comparison: the source Core triangle indices
    // and row-vector affines were extracted from the actual fixture ZIP by
    // Python, NOT from ThreeMFLoader or the WASM STL converter. The *other*
    // browser tab holds only the locally selected pinned WASM candidate.
    // Do not expose original vertices, file contents, or engine on Pages.
    const coreSource = JSON.parse(await readFile(
      'parity-output/three-build-source-facets.json','utf8'));
    assert.equal(coreSource.source,'synthetic-core-indices');
    assert.equal(coreSource.builds,3);
    assert.equal(coreSource.comparedTriangles,36);
    const coreArchive = Array.from(await readFile('parity-output/three-build-shared-mesh.3mf'));
    const nativeVsSource = await page.evaluate(async ({facets,archive}) => {
      const engine=window.__layerDiagnosticEngine?.engine;
      if(typeof engine?.threeMfToStl!=='function')
        throw new Error('Pinned WASM Core conversion is unavailable in isolated Chrome');
      const {auditNative3mfWorldFacets,auditNative3mfWorldFacetWinding} =
        await import('./scripts/audit-native-3mf-world-facets.mjs');
      const {auditNative3mfStlNormalAlignment} =
        await import('./scripts/audit-native-3mf-stl-normals.mjs');
      const nativeStl=await engine.threeMfToStl(new Uint8Array(archive));
      return {
        shape:auditNative3mfWorldFacets(nativeStl,facets),
        winding:auditNative3mfWorldFacetWinding(nativeStl,facets),
        normals:auditNative3mfStlNormalAlignment(nativeStl),
      };
    },{facets:coreSource.facets,archive:coreArchive});
    assert.deepEqual(nativeVsSource.shape,
      {facets:'consistent',comparedTriangles:36},
      'Core source geometry MUST match the independently converted native STL');
    assert.equal(nativeVsSource.winding.comparedTriangles,36);
    assert.ok(['aligned','opposed','mixed','inconsistent','unavailable'].includes(
      nativeVsSource.normals.normalAlignment));
    assert.equal(nativeVsSource.normals.comparedTriangles,
      nativeVsSource.normals.normalAlignment==='unavailable' ? 0 : 36,
      'STL normal-field witness must never invent partial triangle coverage');
    console.log('NATIVE_3MF_STL_NORMAL_FIELD: '+
      nativeVsSource.normals.normalAlignment+
      ' (advisory facet normals vs STL vertex winding; not Core importer parity)');
    assert.ok(['consistent','reversed','mixed','ambiguous'].includes(
      nativeVsSource.winding.winding),
      'Source/Core to WASM orientation must be independently classified');
    const wasmVsViewer=threeReport.split(
      'Native-converted/viewer facet winding (vertex order only): ')[1]
      ?.split(' (36 triangles;')[0];
    assert.ok(wasmVsViewer,'Native vs viewer orientation witness must be present');
    // Immutable pinned v2.5.0 candidate exhibits an explicit known gap:
    // the flattened STL reverses the original source Core facet order.
    // Require this evidence to be reviewed if the pinned artifact ever differs;
    // do NOT treat reversal as a successful orientation parity result.
    assert.equal(nativeVsSource.winding.winding,'reversed',
      'Pinned native WASM must retain its observed Core-source winding discrepancy');
    assert.equal(wasmVsViewer,'reversed',
      'Pinned native WASM versus ThreeMFLoader winding discrepancy changed');
    console.log('NATIVE_3MF_SOURCE_CORE_WINDING: original Core -> WASM '+
      nativeVsSource.winding.winding+'; WASM -> ThreeMFLoader '+wasmVsViewer+
      ' (36 synthetic triangles; orientation only, not mesh or print parity)');

    // Controlled sign flip: this independent Core fixture changes ONLY
    // triangle v2/v3 order. Its vertices, three build transforms, objects
    // and world geometry are identical to the negative-volume baseline.
    // If the importer repairs negative signed volume on load, the original
    // negative source should read "reversed" (above) but the positive
    // source should read "consistent" when independently converted to STL.
    // Both are inspected locally; never enable these bytes on public Pages.
    const positiveSource = JSON.parse(await readFile(
      'parity-output/three-build-positive-source-facets.json','utf8'));
    assert.equal(positiveSource.source,'synthetic-core-indices');
    assert.equal(positiveSource.builds,3);
    assert.equal(positiveSource.comparedTriangles,36);
    const positiveArchive = Array.from(await readFile(
      'parity-output/three-build-positive-winding.3mf'));
    const positiveNative = await page.evaluate(async ({facets,archive}) => {
      const engine=window.__layerDiagnosticEngine?.engine;
      if(typeof engine?.threeMfToStl!=='function')
        throw new Error('Pinned WASM Core conversion is unavailable');
      const {auditNative3mfWorldFacets,auditNative3mfWorldFacetWinding} =
        await import('./scripts/audit-native-3mf-world-facets.mjs');
      const nativeStl=await engine.threeMfToStl(new Uint8Array(archive));
      return {
        shape:auditNative3mfWorldFacets(nativeStl,facets),
        winding:auditNative3mfWorldFacetWinding(nativeStl,facets),
      };
    },{facets:positiveSource.facets,archive:positiveArchive});
    assert.deepEqual(positiveNative.shape,
      {facets:'consistent',comparedTriangles:36},
      'Positive Core winding must preserve the same 36 world triangle locations');
    assert.equal(positiveNative.winding.comparedTriangles,36);
    console.log('NATIVE_3MF_SIGN_CONTROL: negative-volume Core -> WASM '+
      nativeVsSource.winding.winding+'; positive-volume Core -> WASM '+
      positiveNative.winding.winding+
      ' (36 synthetic faces each; unchanged world geometry, not print parity)');
    assert.equal(positiveNative.winding.winding,'consistent',
      'A positive-volume control should not receive the baseline negative-volume face flip');
    console.log('PASS: real pinned WASM Core negative/positive signed-volume '+
      'control isolates importer auto-orientation as the cause of source/STL winding reversal');

    // Observed in the pinned v2.5.0 WASM: one shared Core resource is
    // imported as THREE separate native manifest meshes/objects. Therefore
    // a mesh-ID-based "shared local origin" solver has zero eligible groups;
    // never infer a common pivot from matching world-space geometry alone.
    assert.match(threeReport,/^Native 3MF read-only import: 3 objects, 3 instances, 3 meshes,/,
      'Pin the real native normalization cardinality, not the original Core resource count');
    assert.match(threeReport,/Shared native mesh local-origin hypothesis: insufficient-shared-instances \(0 matched shared-mesh instances; not proof\)\./,
      'Distinct native mesh IDs must not be silently grouped by source Core object ID');
    console.log('KNOWN GAP: pinned native 3MF importer expands one shared Core mesh to 3 native meshes; shared-mesh reframe residual is not identifiable from native mesh IDs alone');
    assert.deepEqual(await mfPage.evaluate(()=>globalThis.__layer3mfViewportAudit?.()),
      threeBefore,'Third shared-mesh 3MF inspection must not alter viewport');
    assert.equal(await mfPage.locator('#lab-slice').isDisabled(),true,
      'The synthetic three-build 3MF must not enable unverified printer slicing');
    console.log('PASS: real isolated Chrome/WASM three-build source-mesh duplication detected without false reframe parity; 36 world facets consistent; no printing');



  } finally {
    await mfPage.close();
  }
} finally {
  await browser.close();
}
