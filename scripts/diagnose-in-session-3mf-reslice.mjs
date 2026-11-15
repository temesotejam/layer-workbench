// Isolated-Chrome / synthetic Core 3MF ONLY: test whether an imported
// session can be sliced, privately edited, and re-sliced IN THAT SAME SESSION.
// There is no 3MF->STL flattening, best-effort export, or setObjects() here.
// The bridge still rebuilds temporary Slic3r::Model values from a normalized
// mesh blob on each slice: this is NOT persistent native Model mutation,
// desktop-project semantic parity, or printer-safe G-code.
import {GENERIC_PLA_TEST_CONFIG} from './slice-stl.mjs';
import {inspectSyntheticCubeExtrusion, requireEditedCubeToolpathShift}
  from './diagnose-edited-3mf-toolpaths.mjs';

const encode = value => new TextEncoder().encode(JSON.stringify(value));
const decode = new TextDecoder('utf-8',{fatal:true});
const TEST_PROFILE = Object.freeze({
  ...GENERIC_PLA_TEST_CONFIG,
  // Unlike init(JSON), initProfile(project.3mf) does not set the bridge's
  // absolute-extrusion default. This synthetic profile opts into it explicitly.
  use_relative_e_distances:0,
});
const REQUEST = Object.freeze({
  schemaVersion:'0.7.0',plateSelection:'selected',
  includeGcode:true,includeStatistics:false,
});

export async function diagnoseImported3mfInSessionReslice(engine, source) {
  if (!engine || typeof engine.createSession!=='function' ||
      !(source instanceof Uint8Array) || source.byteLength<300 ||
      source.byteLength>1_000_000 || source[0]!==0x50 || source[1]!==0x4b)
    throw new Error('Invalid bounded imported Core 3MF session probe');
  const session=await engine.createSession();
  try {
    await session.initProfile('project.3mf',source);
    const beforeManifest=await session.getManifest();
    if (beforeManifest?.instances?.length!==2 ||
        beforeManifest?.objects?.length!==2 ||
        beforeManifest?.plates?.length!==1)
      throw new Error('Expected two Core instances on exactly one native plate');
    const plate=beforeManifest.plates[0];
    if (typeof plate?.id!=='string' || !plate.id)
      throw new Error('Imported Core 3MF lacks a stable plate identifier');

    // A Core 3MF has no trusted printer settings. Explicitly apply a bounded,
    // SYNTHETIC generic test profile rather than treating defaults as printable.
    await session.applyProfile('orca.native-json',encode(TEST_PROFILE));
    const slice=async () => {
      const response=await session.slice({...REQUEST,plateIds:[plate.id]});
      const result=response?.plateResults?.find(p=>p.plateId===plate.id);
      const asset=result?.assets?.find(a=>a.kind==='gcode');
      if(response?.schemaVersion!=='0.7.0' || !asset?.id)
        throw new Error('In-session 3MF slice produced no selected-plate G-code');
      const bytes=await session.getAsset(asset.id);
      if(!(bytes instanceof Uint8Array) || bytes.length<200 ||
          bytes.length>12_000_000)
        throw new Error('In-session 3MF G-code is missing or exceeds test bounds');
      return {...inspectSyntheticCubeExtrusion(decode.decode(bytes)),
        gcodeBytes:bytes.length};
    };
    const before=await slice();

    // PRIVATE ABI: never expose this C symbol through the public engine/UI.
    const mod=session.binding?.module, handle=session.live?.();
    if(!handle || typeof mod?._orcawasm_project_edit_instance_transform!=='function' ||
       typeof mod._malloc!=='function' || typeof mod._free!=='function' ||
       !(mod.HEAPU8 instanceof Uint8Array))
      throw new Error('Pinned private imported-instance C ABI unavailable');

    const target=beforeManifest.instances[1];
    const original=[...target.transform.matrix], shifted=[...original];
    if(original.length!==16 || !original.every(Number.isFinite))
      throw new Error('Invalid native Core instance matrix');
    shifted[3]+=30;
    const applyPrivateTransform=matrix=>{
      const request=encode({instanceId:target.id,matrix});
      const pointer=mod._malloc(request.length);
      if(!pointer) throw new Error('Private C request allocation failed');
      let rc;
      try {
        mod.HEAPU8.set(request,pointer);
        rc=mod._orcawasm_project_edit_instance_transform(handle,pointer,request.length);
      } finally { mod._free(pointer); }
      if(rc!==0) throw new Error('Private same-session 3MF transform edit rejected');
    };
    applyPrivateTransform(shifted);

    const afterManifest=await session.getManifest();
    const expected=JSON.parse(JSON.stringify(beforeManifest));
    expected.instances[1].transform.matrix=shifted;
    if(JSON.stringify(afterManifest)!==JSON.stringify(expected))
      throw new Error('Same-session edit mutated other imported project state');
    // Slice once more without export/reimport, flattening, or setObjects().
    // This proves the manifest edit reaches the bridge's temporary native
    // Slic3r::Model builder, NOT that a persistent Model was edited in place.
    const after=await slice();
    requireEditedCubeToolpathShift(before,after);

    // An edit/undo sequence must not reuse the preceding slice or retain
    // stale placement state. Revert using the SAME private ABI and session.
    // This is a synthetic diagnostic, not a general production undo feature.
    applyPrivateTransform(original);
    const restoredManifest=await session.getManifest();
    if(JSON.stringify(restoredManifest)!==JSON.stringify(beforeManifest))
      throw new Error('Undo did not restore the imported Core manifest exactly');
    const restored=await slice();
    // The original and restored placements must both be on the old cube,
    // while the intermediate slice must be at its shifted position.
    requireEditedCubeToolpathShift(restored,after);
    for(const key of ['regions','regionLayers','regionZSpanMm']){
      if(JSON.stringify(restored[key])!==JSON.stringify(before[key]))
        throw new Error('Undo did not restore the original deposited 3D '+key);
    }
    return {
      status:'PASS',source:'independent synthetic two-cube Core 3MF',
      imported3mfReslicedInSameSession:true,
      editUndoReslicedInSameSession:true,
      noExternalStlFlattening:true,noSetObjects:true,
      temporaryNativeModelBuiltForEachSlice:true,
      persistentNativeModelMutation:false,
      source3mfMetadataFullyPreserved:false,
      nativeDesktopGcodeParity:false,printApproved:false,
      before,after,restored,
    };
  } finally {
    await session.dispose();
  }
}
