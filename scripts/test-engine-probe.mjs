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
    assert.match(result, /^PASS: prepare-cube\.stl/);
    assert.equal(await prepare.locator('#lab-download').isVisible(), true);
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
    assert.ok(transformedResult.startsWith('PASS: prepare-cube.stl'), transformedResult);
    const transformedHash = await prepare.locator('#lab-download').evaluate(async link => {
      const bytes = await (await fetch(link.href)).arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256',bytes);
      return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
    });
    assert.notEqual(transformedHash,initialHash,'Native output must change after Prepare transform');
    console.log('PASS: numeric Prepare position/rotation/scale alter real WASM G-code');
  } finally {
    await prepare.close();
  }
} finally {
  await browser.close();
}
