// Real browser smoke: probe the archived v2.5.0 candidate only on isolated
// localhost, never by publishing a WASM engine to GitHub Pages.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseGcodeToolpaths} from './gcode-preview-parser.mjs';
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
  const triangles = [
    [[0,0,0],[20,0,0],[20,20,0]], [[0,0,0],[20,20,0],[0,20,0]],
    [[0,0,20],[20,20,20],[20,0,20]], [[0,0,20],[0,20,20],[20,20,20]],
    [[0,0,0],[20,0,20],[20,0,0]], [[0,0,0],[0,0,20],[20,0,20]],
    [[0,20,0],[20,20,0],[20,20,20]], [[0,20,0],[20,20,20],[0,20,20]],
    [[0,0,0],[0,20,0],[0,20,20]], [[0,0,0],[0,20,20],[0,0,20]],
    [[20,0,0],[20,0,20],[20,20,20]], [[20,0,0],[20,20,20],[20,20,0]],
  ];
  const cube = Buffer.alloc(84 + 50 * triangles.length);
  cube.writeUInt32LE(triangles.length, 80);
  triangles.forEach((tri, i) => tri.forEach((vertex, v) => vertex.forEach((value, axis) =>
    cube.writeFloatLE(value, 84 + i * 50 + 12 + v * 12 + axis * 4))));
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
  assert.ok(parsedGcode.layers.length >= 2, 'Expected multiple sliced Z layers');
  assert.ok(parsedGcode.extrusions > 10, 'Expected positive extrusion toolpaths');
  const actualGcodeHash = createHash('sha256').update(wasmGcode, 'utf8').digest('hex');
  const parityDir = process.env.PARITY_OUTPUT_DIR || 'parity-output';
  await mkdir(parityDir, {recursive:true});
  await writeFile(parityDir + '/wasm.gcode', wasmGcode, 'utf8');
  await writeFile(parityDir + '/wasm-gcode-summary.json', JSON.stringify({
    engine:'OrcaSlicer WASM candidate', version:'2.5.0', api:'0.7.0',
    fixture:'synthetic 12-triangle cube; generic PLA development profile only',
    gcode_sha256:actualGcodeHash, bytes:Buffer.byteLength(wasmGcode,'utf8'),
    layers:parsedGcode.layers.length, extrusion_segments:parsedGcode.extrusions,
    travel_segments:parsedGcode.travels
  }, null, 2) + '\\n');

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
    assert.equal(await prepare.locator('.gcode-3d-preview').isVisible(),true);
    assert.equal(await prepare.locator('#lab-3d-canvas canvas').isVisible(),true);
    assert.ok(Number(await prepare.locator('#lab-3d-canvas').getAttribute('data-segment-count'))>0);
    const initial3DMax=Number(await prepare.locator('#lab-3d-layer-range').getAttribute('max'));
    assert.ok(initial3DMax>0);
    await prepare.locator('#lab-3d-layer-range').fill('0');
    assert.equal(await prepare.locator('#lab-3d-canvas').getAttribute('data-visible-layers'),'1');
    await prepare.locator('#lab-3d-layer-range').fill(String(initial3DMax));
    assert.equal(await prepare.locator('#lab-3d-canvas').getAttribute('data-visible-layers'),String(initial3DMax+1));
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
      {type:'filament',name:'Generic PLA @System',nozzle_temperature:'210',nozzle_temperature_initial_layer:['235'],bed_temperature:'55',hot_plate_temp:['65'],hot_plate_temp_initial_layer:['75']},
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
