// Real-browser acceptance check for the public Prepare frontend.
// No WASM candidate binaries are published or used by this test.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { findViewerSpace, arrangeViewerSpaces } from './prepare-find-space.mjs';

// Pure geometry regressions run before starting Chrome.
const testPlate = [-128,-128,128,128];
assert.deepEqual(findViewerSpace([0,0,20,20], [], testPlate), {dx:0,dy:0});
assert.deepEqual(findViewerSpace([0,0,20,20], [[0,0,20,20]], testPlate), {dx:-25,dy:0});
assert.deepEqual(findViewerSpace([120,0,140,20], [], testPlate), {dx:-17,dy:0});
assert.equal(findViewerSpace([0,0,250,250], [], testPlate), null);
assert.equal(findViewerSpace([0,0,20,20], [testPlate], testPlate), null);
assert.throws(() => findViewerSpace([0,0,NaN,20], [], testPlate), RangeError);
console.log('PASS: viewer free-space geometry regressions (6)');
const packBoxes = [[0,0,20,20],[0,0,20,20],[0,0,30,30]];
const packMoves = arrangeViewerSpaces(packBoxes,testPlate);
assert.ok(packMoves);
const packed = packBoxes.map((b,i) => b.map((v,j)=>v+(j%2?packMoves[i].dy:packMoves[i].dx)));
assert.deepEqual(arrangeViewerSpaces(packed,testPlate),packed.map(()=>({dx:0,dy:0})));
assert.equal(arrangeViewerSpaces([[0,0,240,240],[0,0,240,240]],testPlate),null);
assert.throws(()=>arrangeViewerSpaces([[0,0,NaN,20]],testPlate),RangeError);
console.log('PASS: viewer batch placement geometry regressions');

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

function makeBinarySTL(dimensions = [20,20,20]) {
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
        result.writeFloatLE(component * dimensions[axis] / 20, offset + 12 + vertexIndex * 12 + axis * 4)));
  }
  return result;
}

try {
  await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('#viewport-canvas canvas').waitFor({ state: 'visible', timeout: 90000 });
  assert.equal(await page.title(), 'Layer Workbench');
  const placementButton = page.locator('#check-placement');
  const placementStatus = page.locator('#placement-status');
  const findSpaceButton = page.locator('#find-space');
  const findSpaceRotateButton = page.locator('#find-space-rotate');
  assert.equal(await findSpaceRotateButton.isDisabled(), true);
  const arrangeAllButton = page.locator('#arrange-all');
  const arrangeAllRotateButton = page.locator('#arrange-all-rotate');
  assert.equal(await arrangeAllRotateButton.isDisabled(),true);
  assert.equal(await arrangeAllButton.isDisabled(), true);
  assert.equal(await findSpaceButton.isDisabled(), true);
  assert.equal(await placementButton.isDisabled(), true);
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
  const directionTransforms = await Promise.all(
    ['x','y','z','rx','ry','rz','sx','sy','sz'].map(k => page.locator('#transform-'+k).inputValue()));
  for (const [mode,label] of [['left','Left'],['right','Right'],['rear','Rear'],['bottom','Bottom']]) {
    const button = page.locator('[data-view-orientation="'+mode+'"]');
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-view-orientation][aria-pressed="true"]').count(), 1);
    assert.equal(await page.locator('#view-direction-label').innerText(), label);
    await page.locator('#fit-all-view').click();
    assert.deepEqual(await Promise.all(
      ['x','y','z','rx','ry','rz','sx','sy','sz'].map(k => page.locator('#transform-'+k).inputValue())),
      directionTransforms, 'camera direction must not edit transforms');
  }
  // The bed used to be double-sided and would obscure the entire cube from
  // below. Check actual rendered pixels away from the central transform axes.
  const underside = await page.locator('#viewport-canvas canvas').screenshot();
  const contrast = await page.evaluate(async data => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + data;
    await img.decode();
    const sample = document.createElement('canvas');
    sample.width = img.width; sample.height = img.height;
    const ctx = sample.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const luminance = (x,y) => {
      const pixels = ctx.getImageData(Math.round(img.width*x)-3, Math.round(img.height*y)-3,7,7).data;
      const values = [];
      for (let i=0;i<pixels.length;i+=4) values.push((pixels[i]+pixels[i+1]+pixels[i+2])/3);
      return values.sort((a,b)=>a-b)[24];
    };
    return luminance(.55,.55) - luminance(.75,.75);
  }, underside.toString('base64'));
  assert.ok(contrast > 12, `Bottom must reveal the cube instead of the opaque bed (contrast ${contrast})`);
  await threeDButton.click();
  assert.equal(await threeDButton.getAttribute('aria-pressed'), 'true');
  assert.equal(await frontButton.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#view-direction-label').innerText(), '3D');

  // Switch the real render camera, zoom it, and switch back without edits.
  const projectionButton = page.locator('#toggle-projection');
  await topButton.click();
  const perspectiveTop = await page.locator('#viewport-canvas canvas').screenshot();
  await projectionButton.click();
  assert.equal(await projectionButton.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#projection-label').innerText(), 'Orthographic');
  assert.equal(await topButton.getAttribute('aria-pressed'), 'true');
  const orthoTop = await page.locator('#viewport-canvas canvas').screenshot();
  assert.equal(perspectiveTop.equals(orthoTop), false, 'projection switch must change rendering');
  await page.locator('#viewport-canvas canvas').hover();
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(300);
  const zoomedOrtho = await page.locator('#viewport-canvas canvas').screenshot();
  assert.equal(orthoTop.equals(zoomedOrtho), false, 'orthographic wheel zoom must change rendering');
  await frontButton.click();
  assert.equal(await page.locator('#projection-label').innerText(), 'Orthographic');
  await projectionButton.click();
  assert.equal(await projectionButton.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#projection-label').innerText(), 'Perspective');
  await threeDButton.click();
  assert.deepEqual(await Promise.all(
    ['x','y','z','rx','ry','rz','sx','sy','sz'].map(k => page.locator('#transform-'+k).inputValue())),
    directionTransforms, 'projection changes must not edit transforms');

  // Automatic projection is opt-in (matching desktop's default preference).
  const autoProjection = page.locator('#auto-projection');
  assert.equal(await autoProjection.getAttribute('aria-pressed'), 'false');
  await autoProjection.click();
  assert.equal(await autoProjection.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#projection-label').innerText(), 'Perspective');
  await topButton.click();
  assert.equal(await page.locator('#projection-label').innerText(), 'Orthographic');
  await threeDButton.click();
  assert.equal(await page.locator('#projection-label').innerText(), 'Perspective');
  await projectionButton.click(); // manual orthographic holds in oblique view
  await threeDButton.click();
  assert.equal(await page.locator('#projection-label').innerText(), 'Orthographic');
  await frontButton.click(); // axial view releases manual hold
  await threeDButton.click();
  assert.equal(await page.locator('#projection-label').innerText(), 'Perspective');
  await autoProjection.click();
  await topButton.click();
  assert.equal(await page.locator('#projection-label').innerText(), 'Perspective');
  await threeDButton.click();
  assert.deepEqual(await Promise.all(
    ['x','y','z','rx','ry','rz','sx','sy','sz'].map(k => page.locator('#transform-'+k).inputValue())),
    directionTransforms, 'auto projection must not edit transforms');

  // Browser transforms can be undone, redone, or replaced with a new edit.
  const undoButton = page.locator('#undo-viewer');
  const redoButton = page.locator('#redo-viewer');
  assert.equal(await undoButton.isDisabled(), true);
  assert.equal(await redoButton.isDisabled(), true);
  const xBeforeEdit = Number(await page.locator('#transform-x').inputValue());
  await page.locator('#transform-x').fill(String(xBeforeEdit + 13));
  await page.locator('#transform-x').press('Tab');
  assert.equal(await undoButton.isEnabled(), true);
  await undoButton.click();
  assert.equal(Number(await page.locator('#transform-x').inputValue()), xBeforeEdit);
  await redoButton.click();
  assert.equal(Number(await page.locator('#transform-x').inputValue()), xBeforeEdit + 13);
  await undoButton.click();
  await page.locator('#transform-x').fill(String(xBeforeEdit + 7));
  await page.locator('#transform-x').press('Tab');
  assert.equal(await redoButton.isDisabled(), true, 'new edits must invalidate redo');
  await undoButton.click();
  assert.equal(Number(await page.locator('#transform-x').inputValue()), xBeforeEdit);

  // Dropping onto the logical plate must use actual transformed geometry
  // rather than resetting Z blindly. This is a browser-only layout operation.
  const dropToBedButton = page.locator('#drop-to-bed');
  assert.equal(await dropToBedButton.isEnabled(), true);
  const originalZ = Number(await page.locator('#transform-z').inputValue());
  await page.locator('#transform-z').fill('25');
  await page.locator('#transform-z').press('Tab');
  await dropToBedButton.click();
  assert.ok(Math.abs(Number(await page.locator('#transform-z').inputValue()) - originalZ) < 0.001,
    'drop-to-bed must return translated cube to its physical bed height');
  assert.match(await page.locator('#file-status').innerText(), /viewer bed Z=0/);
  await undoButton.click();
  assert.equal(Number(await page.locator('#transform-z').inputValue()), 25,
    'drop-to-bed must be undoable');
  await redoButton.click();
  assert.ok(Math.abs(Number(await page.locator('#transform-z').inputValue()) - originalZ) < 0.001,
    'redo must restore drop-to-bed');
  assert.equal(await page.locator('#transform-x').inputValue(), modelX,
    'drop-to-bed must preserve horizontal placement');

  // Duplication is a viewer-only STL/OBJ operation, with independent object
  // transforms and independent selection highlights (not a native 3MF edit).
  const duplicateButton = page.locator('#duplicate-object');
  assert.equal(await duplicateButton.isEnabled(), true);
  const originalX = Number(await page.locator('#transform-x').inputValue());
  const originalY = Number(await page.locator('#transform-y').inputValue());
  await duplicateButton.click();
  await page.locator('#object-count').getByText('2 objects').waitFor();
  assert.equal(await undoButton.isEnabled(), true,
    'loose mesh duplication must be undoable');
  await undoButton.click();
  await page.locator('#object-count').getByText('1 object').waitFor();
  assert.equal(await page.locator('#project-label').innerText(), 'test-cube.stl');
  assert.equal(Number(await page.locator('#transform-x').inputValue()), originalX,
    'undoing duplication must leave the original placement unchanged');
  assert.equal(await redoButton.isEnabled(), true);
  await redoButton.click();
  await page.locator('#object-count').getByText('2 objects').waitFor();
  assert.equal(await page.locator('#object-tree [data-object-id]').count(), 2);
  assert.ok(Math.abs(Number(await page.locator('#transform-x').inputValue()) - originalX - 20) < 0.001,
    'redo must restore the same independent duplicate');
  assert.match(await page.locator('#file-status').innerText(), /browser-only duplication/);
  assert.ok(Math.abs(Number(await page.locator('#transform-x').inputValue()) - originalX - 20) < 0.001);
  assert.ok(Math.abs(Number(await page.locator('#transform-y').inputValue()) - originalY - 20) < 0.001);
  const duplicateX = Number(await page.locator('#transform-x').inputValue());
  const duplicateY = Number(await page.locator('#transform-y').inputValue());
  await page.locator('#transform-z').fill('31');
  await page.locator('#transform-z').press('Tab');
  await dropToBedButton.click();
  assert.ok(Math.abs(Number(await page.locator('#transform-z').inputValue()) - originalZ) < 0.001,
    'dropping the duplicate must use its own world bounds');
  assert.equal(Number(await page.locator('#transform-x').inputValue()), duplicateX);
  assert.equal(Number(await page.locator('#transform-y').inputValue()), duplicateY);
  await page.locator('#transform-x').fill('57');
  await page.locator('#transform-x').press('Tab');
  assert.equal(Number(await page.locator('#transform-x').inputValue()), 57);
  await undoButton.click();
  assert.equal(Number(await page.locator('#transform-x').inputValue()), duplicateX);
  await redoButton.click();
  assert.equal(Number(await page.locator('#transform-x').inputValue()), 57);
  await page.locator('#object-tree [data-object-id]').first().click();
  assert.ok(Math.abs(Number(await page.locator('#transform-x').inputValue()) - originalX) < 0.001,
    'editing the duplicated object must not move its source');
  assert.equal(await duplicateButton.isEnabled(), true);
  await page.locator('#object-tree [data-object-id]').last().click();
  assert.equal(Number(await page.locator('#transform-x').inputValue()), 57,
    'duplicate transform must persist when selection changes');

  // Center uses the actual transformed bounds, preserves Z and rotation/scale,
  // and must not move the source or create history for an already centered model.
  const centerButton = page.locator('#center-on-bed');
  assert.equal(await centerButton.isEnabled(), true);
  const centerKeys = ['x','y','z','rx','ry','rz','sx','sy','sz'];
  const readCenterTransforms = () => Promise.all(centerKeys.map(k =>
    page.locator('#transform-'+k).inputValue()));
  const beforeCenter = await readCenterTransforms();
  await centerButton.click();
  const centered = await readCenterTransforms();
  assert.ok(Math.abs(Number(centered[0]) - originalX) < 0.001);
  assert.ok(Math.abs(Number(centered[1]) - originalY) < 0.001);
  assert.deepEqual(centered.slice(2), beforeCenter.slice(2));
  assert.match(await page.locator('#file-status').innerText(), /overlaps not checked/);
  const placementHistory = [await undoButton.isEnabled(), await redoButton.isEnabled()];
  await placementButton.click();
  assert.match(await placementStatus.innerText(), /Within viewer plate XY.*XY bounding-box overlaps: 1.*XY convex-hull candidates: 1; unavailable: 0/);
  assert.deepEqual(await readCenterTransforms(), centered);
  assert.deepEqual([await undoButton.isEnabled(), await redoButton.isEnabled()], placementHistory);
  await centerButton.click();
  assert.match(await page.locator('#file-status').innerText(), /already centered/);
  await undoButton.click();
  assert.deepEqual(await readCenterTransforms(), beforeCenter, 'centering must be undoable in one step');
  await redoButton.click();
  assert.deepEqual(await readCenterTransforms(), centered);
  await undoButton.click();
  assert.deepEqual(await readCenterTransforms(), beforeCenter);
  assert.match(await placementStatus.innerText(), /Check the selected mesh/);
  await placementButton.click();
  assert.match(await placementStatus.innerText(), /XY bounding-box overlaps: 0.*XY convex-hull candidates: 0; unavailable: 0/);
  await page.locator('#object-tree [data-object-id]').first().click();
  assert.equal(Number(await page.locator('#transform-x').inputValue()), originalX);
  assert.equal(Number(await page.locator('#transform-y').inputValue()), originalY);
  await page.locator('#object-tree [data-object-id]').last().click();

  // Resolve a real centered overlap while keeping the other object fixed.
  await centerButton.click();
  const overlapping = await readCenterTransforms();
  await findSpaceButton.click();
  assert.match(await page.locator('#file-status').innerText(), /free viewer AABB space/);
  const separated = await readCenterTransforms();
  assert.notDeepEqual(separated.slice(0,2), overlapping.slice(0,2));
  assert.deepEqual(separated.slice(2), overlapping.slice(2));
  await placementButton.click();
  assert.match(await placementStatus.innerText(), /Within viewer plate XY.*overlaps: 0/);
  await findSpaceButton.click();
  assert.match(await page.locator('#file-status').innerText(), /already has 5 mm/);
  await undoButton.click();
  assert.deepEqual(await readCenterTransforms(), overlapping);
  await redoButton.click();
  assert.deepEqual(await readCenterTransforms(), separated);
  await undoButton.click();
  await undoButton.click();
  assert.deepEqual(await readCenterTransforms(), beforeCenter);
  await page.locator('#object-tree [data-object-id]').first().click();
  assert.equal(Number(await page.locator('#transform-x').inputValue()), originalX);
  assert.equal(Number(await page.locator('#transform-y').inputValue()), originalY);
  await page.locator('#object-tree [data-object-id]').last().click();

  // Batch arrangement retains selection and uses one reversible action.
  await centerButton.click();
  const beforeBatch = await readCenterTransforms();
  assert.equal(await arrangeAllButton.isEnabled(), true);
  const selectedBeforeBatch = await page.locator('#object-tree .active').getAttribute('data-object-id');
  await arrangeAllButton.click();
  assert.match(await page.locator('#file-status').innerText(), /Arranged all loose meshes/);
  const afterBatch = await readCenterTransforms();
  assert.deepEqual(afterBatch.slice(2), beforeBatch.slice(2));
  assert.equal(await page.locator('#object-tree .active').getAttribute('data-object-id'),selectedBeforeBatch);
  await placementButton.click();
  assert.match(await placementStatus.innerText(), /Within viewer plate XY.*overlaps: 0/);
  await arrangeAllButton.click();
  assert.match(await page.locator('#file-status').innerText(), /already have 5 mm/);
  await undoButton.click();
  assert.deepEqual(await readCenterTransforms(),beforeBatch);
  await placementButton.click();
  assert.match(await placementStatus.innerText(), /overlaps: 1/);
  await redoButton.click();
  assert.deepEqual(await readCenterTransforms(),afterBatch);
  await undoButton.click();
  await undoButton.click();
  assert.deepEqual(await readCenterTransforms(),beforeCenter);

  // Framing all visible objects must differ from framing only the selected
  // displaced duplicate, and must not change selection, placement or history.
  const transformsBeforeFit = await Promise.all(
    ['x','y','z','rx','ry','rz','sx','sy','sz'].map(k => page.locator('#transform-'+k).inputValue()));
  const historyBeforeFit = [await undoButton.isEnabled(), await redoButton.isEnabled()];
  await topButton.click();
  await page.locator('#fit-view').click();
  const selectedFrame = await page.locator('#viewport-canvas canvas').screenshot();
  await page.locator('#fit-all-view').click();
  const allFrame = await page.locator('#viewport-canvas canvas').screenshot();
  assert.equal(selectedFrame.equals(allFrame), false,
    'Fit all must reframe the displaced source and duplicate together');
  assert.deepEqual(await Promise.all(
    ['x','y','z','rx','ry','rz','sx','sy','sz'].map(k => page.locator('#transform-'+k).inputValue())),
    transformsBeforeFit, 'Fit all must not change selected transforms');
  assert.deepEqual([await undoButton.isEnabled(), await redoButton.isEnabled()], historyBeforeFit);
  assert.equal(await page.locator('#object-count').innerText(), '2 objects');
  assert.equal(await page.locator('#object-tree [data-object-id]').last().evaluate(
    el => el.classList.contains('active')), true);
  await threeDButton.click();

  await mkdir('browser-test-artifacts', { recursive: true });
  await page.screenshot({ path: 'browser-test-artifacts/prepare-loaded.png', fullPage: true });
  assert.equal(errors.length, 0, 'Uncaught browser errors: ' + errors.join('; '));

  await page.locator('#remove-object').click();
  await page.locator('#object-count').getByText('1 object').waitFor();
  assert.equal(await undoButton.isEnabled(), true,
    'loose mesh deletion must be undoable without reviving previous transforms');
  assert.equal(await page.locator('#project-label').innerText(), 'test-cube.stl');
  assert.ok(Math.abs(Number(await page.locator('#transform-x').inputValue()) - originalX) < 0.001,
    'deleting the duplicate must retain its source geometry and transform');
  await undoButton.click();
  await page.locator('#object-count').getByText('2 objects').waitFor();
  assert.equal(Number(await page.locator('#transform-x').inputValue()), 57,
    'undo deletion must restore the exact independently edited copy');
  await redoButton.click();
  await page.locator('#object-count').getByText('1 object').waitFor();
  assert.ok(Math.abs(Number(await page.locator('#transform-x').inputValue()) - originalX) < 0.001);
  await page.locator('#remove-object').click();
  await page.locator('#object-count').getByText('0 objects').waitFor();
  assert.equal(await page.locator('[data-transform="translate"]').isDisabled(), true);
  assert.equal(await duplicateButton.isDisabled(), true);
  assert.equal(await dropToBedButton.isDisabled(), true);
  assert.equal(await centerButton.isDisabled(), true);
  assert.equal(await undoButton.isEnabled(), true,
    'deleting the final loose STL must remain reversible');
  await undoButton.click();
  await page.locator('#object-count').getByText('1 object').waitFor();
  assert.ok(Math.abs(Number(await page.locator('#transform-x').inputValue()) - originalX) < 0.001);
  await redoButton.click();
  await page.locator('#object-count').getByText('0 objects').waitFor();
  assert.equal(await undoButton.isEnabled(), true);
  await page.locator('#fit-all-view').click();
  assert.equal(await page.locator('#object-count').innerText(), '0 objects');

  // A sloped tetrahedron has no vertex at the local AABB's (y=0,z=0)
  // corner. With +45° X rotation its exact minimum Z is 20/sqrt(2).
  // The cached-box fast path would wrongly report zero and leave it floating.
  await page.locator('#model-file').setInputFiles({
    name: 'sloped-tetra.obj',
    mimeType: 'text/plain',
    buffer: Buffer.from('v 0 0 20\nv 20 0 20\nv 0 20 0\nv 0 20 20\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n'),
  });
  await page.locator('#object-count').getByText('1 object').waitFor();
  const rx = page.locator('#transform-rx'), ry = page.locator('#transform-ry');
  assert.equal(await rx.isEnabled(), true);
  assert.equal(await ry.isEnabled(), true);
  await rx.fill('45'); await rx.press('Tab');
  assert.equal(Number(await rx.inputValue()), 45);
  await ry.fill('20'); await ry.press('Tab');
  assert.equal(Number(await ry.inputValue()), 20);
  await undoButton.click();
  assert.equal(Number(await rx.inputValue()), 45);
  assert.equal(Number(await ry.inputValue()), 0);
  await redoButton.click();
  assert.equal(Number(await ry.inputValue()), 20);
  await undoButton.click();
  assert.equal(Number(await ry.inputValue()), 0);
  const tetraBefore = await readCenterTransforms();
  assert.equal(Number(tetraBefore[2]), 0);
  await dropToBedButton.click();
  const tetraAfter = await readCenterTransforms();
  assert.ok(Math.abs(Number(tetraAfter[2]) + 20 / Math.sqrt(2)) < 0.001,
    'drop must place rotated actual vertices on Z=0, not cached box corners');
  assert.deepEqual(tetraAfter.slice(0,2), tetraBefore.slice(0,2));
  assert.deepEqual(tetraAfter.slice(3), tetraBefore.slice(3));
  await dropToBedButton.click();
  assert.match(await page.locator('#file-status').innerText(), /already touches/);
  await undoButton.click();
  assert.deepEqual(await readCenterTransforms(), tetraBefore);
  await redoButton.click();
  assert.deepEqual(await readCenterTransforms(), tetraAfter);
  await placementButton.click();
  assert.match(await placementStatus.innerText(), /Within viewer plate XY.*touches bed.*overlaps: 0/);
  await page.locator('#transform-x').fill('150');
  await page.locator('#transform-x').press('Tab');
  await placementButton.click();
  assert.match(await placementStatus.innerText(), /Outside viewer plate/);
  await undoButton.click();
  assert.deepEqual(await readCenterTransforms(), tetraAfter);
  await page.locator('#remove-object').click();
  await page.locator('#object-count').getByText('0 objects').waitFor();
  assert.equal(await rx.isDisabled(), true);
  assert.equal(await ry.isDisabled(), true);

  // Exercise the actual corner-seeded fallback, not only a pure helper test.
  // Two centered 100 x 200 footprints cannot fit by retaining the first
  // footprint at its initial location on a 256 mm bed with 5 mm clearance.
  const tallFixture = name => ({name, mimeType:'model/stl',
    buffer:makeBinarySTL([100,200,20])});
  const readAllTransforms = async () => {
    const nodes = page.locator('#object-tree [data-object-id]');
    const states = [];
    for (let i=0; i<await nodes.count(); i++) {
      await nodes.nth(i).click();
      states.push(await readCenterTransforms());
    }
    return states;
  };
  await page.locator('#model-file').setInputFiles([
    tallFixture('corner-a.stl'), tallFixture('corner-b.stl'),
  ]);
  await page.locator('#object-count').getByText('2 objects').waitFor();
  const cornerBefore = await readAllTransforms();
  assert.deepEqual(cornerBefore.map(s=>s.slice(0,2).map(Number)),[[-50,-100],[-50,-100]]);
  const cornerSelection = await page.locator('#object-tree .active').getAttribute('data-object-id');
  assert.equal(findViewerSpace([-50,-100,50,100],[[-50,-100,50,100]],testPlate),null);
  await arrangeAllButton.click();
  assert.match(await page.locator('#file-status').innerText(), /Arranged all loose meshes/);
  assert.equal(await page.locator('#object-tree .active').getAttribute('data-object-id'),cornerSelection);
  const cornerAfter = await readAllTransforms();
  assert.deepEqual(cornerAfter.map(s=>s.slice(0,2).map(Number)),[[-123,-123],[-18,-100]]);
  assert.deepEqual(cornerAfter.map(s=>s.slice(2)),cornerBefore.map(s=>s.slice(2)));
  await arrangeAllButton.click();
  assert.match(await page.locator('#file-status').innerText(), /already have 5 mm/);
  await undoButton.click();
  assert.deepEqual(await readAllTransforms(),cornerBefore,'one undo restores both corner moves');
  await redoButton.click();
  assert.deepEqual(await readAllTransforms(),cornerAfter,'one redo restores both corner moves');

  // Three such footprints cannot fit without changing orientation. The
  // failed search must preserve every object and must not record history.
  await page.locator('#model-file').setInputFiles(tallFixture('corner-c.stl'));
  await page.locator('#object-count').getByText('3 objects').waitFor();
  // Real pointer selection must remain possible when more than two models
  // are loaded. The formerly horizontal flex list overflowed into the canvas.
  const treeLayout = await page.locator('#object-tree').evaluate(tree => {
    const bounds = tree.getBoundingClientRect();
    return {
      scrollWidth: tree.scrollWidth, clientWidth: tree.clientWidth,
      rows: [...tree.querySelectorAll('[data-object-id]')].map(row => {
        const r = row.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return {left:r.left-bounds.left,right:bounds.right-r.right,
          top:r.top,bottom:r.bottom,hit:!!hit && row.contains(hit)};
      }),
    };
  });
  assert.equal(treeLayout.rows.length,3);
  assert.ok(treeLayout.scrollWidth <= treeLayout.clientWidth + 1,'object list must not overflow horizontally');
  for (const [i,row] of treeLayout.rows.entries()) {
    assert.ok(row.left >= -1 && row.right >= -1 && row.hit,'object row must remain within sidebar and receive pointer events');
    if (i) assert.ok(row.top >= treeLayout.rows[i-1].bottom-1,'object rows must stack vertically');
  }
  const impossibleBefore = await readAllTransforms();
  assert.equal(await undoButton.isDisabled(),true,'import resets viewer history');
  await arrangeAllButton.click();
  assert.match(await page.locator('#file-status').innerText(), /No complete greedy viewer arrangement; nothing moved/);
  assert.equal(await undoButton.isDisabled(),true);
  assert.equal(await redoButton.isDisabled(),true);
  assert.deepEqual(await readAllTransforms(),impossibleBefore);
  for (let remaining=2; remaining>=0; remaining--) {
    await page.locator('#remove-object').click();
    await page.locator('#object-count').getByText(remaining+' object'+(remaining===1?'':'s'),{exact:true}).waitFor();
  }
  console.log('PASS: corner-seeded actual browser packing, batch undo/redo and atomic failure');

  // Explicit rotation fallback: a fixed full-height obstacle leaves only a narrow strip.
  await page.locator('#model-file').setInputFiles([
    {name:'fixed-strip.stl',mimeType:'model/stl',buffer:makeBinarySTL([150,246,20])},
    {name:'rotate-strip.stl',mimeType:'model/stl',buffer:makeBinarySTL([120,60,20])},
  ]);
  await page.locator('#object-count').getByText('2 objects').waitFor();
  await page.getByRole('button',{name:/fixed-strip\.stl/i}).click();
  for (const [key,value] of [['x','-123'],['y','-123']]) {
    await page.locator('#transform-'+key).fill(value);
    await page.locator('#transform-'+key).press('Tab');
  }
  const fixedBefore=await readCenterTransforms();
  await page.getByRole('button',{name:/rotate-strip\.stl/i}).click();
  const rotationBefore=await readCenterTransforms();
  await findSpaceButton.click();
  assert.match(await page.locator('#file-status').innerText(), /No free viewer AABB placement/);
  assert.deepEqual(await readCenterTransforms(),rotationBefore);
  await findSpaceRotateButton.click();
  assert.match(await page.locator('#file-status').innerText(), /Rotated selected mesh/);
  const rotationAfter=await readCenterTransforms();
  assert.equal(Number(rotationAfter[5]),90);
  assert.deepEqual([rotationAfter[2],...rotationAfter.slice(6)],[rotationBefore[2],...rotationBefore.slice(6)]);
  await placementButton.click();
  assert.match(await placementStatus.innerText(), /Within viewer plate XY.*overlaps: 0/);
  await findSpaceRotateButton.click();
  assert.match(await page.locator('#file-status').innerText(), /already has 5 mm/);
  await undoButton.click();
  assert.deepEqual(await readCenterTransforms(),rotationBefore);
  await redoButton.click();
  assert.deepEqual(await readCenterTransforms(),rotationAfter);
  await page.getByRole('button',{name:/fixed-strip\.stl/i}).click();
  assert.deepEqual(await readCenterTransforms(),fixedBefore);
  for (let remaining=1;remaining>=0;remaining--) {
    await page.locator('#remove-object').click();
    await page.locator('#object-count').getByText(remaining+' object'+(remaining===1?'':'s'),{exact:true}).waitFor();
  }
  console.log('PASS: explicit quarter-turn placement, fixed obstacle and reversible transform');

  await page.locator('#model-file').setInputFiles([
    {name:'batch-wide.stl',mimeType:'model/stl',buffer:makeBinarySTL([200,100,20])},
    {name:'batch-tall.stl',mimeType:'model/stl',buffer:makeBinarySTL([100,200,20])},
  ]);
  await page.locator('#object-count').getByText('2 objects').waitFor();
  const batchRotateBefore=await readAllTransforms();
  await arrangeAllButton.click();
  assert.match(await page.locator('#file-status').innerText(),/No complete greedy/);
  assert.deepEqual(await readAllTransforms(),batchRotateBefore);
  assert.equal(await arrangeAllRotateButton.isEnabled(),true);
  await arrangeAllRotateButton.click();
  assert.match(await page.locator('#file-status').innerText(),/Arranged all loose meshes with \+90° turns/);
  const batchRotateAfter=await readAllTransforms();
  assert.deepEqual(batchRotateAfter.map(s=>Number(s[5])),[90,0]);
  assert.deepEqual(batchRotateAfter.map(s=>[s[2],...s.slice(6)]),batchRotateBefore.map(s=>[s[2],...s.slice(6)]));
  for(const name of ['batch-wide.stl','batch-tall.stl']){
    await page.getByRole('button',{name}).click();
    await placementButton.click();
    assert.match(await placementStatus.innerText(),/Within viewer plate XY.*overlaps: 0/);
  }
  await arrangeAllRotateButton.click();
  assert.match(await page.locator('#file-status').innerText(),/already have 5 mm/);
  await undoButton.click();
  assert.deepEqual(await readAllTransforms(),batchRotateBefore);
  await redoButton.click();
  assert.deepEqual(await readAllTransforms(),batchRotateAfter);
  for(let remaining=1;remaining>=0;remaining--){
    await page.locator('#remove-object').click();
    await page.locator('#object-count').getByText(remaining+' object'+(remaining===1?'':'s'),{exact:true}).waitFor();
  }
  console.log('PASS: batch quarter-turn arrangement and atomic undo/redo');

  // Reversible deletion must also preserve 3MF scene roots. The normal
  // public viewport treats a Core 3MF as one viewer item; the explicitly
  // opted-in isolated lab exposes its two build items independently.
  const is3mfBuildLab = await page.evaluate(() =>
    globalThis.crossOriginIsolated === true &&
    new URLSearchParams(location.search).get('engineLab') === '1');
  await page.locator('#model-file').setInputFiles({
    name: 'synthetic-two-build.3mf',
    mimeType: 'model/3mf',
    buffer: await readFile('browser-test-artifacts/viewer-two-build.3mf'),
  });
  const expected3mfCount = is3mfBuildLab ? 2 : 1;
  await page.locator('#object-count').getByText(expected3mfCount + (expected3mfCount === 1 ? ' object' : ' objects')).waitFor();
  assert.equal(await duplicateButton.isDisabled(), true, '3MF duplication remains unsupported');
  assert.equal(await dropToBedButton.isDisabled(), true, 'native 3MF bed editing remains unsupported');
  assert.equal(await centerButton.isDisabled(), true, 'native 3MF centering remains unsupported');
  assert.equal(await placementButton.isDisabled(), true, '3MF placement check remains unsupported');
  assert.equal(await findSpaceButton.isDisabled(), true, '3MF arrangement remains unsupported');
  assert.equal(await findSpaceRotateButton.isDisabled(), true, '3MF rotation placement remains unsupported');
  assert.equal(await arrangeAllButton.isDisabled(), true, '3MF batch arrangement remains unsupported');
  assert.equal(await arrangeAllRotateButton.isDisabled(),true,'3MF batch rotation remains unsupported');
  assert.equal(await rx.isDisabled(), true, 'new numeric X rotation is loose-mesh only');
  assert.equal(await ry.isDisabled(), true, 'new numeric Y rotation is loose-mesh only');
  assert.equal(await undoButton.isDisabled(), true, 'import must clear preceding STL history');
  await page.locator('#remove-object').click();
  await page.locator('#object-count').getByText((expected3mfCount-1) + (expected3mfCount-1 === 1 ? ' object' : ' objects')).waitFor();
  assert.equal(await undoButton.isEnabled(), true, '3MF viewport deletion must be undoable');
  await undoButton.click();
  await page.locator('#object-count').getByText(expected3mfCount + (expected3mfCount === 1 ? ' object' : ' objects')).waitFor();
  assert.equal(await page.locator('#object-tree [data-object-id]').count(), expected3mfCount,
    'Undo must restore the same 3MF build items or scene root');
  await redoButton.click();
  await page.locator('#object-count').getByText((expected3mfCount-1) + (expected3mfCount-1 === 1 ? ' object' : ' objects')).waitFor();
  await undoButton.click();
  await page.locator('#object-count').getByText(expected3mfCount + (expected3mfCount === 1 ? ' object' : ' objects')).waitFor();
  if (is3mfBuildLab) {
    // Delete both build items, including the last one that detaches the
    // shared 3MF root; Undo restores that root with its original hierarchy.
    await page.locator('#remove-object').click();
    await page.locator('#object-count').getByText('1 object').waitFor();
    await page.locator('#remove-object').click();
    await page.locator('#object-count').getByText('0 objects').waitFor();
    assert.equal(await undoButton.isEnabled(), true);
    await undoButton.click();
    await page.locator('#object-count').getByText('1 object').waitFor();
    assert.equal(await page.locator('#object-tree [data-object-id]').count(), 1);
    await redoButton.click();
    await page.locator('#object-count').getByText('0 objects').waitFor();
  }
  assert.equal(errors.length, 0, 'Uncaught 3MF browser errors: ' + errors.join('; '));
  console.log('PASS: WebGL, STL/OBJ editing history and reversible 3MF viewport deletion (' +
    (is3mfBuildLab ? 'isolated per-build' : 'public single-root') + ')');
} catch (error) {
  await mkdir('browser-test-artifacts', { recursive: true });
  await page.screenshot({ path: 'browser-test-artifacts/prepare-failure.png', fullPage: true }).catch(() => {});
  console.error('Browser errors:', errors);
  throw error;
} finally {
  await browser.close();
}
