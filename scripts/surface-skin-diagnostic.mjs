// Read-only, localhost-only proof of actual outer-skin G-code deposition.
// Exact TYPE/FEATURE tags in the bounded parser, not profile headers, identify skin.
// This does not certify native parity, 3MF equivalence, or print safety.
const VALID = new Set(['top surface', 'bottom surface']);
const round = value => Math.round(value * 1000) / 1000;
const point = (x, y) => round(x) + ',' + round(y);

function inspect(parsed, target) {
  if (!parsed || !Array.isArray(parsed.layers) ||
      parsed.skippedMalformedMotion !== 0 || parsed.skippedArcs !== 0)
    throw new Error('Incomplete or malformed G-code toolpaths');
  const byZ = new Map();
  let taggedStrokes = 0, xyLength = 0, commandedE = 0, allPositiveXY = 0;
  for (const layer of parsed.layers) {
    if (!Array.isArray(layer.segments))
      throw new Error('Malformed G-code layer');
    for (const segment of layer.segments) {
      if (!segment || !segment.extrusion ||
          !Number.isFinite(segment.commandedPositiveEMm) ||
          segment.commandedPositiveEMm <= 0 ||
          ![segment.x1, segment.x2, segment.y1, segment.y2,
            segment.z1, segment.z2].every(Number.isFinite))
        continue;
      const xy = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
      if (!Number.isFinite(xy) || xy <= 1e-6 ||
          Math.abs(segment.z2 - segment.z1) > 1e-7)
        continue;
      allPositiveXY++;
      if (segment.feature !== target) continue;
      if (++taggedStrokes > 150000)
        throw new Error('Too many tagged skin strokes');
      const z = String(round(segment.z2));
      const ordered = point(segment.x1,segment.y1) + '>' +
        point(segment.x2,segment.y2);
      const unordered = [point(segment.x1,segment.y1),
        point(segment.x2,segment.y2)].sort().join(':');
      const group = byZ.get(z) ?? {ordered:[],unordered:[]};
      group.ordered.push(ordered);
      group.unordered.push(unordered);
      byZ.set(z,group);
      xyLength += xy;
      commandedE += segment.commandedPositiveEMm;
    }
  }
  return {byZ, summary:{
    tagged_positive_e_xy_strokes:taggedStrokes,
    tagged_xy_length_mm:Number(xyLength.toFixed(5)),
    tagged_commanded_positive_e_mm:Number(commandedE.toFixed(5)),
    tagged_z_levels:byZ.size,
    all_feature_positive_e_xy_strokes:allPositiveXY
  }};
}

export function auditSurfaceSkinPattern(baselineParsed,candidateParsed,feature) {
  if (!VALID.has(feature)) throw new Error('Unsupported surface skin feature');
  const before = inspect(baselineParsed,feature);
  const after = inspect(candidateParsed,feature);
  const zKeys = [...new Set([...before.byZ.keys(),...after.byZ.keys()])]
    .sort((a,b)=>Number(a)-Number(b));
  const changedGeometry = [], changedSequence = [];
  for (const z of zKeys) {
    const a=before.byZ.get(z),b=after.byZ.get(z);
    if ((a?.unordered.slice().sort().join('|') ?? '') !==
        (b?.unordered.slice().sort().join('|') ?? ''))
      changedGeometry.push(Number(z));
    if ((a?.ordered.join('|') ?? '') !== (b?.ordered.join('|') ?? ''))
      changedSequence.push(Number(z));
  }
  const bothTagged = before.summary.tagged_positive_e_xy_strokes > 0 &&
    after.summary.tagged_positive_e_xy_strokes > 0;
  const result = !bothTagged ? 'inconclusive_no_tagged_skin_on_both_sides' :
    changedGeometry.length ? 'observed_tagged_skin_geometry_difference' :
    changedSequence.length ? 'observed_tagged_skin_sequence_difference_only' :
    'inconclusive_no_tagged_skin_path_difference';
  return {
    feature, result, baseline:before.summary,candidate:after.summary,
    changed_geometry_z_count:changedGeometry.length,
    changed_geometry_z_mm:changedGeometry.slice(0,60),
    changed_sequence_z_count:changedSequence.length,
    changed_sequence_z_mm:changedSequence.slice(0,60),
    note:'Actual planar positive-E tagged XY strokes only; 0.001mm quantization. Sequence changes may be direction/order only; no untagged or header evidence.',
    desktop_native_parity:false,printer_safe:false,public_pages_enabled:false
  };
}
