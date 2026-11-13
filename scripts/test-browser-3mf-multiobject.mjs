// Isolated Chrome proof of TWO separate native mesh objects in a 3MF project.
// Uses only synthetic STL and the already verified v2.5.0 WASM candidate.
// This is not an editor, native-desktop 3MF compatibility, or print validation.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export async function checkBrowserMultiObject3mf(page, cubeBytes, outputDir='parity-output') {
  assert.ok(cubeBytes instanceof Uint8Array && cubeBytes.byteLength >= 134);
  const report = await page.evaluate(async input => {
    if (!globalThis.crossOriginIsolated) throw new Error('Isolated Chrome required');
    const engine = globalThis.__layerDiagnosticEngine?.engine;
    if (!engine || typeof engine.createSession !== 'function')
      throw new Error('Verified WASM engine not loaded');
    const cube = new Uint8Array(input);
    const combined = new Uint8Array(cube.length * 2);
    combined.set(cube);
    combined.set(cube, cube.length);
    const matrix = (x, y) => [1,0,0,x, 0,1,0,y, 0,0,1,0, 0,0,0,1];
    const project = {
      schemaVersion:'0.7.0',
      plates:[{id:'plate-0',index:0}],
      meshes:[
        {id:'mesh-0',format:'stl',dataRange:{offset:0,length:cube.length}},
        {id:'mesh-1',format:'stl',dataRange:{offset:cube.length,length:cube.length}}
      ],
      objects:[
        {id:'object-0',meshId:'mesh-0'},
        {id:'object-1',meshId:'mesh-1'}
      ],
      instances:[
        {id:'instance-0',objectId:'object-0',plateId:'plate-0',
          transform:{matrix:matrix(90,90)}},
        {id:'instance-1',objectId:'object-1',plateId:'plate-0',
          transform:{matrix:matrix(150,90)}}
      ],
      modifierVolumes:[]
    };
    const config = {
      bed_size_x:256,bed_size_y:256,printable_height:250,
      nozzle_diameter:0.4,layer_height:0.2,initial_layer_print_height:0.2,
      wall_loops:2,top_shell_layers:3,bottom_shell_layers:3,
      sparse_infill_density:15,sparse_infill_pattern:'grid',
      filament_type:'PLA',nozzle_temperature:220,bed_temperature:55
    };
    const source = await engine.createSession();
    let original, initial;
    try {
      await source.init(new TextEncoder().encode(JSON.stringify(config)));
      await source.setObjects(combined, project);
      initial = await source.getManifest();
      if (initial?.instances?.length !== 2 || initial?.objects?.length !== 2
          || initial?.meshes?.length !== 2)
        throw new Error('Native multi-object session manifest is incomplete');
      const descriptor = await source.export('project.3mf', {
        schemaVersion:'0.7.0',preservation:'best-effort',includeSliceArtifacts:false
      });
      if (descriptor?.asset?.kind !== 'project' || descriptor?.asset?.mimeType !== 'model/3mf')
        throw new Error('Native multi-object 3MF descriptor invalid');
      original = await source.getAsset(descriptor.asset.id);
      if (!(original instanceof Uint8Array) || original.byteLength < 100 ||
          original.byteLength > 5_000_000 || original[0] !== 0x50 || original[1] !== 0x4b)
        throw new Error('Native multi-object 3MF is empty, excessive, or not a ZIP');
    } finally { await source.dispose(); }
    const reopened = await engine.createSession();
    let imported, converted;
    try {
      await reopened.initProfile('project.3mf', original);
      imported = await reopened.getManifest();
      if (imported?.schemaVersion !== '0.7.0' ||
          imported?.instances?.length !== 2 || imported?.objects?.length !== 2)
        throw new Error('Reimported two-object native 3MF lost object instances');
      converted = await engine.threeMfToStl(original);
      if (!(converted instanceof Uint8Array) || converted.byteLength < 134)
        throw new Error('Two-object 3MF conversion returned no STL');
      const count = new DataView(converted.buffer,converted.byteOffset,converted.byteLength)
        .getUint32(80,true);
      if (count !== 24 || converted.byteLength !== 84+50*count)
        throw new Error('Two placed cubes must convert to exactly 24 triangles');
    } finally { await reopened.dispose(); }
    return {
      archive:Array.from(original), stl:Array.from(converted),
      initialObjects:initial.objects.length, initialInstances:initial.instances.length,
      importedObjects:imported.objects.length, importedInstances:imported.instances.length,
      stlTriangles:24
    };
  }, Array.from(cubeBytes));
  assert.equal(report.importedInstances, 2);
  assert.equal(report.stlTriangles, 24);
  const archive=Buffer.from(report.archive), stl=Buffer.from(report.stl);
  await mkdir(outputDir,{recursive:true});
  await writeFile(outputDir+'/wasm-multiobject-3mf.3mf',archive);
  await writeFile(outputDir+'/wasm-multiobject-converted.stl',stl);
  const sha256=createHash('sha256').update(archive).digest('hex');
  await writeFile(outputDir+'/wasm-multiobject-3mf-summary.json',JSON.stringify({
    fixture:'two separate synthetic 12-triangle cube meshes, translated 60 mm in X',
    engine:'OrcaSlicer v2.5.0 isolated Chrome WASM candidate',
    source:'WASM-generated project, NOT desktop-authored 3MF',
    archiveBytes:archive.length, sha256,
    initialObjects:report.initialObjects,initialInstances:report.initialInstances,
    reimportedObjects:report.importedObjects,reimportedInstances:report.importedInstances,
    flattenedTriangles:report.stlTriangles,
    limitations:'No desktop-authored 3MF, edit-and-resave transform, face-ID mesh preview, metadata parity or printer safety validated'
  },null,2)+'\n');
  return {bytes:archive.length,sha256,instances:report.importedInstances,triangles:report.stlTriangles};
}
