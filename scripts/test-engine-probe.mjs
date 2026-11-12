// Real browser smoke: probe the archived v2.5.0 candidate only on isolated
// localhost, never by publishing a WASM engine to GitHub Pages.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
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
      {type:'filament',name:'Generic PLA @System',nozzle_temperature:'210',bed_temperature:'55',hot_plate_temp:['65'],hot_plate_temp_initial_layer:['75']},
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
    assert.match(nativeStatus,/2 unsupported keys excluded/);
    const nativeHash=await prepare.locator('#lab-download').evaluate(async link=>{
      const digest=await crypto.subtle.digest('SHA-256',await(await fetch(link.href)).arrayBuffer());
      return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
    });
    assert.notEqual(nativeHash,inheritedHash,'Three-domain raw Orca settings must change WASM output');
    console.log('PASS: indexed Orca vendor machine+filament+process inheritance → WASM G-code');
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
    const thermalCommands=text=>text.split(/\\r?\\n/).filter(line=>/^M(?:140|190)\\b/i.test(line.trim()));
    const before=thermalCommands(hotText);
    const after=thermalCommands(warmerText);
    console.log('HOT_PLATE_THERMAL_COMMANDS',JSON.stringify({before:before.slice(0,8),after:after.slice(0,8)}));
    assert.notDeepEqual(after,before,'Initial layer hot plate temperature must change real bed heater G-code (not merely metadata)');
    console.log('PASS: explicit first-layer hot plate temperature changes real WASM bed heater commands');



  } finally {
    await prepare.close();
  }
} finally {
  await browser.close();
}
