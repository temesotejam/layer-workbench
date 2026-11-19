// Diagnostic-only: compare actual internal-solid positive-E planar XY strokes.
// Does not infer OrcaSlicer native parity, layer identity or print readiness.
// Only exact explicit feature labels count; never promote headers or G-code hashes.
const TARGET = 'internal solid infill';
const quantize = n => Math.round(n * 1000) / 1000;
const idFor = s => {
  const a=[quantize(s.x1),quantize(s.y1)].join(',');
  const b=[quantize(s.x2),quantize(s.y2)].join(',');
  return [a,b].sort().join(':'); // direction/ordering are irrelevant
};
function extract(parsed) {
  if (!parsed || !Array.isArray(parsed.layers) ||
      parsed.skippedMalformedMotion !== 0 || parsed.skippedArcs !== 0)
    throw new Error('Incomplete or malformed G-code toolpaths');
  const byZ = new Map();
  let allXY=0, count=0, totalE=0;
  for (const layer of parsed.layers) {
    if (!Array.isArray(layer.segments)) throw new Error('Invalid toolpath layer');
    for (const s of layer.segments) {
      if (!s || !s.extrusion || !Number.isFinite(s.commandedPositiveEMm) ||
          s.commandedPositiveEMm <= 0 || ![s.x1,s.y1,s.x2,s.y2,s.z1,s.z2].every(Number.isFinite))
        continue;
      const xy=Math.hypot(s.x2-s.x1,s.y2-s.y1);
      if (!Number.isFinite(xy) || xy <= 1e-6 || Math.abs(s.z2-s.z1)>1e-7)
        continue;
      allXY++;
      if (typeof s.feature!=='string' ||
          s.feature.trim().toLowerCase().replace(/\s+/g,' ') !== TARGET)
        continue;
      const z=String(quantize(s.z2));
      const group=byZ.get(z) ?? {strokes:[],length:0,e:0};
      group.strokes.push(idFor(s));
      group.length+=xy;
      group.e+=s.commandedPositiveEMm;
      byZ.set(z,group);
      if (++count > 300000) throw new Error('Too many diagnostic strokes');
      totalE+=s.commandedPositiveEMm;
    }
  }
  const signature=new Map([...byZ.entries()].map(([z,v])=>
    [z,v.strokes.sort().join('|')]));
  const sumLength=[...byZ.values()].reduce((sum,g)=>sum+g.length,0);
  return {signature,summary:{
    positive_e_xy_strokes_all_features:allXY,
    internal_solid_positive_e_xy_strokes:count,
    internal_solid_xy_length_mm:Number(sumLength.toFixed(5)),
    internal_solid_commanded_positive_e_mm:Number(totalE.toFixed(5)),
    internal_solid_z_levels:signature.size
  }};
}
export function auditVerticalShellDeposition(baselineParsed,candidateParsed) {
  const before=extract(baselineParsed),after=extract(candidateParsed);
  const zKeys=[...new Set([...before.signature.keys(),...after.signature.keys()])]
    .sort((a,b)=>Number(a)-Number(b));
  const changedZ=zKeys.filter(z=>before.signature.get(z)!==after.signature.get(z));
  const bothHaveTagged=before.summary.internal_solid_positive_e_xy_strokes>0 &&
    after.summary.internal_solid_positive_e_xy_strokes>0;
  const result=!bothHaveTagged?'inconclusive_no_tagged_internal_solid_on_both_sides':
    changedZ.length?'observed_internal_solid_stroke_signature_difference':
    'inconclusive_no_internal_solid_stroke_difference';
  return {
    result,baseline:before.summary,candidate:after.summary,
    changed_internal_solid_z_mm:changedZ.map(Number).slice(0,60),
    changed_internal_solid_z_count:changedZ.length,
    note:'Order/direction-invariant 0.001mm-rounded line signatures; differences can include line segmentation; not a native parity verdict',
    native_desktop_parity:false,printer_safe:false,public_pages_enabled:false
  };
}
