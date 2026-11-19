// Diagnostic-only: compare modal F on identical first-layer XY travel moves.
// Not a desktop parity check, measured physical speed or print approval.
const xyLen=s=>Math.hypot(s.x2-s.x1,s.y2-s.y1);
function motionKey(s) {
  return [s.x1,s.y1,s.x2,s.y2,s.z1,s.z2].map(v=>{
    if (!Number.isFinite(v)||Math.abs(v)>100000)throw Error('Invalid motion geometry');
    return v.toFixed(3);
  }).join('/');
}
function inspect(parsed) {
  if (!Array.isArray(parsed?.layers)||parsed.skippedMalformedMotion!==0||parsed.skippedArcs!==0)
    throw Error('Cannot compare skipped or malformed G-code motions');
  const layers=parsed.layers.filter(l=>Number.isFinite(l.z)&&Array.isArray(l.segments)&&
    l.segments.some(s=>s.extrusion===true&&s.commandedPositiveEMm>0&&
      xyLen(s)>0.001&&Math.abs(s.z2-s.z1)<0.001)).sort((a,b)=>a.z-b.z);
  if(!layers.length)throw Error('No deposited first layer');
  const layer=layers[0];
  const dep=layer.segments.filter(s=>s.extrusion===true&&s.commandedPositiveEMm>0&&
    xyLen(s)>0.001&&Math.abs(s.z2-s.z1)<0.001).map(motionKey).sort();
  const travel=layer.segments.filter(s=>s.extrusion===false&&xyLen(s)>=0.5&&
    Math.abs(s.z2-s.z1)<0.001);
  if(travel.some(s=>!Number.isFinite(s.feedrateMmMin)||s.feedrateMmMin<=0))
    throw Error('First-layer planar travel missing valid modal F');
  const byPath=new Map();
  for(const s of travel){
    const key=motionKey(s);
    if(!byPath.has(key))byPath.set(key,[]);
    byPath.get(key).push(s.feedrateMmMin);
  }
  for(const rates of byPath.values())rates.sort((a,b)=>a-b);
  return {z:layer.z,dep,byPath,travelCount:travel.length,
    rates:[...new Set(travel.map(s=>Number(s.feedrateMmMin.toFixed(3))))].sort((a,b)=>a-b)};
}
export function compareFirstLayerTravelFeedrates(gcode50,gcode100) {
  const lo=inspect(gcode50),hi=inspect(gcode100),paired=[];
  for(const [key,a] of lo.byPath){
    const b=hi.byPath.get(key);
    if(!b)continue;
    for(let i=0;i<Math.min(a.length,b.length);i++)
      paired.push({path:key,f50_mm_min:Number(a[i].toFixed(3)),
        f100_mm_min:Number(b[i].toFixed(3)),
        ratio_100_to_50:Number((b[i]/a[i]).toFixed(4))});
  }
  const changed=paired.filter(p=>Math.abs(p.f50_mm_min-p.f100_mm_min)>0.01);
  const faster=changed.filter(p=>p.f100_mm_min>p.f50_mm_min);
  return {first_deposition_z_mm:lo.z,
    same_deposition_geometry:Math.abs(lo.z-hi.z)<0.001&&
      JSON.stringify(lo.dep)===JSON.stringify(hi.dep),
    positive_e_strokes_50:lo.dep.length,positive_e_strokes_100:hi.dep.length,
    planar_travels_50:lo.travelCount,planar_travels_100:hi.travelCount,
    matched_travels:paired.length,changed_travels:changed.length,
    faster_at_100_percent:faster.length,
    near_double_f_strokes:faster.filter(p=>p.ratio_100_to_50>=1.95&&p.ratio_100_to_50<=2.05).length,
    f50_unique_mm_min:lo.rates.slice(0,64),f100_unique_mm_min:hi.rates.slice(0,64),
    changed_pairs:changed.slice(0,32),native_desktop_parity:false,
    physical_speed_verified:false,printer_ready:false};
}
