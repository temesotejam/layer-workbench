// Read-only diagnostic of affine translation-frame consistency for native
// one-slicer-api 0.7.0 instances and Three.js Core 3MF build items.
// First match 3x3 linear transforms; repeated transforms require exactly
// one shared-translation bijection or are explicitly ambiguous. This remains
// an alignment hypothesis, not native object identity or mesh attribution.
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

  // A naive exhaustive search can take factorial time even for <=64
  // instances when every native item matches 63 of 64 viewer items but no
  // perfect bijection exists (Hall's condition). Keep untrusted 3MF inspection
  // bounded with augmenting-path bipartite matching instead.
  function findMatching(sets, forbiddenI=-1, forbiddenJ=-1) {
    const owner=Array(n).fill(-1);
    const order=Array.from({length:n},(_,i)=>i)
      .sort((i,j)=>sets[i].length-sets[j].length);
    function augment(i,seen) {
      for(const j of sets[i]) {
        if ((i===forbiddenI && j===forbiddenJ) || seen[j]) continue;
        seen[j]=true;
        if(owner[j]===-1 || augment(owner[j],seen)) {
          owner[j]=i;
          return true;
        }
      }
      return false;
    }
    for(const i of order)
      if(!augment(i,Array(n).fill(false))) return null;
    const mapping=Array(n).fill(-1);
    for(let j=0;j<n;j++) mapping[owner[j]]=j;
    return mapping;
  }
  // A perfect matching is unique iff removing each of its matched edges
  // destroys every perfect matching. At most n+1 bounded graph searches,
  // not a factorial enumeration; preserve the old count=0/1/2 contract.
  function matchings(sets,limit=2) {
    const mapping=findMatching(sets);
    if(!mapping) return {count:0,mapping:null};
    if(limit===1) return {count:1,mapping};
    for(let i=0;i<n;i++)
      if(findMatching(sets,i,mapping[i]))
        return {count:2,mapping};
    return {count:1,mapping};
  }
  const linearMatches=matchings(candidates);
  if(linearMatches.count===0)
    return Object.freeze({frame:'linear-mismatch',comparedInstances:0});
  const deltaFor=(i,j)=>a[i].translation.map((v,axis)=>v-b[j].translation[axis]);
  const matchesDelta=(i,j,delta)=>deltaFor(i,j).every((v,axis)=>
    Math.abs(v-delta[axis])<=translationToleranceMm);

  // With a unique linear assignment, test its translations directly.
  if(linearMatches.count===1) {
    const mapping=linearMatches.mapping;
    const delta=deltaFor(0,mapping[0]);
    const consistent=a.every((_,i)=>matchesDelta(i,mapping[i],delta));
    return Object.freeze({frame:consistent?'common-offset':'instance-dependent',
      comparedInstances:n});
  }

  // Duplicated rotations/scales need not imply ambiguous *placements*.
  // Try each possible first-instance match as a common translation anchor,
  // then require exactly ONE full matching respecting both the linear terms
  // and that same global translation. Never select by array/build order.
  let commonMappings=0;
  for(const j of candidates[0]) {
    const delta=deltaFor(0,j);
    const constrained=candidates.map((choices,i)=>
      choices.filter(k=>matchesDelta(i,k,delta)));
    if(constrained.some(choices=>choices.length===0)) continue;
    commonMappings+=matchings(constrained,2-commonMappings).count;
    if(commonMappings>1) break;
  }
  // If no globally translated matching exists, duplicated linear transforms
  // still cannot uniquely attribute a per-instance pivot difference.
  // Coincident placements with >1 valid matching remain ambiguous as well.
  return Object.freeze({frame:commonMappings===1?'common-offset':'ambiguous',
    comparedInstances:commonMappings===1?n:0});
}
