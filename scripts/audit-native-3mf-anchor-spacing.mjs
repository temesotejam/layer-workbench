// Read-only comparison of pairwise native 3MF instance transform anchors and
// Three.js build-item world anchors. Coordinates never leave this function.
// This tests translation *spacing*, not identity matching, actual mesh bounds,
// nested components, transforms, orientation, full project parity or print safety.
const unavailable = Object.freeze({spacing:'unavailable',comparedPairs:0});
const isFinitePoint = p => Array.isArray(p) && p.length===3 &&
  p.every(v=>typeof v==='number' && Number.isFinite(v) && Math.abs(v)<=1e7);

function nativeAnchor(instance) {
  const m=instance?.transform?.matrix;
  if(!Array.isArray(m) || m.length!==16 ||
      !m.every(x=>typeof x==='number' && Number.isFinite(x)) ||
      Math.abs(m[12])>1e-8 || Math.abs(m[13])>1e-8 ||
      Math.abs(m[14])>1e-8 || Math.abs(m[15]-1)>1e-8) return null;
  return [m[3],m[7],m[11]];
}
function separations(points) {
  const lengths=[];
  for(let i=0;i<points.length;i++)
    for(let j=i+1;j<points.length;j++)
      lengths.push(Math.hypot(points[i][0]-points[j][0],
        points[i][1]-points[j][1],points[i][2]-points[j][2]));
  return lengths.sort((a,b)=>a-b);
}

export function auditNative3mfAnchorSpacing(nativeInstances, viewerAnchors, toleranceMm=0.05) {
  if(!Array.isArray(nativeInstances) || !Array.isArray(viewerAnchors) ||
      nativeInstances.length<2 || nativeInstances.length>64 ||
      nativeInstances.length!==viewerAnchors.length ||
      !Number.isFinite(toleranceMm) || toleranceMm<=0 || toleranceMm>0.1)
    return unavailable;
  const native=nativeInstances.map(nativeAnchor);
  if(native.some(p=>!isFinitePoint(p)) || !viewerAnchors.every(isFinitePoint))
    return unavailable;
  const a=separations(native), b=separations(viewerAnchors);
  if(!a.every(Number.isFinite) || !b.every(Number.isFinite)) return unavailable;
  return Object.freeze({spacing:a.every((distance,i)=>Math.abs(distance-b[i])<=toleranceMm)
    ? 'consistent':'mismatch',comparedPairs:a.length});
}
