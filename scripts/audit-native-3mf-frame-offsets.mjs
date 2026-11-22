// Read-only diagnostic of affine translation-frame consistency for native
// one-slicer-api 0.7.0 instances and Three.js Core 3MF build items.
// Match only uniquely distinguishable LINEAR transforms. Identical/nearby
// transforms make correspondence ambiguous, not a successful parity claim.
// No original IDs, offsets, matrices or private geometry leave this module.
const unavailable = Object.freeze({frame:'unavailable', comparedInstances:0});
const finite = n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7;
const affine = (m, column) => Array.isArray(m) && m.length === 16 &&
  m.every(finite) && (column
    ? [3,7,11].every(i=>Math.abs(m[i])<=1e-8)
    : [12,13,14].every(i=>Math.abs(m[i])<=1e-8)) &&
  Math.abs(m[15]-1)<=1e-8;
const determinant = a => a[0]*(a[4]*a[8]-a[5]*a[7])-
  a[1]*(a[3]*a[8]-a[5]*a[6])+a[2]*(a[3]*a[7]-a[4]*a[6]);
const native = item => {
  const m = item?.transform?.matrix;
  if (!affine(m, false)) return null;
  return {linear:[m[0],m[1],m[2],m[4],m[5],m[6],m[8],m[9],m[10]],
    translation:[m[3],m[7],m[11]]};
};
const viewer = m => {
  if (!affine(m, true)) return null;
  return {linear:[m[0],m[4],m[8],m[1],m[5],m[9],m[2],m[6],m[10]],
    translation:[m[12],m[13],m[14]]};
};
const similar=(a,b,tol)=>a.every((x,i)=>Math.abs(x-b[i])<=tol);

export function auditNative3mfFrameOffsets(nativeInstances, viewerMatrices,
    translationToleranceMm=0.05, linearTolerance=1e-5) {
  if (!Array.isArray(nativeInstances) || !Array.isArray(viewerMatrices) ||
      nativeInstances.length<2 || nativeInstances.length>64 ||
      nativeInstances.length!==viewerMatrices.length ||
      !Number.isFinite(translationToleranceMm) || translationToleranceMm<=0 ||
      translationToleranceMm>0.1 || !Number.isFinite(linearTolerance) ||
      linearTolerance<=0 || linearTolerance>1e-3) return unavailable;
  const a=nativeInstances.map(native), b=viewerMatrices.map(viewer);
  if ([...a,...b].some(x=>!x || !Number.isFinite(determinant(x.linear)) ||
      Math.abs(determinant(x.linear))<1e-8)) return unavailable;
  const n=a.length;
  const candidates=a.map(x=>b.flatMap((y,j)=>
    similar(x.linear,y.linear,linearTolerance)?[j]:[]));
  if(candidates.some(matches=>matches.length===0))
    return Object.freeze({frame:'linear-mismatch',comparedInstances:0});
  // Count up to two full bijections. More than one mapping would silently
  // assign the wrong mesh/instance when transforms are duplicated.
  let solutions=0, mapping=null;
  const chosen=Array(n).fill(-1), used=Array(n).fill(false);
  const order=Array.from({length:n},(_,i)=>i)
    .sort((i,j)=>candidates[i].length-candidates[j].length);
  function visit(depth) {
    if (solutions>1) return;
    if (depth===n) {solutions++;mapping=chosen.slice();return;}
    const i=order[depth];
    for(const j of candidates[i]) {
      if(used[j]) continue;
      used[j]=true;chosen[i]=j;
      visit(depth+1);
      used[j]=false;chosen[i]=-1;
      if(solutions>1) return;
    }
  }
  visit(0);
  if(solutions===0) return Object.freeze({frame:'linear-mismatch',comparedInstances:0});
  if(solutions>1) return Object.freeze({frame:'ambiguous',comparedInstances:0});
  const delta = a[0].translation.map((v,axis)=>v-b[mapping[0]].translation[axis]);
  const consistent = a.every((item,i)=>item.translation.every((v,axis)=>
    Math.abs((v-b[mapping[i]].translation[axis])-delta[axis])<=translationToleranceMm));
  return Object.freeze({frame:consistent?'common-offset':'instance-dependent',
    comparedInstances:n});
}
