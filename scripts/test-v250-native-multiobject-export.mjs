// Candidate-only regression: two source objects must remain two native 3MF
// objects and two build placements. This does NOT certify desktop 3MF parity
// or printer-safe G-code. Runs after rebuilding the experimental WASM bridge.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import { loadEngineArtifact, trianglesToStl } from '../orcawasm/scripts/lib/engine-harness.mjs';

const vertices = [
  [0,0,0],[20,0,0],[20,20,0],[0,20,0],
  [0,0,20],[20,0,20],[20,20,20],[0,20,20],
];
const faces = [
  [0,1,2],[0,2,3],[4,6,5],[4,7,6],
  [0,5,1],[0,4,5],[3,2,6],[3,6,7],
  [0,3,7],[0,7,4],[1,5,6],[1,6,2],
];
const cube = trianglesToStl(vertices, faces);
const data = new Uint8Array(cube.byteLength * 2);
data.set(cube);
data.set(cube, cube.byteLength);
const placement = (x) => [1,0,0,x, 0,1,0,90, 0,0,1,0, 0,0,0,1];
const manifest = {
  schemaVersion:'0.7.0',
  plates:[{id:'plate-0', index:0}],
  meshes:[
    {id:'mesh-0',format:'stl',dataRange:{offset:0,length:cube.byteLength}},
    {id:'mesh-1',format:'stl',dataRange:{offset:cube.byteLength,length:cube.byteLength}},
  ],
  objects:[{id:'object-0',meshId:'mesh-0'},{id:'object-1',meshId:'mesh-1'}],
  instances:[
    {id:'instance-0',objectId:'object-0',plateId:'plate-0',transform:{matrix:placement(90)}},
    {id:'instance-1',objectId:'object-1',plateId:'plate-0',transform:{matrix:placement(150)}},
  ],
  modifierVolumes:[],
};
const config = {
  bed_size_x:256,bed_size_y:256,printable_height:250,
  nozzle_diameter:0.4,layer_height:0.2,initial_layer_print_height:0.2,
  wall_loops:2,top_shell_layers:3,bottom_shell_layers:3,
  sparse_infill_density:15,sparse_infill_pattern:'grid',
  filament_type:'PLA',nozzle_temperature:220,bed_temperature:55,
};
const {artifact,runtime} = await loadEngineArtifact('orcawasm/artifacts','slicer-mt');
const engine = await artifact.createEngine({runtime});
let first, reopened;
try {
  first = await engine.createSession();
  await first.init(new TextEncoder().encode(JSON.stringify(config)));
  await first.setObjects(data,manifest);
  const original = await first.getManifest();
  assert.equal(original.objects?.length,2,'source objects');
  assert.equal(original.instances?.length,2,'source instances');
  const descriptor = await first.export('project.3mf', {
    schemaVersion:'0.7.0',preservation:'best-effort',includeSliceArtifacts:false,
  });
  const archive = await first.getAsset(descriptor.asset.id);
  assert.ok(archive instanceof Uint8Array && archive.byteLength>100 && archive[0]===0x50);
  reopened = await engine.createSession();
  await reopened.initProfile('project.3mf',archive);
  const result = await reopened.getManifest();
  assert.equal(result.objects?.length,2,'the native 3MF writer must retain separate objects');
  assert.equal(result.instances?.length,2,'the native 3MF writer must retain separate placements');
  const stl = await engine.threeMfToStl(archive);
  const view = new DataView(stl.buffer,stl.byteOffset,stl.byteLength);
  const count = view.getUint32(80,true);
  assert.equal(count,24,'both meshes must survive native 3MF export and conversion');
  assert.equal(stl.byteLength,84+50*count,'converted binary STL length');
  const centroids=[];
  for(let i=0;i<count;i++) {
    let x=0;
    for(let j=0;j<3;j++)x+=view.getFloat32(84+i*50+12+j*12,true)/3;
    centroids.push(x);
  }
  centroids.sort((a,b)=>a-b);
  assert.ok(centroids[12]-centroids[11]>30,'both placed geometry clusters must remain separate');
  console.log('PASS: rebuilt candidate preserves two native 3MF objects, two instances, 24 STL triangles');
  // Exercise the same object ID twice (not two equal meshes with different IDs).
  await reopened.dispose(); reopened = undefined;
  await first.dispose(); first = undefined;
  first = await engine.createSession();
  await first.init(new TextEncoder().encode(JSON.stringify(config)));
  const sharedManifest = {
    ...manifest, meshes:[manifest.meshes[0]], objects:[manifest.objects[0]],
    instances:manifest.instances.map(i=>({...i,objectId:'object-0'})),
  };
  await first.setObjects(cube,sharedManifest);
  const shared = await first.getManifest();
  assert.equal(shared.objects?.length,1);
  assert.equal(shared.meshes?.length,1);
  assert.equal(shared.instances?.length,2);
  const sharedDescriptor = await first.export('project.3mf', {
    schemaVersion:'0.7.0',preservation:'best-effort',includeSliceArtifacts:false,
  });
  const sharedArchive = await first.getAsset(sharedDescriptor.asset.id);
  const sharedStl = await engine.threeMfToStl(sharedArchive);
  assert.equal(sharedStl.byteLength,84+50*24);
  const sharedView = new DataView(sharedStl.buffer,sharedStl.byteOffset,sharedStl.byteLength);
  assert.equal(sharedView.getUint32(80,true),24);
  const bounds = [0,1].map(()=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity],count:0}));
  for(let i=0;i<24;i++){
    const points=[0,1,2].map(v=>[0,1,2].map(a=>sharedView.getFloat32(84+i*50+12+v*12+a*4,true)));
    assert.ok(points.flat().every(Number.isFinite));
    const region=bounds[points.reduce((s,p)=>s+p[0],0)/3<130?0:1];
    region.count++;
    for(const p of points)for(let a=0;a<3;a++){
      region.min[a]=Math.min(region.min[a],p[a]);region.max[a]=Math.max(region.max[a],p[a]);
    }
  }
  for(let i=0;i<2;i++){
    assert.equal(bounds[i].count,12);
    const expectedMin=[90+60*i,90,0],expectedMax=[110+60*i,110,20];
    for(let a=0;a<3;a++){
      assert.ok(Math.abs(bounds[i].min[a]-expectedMin[a])<0.05,'shared mesh minimum');
      assert.ok(Math.abs(bounds[i].max[a]-expectedMax[a])<0.05,'shared mesh maximum');
    }
  }
  await mkdir('parity-output',{recursive:true});
  await writeFile('parity-output/rebuilt-shared-object.3mf',sharedArchive);
  console.log('PASS: shared-object export retained two world geometry placements; Core identity audit follows');
} finally {
  if(reopened)await reopened.dispose();
  if(first)await first.dispose();
  await engine.dispose();
}
