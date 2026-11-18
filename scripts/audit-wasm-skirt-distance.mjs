// Read-only witness for the localhost OrcaSlicer WASM skirt-distance probe.
// Only positive-E XY paths explicitly tagged ;TYPE:Skirt or ;FEATURE:Skirt
// are compared. Do not infer a skirt from a changed G-code hash, travel or
// unclassified deposition. This is not a native parity or print-safety audit.
const MIN_SPAN_GROWTH_MM = 2;
const MAX_BOUND_SHRINK_MM = 0.5;

function skirtEnvelope(parsed) {
  if (!parsed || !Array.isArray(parsed.layers) ||
      !Number.isSafeInteger(parsed.skippedArcs) ||
      !Number.isSafeInteger(parsed.skippedMalformedMotion))
    throw new Error('Expected bounded G-code parser result');
  const bounds = [[Infinity,-Infinity],[Infinity,-Infinity]];
  let segments=0;
  for (const layer of parsed.layers) {
    if (!Array.isArray(layer.segments)) throw new Error('Invalid G-code layer');
    for (const s of layer.segments) {
      if (s.extrusion !== true || s.feature !== 'skirt') continue;
      const coords=[s.x1,s.y1,s.z1,s.x2,s.y2,s.z2];
      if (!coords.every(Number.isFinite)) throw new Error('Nonfinite skirt path');
      if (Math.abs(s.z2-s.z1)>0.0005 || Math.hypot(s.x2-s.x1,s.y2-s.y1)<=1e-6) continue;
      segments++;
      for(const p of [[s.x1,s.y1],[s.x2,s.y2]])for(let axis=0;axis<2;axis++){
        if(p[axis]<bounds[axis][0])bounds[axis][0]=p[axis];
        if(p[axis]>bounds[axis][1])bounds[axis][1]=p[axis];
      }
    }
  }
  return {segments,bounds:segments?bounds:null,
    complete:parsed.skippedArcs===0 && parsed.skippedMalformedMotion===0};
}

export function auditWasmSkirtDistance(nearParsed,farParsed) {
  const near=skirtEnvelope(nearParsed),far=skirtEnvelope(farParsed);
  const spans=near.bounds&&far.bounds ? [0,1].map(axis=>({
    near:near.bounds[axis][1]-near.bounds[axis][0],
    far:far.bounds[axis][1]-far.bounds[axis][0],
  })) : null;
  const enclosing=!!spans && [0,1].every(axis=>
    far.bounds[axis][0] <= near.bounds[axis][0]+MAX_BOUND_SHRINK_MM &&
    far.bounds[axis][1] >= near.bounds[axis][1]-MAX_BOUND_SHRINK_MM);
  const wider=!!spans && spans.every(s=>s.far-s.near>=MIN_SPAN_GROWTH_MM);
  const passed=near.complete && far.complete && near.segments>=4 &&
    far.segments>=4 && enclosing && wider;
  return {passed,parity_pass:false,
    source:'actual positive-E planar XY paths with exact Skirt feature tags',
    near_skirt_segments:near.segments,far_skirt_segments:far.segments,
    near_xy_bounds_mm:near.bounds,far_xy_bounds_mm:far.bounds,
    xy_span_growth_mm:spans?spans.map(s=>s.far-s.near):null,
    complete_gcode_parse:near.complete&&far.complete,
    reason:!near.segments||!far.segments?'missing_skirt_feature_paths':
      !near.complete||!far.complete?'skipped_motion_in_parser':
      !passed?'skirt_envelope_did_not_expand':'skirt_envelope_expanded'};
}
