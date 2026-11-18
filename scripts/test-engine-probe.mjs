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
import {makeParityCubeStl, PARITY_CUBE_STL_SHA256} from './parity-cube-fixture.mjs';
import {auditWasmCubeDeposition} from './audit-wasm-cube-deposition.mjs';
import {auditWasmSkirtDistance} from './audit-wasm-skirt-distance.mjs';
import {auditBridgeSpeedSegments} from './bridge-feature-diagnostic.mjs';
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
    const sliceRing=async(name,settings)=>{
      await prepare.locator('#lab-process').setInputFiles({
        name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(settings)),
      });
      await prepare.locator('#lab-slice').click();
      await prepare.waitForFunction(()=>{
        const status=document.querySelector('#lab-status')?.textContent||'';
        return status.startsWith('PASS:')||status.startsWith('FAILED');
      },null,{timeout:120000});
      assert.match(await prepare.locator('#lab-status').innerText(),
        /^PASS: 1 STL\/OBJ mesh model\(s\)/);
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

  } finally {
    await mfPage.close();
  }
} finally {
  await browser.close();
}
