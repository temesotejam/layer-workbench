// Isolated-Chrome-only verification of the ACTUAL v2.5.0 WASM 3MF export
// and native-project reimport path. Test fixture is a synthetic STL; this
// does not establish desktop-created 3MF compatibility or print safety.
import assert from "node:assert/strict";
import {mkdir, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";

export async function checkBrowser3mfRoundTrip(page, stlBytes, outputDir="parity-output") {
  assert.ok(stlBytes instanceof Uint8Array && stlBytes.byteLength >= 134);
  const result=await page.evaluate(async data=>{
    if(!globalThis.crossOriginIsolated)throw new Error("WASM 3MF proof requires isolated Chrome");
    const engine=globalThis.__layerDiagnosticEngine?.engine;
    if(!engine || typeof engine.createSession!=="function")
      throw new Error("Locally selected WASM engine not loaded");
    const config={
      bed_size_x:256,bed_size_y:256,printable_height:250,nozzle_diameter:0.4,
      layer_height:0.2,initial_layer_print_height:0.2,wall_loops:2,
      top_shell_layers:3,bottom_shell_layers:3,sparse_infill_density:15,
      sparse_infill_pattern:"grid",filament_type:"PLA",
      nozzle_temperature:220,bed_temperature:55
    };
    const blob=new Uint8Array(data);
    const project={
      schemaVersion:"0.7.0",
      plates:[{id:"plate-0",index:0}],
      meshes:[{id:"mesh-0",format:"stl",dataRange:{offset:0,length:blob.byteLength}}],
      objects:[{id:"object-0",meshId:"mesh-0"}],
      instances:[{id:"instance-0",objectId:"object-0",plateId:"plate-0",
        transform:{matrix:[1,0,0,128,0,1,0,128,0,0,1,0,0,0,0,1]}}],
      modifierVolumes:[]
    };
    const bytes=value=>{
      if(!(value instanceof Uint8Array)||value.byteLength<100||value.byteLength>5_000_000)
        throw new Error("3MF asset empty or too large for bounded browser regression");
      if(value[0]!==0x50||value[1]!==0x4b)
        throw new Error("Native 3MF asset has no ZIP signature");
      return value;
    };
    const first=await engine.createSession();
    let original,firstManifest,firstWarnings;
    try {
      await first.init(new TextEncoder().encode(JSON.stringify(config)));
      await first.setObjects(blob,project);
      firstManifest=await first.getManifest();
      if(firstManifest?.schemaVersion!=="0.7.0"||firstManifest.instances?.length!==1)
        throw new Error("Initial native project manifest is incomplete");
      const exported=await first.export("project.3mf",{
        schemaVersion:"0.7.0",preservation:"best-effort",includeSliceArtifacts:false
      });
      if(exported?.schemaVersion!=="0.7.0"||exported.asset?.kind!=="project"
        ||exported.asset?.mimeType!=="model/3mf"||!exported.asset?.id)
        throw new Error("Native 3MF exporter returned an invalid descriptor");
      original=bytes(await first.getAsset(exported.asset.id));
      if(exported.asset.byteLength!==original.byteLength)
        throw new Error("Native exporter asset byte length mismatch");
      firstWarnings=exported.warnings??[];
    } finally { await first.dispose(); }
    const second=await engine.createSession();
    let reexported,manifest,geometryTriangles,mappedPreviewSupported=true;
    try {
      await second.initProfile("project.3mf",original);
      manifest=await second.getManifest();
      if(manifest?.schemaVersion!=="0.7.0"||manifest.instances?.length!==1
        ||!manifest.meshes?.length||!manifest.objects?.length)
        throw new Error("Re-imported native 3MF lost object hierarchy");
      // A 3MF-to-STL converter is present in API 0.7.0, but mapped face-ID
      // project previews are optional and this candidate lacks them.
      const geometry=await engine.threeMfToStl(original);
      if(!(geometry instanceof Uint8Array)||geometry.byteLength<134)
        throw new Error("Native 3MF conversion produced no STL geometry");
      geometryTriangles=new DataView(geometry.buffer,geometry.byteOffset,
        geometry.byteLength).getUint32(80,true);
      if(geometryTriangles<1||geometry.byteLength!==84+50*geometryTriangles)
        throw new Error("Native 3MF conversion produced invalid binary STL");
      try {
        const preview=await second.getPreview(manifest.meshes[0].id);
        if(preview?.schemaVersion!=="0.7.0"||preview.triangleFaceIds?.length<1)
          throw new Error("Native mapped preview descriptor is invalid");
      } catch(error) {
        if(error?.code!=="UNSUPPORTED")throw error;
        mappedPreviewSupported=false;
      }
      const preserved=await second.export("project.3mf",{
        schemaVersion:"0.7.0",preservation:"require",includeSliceArtifacts:false
      });
      if(preserved?.schemaVersion!=="0.7.0"||preserved.asset?.kind!=="project")
        throw new Error("Native 3MF preservation=require was not supported");
      reexported=bytes(await second.getAsset(preserved.asset.id));
      if(reexported.byteLength!==original.byteLength||reexported.some((v,i)=>v!==original[i]))
        throw new Error("Untouched imported native 3MF was not preserved byte-for-byte");
    } finally { await second.dispose(); }
    return {
      original:Array.from(original),preserved:Array.from(reexported),
      initialInstanceCount:firstManifest.instances.length,
      reimportedInstanceCount:manifest.instances.length,
      reimportedMeshCount:manifest.meshes.length,
      geometryTriangles,mappedPreviewSupported,firstWarnings
    };
  },Array.from(stlBytes));
  assert.equal(result.initialInstanceCount,1);
  assert.equal(result.reimportedInstanceCount,1);
  assert.ok(result.geometryTriangles>0);
  const native=Buffer.from(result.original),preserved=Buffer.from(result.preserved);
  assert.deepEqual(preserved,native,"preservation=require must retain original bytes");
  await mkdir(outputDir,{recursive:true});
  await writeFile(outputDir+"/wasm-native-3mf.3mf",native);
  await writeFile(outputDir+"/wasm-native-3mf-preserved.3mf",preserved);
  const sha256=createHash("sha256").update(native).digest("hex");
  await writeFile(outputDir+"/wasm-3mf-roundtrip-summary.json",JSON.stringify({
    fixture:"synthetic 12-triangle cube; generic PLA test profile only",
    engine:"OrcaSlicer v2.5.0 WASM candidate",
    source:"native 3MF generated by WASM itself; NOT a desktop-created project",
    originalBytes:native.byteLength,sha256,
    reimportedInstances:result.reimportedInstanceCount,
    reimportedMeshes:result.reimportedMeshCount,
    convertedGeometryTriangles:result.geometryTriangles,
    mappedPreviewSupported:result.mappedPreviewSupported,
    firstExportWarnings:result.firstWarnings,
    preservationRequireByteIdentical:true,
    limitations:"3MF-to-STL conversion is flattened geometry; mapped mesh preview unsupported in current engine. Not desktop 3MF parity, transform-edit proof or printer safety."
  },null,2)+"\n");
  return {bytes:native.byteLength,sha256,triangles:result.geometryTriangles,
    mappedPreviewSupported:result.mappedPreviewSupported,
    warnings:result.firstWarnings.length};
}
