// Rebuilt-candidate-only Node regression. No printer/G-code safety claim.
// An imported Core 3MF must not be reported as losslessly preserved after
// setObjects has discarded the original native project archive.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadEngineArtifact, trianglesToStl } from '../orcawasm/scripts/lib/engine-harness.mjs';

const fixturePath = process.argv[2] ?? 'parity-output/independent-core-two-build.3mf';
const source = readFileSync(fixturePath);
assert.ok(source.length > 300 && source[0] === 0x50 && source[1] === 0x4b,
  'independent 3MF fixture must be a nonempty ZIP');

const vertices = [
  [0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0],
  [0, 0, 20], [20, 0, 20], [20, 20, 20], [0, 20, 20],
];
const faces = [
  [0,1,2],[0,2,3],[4,6,5],[4,7,6],
  [0,5,1],[0,4,5],[3,2,6],[3,6,7],
  [0,3,7],[0,7,4],[1,5,6],[1,6,2],
];
const cube = trianglesToStl(vertices, faces);
const replacement = {
  schemaVersion: '0.7.0',
  plates: [{ id: 'plate-0', index: 0 }],
  meshes: [{ id: 'replacement-mesh', format: 'stl',
    dataRange: { offset: 0, length: cube.byteLength } }],
  objects: [{ id: 'replacement-object', meshId: 'replacement-mesh' }],
  instances: [{ id: 'replacement-instance', objectId: 'replacement-object',
    plateId: 'plate-0', transform: { matrix: [
      1, 0, 0, 90, 0, 1, 0, 90, 0, 0, 1, 0, 0, 0, 0, 1,
    ] } }],
  modifierVolumes: [],
};

const { artifact, runtime } = await loadEngineArtifact('orcawasm/artifacts', 'slicer-mt');
const engine = await artifact.createEngine({ runtime });
let session;
const report = {
  status: 'FAIL',
  fixture: 'independent synthetic Core 3MF; NOT desktop OrcaSlicer',
  experimental: true, printApproved: false,
};
try {
  session = await engine.createSession();
  await session.initProfile('project.3mf', source);
  const imported = await session.getManifest();
  assert.equal(imported.objects?.length, 2, 'import must retain two objects');
  assert.equal(imported.instances?.length, 2, 'import must retain two placements');

  const untouched = await session.export('project.3mf', {
    schemaVersion: '0.7.0', preservation: 'require', includeSliceArtifacts: false,
  });
  const intact = await session.getAsset(untouched.asset.id);
  assert.deepEqual(intact, new Uint8Array(source),
    'untouched strict export must preserve source bytes');
  report.untouchedByteIdentical = true;

  await session.setObjects(cube, replacement);
  const modified = await session.getManifest();
  assert.equal(modified.objects?.length, 1, 'setObjects must replace the old project');
  assert.equal(modified.instances?.length, 1, 'setObjects must replace old placement');

  let strictError;
  try {
    await session.export('project.3mf', {
      schemaVersion: '0.7.0', preservation: 'require', includeSliceArtifacts: false,
    });
  } catch (err) {
    strictError = String(err?.message ?? err);
  }
  assert.ok(strictError, 'unsafe strict preservation succeeded after destructive replacement');
  assert.match(strictError, /preservation=require.*metadata/i,
    'strict refusal must explicitly identify lost imported-project metadata');
  report.strictReplacementRejected = true;
  report.strictError = strictError.slice(0, 400);

  const bestEffort = await session.export('project.3mf', {
    schemaVersion: '0.7.0', preservation: 'best-effort', includeSliceArtifacts: false,
  });
  assert.ok(bestEffort.warnings?.some((w) => w?.code === 'native-project-replaced'),
    'best-effort export must report discarded native metadata');
  const rebuilt = await session.getAsset(bestEffort.asset.id);
  assert.ok(rebuilt instanceof Uint8Array && rebuilt.length > 100 && rebuilt[0] === 0x50,
    'best-effort replacement must yield ZIP bytes');
  report.bestEffortWarning = 'native-project-replaced';

  // Loading a new project must clear the sticky replacement flag.
  await session.initProfile('project.3mf', source);
  const cleanAgain = await session.export('project.3mf', {
    schemaVersion: '0.7.0', preservation: 'require', includeSliceArtifacts: false,
  });
  assert.deepEqual(await session.getAsset(cleanAgain.asset.id), new Uint8Array(source),
    'fresh import must reset the replacement guard and preserve its input');
  report.reimportResetVerified = true;
  report.status = 'PASS';
  console.log('PASS: imported 3MF replacement guard, best-effort warning and re-import reset');
} catch (error) {
  report.error = String(error?.stack ?? error).slice(0, 1500);
  console.error('FAIL: imported 3MF replacement guard', report.error);
  process.exitCode = 1;
} finally {
  try {
    if (session) await session.dispose();
    await engine.dispose();
  } finally {
    mkdirSync('parity-output', { recursive: true });
    writeFileSync('parity-output/rebuilt-import-replacement-guard.json',
      JSON.stringify(report, null, 2) + '\n');
  }
}
