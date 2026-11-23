// Isolated Chrome proof of two placed native objects or two instances of one mesh.
// Uses only synthetic STL and the already verified v2.5.0 WASM candidate.
// Legacy candidate uses diagnostic placement reporting; accepted candidates
// require exact per-object XYZ bounds. No native editor or print validation.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export async function checkBrowserMultiObject3mf(page, cubeBytes, outputDir='parity-output', {requireExactPlacement=false, sharedMesh=false}={}) {
  assert.ok(cubeBytes instanceof Uint8Array && cubeBytes.byteLength >= 134);
  // The separate-resource case must use GEOMETRICALLY DISTINCT source STLs.
  // Two byte-identical cubes cannot reveal an exporter which duplicates one
  // resource while silently discarding the other. Retain the original cube
  // unchanged for the shared-mesh / multiple-instance comparison.
  let secondSource=null;
  if(!sharedMesh){
    secondSource=Uint8Array.from(cubeBytes);
    const view=new DataView(secondSource.buffer,secondSource.byteOffset,secondSource.byteLength);
    const triangles=view.getUint32(80,true);
    assert.equal(secondSource.byteLength,84+50*triangles,'Expected binary STL source');
    assert.equal(triangles,12,'Distinct-resource fixture must be the verified cube');
    for(let i=0;i<triangles;i++)for(let vertex=0;vertex<3;vertex++){
      const zOffset=84+50*i+12+12*vertex+8;
      const z=view.getFloat32(zOffset,true);
      assert.ok(Number.isFinite(z),'Nonfinite source cube vertex');
      view.setFloat32(zOffset,z/2,true);
    }
    assert.notEqual(Buffer.compare(Buffer.from(secondSource),Buffer.from(cubeBytes)),0,
      'Independent source STL must have different vertex geometry');
  }
  const report = await page.evaluate(async ({input,secondInput,requireExactPlacement,sharedMesh}) => {
    if (!globalThis.crossOriginIsolated) throw new Error('Isolated Chrome required');
    const engine = globalThis.__layerDiagnosticEngine?.engine;
    if (!engine || typeof engine.createSession !== 'function')
      throw new Error('Verified WASM engine not loaded');
    const cube = new Uint8Array(input);
    const combined = new Uint8Array(cube.length * (sharedMesh ? 1 : 2));
    combined.set(cube);
    if (!sharedMesh) {
      const second=new Uint8Array(secondInput);
      if(second.length!==cube.length || second.every((byte,index)=>byte===cube[index]))
        throw new Error('Separate mesh fixture must have independently different STL vertices');
      combined.set(second,cube.length);
    }
    const matrix = (x, y) => [1,0,0,x, 0,1,0,y, 0,0,1,0, 0,0,0,1];
    const project = {
      schemaVersion:'0.7.0',
      plates:[{id:'plate-0',index:0}],
      meshes:[
        {id:'mesh-0',format:'stl',dataRange:{offset:0,length:cube.length}},
        ...(!sharedMesh ? [{id:'mesh-1',format:'stl',dataRange:{offset:cube.length,length:cube.length}}] : [])
      ],
      objects:[
        {id:'object-0',meshId:'mesh-0'},
        ...(!sharedMesh ? [{id:'object-1',meshId:'mesh-1'}] : [])
      ],
      instances:[
        {id:'instance-0',objectId:'object-0',plateId:'plate-0',
          transform:{matrix:matrix(90,90)}},
        {id:'instance-1',objectId:sharedMesh ? 'object-0' : 'object-1',plateId:'plate-0',
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
      if (initial?.instances?.length !== 2 || initial?.objects?.length !== (sharedMesh ? 1 : 2)
          || initial?.meshes?.length !== (sharedMesh ? 1 : 2))
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
    let imported, converted, convertedCount, splitGapMm, placedBoundsMm, absolutePlacementVerified=false;
    try {
      await reopened.initProfile('project.3mf', original);
      imported = await reopened.getManifest();
      if (imported?.schemaVersion !== '0.7.0' || !Array.isArray(imported.instances) ||
          !Array.isArray(imported.objects) || !Array.isArray(imported.meshes))
        throw new Error('Reimported 3MF returned invalid project manifest');
      converted = await engine.threeMfToStl(original);
      if (!(converted instanceof Uint8Array) || converted.byteLength < 134)
        throw new Error('Two-object 3MF conversion returned no STL');
      const count = new DataView(converted.buffer,converted.byteOffset,converted.byteLength)
        .getUint32(80,true);
      if (count < 1 || converted.byteLength !== 84+50*count)
        throw new Error('Two-object probe produced malformed binary STL');
      convertedCount=count;
      // Two cubes must remain spatially separate even when the exporter
      // collapses their source object hierarchy into one output mesh.
      if (count !== 24) throw new Error('Native export dropped synthetic cube triangles');
      const centroids=[];
      const view=new DataView(converted.buffer,converted.byteOffset,converted.byteLength);
      // An inter-object gap alone misses a common translation, misplaced
      // Y/Z coordinates and unequal per-object geometry. Verify the exact
      // placed XYZ extents of EACH 20 mm cube, not just the overall STL.
      const regions=[0,1].map(()=>({
        triangles:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]
      }));
      for(let i=0;i<count;i++) {
        const vertices=[];
        for(let v=0;v<3;v++) {
          const offset=84+i*50+12+v*12;
          vertices.push([0,1,2].map(axis=>view.getFloat32(offset+axis*4,true)));
        }
        if(vertices.some(point=>point.some(value=>!Number.isFinite(value))))
          throw new Error('Non-finite coordinates in converted two-object STL');
        const centroidX=vertices.reduce((sum,point)=>sum+point[0],0)/3;
        centroids.push(centroidX);
        const region=regions[centroidX<130?0:1];
        region.triangles++;
        for(const point of vertices)for(let axis=0;axis<3;axis++) {
          region.min[axis]=Math.min(region.min[axis],point[axis]);
          region.max[axis]=Math.max(region.max[axis],point[axis]);
        }
      }
      centroids.sort((a,b)=>a-b);
      splitGapMm=centroids[12]-centroids[11];
      if (!Number.isFinite(splitGapMm) || splitGapMm < 30)
        throw new Error('Expected two spatially separated 3MF mesh clusters');
      const expected=[
        {min:[90,90,0],max:[110,110,20]},
        {min:[150,90,0],max:[170,110,sharedMesh ? 20 : 10]}
      ];
      absolutePlacementVerified=true;
      for(let i=0;i<2;i++) {
        if(regions[i].triangles!==12)
          throw new Error('Object '+i+' lost or gained placed mesh triangles');
        for(const side of ['min','max'])for(let axis=0;axis<3;axis++)
          if(Math.abs(regions[i][side][axis]-expected[i][side][axis])>0.05) {
            absolutePlacementVerified=false;
            if(requireExactPlacement)
              throw new Error('Object '+i+' '+side+' XYZ'+axis+
                ' differs from source placement: '+regions[i][side][axis]);
          }
      }
      placedBoundsMm=regions;
    } finally { await reopened.dispose(); }
    return {
      archive:Array.from(original), stl:Array.from(converted),
      initialObjects:initial.objects.length, initialMeshes:initial.meshes.length,
      initialInstances:initial.instances.length, importedObjects:imported.objects.length,
      importedMeshes:imported.meshes.length, importedInstances:imported.instances.length,
      stlTriangles:convertedCount, splitGapMm, placedBoundsMm,
      absolutePlacementVerified
    };
  }, {input:Array.from(cubeBytes),secondInput:secondSource ? Array.from(secondSource) : [],
    requireExactPlacement,sharedMesh});
  assert.equal(report.initialInstances, 2);
  assert.equal(report.initialObjects, sharedMesh ? 1 : 2);
  assert.equal(report.initialMeshes, sharedMesh ? 1 : 2);
  assert.equal(report.stlTriangles, 24);
  assert.ok(report.splitGapMm >= 30);
  const archive=Buffer.from(report.archive), stl=Buffer.from(report.stl);
  await mkdir(outputDir,{recursive:true});
  const prefix=sharedMesh ? 'wasm-sharedmesh' : 'wasm-multiobject';
  await writeFile(outputDir+`/${prefix}-3mf.3mf`,archive);
  await writeFile(outputDir+`/${prefix}-converted.stl`,stl);
  const expectedResources=sharedMesh ? 1 : 2;
  const hierarchyRetained=report.importedInstances===2 &&
    report.importedObjects===expectedResources && report.importedMeshes===expectedResources;
  const sha256=createHash('sha256').update(archive).digest('hex');
  await writeFile(outputDir+`/${prefix}-3mf-summary.json`,JSON.stringify({
    fixture:sharedMesh ? 'two instances of ONE synthetic 12-triangle cube mesh, 60 mm apart in X'
                       : 'two DISTINCT synthetic 12-triangle meshes (20 mm and 10 mm height), 60 mm apart in X',
    sharedInputMesh:sharedMesh,
    distinctInputGeometry:!sharedMesh,
    engine:'OrcaSlicer v2.5.0 isolated Chrome WASM candidate',
    source:'WASM-generated project, NOT desktop-authored 3MF',
    archiveBytes:archive.length, sha256,
    initialObjects:report.initialObjects,initialMeshes:report.initialMeshes,
    initialInstances:report.initialInstances, reimportedObjects:report.importedObjects,
    reimportedMeshes:report.importedMeshes,reimportedInstances:report.importedInstances,
    flattenedTriangles:report.stlTriangles,
    measuredGapBetweenTriangleClustersMm:report.splitGapMm,
    verifiedPerObjectPlacedBoundsMm:report.placedBoundsMm,
    absolutePlacementVerified:report.absolutePlacementVerified,
    nativeHierarchyRetained:hierarchyRetained,
    multiObjectRoundTripSupported:hierarchyRetained && report.absolutePlacementVerified &&
      report.stlTriangles === 24,
    limitations:'No desktop-authored 3MF, edit-and-resave transform, face-ID mesh preview, metadata parity or printer safety validated'
  },null,2)+'\n');
  return {bytes:archive.length,sha256,placementVerified:report.absolutePlacementVerified,
    initialMeshes:report.initialMeshes,instances:report.importedInstances,
    reimportedMeshes:report.importedMeshes,triangles:report.stlTriangles,
    supported:hierarchyRetained && report.absolutePlacementVerified &&
      report.stlTriangles === 24};
}
