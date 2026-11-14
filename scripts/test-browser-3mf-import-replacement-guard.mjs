// Isolated Chrome regression: imported 3MF -> setObjects replacement must
// NOT claim preservation=require. This deliberately does not implement a
// native in-place transform or claim desktop project metadata preservation.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';

export async function checkImportedProjectReplacementGuard(page, sourceBytes, cubeBytes,
    outputDir='parity-output') {
  assert.ok(sourceBytes instanceof Uint8Array && sourceBytes.length > 300 && sourceBytes.length < 1e6);
  assert.ok(cubeBytes instanceof Uint8Array && cubeBytes.length >= 134 && cubeBytes.length < 1e6);
  const result = await page.evaluate(async ({source, cube}) => {
    if (!globalThis.crossOriginIsolated)
      throw new Error('Imported 3MF guard needs isolated Chrome');
    const engine = globalThis.__layerDiagnosticEngine?.engine;
    if (!engine?.createSession) throw new Error('Native WASM unavailable');
    const session = await engine.createSession();
    try {
      const input = new Uint8Array(source);
      await session.initProfile('project.3mf',input);
      const original = await session.getManifest();
      if (original?.objects?.length !== 2 || original?.instances?.length !== 2)
        throw new Error('Original imported 3MF must contain two instances');
      const clean = await session.export('project.3mf',{
        schemaVersion:'0.7.0',preservation:'require',includeSliceArtifacts:false
      });
      const cleanBytes = await session.getAsset(clean.asset.id);
      if (!(cleanBytes instanceof Uint8Array) || cleanBytes.length !== input.length ||
          !cleanBytes.every((b,i)=>b===input[i]))
        throw new Error('Clean imported project lost its source archive');
      // A deliberate full project replacement, NOT an imported-object edit.
      // The old importer used to clear native_project_blob here and then
      // incorrectly let preservation=require succeed without source metadata.
      const object = {
        schemaVersion:'0.7.0',
        plates:[{id:'plate-0',index:0}],
        meshes:[{id:'replacement-mesh',format:'stl',
          dataRange:{offset:0,length:cube.length}}],
        objects:[{id:'replacement-object',meshId:'replacement-mesh'}],
        instances:[{id:'replacement-instance',objectId:'replacement-object',
          plateId:'plate-0',transform:{matrix:[
            1,0,0,90, 0,1,0,90, 0,0,1,0, 0,0,0,1
          ]}}],
        modifierVolumes:[]
      };
      await session.setObjects(new Uint8Array(cube),object);
      const updated=await session.getManifest();
      if(updated.objects?.length!==1 || updated.instances?.length!==1)
        throw new Error('setObjects did not replace the native source project');
      let strictRejected=false;
      let strictError='';
      try {
        await session.export('project.3mf',{
          schemaVersion:'0.7.0',preservation:'require',includeSliceArtifacts:false
        });
      } catch(e) {
        strictRejected=true;
        strictError=String(e?.message??e).slice(0,400);
      }
      if(!strictRejected)
        throw new Error('UNSAFE: discarded imported 3MF metadata yet preservation=require succeeded');
      const bestEffort=await session.export('project.3mf',{
        schemaVersion:'0.7.0',preservation:'best-effort',includeSliceArtifacts:false
      });
      const warned=bestEffort?.warnings?.some(w=>w?.code==='native-project-replaced');
      if(!warned)throw new Error('Best-effort replacement lacks source metadata-loss warning');
      const rebuilt=await session.getAsset(bestEffort.asset.id);
      if(!(rebuilt instanceof Uint8Array)||rebuilt.length<100||rebuilt[0]!==0x50)
        throw new Error('Best-effort replacement did not produce valid ZIP bytes');
      return {
        source:'independently generated Core 3MF, NOT desktop OrcaSlicer',
        originalObjects:original.objects.length,
        replacementObjects:updated.objects.length,
        untouchedByteIdentical:true,strictRejected,strictError,
        bestEffortWarning:'native-project-replaced',
        bestEffortArchiveBytes:rebuilt.length,
        note:'Source metadata not preserved; this is destructive replacement, not native imported-object editing.'
      };
    } finally {
      await session.dispose();
    }
  },{source:Array.from(sourceBytes),cube:Array.from(cubeBytes)});
  await mkdir(outputDir,{recursive:true});
  await writeFile(outputDir+'/imported-3mf-replacement-guard.json',
    JSON.stringify(result,null,2)+'\n');
  assert.equal(result.strictRejected,true);
  assert.equal(result.bestEffortWarning,'native-project-replaced');
  console.log('PASS: imported 3MF replacement rejects strict preservation and warns best-effort data loss');
  return result;
}
