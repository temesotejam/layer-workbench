// Real browser smoke: probe the archived v2.5.0 candidate only on isolated
// localhost, never by publishing a WASM engine to GitHub Pages.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.ENGINE_PROBE_URL || 'http://127.0.0.1:8766/';
const artifactDir = process.env.ENGINE_ARTIFACT_DIR || 'engine-test-artifacts';
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
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
} finally {
  await browser.close();
}
