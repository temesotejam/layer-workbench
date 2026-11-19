// Read-only comparison of actual feature-attributed extrusion segments.
// A profile value, changed header, or generic travel F is not bridge evidence.
// Match the strict, explicitly enumerated feature labels used by the native
// v2.5.0 G-code audit. A substring such as "not bridge" or "bridge overhang"
// is not evidence of a bridge extrusion. Unknown labels remain unclassified.
const BRIDGE_FEATURES = new Set([
  "bridge", "external bridge", "internal bridge", "bridge infill",
  "internal bridge infill", "bridge over infill",
]);
const normalizeFeature = value => typeof value === "string"
  ? value.trim().toLowerCase().replace(/\s+/g," ") : null;
const featureCounts = segments => {
  const counts = {};
  for (const segment of segments) {
    const label = normalizeFeature(segment.feature);
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return counts;
};

export function auditBridgeSpeedSegments(baselineSegments,candidateSegments,targetMmMin=120) {
  if(!Array.isArray(baselineSegments)||!Array.isArray(candidateSegments)||
      !Number.isFinite(targetMmMin)||targetMmMin<=0)
    throw new Error("Invalid bridge feature inputs");
  // The native diagnostic measures positive-E XY G1 deposition, not
  // an extrusion-only prime or vertical move mislabeled as a bridge.
  // Browser preview paths may include tessellated arcs, so matching counts
  // here still does NOT establish identical native/wasm command subsets.
  const tagged=segments=>segments.filter(s=>s&&s.extrusion===true&&
    BRIDGE_FEATURES.has(normalizeFeature(s.feature))&&
    Number.isFinite(s.feedrateMmMin)&&s.feedrateMmMin>0&&
    [s.x1,s.y1,s.x2,s.y2].every(Number.isFinite)&&
    Number.isFinite(Math.hypot(s.x2-s.x1,s.y2-s.y1))&&
    Math.hypot(s.x2-s.x1,s.y2-s.y1)>1e-9);
  const base=tagged(baselineSegments),changed=tagged(candidateSegments);
  // Cumulative XY length is more robust to different line segmentation than
  // raw move counts. It is still not geometric parity: arcs may be tessellated
  // in the browser preview, and native/WASM profiles are not yet aligned.
  const xyLengths=items=>{
    const byFeature={};
    let total=0;
    for (const s of items) {
      const length=Math.hypot(s.x2-s.x1,s.y2-s.y1);
      total+=length;
      const key=normalizeFeature(s.feature);
      byFeature[key]=(byFeature[key]??0)+length;
    }
    return {
      total:Number(total.toFixed(6)),
      byFeature:Object.fromEntries(Object.entries(byFeature).sort(([a],[b])=>a.localeCompare(b))
        .map(([label,length])=>[label,Number(length.toFixed(6))])),
    };
  };
  const baselineLengths=xyLengths(base),candidateLengths=xyLengths(changed);
  // A speed-only perturbation must retain at least the gross bridge geometry.
  // Subtype length AND XY envelope are tested: length alone misses a shifted
  // or mirrored toolpath. This is NOT ordered-toolpath or native/WASM parity.
  const bounds=items=>{
    const groups=Object.create(null);
    for(const s of items) {
      const label=normalizeFeature(s.feature);
      const b=groups[label]??(groups[label]={
        minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity});
      b.minX=Math.min(b.minX,s.x1,s.x2);
      b.maxX=Math.max(b.maxX,s.x1,s.x2);
      b.minY=Math.min(b.minY,s.y1,s.y2);
      b.maxY=Math.max(b.maxY,s.y1,s.y2);
    }
    return Object.fromEntries(Object.entries(groups).sort(([a],[b])=>a.localeCompare(b))
      .map(([label,b])=>[label,Object.fromEntries(
        Object.entries(b).map(([name,value])=>[name,Number(value.toFixed(6))]))]));
  };
  const baselineBounds=bounds(base),candidateBounds=bounds(changed);
  // Allow only a 0.01 mm numerical/tessellation difference in gross bridge
  // lengths and envelopes; never infer identical ordered G-code from this.
  const geometryToleranceMm=0.01;
  const geometryDifferences=[...new Set([
    ...Object.keys(baselineLengths.byFeature),
    ...Object.keys(candidateLengths.byFeature)])].sort().filter(label=>{
    if(!Object.hasOwn(baselineBounds,label)||!Object.hasOwn(candidateBounds,label))
      return true;
    if(Math.abs(baselineLengths.byFeature[label]-
        candidateLengths.byFeature[label])>geometryToleranceMm)return true;
    return ["minX","maxX","minY","maxY"].some(axis=>
      Math.abs(baselineBounds[label][axis]-candidateBounds[label][axis])>
        geometryToleranceMm);
  });
  const geometryConsistent=base.length>0&&changed.length>0&&geometryDifferences.length===0;
  const rates=items=>[...new Set(items.map(s=>Math.round(s.feedrateMmMin*100)/100))]
    .sort((a,b)=>a-b);
  const baselineFeeds=rates(base),candidateFeeds=rates(changed);
  const newFeeds=candidateFeeds.filter(f=>!baselineFeeds.some(b=>Math.abs(b-f)<0.01));
  const targetAppeared=newFeeds.some(f=>Math.abs(f-targetMmMin)<0.01);
  const observed=geometryConsistent&&targetAppeared;
  return {
    result:observed?"observed_tagged_bridge_feedrate_effect":
      base.length&&changed.length&&!geometryConsistent?
        "bridge_geometry_changed_speed_unverified":
      base.length||changed.length?"bridge_paths_observed_but_speed_unverified":
      "inconclusive_no_tagged_bridge_paths",
    baseline_tagged_bridge_extrusion_segments:base.length,
    candidate_tagged_bridge_extrusion_segments:changed.length,
    baseline_tagged_bridge_feature_counts:featureCounts(base),
    candidate_tagged_bridge_feature_counts:featureCounts(changed),
    baseline_tagged_bridge_xy_length_mm:baselineLengths.total,
    candidate_tagged_bridge_xy_length_mm:candidateLengths.total,
    baseline_tagged_bridge_xy_lengths_mm_by_feature:baselineLengths.byFeature,
    candidate_tagged_bridge_xy_lengths_mm_by_feature:candidateLengths.byFeature,
    baseline_tagged_bridge_xy_bounds_mm_by_feature:baselineBounds,
    candidate_tagged_bridge_xy_bounds_mm_by_feature:candidateBounds,
    bridge_path_geometry_consistent:geometryConsistent,
    bridge_path_geometry_tolerance_mm:geometryToleranceMm,
    bridge_path_geometry_mismatched_features:geometryDifferences,
    baseline_tagged_bridge_feedrates_mm_min:baselineFeeds,
    candidate_tagged_bridge_feedrates_mm_min:candidateFeeds,
    new_tagged_bridge_feedrates_mm_min:newFeeds,
    target_feedrate_observed:observed,
    measured_subset:"positive-E XY preview segments (rendered G17 arcs may be tessellated)",
    native_desktop_parity:false,
    printer_safe:false,
  };
}

// A strictly read-only flow probe for the *independent* native
// internal_bridge_flow knob. A conventional Bridge/External bridge feature
// is NOT evidence of internal bridge deposition. The caller must change
// only internal_bridge_flow between otherwise identical real-engine slices.
// Diagnostic-only: this is filament-axis E length, not melted volume.
export function auditInternalBridgeFlowSegments(baselineSegments,candidateSegments) {
  if(!Array.isArray(baselineSegments)||!Array.isArray(candidateSegments))
    throw new Error("Invalid internal bridge flow inputs");
  const INTERNAL=new Set(["internal bridge","internal bridge infill"]);
  const EXTERNAL=new Set([...BRIDGE_FEATURES].filter(label=>!INTERNAL.has(label)));
  const extract=(segments,labels)=>{
    let count=0,e=0,length=0;
    const b={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};
    for(const s of segments){
      if(!s||s.extrusion!==true||!labels.has(normalizeFeature(s.feature))||
         !Number.isFinite(s.commandedPositiveEMm)||s.commandedPositiveEMm<=0||
         ![s.x1,s.y1,s.x2,s.y2].every(Number.isFinite))continue;
      const xy=Math.hypot(s.x2-s.x1,s.y2-s.y1);
      if(!Number.isFinite(xy)||xy<=1e-9)continue;
      count++;e+=s.commandedPositiveEMm;length+=xy;
      b.minX=Math.min(b.minX,s.x1,s.x2);
      b.maxX=Math.max(b.maxX,s.x1,s.x2);
      b.minY=Math.min(b.minY,s.y1,s.y2);
      b.maxY=Math.max(b.maxY,s.y1,s.y2);
    }
    const rounded=n=>Number(n.toFixed(6));
    return {segments:count,positive_e_mm:rounded(e),xy_length_mm:rounded(length),
      xy_bounds_mm:count?Object.fromEntries(Object.entries(b).map(([k,v])=>[k,rounded(v)])):null};
  };
  const baseline={internal:extract(baselineSegments,INTERNAL),
    other_bridge:extract(baselineSegments,EXTERNAL)};
  const candidate={internal:extract(candidateSegments,INTERNAL),
    other_bridge:extract(candidateSegments,EXTERNAL)};
  const sameGeometry=(a,b)=>a.segments>0&&b.segments>0&&
    Math.abs(a.xy_length_mm-b.xy_length_mm)<=0.01&&
    ["minX","maxX","minY","maxY"].every(axis=>
      Math.abs(a.xy_bounds_mm[axis]-b.xy_bounds_mm[axis])<=0.01);
  const internalGeometryStable=sameGeometry(baseline.internal,candidate.internal);
  const externalGeometryStable=sameGeometry(baseline.other_bridge,candidate.other_bridge);
  const externalEStable=baseline.other_bridge.positive_e_mm>0&&
    Math.abs(candidate.other_bridge.positive_e_mm-baseline.other_bridge.positive_e_mm)
       <=Math.max(0.02,baseline.other_bridge.positive_e_mm*0.025);
  const internalEDecreased=baseline.internal.positive_e_mm>0&&
    candidate.internal.positive_e_mm>0&&
    candidate.internal.positive_e_mm<baseline.internal.positive_e_mm*0.95;
  const observed=internalGeometryStable&&externalGeometryStable&&
    externalEStable&&internalEDecreased;
  const result=observed?"observed_internal_bridge_flow_effect":
    !baseline.internal.segments||!candidate.internal.segments?
      "inconclusive_no_tagged_internal_bridge":
    !baseline.other_bridge.segments||!candidate.other_bridge.segments?
      "inconclusive_no_external_bridge_control":
    !internalGeometryStable||!externalGeometryStable?
      "bridge_geometry_changed_flow_unverified":
    !externalEStable?"external_bridge_flow_changed_control_failed":
      "internal_bridge_flow_effect_unverified";
  return {result,baseline,candidate,
    internal_geometry_stable:internalGeometryStable,
    external_bridge_geometry_stable:externalGeometryStable,
    external_bridge_e_stable:externalEStable,
    internal_positive_e_decreased:internalEDecreased,
    measured_subset:"explicit feature-tagged linear positive-E XY G1 preview segments only",
    native_desktop_parity:false,printer_safe:false,public_pages_enabled:false};
}
