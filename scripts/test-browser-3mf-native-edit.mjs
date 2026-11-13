// Real isolated Chrome + rebuilt v2.5.0 WASM: edit ONE native manifest
// instance, replace the test project through setObjects, export/reimport 3MF.
// This is NOT lossless editing of an already imported desktop 3MF archive.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export async function checkNativeManifestEditRoundTrip(page, cubeBytes, outputDir='parity-output') {
  assert.ok(cubeBytes instanceof Uint8Array && cubeBytes.byteLength >= 134);
  const outcome=await page.evaluate(async raw => {
    if(!crossOriginIsolated)throw new Error('Isolated Chrome required');
    const engine=globalThis.__layerDiagnosticEngine?.engine;
    if(!engine?.createSession)throw new Error('Verified WASM engine is not loaded');
    const {editManifestInstanceTransform}=await import('/scripts/native-manifest-edit.mjs');
    const cube=new Uint8Array(raw);
    const blob=new Uint8Array(cube.length*2);
    blob.set(cube);
    blob.set(cube,cube.length);
    const position=x=>[1,0,0,x, 0,1,0,90, 0,0,1,0, 0,0,0,1];
    const project={
      schemaVersion:'0.7.0',
      plates:[{id:'plate-0',index:0}],
      meshes:[
        {id:'mesh-0',format:'stl',dataRange:{offset:0,length:cube.length}},
        {id:'mesh-1',format:'stl',dataRange:{offset:cube.length,length:cube.length}}
      ],
      objects:[{id:'object-0',meshId:'mesh-0'},{id:'object-1',meshId:'mesh-1'}],
      instances:[
        {id:'instance-0',objectId:'object-0',plateId:'plate-0',transform:{matrix:position(90)}},
        {id:'instance-1',objectId:'object-1',plateId:'plate-0',transform:{matrix:position(150)}}
      ],
      modifierVolumes:[]
    };
    const config={
      bed_size_x:256,bed_size_y:256,printable_height:250,
      nozzle_diameter:0.4,layer_height:0.2,initial_layer_print_height:0.2,
      wall_loops:2,top_shell_layers:3,bottom_shell_layers:3,
      sparse_infill_density:15,sparse_infill_pattern:'grid',
      filament_type:'PLA',nozzle_temperature:220,bed_temperature:55
    };
    const session=await engine.createSession();
    let bytes;
    try {
      await session.init(new TextEncoder().encode(JSON.stringify(config)));
      await session.setObjects(blob,project);
      const initial=await session.getManifest();
      assert.equal(initial.instances.length,2);
      // 90-degree rotation, nonuniform X scale (1.5), and translation
      // on the SECOND instance only. Expected X range: 145..175 mm.
      const edited=editManifestInstanceTransform(initial,'instance-1',[
        0,-1.5,0,175, 1,0,0,90, 0,0,1,0, 0,0,0,1
      ]);
      assert.deepEqual(edited.instances[0],initial.instances[0]);
      await session.setObjects(blob,edited);
      const applied=await session.getManifest();
      assert.deepEqual(applied.instances[0].transform.matrix,initial.instances[0].transform.matrix);
      assert.deepEqual(applied.instances[1].transform.matrix,edited.instances[1].transform.matrix);
      const exported=await session.export('project.3mf',{
        schemaVersion:'0.7.0',preservation:'best-effort',includeSliceArtifacts:false
      });
      if(exported?.asset?.kind!=='project'||exported?.asset?.mimeType!=='model/3mf')
        throw new Error('Native project export descriptor missing');
      bytes=await session.getAsset(exported.asset.id);
      if(!(bytes instanceof Uint8Array)||bytes.byteLength<100||bytes.byteLength>5_000_000||
         bytes[0]!==0x50||bytes[1]!==0x4b)throw new Error('Native edited 3MF invalid');
    }finally{await session.dispose();}
    const reopened=await engine.createSession();
    let manifest,converted;
    try{
      await reopened.initProfile('project.3mf',bytes);
      manifest=await reopened.getManifest();
      converted=await engine.threeMfToStl(bytes);
    }finally{await reopened.dispose();}
    if(manifest?.objects?.length!==2||manifest?.instances?.length!==2)
      throw new Error('Edited native 3MF lost independent object hierarchy');
    if(!(converted instanceof Uint8Array)||converted.byteLength<134)
      throw new Error('Edited 3MF STL conversion invalid');
    const view=new DataView(converted.buffer,converted.byteOffset,converted.byteLength);
    const triangles=view.getUint32(80,true);
    if(triangles!==24||converted.byteLength!==84+50*triangles)
      throw new Error('Edited 3MF lost source triangles');
    const region=[
      {triangles:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},
      {triangles:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}
    ];
    for(let i=0;i<triangles;i++){
      const vertices=[];
      for(let v=0;v<3;v++)vertices.push([0,1,2].map(axis=>
        view.getFloat32(84+i*50+12+v*12+axis*4,true)));
      if(vertices.some(p=>p.some(x=>!Number.isFinite(x))))
        throw new Error('Non-finite geometry in edited native 3MF');
      const x=vertices.reduce((sum,p)=>sum+p[0],0)/3;
      const item=region[x<130?0:1];
      item.triangles++;
      for(const p of vertices)for(let axis=0;axis<3;axis++){
        item.min[axis]=Math.min(item.min[axis],p[axis]);
        item.max[axis]=Math.max(item.max[axis],p[axis]);
      }
    }
    const expected=[
      {min:[90,90,0],max:[110,110,20]},
      {min:[145,90,0],max:[175,110,20]}
    ];
    for(let i=0;i<2;i++){
      if(region[i].triangles!==12)throw new Error('Edited object lost triangles '+i);
      for(const side of ['min','max'])for(let axis=0;axis<3;axis++)
        if(Math.abs(region[i][side][axis]-expected[i][side][axis])>0.05)
          throw new Error('Edited object '+i+' '+side+' XYZ'+axis+
            ' differs from expected placement: '+region[i][side][axis]);
    }
    return{archive:Array.from(bytes),stl:Array.from(converted),
      importedObjects:manifest.objects.length,importedInstances:manifest.instances.length,
      triangles,regions:region};
  },Array.from(cubeBytes));
  const archive=Buffer.from(outcome.archive),stl=Buffer.from(outcome.stl);
  await mkdir(outputDir,{recursive:true});
  await writeFile(outputDir+'/wasm-edited-manifest-instance.3mf',archive);
  await writeFile(outputDir+'/wasm-edited-manifest-instance.stl',stl);
  const sha256=createHash('sha256').update(archive).digest('hex');
  await writeFile(outputDir+'/wasm-edited-manifest-instance-summary.json',JSON.stringify({
    source:'two synthetic cube STLs; edited on one-slicer-api setObjects project replacement',
    operation:'second instance only: Z rotation 90 degrees, nonuniform scale 1.5, translation',
    native3mfSha256:sha256,bytes:archive.length,
    reopenedObjects:outcome.importedObjects,reopenedInstances:outcome.importedInstances,
    flattenedTriangles:outcome.triangles,perObjectBoundsMm:outcome.regions,
    limitation:'NOT editing a desktop-imported 3MF. setObjects rebuilds the project; original 3MF opaque metadata is NOT preserved. No print safety.'
  },null,2)+'\n');
  return {sha256,triangles:outcome.triangles,regions:outcome.regions};
}
