// Test-only diagnostic. A private imported-3MF edit is exported best-effort,
// flattened by native WASM to STL, then separately sliced with a fixed generic
// test profile. This is NOT in-place Slic3r::Model editing, native 3MF
// project slicing, desktop G-code parity, or printer-safe output.
import {parseGcodeToolpaths} from './gcode-preview-parser.mjs';

const GENERIC_TEST_PROFILE = Object.freeze({
  bed_size_x:256, bed_size_y:256, printable_height:250,
  nozzle_diameter:0.4, layer_height:0.2, initial_layer_print_height:0.2,
  wall_loops:2, top_shell_layers:3, bottom_shell_layers:3,
  sparse_infill_density:15, sparse_infill_pattern:'grid',
  filament_type:'PLA', nozzle_temperature:220, bed_temperature:55,
});
const ROI = Object.freeze({
  unchanged:[89,111], original:[149,171], moved:[179,201],
});

// Count only deposited XY segments in the body, excluding first-layer skirt,
// priming paths, and the top/bottom Z extremes. The synthetic 20-mm cubes are
// at X=90..110 and X=150..170 before, X=180..200 after, Y=90..110.
export function inspectSyntheticCubeExtrusion(gcode) {
  const parsed=parseGcodeToolpaths(gcode,{maxChars:12_000_000,maxSegments:300_000});
  const counts={unchanged:0,original:0,moved:0};
  const zByRegion={unchanged:new Set(),original:new Set(),moved:new Set()};
  for (const layer of parsed.layers) {
    if (!(layer.z>=1 && layer.z<=19.5)) continue;
    for (const segment of layer.segments) {
      if (!segment.extrusion) continue;
      // A midpoint-only check falsely credits a cube for a single long
      // extrusion crossing its ROI. Require the FULL deposited XY segment
      // to lie inside the cube's bounded region, not just its midpoint.
      if (segment.y1<89 || segment.y1>111 ||
          segment.y2<89 || segment.y2>111) continue;
      for (const [name,range] of Object.entries(ROI)) {
        if (segment.x1>=range[0] && segment.x1<=range[1] &&
            segment.x2>=range[0] && segment.x2<=range[1]) {
          counts[name]++;
          zByRegion[name].add(layer.z);
        }
      }
    }
  }
  // A single stray line can be inside a cube ROI without demonstrating a
  // sliced 20-mm-tall object. Record independently occupied interior layers.
  const regionLayers={},regionZSpanMm={};
  for (const [name,levels] of Object.entries(zByRegion)) {
    regionLayers[name]=levels.size;
    let min=Infinity,max=-Infinity;
    for (const z of levels) { min=Math.min(min,z); max=Math.max(max,z); }
    regionZSpanMm[name]=levels.size ? max-min : 0;
  }
  return {
    regions:counts,regionLayers,regionZSpanMm,
    extrusionSegments:parsed.extrusions,
    renderedArcs:parsed.renderedArcs,
    skippedArcs:parsed.skippedArcs,
    malformedMotionLines:parsed.skippedMalformedMotion,
  };
}

export function requireEditedCubeToolpathShift(before,after) {
  const a=before?.regions, b=after?.regions;
  if (!a || !b || !Number.isSafeInteger(before.extrusionSegments) ||
      !Number.isSafeInteger(after.extrusionSegments))
    throw new Error('Invalid synthetic cube toolpath diagnostic');
  for (const [label,counts] of [['before',a],['after',b]]) {
    for (const key of Object.keys(ROI))
      if (!Number.isSafeInteger(counts[key]) || counts[key]<0)
        throw new Error('Invalid '+label+' deposited region: '+key);
  }
  if (!(a.unchanged>0 && b.unchanged>0 &&
        a.original>0 && a.moved===0 &&
        b.original===0 && b.moved>0))
    throw new Error('Private 3MF edit did not relocate deposited XY paths as expected: '+
      JSON.stringify({before:a,after:b}));
  // Each expected cube needs extrusion on >=3 distinct interior layers
  // spanning >=6 mm in Z. Repeated lines on one layer must fail closed.
  for (const [label,result,names] of [
    ['before',before,['unchanged','original']],
    ['after',after,['unchanged','moved']],
  ]) {
    for (const name of Object.keys(ROI)) {
      const layers=result.regionLayers?.[name];
      const span=result.regionZSpanMm?.[name];
      if (!Number.isSafeInteger(layers) || layers<0 ||
          typeof span!=='number' || !Number.isFinite(span) || span<0 ||
          layers>result.regions[name] || (layers===0 && span!==0))
        throw new Error('Invalid '+label+' vertical region evidence: '+name);
    }
    for (const name of names) {
      if (result.regionLayers[name]<3 || result.regionZSpanMm[name]<6)
        throw new Error('Insufficient '+label+' 3D layer coverage for '+name+
          ': '+JSON.stringify({layers:result.regionLayers[name],
            spanMm:result.regionZSpanMm[name]}));
    }
  }
  return true;
}

async function sliceFlattenedStl(engine,stl) {
  if (!(stl instanceof Uint8Array) || stl.byteLength<134 ||
      stl.byteLength>15_000_000)
    throw new Error('Invalid or oversized native flattened STL');
  const session=await engine.createSession();
  try {
    await session.init(new TextEncoder().encode(JSON.stringify(GENERIC_TEST_PROFILE)));
    const manifest={
      schemaVersion:'0.7.0',plates:[{id:'plate-0',index:0}],
      meshes:[{id:'mesh-0',format:'stl',dataRange:{offset:0,length:stl.byteLength}}],
      objects:[{id:'object-0',meshId:'mesh-0'}],
      // STL already contains WORLD-space 3MF coordinates. Use identity here:
      // applying the original build-item transform again would double-move it.
      instances:[{id:'instance-0',objectId:'object-0',plateId:'plate-0',
        transform:{matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}}],
      modifierVolumes:[]
    };
    await session.setObjects(stl,manifest);
    const response=await session.slice({
      schemaVersion:'0.7.0',plateSelection:'selected',plateIds:['plate-0'],
      includeGcode:true,includeStatistics:true
    });
    const plate=response?.plateResults?.find(p=>p.plateId==='plate-0');
    const asset=plate?.assets?.find(x=>x.kind==='gcode');
    if (response?.schemaVersion!=='0.7.0' || !asset?.id)
      throw new Error('Re-slice did not return plate-0 G-code');
    const bytes=await session.getAsset(asset.id);
    if (!(bytes instanceof Uint8Array) || bytes.length<200 ||
        bytes.length>12_000_000)
      throw new Error('Invalid or oversized diagnostic G-code');
    const outcome=inspectSyntheticCubeExtrusion(new TextDecoder().decode(bytes));
    return {...outcome,gcodeBytes:bytes.length};
  } finally {
    await session.dispose();
  }
}

export async function diagnosePrivateEdited3mfToolpathShift(engine,source3mf,edited3mf) {
  if (!engine?.createSession || typeof engine.threeMfToStl!=='function' ||
      !(source3mf instanceof Uint8Array) || !(edited3mf instanceof Uint8Array) ||
      source3mf.byteLength>1_000_000 || edited3mf.byteLength>1_000_000)
    throw new Error('Invalid isolated-WASM 3MF reslice diagnostic inputs');
  // Two new test-only sessions avoid accidentally comparing a stale slice
  // from the imported 3MF session or silently mutating its project state.
  const sourceStl=await engine.threeMfToStl(source3mf);
  const editedStl=await engine.threeMfToStl(edited3mf);
  const before=await sliceFlattenedStl(engine,sourceStl);
  const after=await sliceFlattenedStl(engine,editedStl);
  requireEditedCubeToolpathShift(before,after);
  return {
    status:'PASS',syntheticEditToFlattenedStlToNewSlice:true,
    source:'two independently constructed Core 3MF cube placements',
    before,after,fullNativeProjectReslice:false,
    desktopGcodeParity:false,printApproved:false,
    limitations:'Sliced flattened STL with generic test profile, NOT edited Slic3r::Model or complete desktop-origin 3MF settings.'
  };
}
