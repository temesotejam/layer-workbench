// Source-pinned OrcaSlicer v2.5.0 support-path diagnostic (read-only).
// Exact labels: src/libslic3r/GCode.cpp at 40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19,
// GCode::extrude_support labels "support material", "support material interface",
// "support transition", "support ironing". Never infer support from substrings,
// a profile value, a comment without deposition, or a travel-only F change.
// This is NOT full native parity or print-safety verification.
const LABELS = Object.freeze({
  "support material":"body",
  "support material interface":"interface",
  "support transition":"transition",
  "support ironing":"ironing",
});
const ROLES = Object.freeze(["body","interface","transition","ironing"]);
const normalize = value => typeof value==="string"
  ? value.trim().toLowerCase().replace(/\s+/g," ") : "";
const finite = (...values) => values.every(Number.isFinite);
const round = value => Number(value.toFixed(6));

function collect(parsed) {
  if(!parsed || !Array.isArray(parsed.layers))
    throw new Error("Expected parsed G-code toolpath layers");
  const out = Object.fromEntries(ROLES.map(role=>[role,[]]));
  for(const layer of parsed.layers) {
    if(!layer || !Array.isArray(layer.segments))
      throw new Error("Invalid G-code toolpath layer");
    for(const s of layer.segments) {
      if(!s || s.extrusion!==true) continue;
      const role=LABELS[normalize(s.feature)];
      if(!role || !finite(s.x1,s.y1,s.x2,s.y2,s.z1,s.z2))continue;
      const length=Math.hypot(s.x2-s.x1,s.y2-s.y1);
      if(!Number.isFinite(length)||length<=1e-9)continue; // E-only and vertical priming
      out[role].push({...s,xyLength:length});
    }
  }
  return out;
}

function stats(segments) {
  const feedrates=[...new Set(segments.filter(s=>
    Number.isFinite(s.feedrateMmMin)&&s.feedrateMmMin>0)
    .map(s=>Math.round(s.feedrateMmMin*100)/100))].sort((a,b)=>a-b);
  // Iterate instead of spreading every segment into Math.min/Math.max:
  // a real large support print may exceed the JS argument-count limit.
  let bounds=null;
  for(const s of segments) {
    if(bounds===null)bounds={
      minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,
      minZ:Infinity,maxZ:-Infinity};
    bounds.minX=Math.min(bounds.minX,s.x1,s.x2);
    bounds.maxX=Math.max(bounds.maxX,s.x1,s.x2);
    bounds.minY=Math.min(bounds.minY,s.y1,s.y2);
    bounds.maxY=Math.max(bounds.maxY,s.y1,s.y2);
    bounds.minZ=Math.min(bounds.minZ,s.z1,s.z2);
    bounds.maxZ=Math.max(bounds.maxZ,s.z1,s.z2);
  }
  if(bounds)bounds=Object.fromEntries(Object.entries(bounds)
    .map(([key,value])=>[key,round(value)]));
  return {
    extrusion_xy_segments:segments.length,
    xy_length_mm:round(segments.reduce((sum,s)=>sum+s.xyLength,0)),
    feedrates_mm_min:feedrates,
    bounds_mm:bounds,
  };
}

export function auditSupportDeposition(parsed) {
  const byRole=collect(parsed);
  const roles=Object.fromEntries(ROLES.map(role=>[role,stats(byRole[role])]));
  const supported=roles.body.extrusion_xy_segments+roles.interface.extrusion_xy_segments;
  return {
    result:supported>0?"tagged_support_body_or_interface_observed":
      "no_tagged_support_body_or_interface",
    source:"OrcaSlicer v2.5.0 pinned support extrusion labels",
    roles,
    support_generation_verified:supported>0,
    native_desktop_parity:false,
    printer_safe:false,
  };
}

// Compare the SAME isolated engine, model, and fixed settings with only one
// speed override changed. Counts may differ due to move segmentation, so
// require role-specific gross length and XYZ bounds to stay within 0.01 mm.
// This is deliberately NOT exact ordered-path or native-vs-WASM parity.
export function auditSupportSpeedEffect(baseline,candidate,role,targetMmMin) {
  if(!["body","interface"].includes(role)||
     !Number.isFinite(targetMmMin)||targetMmMin<=0)
    throw new Error("Invalid support speed diagnostic role or target");
  const base=auditSupportDeposition(baseline), next=auditSupportDeposition(candidate);
  const a=base.roles[role],b=next.roles[role];
  const tolerance=0.01;
  const comparable=a.extrusion_xy_segments>0&&b.extrusion_xy_segments>0;
  const geometryStable=comparable &&
    Math.abs(a.xy_length_mm-b.xy_length_mm)<=tolerance &&
    Object.keys(a.bounds_mm).every(key=>
      Math.abs(a.bounds_mm[key]-b.bounds_mm[key])<=tolerance);
  const newRates=b.feedrates_mm_min.filter(rate=>
    !a.feedrates_mm_min.some(old=>Math.abs(rate-old)<0.01));
  const targetNew=newRates.some(rate=>Math.abs(rate-targetMmMin)<0.01);
  const observed=geometryStable&&targetNew;
  return {
    result:observed?"observed_tagged_support_feedrate_effect":
      comparable&&!geometryStable?"support_geometry_changed_speed_unverified":
      comparable?"support_paths_observed_but_speed_unverified":
      "inconclusive_no_matching_support_deposition",
    role, target_feedrate_mm_min:targetMmMin,
    baseline:a,candidate:b,new_tagged_feedrates_mm_min:newRates,
    geometry_stable:geometryStable,geometry_tolerance_mm:tolerance,
    target_feedrate_observed:observed,
    native_desktop_parity:false,printer_safe:false,
  };
}
