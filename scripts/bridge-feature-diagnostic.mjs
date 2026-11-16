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
  const rates=items=>[...new Set(items.map(s=>Math.round(s.feedrateMmMin*100)/100))]
    .sort((a,b)=>a-b);
  const baselineFeeds=rates(base),candidateFeeds=rates(changed);
  const newFeeds=candidateFeeds.filter(f=>!baselineFeeds.some(b=>Math.abs(b-f)<0.01));
  const targetAppeared=newFeeds.some(f=>Math.abs(f-targetMmMin)<0.01);
  const observed=base.length>0&&changed.length>0&&targetAppeared;
  return {
    result:observed?"observed_tagged_bridge_feedrate_effect":
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
    baseline_tagged_bridge_feedrates_mm_min:baselineFeeds,
    candidate_tagged_bridge_feedrates_mm_min:candidateFeeds,
    new_tagged_bridge_feedrates_mm_min:newFeeds,
    target_feedrate_observed:observed,
    measured_subset:"positive-E XY preview segments (rendered G17 arcs may be tessellated)",
    native_desktop_parity:false,
    printer_safe:false,
  };
}
