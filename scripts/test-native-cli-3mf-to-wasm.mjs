// Isolated acceptance: official native v2.5.0 CLI project -> WASM.
// The fixture and full profiles are generated on this runner only.
// Optional translated fixture is edited offline, not via a WASM mutation API.
// No G-code generation, printing, or production engine activation.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {auditNative3mfWorldFacetGroups,auditNative3mfWorldFacetWinding}
  from './audit-native-3mf-world-facets.mjs';

const args=process.argv.slice(2);
assert.ok(args.length===0||(args.length===1&&args[0]==='--translated'));
const translated=args.length===1;
const source=await readFile('native-cli-output/'+
  (translated?'native-v250-project-translated.3mf':'native-v250-project.3mf'));
assert.ok(source.length>300 && source.length<=4_000_000);
assert.equal(source.readUInt32LE(0),0x04034b50);
const baselineGroups=JSON.parse(await readFile('native-cli-output/native-world-facets.json','utf8'));
assert.deepEqual(baselineGroups.map(group=>group.length),[12,12]);
// Independent oracle: translate only the first original world-facet group.
// Do not derive the expected geometry from the edited archive or the WASM.
const delta=[12,-7,0];
const groups=baselineGroups.map((group,index)=>group.map(facet=>
  facet.map(vertex=>vertex.map((value,axis)=>value+(translated&&index===0?delta[axis]:0)))));
const browser=await chromium.launch({channel:'chrome',headless:true,
  args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page=await browser.newPage();
  const response=await page.goto('http://127.0.0.1:8766/engine-probe.html',
    {waitUntil:'domcontentloaded'});
  assert.equal(response?.status(),200);
  assert.equal(await page.evaluate(()=>crossOriginIsolated),true);
  for(const [selector,name,mimeType] of [
    ['#engine-js','slicer-mt.js','text/javascript'],
    ['#engine-wasm','slicer-mt.wasm','application/wasm']
  ]) {
    await page.locator(selector).setInputFiles({
      name,mimeType,buffer:await readFile('engine-test-artifacts/'+name)
    });
  }
  await page.locator('#probe').click();
  await page.waitForFunction(()=>{
    const message=document.querySelector('#probe-output')?.textContent??'';
    return message.includes('"family": "OrcaSlicer"')||message.startsWith('FAILED:');
  },null,{timeout:90000});
  const capability=JSON.parse(await page.locator('#probe-output').innerText());
  assert.equal(capability.engine.family,'OrcaSlicer');
  assert.equal(capability.engine.version,'2.5.0');
  assert.equal(capability.api.version,'0.7.0');
  // Keep geometry conversion and untouched archive preservation independent.
  const result=await page.evaluate(async encoded=>{
    const source=new Uint8Array(encoded);
    const engine=globalThis.__layerDiagnosticEngine?.engine;
    if(!crossOriginIsolated||!engine?.createSession||!engine?.threeMfToStl)
      throw new Error('Isolated diagnostic engine unavailable');
    const stl=await engine.threeMfToStl(source);
    if(!(stl instanceof Uint8Array)||stl.length!==84+50*24)
      throw new Error('Expected bounded 24-face binary STL');
    const session=await engine.createSession();
    try {
      await session.initProfile('project.3mf',source);
      const manifest=await session.getManifest();
      const exported=await session.export('project.3mf',{
        schemaVersion:'0.7.0',preservation:'require',includeSliceArtifacts:false
      });
      const preserved=await session.getAsset(exported.asset.id);
      return {stl:Array.from(stl),manifest:{
        schemaVersion:manifest?.schemaVersion,
        objects:manifest?.objects?.length,
        meshes:manifest?.meshes?.length,
        instances:manifest?.instances?.length,
        plates:manifest?.plates?.length
      },untouchedByteIdentical:preserved instanceof Uint8Array &&
        preserved.length===source.length &&
        preserved.every((value,i)=>value===source[i])};
    } finally { await session.dispose(); }
  },Array.from(source));
  const stl=new Uint8Array(result.stl);
  const geometry=auditNative3mfWorldFacetGroups(stl,groups,0.05);
  const winding=auditNative3mfWorldFacetWinding(stl,groups.flat(),0.05);
  console.log('NATIVE_CLI_TO_WASM_3MF '+JSON.stringify({
    fixture:translated?'offline-first-build-translation':'untouched-native',
    sourceSha256:createHash('sha256').update(source).digest('hex'),
    manifest:result.manifest,geometry,winding,
    untouchedByteIdentical:result.untouchedByteIdentical
  }));
  assert.deepEqual(geometry,{partition:'separable',comparedBuilds:2,comparedTriangles:24});
  assert.equal(result.manifest.schemaVersion,'0.7.0');
  assert.equal(result.manifest.instances,2);
  assert.deepEqual(winding,{winding:'consistent',comparedTriangles:24});
  assert.equal(result.untouchedByteIdentical,true);
  console.log('PASS: '+(translated?'offline-translated native CLI project':'untouched native CLI project')+
    ' -> isolated WASM geometry and byte preservation; not in-session edit or desktop metadata parity');
} finally {await browser.close();}
