// Real isolated Chrome + rebuilt v2.5.0 WASM: call the experimental
// PRIVATE C ABI on an imported independent Core 3MF. Test-only; never exposed
// in the public app. This edits the in-session manifest, NOT Slic3r::Model,
// and does NOT establish opaque metadata or desktop 3MF parity.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';

export async function checkBrowserPrivateImportedInstanceEdit(
    page, sourceBytes, outputDir='parity-output') {
  assert.ok(sourceBytes instanceof Uint8Array);
  assert.ok(sourceBytes.length > 300 && sourceBytes.length < 1_000_000);
  const result = await page.evaluate(async raw => {
    if (globalThis.crossOriginIsolated !== true)
      throw new Error('Private ABI test requires isolated localhost Chrome');
    const engine = globalThis.__layerDiagnosticEngine?.engine;
    if (!engine?.createSession) throw new Error('Verified engine is not loaded');
    const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
    const source = new Uint8Array(raw);
    const session = await engine.createSession();
    const opts = {schemaVersion:'0.7.0',preservation:'require',
      includeSliceArtifacts:false};
    try {
      await session.initProfile('project.3mf', source);
      const before = await session.getManifest();
      if (before.objects?.length !== 2 || before.instances?.length !== 2)
        throw new Error('Independent fixture must import exactly two instances');
      const clean = await session.export('project.3mf', opts);
      const cleanBytes = await session.getAsset(clean.asset.id);
      if (cleanBytes.length !== source.length ||
          !cleanBytes.every((value,i)=>value === source[i]))
        throw new Error('Unmodified source archive was not preserved byte-for-byte');

      // This is a deliberately private, test-only C entry point. The
      // pinned one-slicer-api glue exposes its module on session.binding;
      // do not add this to the public UI or canonical API surface.
      const mod = session.binding?.module;
      const handle = session.live?.();
      if (!handle || typeof mod?._orcawasm_project_edit_instance_transform !== 'function')
        throw new Error('Rebuilt WASM lacks the experimental private ABI');
      if (typeof mod._malloc !== 'function' || !mod.HEAPU8 ||
          typeof mod._free !== 'function')
        throw new Error('Private ABI test cannot access module memory');
      const encoder = new TextEncoder();
      const edit = request => {
        const bytes = encoder.encode(JSON.stringify(request));
        const pointer = mod._malloc(bytes.length);
        if (!pointer) throw new Error('Failed to allocate private request');
        try {
          mod.HEAPU8.set(bytes, pointer);
          return mod._orcawasm_project_edit_instance_transform(handle,pointer,bytes.length);
        } finally {
          mod._free(pointer);
        }
      };
      const target = before.instances[1];
      const changedMatrix = [...target.transform.matrix];
      changedMatrix[3] += 30;
      for (const invalid of [
        {instanceId:'missing-instance',matrix:changedMatrix},
        {instanceId:target.id,matrix:Array(16).fill(0)},
        {instanceId:target.id,matrix:target.transform.matrix},
      ]) {
        if (edit(invalid) === 0)
          throw new Error('Invalid private edit unexpectedly succeeded');
        if (!same(await session.getManifest(),before))
          throw new Error('Rejected private edit changed the native session');
      }
      if (edit({instanceId:target.id,matrix:changedMatrix}) !== 0)
        throw new Error('Valid selected-instance private edit failed');
      const after = await session.getManifest();
      const expected = JSON.parse(JSON.stringify(before));
      expected.instances[1].transform.matrix = changedMatrix;
      if (!same(after,expected))
        throw new Error('Private edit changed sibling, hierarchy or unrelated fields');
      let strictRejected = false;
      try {
        await session.export('project.3mf',opts);
      } catch (_) {
        strictRejected = true;
      }
      if (!strictRejected)
        throw new Error('UNSAFE: edited imported project accepted preservation=require');

      const best = await session.export('project.3mf',{
        ...opts,preservation:'best-effort'
      });
      const bytes = await session.getAsset(best.asset.id);
      if (!(bytes instanceof Uint8Array) || bytes.length < 100 ||
          bytes[0] !== 0x50 || bytes[1] !== 0x4b)
        throw new Error('Best-effort edited project is not a 3MF ZIP');
      const reopened = await engine.createSession();
      try {
        await reopened.initProfile('project.3mf',bytes);
        const reread = await reopened.getManifest();
        if (reread.objects?.length !== 2 || reread.instances?.length !== 2)
          throw new Error('Native reimport lost instance hierarchy');
        const actualX = reread.instances.map(x=>x.transform.matrix[3])
          .sort((a,b)=>a-b);
        const expectedX = [before.instances[0].transform.matrix[3],changedMatrix[3]]
          .sort((a,b)=>a-b);
        if (actualX.some((x,i)=>Math.abs(x-expectedX[i]) > 0.1))
          throw new Error('Native reimport lost the edited X position');

        // The manifest alone is insufficient: independently flatten the
        // best-effort 3MF through native WASM and check actual mesh positions.
        // This is a synthetic Core fixture, not a desktop/print validation.
        const stl = await engine.threeMfToStl(bytes);
        if (!(stl instanceof Uint8Array) || stl.byteLength < 84)
          throw new Error('Edited 3MF did not flatten to a binary STL');
        const view = new DataView(stl.buffer,stl.byteOffset,stl.byteLength);
        const triangles = view.getUint32(80,true);
        if (triangles !== 24 || stl.byteLength !== 84+50*triangles)
          throw new Error('Private edit export lost the 24 source triangles');
        const regions = [
          {triangles:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},
          {triangles:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}
        ];
        for (let t=0;t<triangles;t++) {
          const vertices=[];
          for (let v=0;v<3;v++) vertices.push([0,1,2].map(axis=>
            view.getFloat32(84+t*50+12+v*12+axis*4,true)));
          if (vertices.some(p=>p.some(x=>!Number.isFinite(x))))
            throw new Error('Edited 3MF STL contains nonfinite vertices');
          const centerX=vertices.reduce((sum,p)=>sum+p[0],0)/3;
          const region=regions[centerX<130?0:1];
          region.triangles++;
          for (const p of vertices)for(let axis=0;axis<3;axis++){
            region.min[axis]=Math.min(region.min[axis],p[axis]);
            region.max[axis]=Math.max(region.max[axis],p[axis]);
          }
        }
        const expectedBounds=[
          {min:[90,90,0],max:[110,110,20]},
          {min:[180,90,0],max:[200,110,20]}
        ];
        for(let i=0;i<2;i++){
          if(regions[i].triangles!==12)
            throw new Error('Private edit STL lost one cube placement');
          for(const side of ['min','max'])for(let axis=0;axis<3;axis++){
            if(Math.abs(regions[i][side][axis]-expectedBounds[i][side][axis])>0.05)
              throw new Error('Private edit STL geometry differs at cube '+i+
                ' '+side+' axis '+axis+': '+regions[i][side][axis]);
          }
        }
        return {
          editedArchive:Array.from(bytes),flattenedStl:Array.from(stl),
          flattenedTriangles:triangles,flattenedBoundsMm:regions,
          status:'PASS',source:'independent synthetic Core 3MF',
          isolatedChrome:true,privateCAbiCalled:true,
          invalidEditsAtomic:true,unselectedInstanceUnchanged:true,
          strictPreservationRejected:true,cleanArchiveByteIdentical:true,
          sourceObjects:before.objects.length,reimportObjects:reread.objects.length,
          beforeTargetX:target.transform.matrix[3],afterTargetX:changedMatrix[3],
          reimportedX:actualX,lossyExportBytes:bytes.length,
          fullDesktopParity:false,printApproved:false,
          note:'Private manifest edit only; Slic3r::Model and opaque metadata not proven'
        };
      } finally {
        await reopened.dispose();
      }
    } finally {
      await session.dispose();
    }
  },Array.from(sourceBytes));
  assert.equal(result.status,'PASS');
  assert.equal(result.privateCAbiCalled,true);
  assert.equal(result.strictPreservationRejected,true);
  assert.equal(result.flattenedTriangles,24);
  // New, isolated test-only sessions re-slice native WASM-flattened source
  // and edited 3MFs with the SAME generic profile. Assert deposited XY
  // paths move from the old cube's region to the edited cube's region.
  // This deliberately does NOT claim direct 3MF Slic3r::Model re-slicing.
  const toolpathDiagnostic=await page.evaluate(async ({source,edited})=>{
    if(!globalThis.crossOriginIsolated)
      throw new Error('Private edit toolpath test requires isolated Chrome');
    const engine=globalThis.__layerDiagnosticEngine?.engine;
    const {diagnosePrivateEdited3mfToolpathShift}=
      await import('/scripts/diagnose-edited-3mf-toolpaths.mjs');
    return diagnosePrivateEdited3mfToolpathShift(
      engine,new Uint8Array(source),new Uint8Array(edited));
  },{source:Array.from(sourceBytes),edited:result.editedArchive});
  assert.equal(toolpathDiagnostic.status,'PASS');
  assert.equal(toolpathDiagnostic.printApproved,false);
  result.editedToolpathDiagnostic=toolpathDiagnostic;
  // Native WASM route: import Core 3MF, apply synthetic profile, slice,
  // private-edit, and re-slice IN ONE SESSION. This does not flatten the 3MF
  // or replace the session with an STL. The C bridge still creates a new
  // temporary Slic3r::Model from its normalized mesh manifest per slice.
  const inSession=await page.evaluate(async raw=>{
    if(!globalThis.crossOriginIsolated)
      throw new Error('Same-session 3MF slice requires isolated Chrome');
    const engine=globalThis.__layerDiagnosticEngine?.engine;
    const {diagnoseImported3mfInSessionReslice}=
      await import('/scripts/diagnose-in-session-3mf-reslice.mjs');
    return diagnoseImported3mfInSessionReslice(engine,new Uint8Array(raw));
  },Array.from(sourceBytes));
  assert.equal(inSession.status,'PASS');
  assert.equal(inSession.imported3mfReslicedInSameSession,true);
  assert.equal(inSession.persistentNativeModelMutation,false);
  assert.equal(inSession.printApproved,false);
  result.inSessionImported3mfToolpathDiagnostic=inSession;
  const archive=Buffer.from(result.editedArchive);
  const stl=Buffer.from(result.flattenedStl);
  delete result.editedArchive;
  delete result.flattenedStl;
  await mkdir(outputDir,{recursive:true});
  await writeFile(outputDir+'/browser-private-edited-instance.3mf',archive);
  await writeFile(outputDir+'/browser-private-edited-instance.stl',stl);
  await writeFile(outputDir+'/browser-private-imported-instance-edit.json',
    JSON.stringify(result,null,2)+'\n');
  console.log('PASS: isolated Chrome private 3MF C ABI, strict preservation guard, edited STL geometry, and synthetic flattened-STL reslice XY paths');
  return result;
}
