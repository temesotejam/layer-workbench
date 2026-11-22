// Local, read-only comparison of the 3x3 LINEAR parts of native 3MF
// instance matrices and Three.js build-item world matrices. The root viewer
// bed offset is translation only and does not affect these terms.
// This is an unordered multiset comparison: it cannot map instance IDs to
// build items or prove vertex placement, pivot, metadata or G-code parity.
// Never expose raw matrix entries, IDs, coordinates or imported metadata.
const unavailable=Object.freeze({linear:'unavailable',comparedInstances:0});
const finite=value=>typeof value==='number' && Number.isFinite(value) &&
  Math.abs(value)<=1e7;
const rowAffine=m=>Array.isArray(m) && m.length===16 && m.every(finite) &&
  Math.abs(m[12])<=1e-8 && Math.abs(m[13])<=1e-8 &&
  Math.abs(m[14])<=1e-8 && Math.abs(m[15]-1)<=1e-8;
const columnAffine=m=>Array.isArray(m) && m.length===16 && m.every(finite) &&
  Math.abs(m[3])<=1e-8 && Math.abs(m[7])<=1e-8 &&
  Math.abs(m[11])<=1e-8 && Math.abs(m[15]-1)<=1e-8;
const determinant=a=>a[0]*(a[4]*a[8]-a[5]*a[7])-
  a[1]*(a[3]*a[8]-a[5]*a[6])+a[2]*(a[3]*a[7]-a[4]*a[6]);
function nativeLinear(instance) {
  const m=instance?.transform?.matrix;
  return rowAffine(m) ? [m[0],m[1],m[2],m[4],m[5],m[6],m[8],m[9],m[10]] : null;
}
function viewerLinear(elements) {
  // Three.js Matrix4.elements is column-major (not a transposed transform).
  return columnAffine(elements) ? [
    elements[0],elements[4],elements[8],
    elements[1],elements[5],elements[9],
    elements[2],elements[6],elements[10],
  ] : null;
}
const similar=(a,b,tol)=>a.every((value,k)=>Math.abs(value-b[k])<=tol);

export function auditNative3mfLinearParity(nativeInstances, viewerMatrices, tolerance=1e-5) {
  if(!Array.isArray(nativeInstances) || !Array.isArray(viewerMatrices) ||
     nativeInstances.length<1 || nativeInstances.length>64 ||
     nativeInstances.length!==viewerMatrices.length ||
     !Number.isFinite(tolerance) || tolerance<=0 || tolerance>1e-3)
    return unavailable;
  const native=nativeInstances.map(nativeLinear);
  const viewer=viewerMatrices.map(viewerLinear);
  if([...native,...viewer].some(a=>!a || !Number.isFinite(determinant(a)) ||
    Math.abs(determinant(a))<1e-8)) return unavailable;
  // Maximum bipartite matching: avoids depending on 3MF native IDs, object
  // enumeration order, and rounding-sensitive lexical sorting of matrices.
  const owner=Array(viewer.length).fill(-1);
  function assign(index,visited) {
    for(let j=0;j<viewer.length;j++) {
      if(visited[j] || !similar(native[index],viewer[j],tolerance)) continue;
      visited[j]=true;
      if(owner[j]===-1 || assign(owner[j],visited)) {
        owner[j]=index;
        return true;
      }
    }
    return false;
  }
  const consistent=native.every((_,i)=>assign(i,Array(viewer.length).fill(false)));
  return Object.freeze({linear:consistent?'consistent':'mismatch',
    comparedInstances:native.length});
}
