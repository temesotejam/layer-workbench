// Stable diagnostic 3D palette for modal G-code F values (mm/min).
// These are *commanded* speeds, not actual head velocity or print safety.
// Unknown/nonpositive F remains explicitly unclassified, never inferred.
export const COMMANDED_SPEED_BANDS=Object.freeze([
  Object.freeze({id:"unknown",label:"F unknown",maxMmPerSecond:null,color:"#8e9aa8"}),
  Object.freeze({id:"slow",label:"≤ 10 mm/s",maxMmPerSecond:10,color:"#67b7dc"}),
  Object.freeze({id:"medium",label:"> 10–25 mm/s",maxMmPerSecond:25,color:"#78cfaa"}),
  Object.freeze({id:"fast",label:"> 25–50 mm/s",maxMmPerSecond:50,color:"#f0d66e"}),
  Object.freeze({id:"very-fast",label:"> 50–100 mm/s",maxMmPerSecond:100,color:"#ff9a61"}),
  Object.freeze({id:"highest",label:"> 100 mm/s",maxMmPerSecond:Infinity,color:"#dc7198"}),
]);
export function commandedSpeedBand(feedrateMmMin) {
  if(typeof feedrateMmMin!=="number" || !Number.isFinite(feedrateMmMin) || feedrateMmMin<=0)
    return COMMANDED_SPEED_BANDS[0];
  const speed=feedrateMmMin/60;
  return COMMANDED_SPEED_BANDS.slice(1).find(b=>speed<=b.maxMmPerSecond)
    ?? COMMANDED_SPEED_BANDS.at(-1);
}
export function commandedSpeedLegend() {
  return COMMANDED_SPEED_BANDS.map(b=>b.label).join(" · ")+
    " (modal F; commanded only, not measured)";
}
