// Diagnostic acceptance boundary for an independently constructed 3MF Core
// document. The fixture is NOT desktop OrcaSlicer output. This probe is
// exploratory and intentionally records unsupported native imports rather
// than misreporting them as successful edits or weakening other strict gates.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';

export async function probeIndependentCore3mfImport(page, sourceBytes, outputDir='parity-output') {
  assert.ok(sourceBytes instanceof Uint8Array && sourceBytes.length > 300 &&
    sourceBytes.length < 1_000_000, 'Bounded external 3MF fixture required');
  assert.equal(sourceBytes[0], 0x50, 'Expected ZIP archive');
  assert.equal(sourceBytes[1], 0x4b, 'Expected ZIP archive');
  const outcome = await page.evaluate(async data => {
    if (!globalThis.crossOriginIsolated)
      throw new Error('Independent 3MF probe requires isolated Chrome');
    const engine=globalThis.__layerDiagnosticEngine?.engine;
    if (!engine?.createSession || typeof engine.threeMfToStl !== 'function')
      throw new Error('Verified native WASM engine not loaded');
    const source=new Uint8Array(data);
    const result={
      source:'independent synthetic 3MF Core file, not desktop OrcaSlicer',
      sourceBytes:source.byteLength,
      flattenedConversion:{status:'not-run'},
      nativeProjectImport:{status:'not-run'}
    };
    const errorText=e=>String(e?.message ?? e).slice(0,800);
    try {
      const stl=await engine.threeMfToStl(source);
      if (!(stl instanceof Uint8Array) || stl.byteLength < 134)
        throw new Error('Conversion yielded no binary STL');
      const view=new DataView(stl.buffer,stl.byteOffset,stl.byteLength);
      const triangles=view.getUint32(80,true);
      if (triangles !== 24 || stl.byteLength !== 84+triangles*50)
        throw new Error('Independent two-build 3MF expected 24 placed triangles');
      const regions=[
        {triangles:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},
        {triangles:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}
      ];
      for (let t=0;t<triangles;t++) {
        const vertices=[];
        for (let v=0;v<3;v++) vertices.push([0,1,2].map(axis=>
          view.getFloat32(84+t*50+12+v*12+axis*4,true)));
        if (vertices.some(p=>p.some(value=>!Number.isFinite(value))))
          throw new Error('Nonfinite converted STL vertex');
        const centerX=vertices.reduce((sum,p)=>sum+p[0],0)/3;
        const region=regions[centerX<130?0:1];
        region.triangles++;
        for (const vertex of vertices) for (let axis=0;axis<3;axis++) {
          region.min[axis]=Math.min(region.min[axis],vertex[axis]);
          region.max[axis]=Math.max(region.max[axis],vertex[axis]);
        }
      }
      const expected=[
        {min:[90,90,0],max:[110,110,20]},
        {min:[150,90,0],max:[170,110,20]}
      ];
      for (let i=0;i<2;i++) {
        if (regions[i].triangles !== 12)
          throw new Error('Independent build item '+i+' lost triangles');
        for (const side of ['min','max']) for (let axis=0;axis<3;axis++) {
          if (Math.abs(regions[i][side][axis]-expected[i][side][axis])>0.05)
            throw new Error('Independent Core STL placement mismatch: '+i+' '+side+' '+axis);
        }
      }
      result.convertedStl=Array.from(stl);
      result.flattenedConversion={status:'pass',triangles,regions};
    } catch(error) {
      result.flattenedConversion={status:'unsupported-or-failed',error:errorText(error)};
    }
    const session=await engine.createSession();
    try {
      try {
        await session.initProfile('project.3mf',source);
        result.nativeProjectImport.status='accepted';
      } catch(error) {
        result.nativeProjectImport={status:'unsupported-or-failed',error:errorText(error)};
      }
      if (result.nativeProjectImport.status==='accepted') {
        try {
          const manifest=await session.getManifest();
          result.nativeProjectImport.manifest={
            schemaVersion:manifest?.schemaVersion ?? null,
            meshes:manifest?.meshes?.length ?? null,
            objects:manifest?.objects?.length ?? null,
            instances:manifest?.instances?.length ?? null,
            plateCount:manifest?.plates?.length ?? null
          };
          result.nativeProjectImport.twoPlacementsExposed=
            manifest?.instances?.length===2;
        } catch(error) {
          result.nativeProjectImport.manifestError=errorText(error);
        }
        // Untouched preservation is a separate gate from editable hierarchy.
        // A byte-identical archive is not proof that transforms are mutable.
        try {
          const exported=await session.export('project.3mf',{
            schemaVersion:'0.7.0',preservation:'require',includeSliceArtifacts:false
          });
          const preserved=await session.getAsset(exported.asset.id);
          result.nativeProjectImport.preservationRequireByteIdentical=
            preserved instanceof Uint8Array && preserved.length===source.length &&
            preserved.every((value,index)=>value===source[index]);
          result.nativeProjectImport.exportBytes=preserved?.length ?? null;
        } catch(error) {
          result.nativeProjectImport.preservationError=errorText(error);
        }
      }
    } finally {
      await session.dispose();
    }
    return result;
  },Array.from(sourceBytes));
  await mkdir(outputDir,{recursive:true});
  if (outcome.convertedStl) {
    await writeFile(outputDir+'/independent-core-converted.stl',
      Buffer.from(outcome.convertedStl));
    delete outcome.convertedStl;
  }
  await writeFile(outputDir+'/independent-core-import-diagnostic.json',
    JSON.stringify({...outcome,limitations:
      'Diagnostic only. No desktop-authored 3MF, selective imported-project editing, native metadata editing, G-code parity or print validation.'},null,2)+'\n');
  // The initial exploratory Chrome run established that this deterministic
  // Core fixture is accepted by the pinned candidate. Promote those observed
  // invariants to an actual FAIL-on-regression acceptance gate. Write the
  // diagnostic JSON first, so a future failure still retains evidence.
  assert.equal(outcome.flattenedConversion.status,'pass',
    'Independent 3MF conversion failed; see import diagnostic artifact');
  assert.equal(outcome.nativeProjectImport.status,'accepted',
    'Native import of independent Core 3MF failed');
  assert.equal(outcome.nativeProjectImport.manifest?.schemaVersion,'0.7.0');
  assert.equal(outcome.nativeProjectImport.manifest?.objects,2,
    'Independent Core 3MF lost two native objects');
  assert.equal(outcome.nativeProjectImport.manifest?.instances,2,
    'Independent Core 3MF lost two build placements');
  assert.equal(outcome.nativeProjectImport.twoPlacementsExposed,true);
  assert.equal(outcome.nativeProjectImport.preservationRequireByteIdentical,true,
    'Untouched independent Core 3MF did not survive preservation=require');
  console.log('PASS: independently authored Core 3MF -> native import 2 objects/2 instances, exact STL bounds, untouched archive byte preservation');
  console.log('INDEPENDENT_CORE_3MF_DIAGNOSTIC '+JSON.stringify(outcome));
  return outcome;
}
