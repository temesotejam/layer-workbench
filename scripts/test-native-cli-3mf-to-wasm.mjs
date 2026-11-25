// Isolated acceptance: official native v2.5.0 CLI project -> WASM.
// The fixture and full profiles are generated on this runner only.
// The translated mode edits offline; private-edit probes the existing test-only
// C ABI manifest mutation, not persistent Slic3r::Model or metadata preservation.
// Optional same-archive slice comparison is CI-only. No printing or production activation.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {auditNative3mfWorldFacetGroups,auditNative3mfWorldFacetWinding}
  from './audit-native-3mf-world-facets.mjs';

const args=process.argv.slice(2);
assert.ok(args.length===0||(args.length===1&&['--translated','--private-edit','--slice-embedded','--slice-anchor-zero'].includes(args[0])));
const translated=args[0]==='--translated';
const privateEdit=args[0]==='--private-edit';
const anchorZero=args[0]==='--slice-anchor-zero';
const embeddedSlice=args[0]==='--slice-embedded'||anchorZero;
const source=await readFile('native-cli-output/'+
  (anchorZero?'anchor-zero.3mf':embeddedSlice?'browser-source-preserving-edited.3mf':translated?'native-v250-project-translated.3mf':'native-v250-project.3mf'));
assert.ok(source.length>300 && source.length<=4_000_000);
assert.equal(source.readUInt32LE(0),0x04034b50);
const baselineGroups=JSON.parse(await readFile('native-cli-output/native-world-facets.json','utf8'));
assert.deepEqual(baselineGroups.map(group=>group.length),[12,12]);
// Independent oracle: translate only the first original world-facet group.
// Do not derive the expected geometry from the edited archive or the WASM.
const delta=[12,-7,0];
// Private edit selects the left-hand fixture by its native X anchor, not
// manifest enumeration order. The independent Core world geometry oracle
// chooses the left-hand build by bounds; a wrong association fails the test.
const ranges=baselineGroups.map(group=>{
  const xs=group.flat().map(vertex=>vertex[0]);
  return {min:Math.min(...xs),max:Math.max(...xs)};
});
const left=ranges[0].min<ranges[1].min?0:1;
if(privateEdit)assert.ok(ranges[left].max+delta[0]<ranges[1-left].min,
  'Private fixture must remain spatially separable after translation');
const editedIndex=privateEdit?left:0;
const groups=baselineGroups.map((group,index)=>group.map(facet=>
  facet.map(vertex=>vertex.map((value,axis)=>value+((translated||privateEdit)&&index===editedIndex?delta[axis]:0)))));
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
  if(embeddedSlice){
    // Same exact archive as the native CLI comparison, no applyProfile(),
    // setObjects(), STL conversion, arrangement or replacement settings.
    // Effective native/WASM profile equivalence is NOT assumed.
    const bytes=await page.evaluate(async raw=>{
      const engine=globalThis.__layerDiagnosticEngine?.engine;
      if(!crossOriginIsolated||!engine?.createSession)
        throw new Error('Isolated diagnostic engine unavailable');
      const session=await engine.createSession();
      try {
        await session.initProfile('project.3mf',new Uint8Array(raw));
        const m=await session.getManifest();
        if(m.instances?.length!==2||m.objects?.length!==2||m.plates?.length!==1||
            typeof m.plates[0].id!=='string'||!m.plates[0].id)
          throw new Error('Unexpected same-archive fixture hierarchy');
        const id=m.plates[0].id;
        const result=await session.slice({schemaVersion:'0.7.0',
          plateSelection:'selected',plateIds:[id],includeGcode:true,includeStatistics:false});
        const plates=result?.plateResults;
        if(result?.schemaVersion!=='0.7.0'||plates?.length!==1||plates[0].plateId!==id)
          throw new Error('Unexpected same-archive slice response');
        const assets=plates[0].assets?.filter(a=>a.kind==='gcode');
        if(assets?.length!==1||!assets[0].id)
          throw new Error('Expected exactly one selected-plate G-code asset');
        const data=await session.getAsset(assets[0].id);
        if(!(data instanceof Uint8Array)||data.length<1024||data.length>12_000_000)
          throw new Error('Same-archive G-code outside diagnostic bounds');
        new TextDecoder('utf-8',{fatal:true}).decode(data);
        return Array.from(data);
      } finally {await session.dispose();}
    },Array.from(source));
    await writeFile('native-cli-output/'+(anchorZero?'anchor-zero-wasm.gcode':'same-archive-wasm.gcode'),Buffer.from(bytes),{flag:'wx'});
    console.log('WASM_SAME_ARCHIVE_SLICE '+JSON.stringify({
      sourceSha256:createHash('sha256').update(source).digest('hex'),
      bytes:bytes.length,anchorZeroControl:anchorZero,embeddedProfileOnly:true,effectiveProfileParity:false,
      printApproved:false
    }));
  }else{
  // Keep geometry conversion and untouched archive preservation independent.
  const result=await page.evaluate(async ({encoded,privateEdit,delta,editedIndex})=>{
    const source=new Uint8Array(encoded);
    const engine=globalThis.__layerDiagnosticEngine?.engine;
    if(!crossOriginIsolated||!engine?.createSession||!engine?.threeMfToStl)
      throw new Error('Isolated diagnostic engine unavailable');
    const session=await engine.createSession();
    try {
      await session.initProfile('project.3mf',source);
      let manifest=await session.getManifest();
      const exported=await session.export('project.3mf',{
        schemaVersion:'0.7.0',preservation:'require',includeSliceArtifacts:false
      });
      const preserved=await session.getAsset(exported.asset.id);
      const untouchedByteIdentical=preserved instanceof Uint8Array &&
        preserved.length===source.length && preserved.every((value,i)=>value===source[i]);
      if(!untouchedByteIdentical)throw new Error('Untouched source bytes changed');
      let geometrySource=source, strictRejected=false, manifestOnlyTargetChanged=false;
      let sourcePreservingArchive=null,sourcePreservingStl=null;
      if(privateEdit){
        if(manifest.instances?.length!==2||manifest.objects?.length!==2||manifest.meshes?.length!==2)
          throw new Error('Unexpected private edit fixture hierarchy');
        const before=manifest;
        const ordered=[...before.instances].sort((a,b)=>a.transform.matrix[3]-b.transform.matrix[3]);
        if(!ordered.every(i=>typeof i.id==='string'&&i.transform.matrix.length===16&&i.transform.matrix.every(Number.isFinite))||
            ordered[0].id===ordered[1].id||ordered[1].transform.matrix[3]-ordered[0].transform.matrix[3]<=20)
          throw new Error('Native fixture X-anchor selection is ambiguous');
        const target=ordered[0];
        const changed=[...target.transform.matrix];
        for(let axis=0;axis<3;axis++)changed[3+4*axis]+=delta[axis];
        const mod=session.binding?.module,handle=session.live?.();
        if(!handle||typeof mod?._orcawasm_project_edit_instance_transform!=='function'||
            typeof mod._malloc!=='function'||!mod.HEAPU8||typeof mod._free!=='function')
          throw new Error('Private test-only transform ABI unavailable');
        const request=new TextEncoder().encode(JSON.stringify({instanceId:target.id,matrix:changed}));
        const pointer=mod._malloc(request.length);
        if(!pointer)throw new Error('Private transform allocation failed');
        try {
          mod.HEAPU8.set(request,pointer);
          if(mod._orcawasm_project_edit_instance_transform(handle,pointer,request.length)!==0)
            throw new Error('Private official-project transform failed');
        } finally {mod._free(pointer);}
        const expected=JSON.parse(JSON.stringify(before));
        expected.instances.find(i=>i.id===target.id).transform.matrix=changed;
        manifestOnlyTargetChanged=JSON.stringify(await session.getManifest())===JSON.stringify(expected);
        if(!manifestOnlyTargetChanged)throw new Error('Private transform changed unrelated manifest fields');
        const {preserveNativeSourceTranslation}=await import('./scripts/preserve-native-source-translation.mjs');
        const observed=(await session.getManifest()).instances.find(i=>i.id===target.id).transform.matrix;
        const options={index:editedIndex,before:target.transform.matrix,after:observed,optIn:true};
        // Invalid/non-translation requests and absent explicit opt-in must fail.
        for(const invalid of [{...options,optIn:false},{...options,after:options.before},
          {...options,after:options.after.map((v,i)=>i===0?v+1:v)}]){
          let refused=false;
          try {await preserveNativeSourceTranslation(source,invalid);}catch(_){refused=true;}
          if(!refused)throw new Error('Unsafe source-preserving translation accepted');
        }
        sourcePreservingArchive=await preserveNativeSourceTranslation(source,options);
        const preservingSession=await engine.createSession();
        try {
          await preservingSession.initProfile('project.3mf',sourcePreservingArchive);
          const m=await preservingSession.getManifest();
          if(m.objects?.length!==2||m.meshes?.length!==2||m.instances?.length!==2||m.plates?.length!==1)
            throw new Error('Source-preserving project reimport changed hierarchy');
        }finally{await preservingSession.dispose();}
        sourcePreservingStl=await engine.threeMfToStl(sourcePreservingArchive);
        if(!(sourcePreservingStl instanceof Uint8Array)||sourcePreservingStl.length!==84+50*24)
          throw new Error('Expected source-preserving 24-face STL');
        try {await session.export('project.3mf',{
          schemaVersion:'0.7.0',preservation:'require',includeSliceArtifacts:false
        });}catch(_){strictRejected=true;}
        if(!strictRejected)throw new Error('UNSAFE: private edit accepted strict preservation');
        const best=await session.export('project.3mf',{
          schemaVersion:'0.7.0',preservation:'best-effort',includeSliceArtifacts:false
        });
        geometrySource=await session.getAsset(best.asset.id);
        if(!(geometrySource instanceof Uint8Array)||geometrySource.length<300||geometrySource.length>4_000_000||
            geometrySource[0]!==0x50||geometrySource[1]!==0x4b)
          throw new Error('Invalid best-effort edited project ZIP');
        const reopened=await engine.createSession();
        try {
          await reopened.initProfile('project.3mf',geometrySource);
          manifest=await reopened.getManifest();
          if(manifest.objects?.length!==2||manifest.meshes?.length!==2||manifest.instances?.length!==2||manifest.plates?.length!==1)
            throw new Error('Best-effort official project reimport changed fixture hierarchy');
        } finally {await reopened.dispose();}
      }
      const stl=await engine.threeMfToStl(geometrySource);
      if(!(stl instanceof Uint8Array)||stl.length!==84+50*24)
        throw new Error('Expected bounded 24-face binary STL');
      return {stl:Array.from(stl),manifest:{
        schemaVersion:manifest?.schemaVersion,
        objects:manifest?.objects?.length,
        meshes:manifest?.meshes?.length,
        instances:manifest?.instances?.length,
        plates:manifest?.plates?.length
      },untouchedByteIdentical,strictRejected,manifestOnlyTargetChanged,
        privateEditedArchive:privateEdit?Array.from(geometrySource):null,
        sourcePreservingArchive:privateEdit?Array.from(sourcePreservingArchive):null,
        sourcePreservingStl:privateEdit?Array.from(sourcePreservingStl):null};
    } finally { await session.dispose(); }
  },{encoded:Array.from(source),privateEdit,delta,editedIndex});
  const stl=new Uint8Array(result.stl);
  const geometry=auditNative3mfWorldFacetGroups(stl,groups,0.05);
  const winding=auditNative3mfWorldFacetWinding(stl,groups.flat(),0.05);
  console.log('NATIVE_CLI_TO_WASM_3MF '+JSON.stringify({
    fixture:privateEdit?'private-left-build-translation':translated?'offline-first-build-translation':'untouched-native',
    sourceSha256:createHash('sha256').update(source).digest('hex'),
    manifest:result.manifest,geometry,winding,
    untouchedByteIdentical:result.untouchedByteIdentical,
    ...(privateEdit?{strictPreservationRejected:result.strictRejected,
      manifestOnlyTargetChanged:result.manifestOnlyTargetChanged,
      preservation:'best-effort',persistentNativeModelMutation:false}: {})
  }));
  assert.deepEqual(geometry,{partition:'separable',comparedBuilds:2,comparedTriangles:24});
  assert.equal(result.manifest.schemaVersion,'0.7.0');
  assert.equal(result.manifest.instances,2);
  assert.deepEqual(winding,{winding:'consistent',comparedTriangles:24});
  assert.equal(result.untouchedByteIdentical,true);
  if(privateEdit){
    assert.equal(result.strictRejected,true);
    assert.equal(result.manifestOnlyTargetChanged,true);
    // CI-generated synthetic project only; pass the exact audited bytes to
    // the official desktop CLI in this disposable runner. Never publish it.
    const preservingStl=new Uint8Array(result.sourcePreservingStl);
    assert.deepEqual(auditNative3mfWorldFacetGroups(preservingStl,groups,0.05),
      {partition:'separable',comparedBuilds:2,comparedTriangles:24});
    assert.deepEqual(auditNative3mfWorldFacetWinding(preservingStl,groups.flat(),0.05),
      {winding:'consistent',comparedTriangles:24});
    const preservingArchive=Buffer.from(result.sourcePreservingArchive);
    assert.ok(preservingArchive.length>300&&preservingArchive.length<=4_000_000);
    await writeFile('native-cli-output/browser-source-preserving-edited.3mf',preservingArchive,{flag:'wx'});
    console.log('BROWSER_SOURCE_PRESERVING_TRANSLATION '+JSON.stringify({buildIndex:editedIndex,
      geometry:'pass',winding:'pass',nativeExportApi:false,metadataSemanticParity:false}));
    const editedArchive=Buffer.from(result.privateEditedArchive);
    assert.ok(editedArchive.length>300 && editedArchive.length<=4_000_000);
    assert.equal(editedArchive.readUInt32LE(0),0x04034b50);
    await writeFile('native-cli-output/wasm-private-edited.3mf',editedArchive,{flag:'wx'});
    console.log('WASM_PRIVATE_EDITED_SHA256 '+createHash('sha256').update(editedArchive).digest('hex'));
    console.log('PASS: private in-session manifest translation of official CLI project -> best-effort 3MF reimport and oriented geometry; strict preservation rejected; not persistent native Model mutation or metadata parity');
  }else{
    console.log('PASS: '+(translated?'offline-translated native CLI project':'untouched native CLI project')+
      ' -> isolated WASM geometry and byte preservation; not in-session edit or desktop metadata parity');
  }
  }
} finally {await browser.close();}
