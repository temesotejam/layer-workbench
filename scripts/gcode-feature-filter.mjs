// Read-only feature filtering for localhost G-code Preview.
// Only explicit comment tags recognized by the bounded parser are used.
// A filter never invents filament colors or printer/slicer feature semantics.
export const ALL_GCODE_PATHS = "all";

export function gcodeFeatureOptions(parsed) {
  const counts = new Map();
  let deposition = 0;
  for (const layer of parsed.layers ?? []) {
    for (const segment of layer.segments ?? []) {
      if (!segment.extrusion) continue;
      deposition++;
      const feature = typeof segment.feature === "string" && segment.feature.length
        ? segment.feature : null;
      counts.set(feature, (counts.get(feature) ?? 0) + 1);
    }
  }
  const options = [{value: ALL_GCODE_PATHS, label: "All paths", count: deposition}];
  const sorted = [...counts].sort(([a],[b])=>{
    if(a === null) return 1;
    if(b === null) return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  for (const [feature,count] of sorted) {
    options.push({
      value: feature === null ? "unclassified" : "feature:" + feature,
      label: feature === null ? "Unclassified deposition" : feature,
      count,
    });
  }
  return options;
}

export function visibleGcodeSegment(segment, selection = ALL_GCODE_PATHS) {
  if(selection === ALL_GCODE_PATHS) return true;
  if(!segment.extrusion) return false;
  if(selection === "unclassified") return !segment.feature;
  if(typeof selection === "string" && selection.startsWith("feature:"))
    return segment.feature === selection.slice("feature:".length);
  return false; // fail closed on unknown filter keys
}
