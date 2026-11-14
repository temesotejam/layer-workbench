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
        return {
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
  await mkdir(outputDir,{recursive:true});
  await writeFile(outputDir+'/browser-private-imported-instance-edit.json',
    JSON.stringify(result,null,2)+'\n');
  console.log('PASS: isolated Chrome directly invoked private imported-instance C ABI; sibling and strict preservation guard verified');
  return result;
}
