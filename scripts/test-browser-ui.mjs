// Real-browser acceptance check for the public Prepare frontend.
// No WASM candidate binaries are published or used by this test.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const site = process.env.UI_TEST_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl',
         '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('response', response => {
  if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
});

function makeBinarySTL() {
  const result = Buffer.alloc(84 + 50 * 12);
  result.write('Layer Workbench browser smoke cube', 0, 'ascii');
  const triangles = [
    [[0,0,0],[20,0,0],[20,20,0]], [[0,0,0],[20,20,0],[0,20,0]],
    [[0,0,20],[20,20,20],[20,0,20]], [[0,0,20],[0,20,20],[20,20,20]],
    [[0,0,0],[20,0,20],[20,0,0]], [[0,0,0],[0,0,20],[20,0,20]],
    [[0,20,0],[20,20,0],[20,20,20]], [[0,20,0],[20,20,20],[0,20,20]],
    [[0,0,0],[0,20,0],[0,20,20]], [[0,0,0],[0,20,20],[0,0,20]],
    [[20,0,0],[20,0,20],[20,20,20]], [[20,0,0],[20,20,20],[20,20,0]],
  ];
  result.writeUInt32LE(triangles.length, 80);
  for (let i = 0; i < triangles.length; i++) {
    const offset = 84 + i * 50;
    triangles[i].forEach((vertex, vertexIndex) =>
      vertex.forEach((component, axis) =>
        result.writeFloatLE(component, offset + 12 + vertexIndex * 12 + axis * 4)));
  }
  return result;
}

try {
  await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('#viewport-canvas canvas').waitFor({ state: 'visible', timeout: 90000 });
  assert.equal(await page.title(), 'Layer Workbench');
  const initialStatus = await page.locator('#file-status').innerText();
  assert.match(initialStatus, /Ready|No model/);

  await page.locator('#model-file').setInputFiles({
    name: 'test-cube.stl',
    mimeType: 'model/stl',
    buffer: makeBinarySTL(),
  });
  await page.locator('#object-count').getByText('1 object').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /test-cube\.stl/i }).waitFor();
  assert.equal(await page.locator('[data-transform="translate"]').isEnabled(), true);
  assert.equal(await page.locator('[data-transform="rotate"]').isEnabled(), true);
  assert.equal(await page.locator('[data-transform="scale"]').isEnabled(), true);

  await page.locator('[data-transform="rotate"]').click();
  assert.equal(await page.locator('[data-transform="rotate"]').evaluate(el => el.classList.contains('active-tool')), true);
  await page.locator('[data-transform="scale"]').click();
  assert.equal(await page.locator('[data-transform="scale"]').evaluate(el => el.classList.contains('active-tool')), true);
  await page.locator('[data-transform="translate"]').click();
  await page.locator('#fit-view').click();

  // Top and Front must visibly change the real WebGL camera without touching
  // the model transform, selecting an engine, or changing the original STL.
  const modelX = await page.locator('#transform-x').inputValue();
  const topButton = page.locator('[data-view-orientation="top"]');
  const frontButton = page.locator('[data-view-orientation="front"]');
  const threeDButton = page.locator('[data-view-orientation="3d"]');
  assert.equal(await topButton.isEnabled(), true);
  assert.equal(await frontButton.isEnabled(), true);
  await topButton.click();
  await page.locator('#fit-view').click();
  assert.equal(await topButton.getAttribute('aria-pressed'), 'true');
  assert.equal(await threeDButton.getAttribute('aria-pressed'), 'false');
  const topView = await page.locator('#viewport-canvas canvas').screenshot();
  await frontButton.click();
  await page.locator('#fit-view').click();
  assert.equal(await frontButton.getAttribute('aria-pressed'), 'true');
  const frontView = await page.locator('#viewport-canvas canvas').screenshot();
  assert.equal(topView.equals(frontView), false,
    'Top and Front must render different camera directions');
  assert.equal(await page.locator('#transform-x').inputValue(), modelX,
    'switching views must not edit the selected model');
  await threeDButton.click();
  assert.equal(await threeDButton.getAttribute('aria-pressed'), 'true');
  assert.equal(await frontButton.getAttribute('aria-pressed'), 'false');

  // Duplication is a viewer-only STL/OBJ operation, with independent object
  // transforms and independent selection highlights (not a native 3MF edit).
  const duplicateButton = page.locator('#duplicate-object');
  assert.equal(await duplicateButton.isEnabled(), true);
  const originalX = Number(await page.locator('#transform-x').inputValue());
  const originalY = Number(await page.locator('#transform-y').inputValue());
  await duplicateButton.click();
  await page.locator('#object-count').getByText('2 objects').waitFor();
  assert.equal(await page.locator('#object-tree [data-object-id]').count(), 2);
  assert.match(await page.locator('#file-status').innerText(), /browser viewport only/);
  assert.ok(Math.abs(Number(await page.locator('#transform-x').inputValue()) - originalX - 20) < 0.001);
  assert.ok(Math.abs(Number(await page.locator('#transform-y').inputValue()) - originalY - 20) < 0.001);
  await page.locator('#transform-x').fill('57');
  await page.locator('#transform-x').press('Tab');
  assert.equal(Number(await page.locator('#transform-x').inputValue()), 57);
  await page.locator('#object-tree [data-object-id]').first().click();
  assert.ok(Math.abs(Number(await page.locator('#transform-x').inputValue()) - originalX) < 0.001,
    'editing the duplicated object must not move its source');
  assert.equal(await duplicateButton.isEnabled(), true);
  await page.locator('#object-tree [data-object-id]').last().click();
  assert.equal(Number(await page.locator('#transform-x').inputValue()), 57,
    'duplicate transform must persist when selection changes');

  await mkdir('browser-test-artifacts', { recursive: true });
  await page.screenshot({ path: 'browser-test-artifacts/prepare-loaded.png', fullPage: true });
  assert.equal(errors.length, 0, 'Uncaught browser errors: ' + errors.join('; '));

  await page.locator('#remove-object').click();
  await page.locator('#object-count').getByText('1 object').waitFor();
  assert.equal(await page.locator('#project-label').innerText(), 'test-cube.stl');
  assert.ok(Math.abs(Number(await page.locator('#transform-x').inputValue()) - originalX) < 0.001,
    'deleting the duplicate must retain its source geometry and transform');
  await page.locator('#remove-object').click();
  await page.locator('#object-count').getByText('0 objects').waitFor();
  assert.equal(await page.locator('[data-transform="translate"]').isDisabled(), true);
  assert.equal(await duplicateButton.isDisabled(), true);
  console.log('PASS: WebGL canvas, STL rendering, selection, transform modes, camera views, independent duplication and deletion');
} catch (error) {
  await mkdir('browser-test-artifacts', { recursive: true });
  await page.screenshot({ path: 'browser-test-artifacts/prepare-failure.png', fullPage: true }).catch(() => {});
  console.error('Browser errors:', errors);
  throw error;
} finally {
  await browser.close();
}
