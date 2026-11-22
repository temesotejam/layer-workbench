// Read-only, small-fixture geometry check for opt-in isolated localhost.
// Compare WORLD-SPACE triangle coordinates from the official WASM 3MF->STL
// converter with Three.js's independently transformed, bed-offset-corrected
// visible triangles. The native STL is FLATTENED: this does NOT identify
// instances, prove editable 3MF parity, preserve metadata, or certify G-code.
// Deliberately bounded: larger/unsupported scenes return "unavailable".
// Never return or log any file-derived coordinates, IDs or metadata.
export const MAX_WORLD_FACETS = 256;
const unavailable = Object.freeze({facets:'unavailable',comparedTriangles:0});
const valid = x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1e7;
const validPoint = p => Array.isArray(p) && p.length === 3 && p.every(valid);
const validFacet = f => Array.isArray(f) && f.length === 3 && f.every(validPoint);
const permutations = [
  [0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]
];

function parseBinaryStl(stl) {
  if (!(stl instanceof Uint8Array) || stl.byteLength < 134 ||
      stl.byteLength > 84 + 50 * MAX_WORLD_FACETS) return null;
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const count = view.getUint32(80, true);
  if (count < 1 || count > MAX_WORLD_FACETS ||
      stl.byteLength !== 84 + 50 * count) return null;
  const facets = [];
  for (let face = 0; face < count; face++) {
    const triangle = [];
    for (let v = 0; v < 3; v++) {
      const offset = 84 + face * 50 + 12 + v * 12;
      triangle.push([0,1,2].map(axis => view.getFloat32(offset + axis * 4, true)));
    }
    if (!validFacet(triangle)) return null;
    facets.push(triangle);
  }
  return facets;
}

const equalFacet = (a,b,tolerance) => permutations.some(order =>
  order.every((j,i) => [0,1,2].every(axis =>
    Math.abs(a[i][axis] - b[j][axis]) <= tolerance)));

export function auditNative3mfWorldFacets(nativeStl, viewerFacets, toleranceMm=0.05) {
  if (!Array.isArray(viewerFacets) || viewerFacets.length < 1 ||
      viewerFacets.length > MAX_WORLD_FACETS ||
      !viewerFacets.every(validFacet) || !Number.isFinite(toleranceMm) ||
      toleranceMm <= 0 || toleranceMm > 0.1) return unavailable;
  const native = parseBinaryStl(nativeStl);
  if (!native) return unavailable;
  if (native.length !== viewerFacets.length)
    return Object.freeze({facets:'mismatch',comparedTriangles:0});
  // Full bipartite matching, not list order or an assumed 3MF build ID map.
  // Six vertex permutations allow face order and winding to differ. Face
  // orientation and indexed connectivity have separate audits.
  const owner = Array(viewerFacets.length).fill(-1);
  function assign(i, visited) {
    for (let j = 0; j < viewerFacets.length; j++) {
      if (visited[j] || !equalFacet(native[i], viewerFacets[j], toleranceMm)) continue;
      visited[j] = true;
      if (owner[j] === -1 || assign(owner[j], visited)) {
        owner[j] = i;
        return true;
      }
    }
    return false;
  }
  const same = native.every((_,i) => assign(i, Array(viewerFacets.length).fill(false)));
  return Object.freeze({facets:same ? 'consistent' : 'mismatch',
    comparedTriangles:native.length});
}

// Separate winding witness for the flattened 3MF converter. The general
// geometry audit above intentionally ignores triangle orientation, but a
// reversed surface may materially change native face semantics. Compare
// cyclic vertex permutations (same winding) independently of anticyclic
// permutations (opposite winding). NEVER infer native instance IDs or use
// binary STL normal-vector fields as a reliable winding proxy.
// A positive classification is only about the observed bounded triangles.
const cyclicOrders=[[0,1,2],[1,2,0],[2,0,1]];
const reversedOrders=[[0,2,1],[2,1,0],[1,0,2]];
function windingMatch(a,b,orders,tolerance) {
  return orders.some(order=>order.every((j,i)=>[0,1,2].every(axis=>
    Math.abs(a[i][axis]-b[j][axis])<=tolerance)));
}
function nonDegenerateFacet(f, tolerance) {
  const u=f[1].map((v,i)=>v-f[0][i]);
  const v=f[2].map((x,i)=>x-f[0][i]);
  const cross=[
    u[1]*v[2]-u[2]*v[1],
    u[2]*v[0]-u[0]*v[2],
    u[0]*v[1]-u[1]*v[0],
  ];
  // Refuse orientation claims on faces too tiny for the positional
  // comparison tolerance to determine a stable clockwise order.
  return Math.hypot(...cross)>4*tolerance*tolerance;
}
function fullWindingMatching(native,viewer,orders,tolerance) {
  const owner=Array(viewer.length).fill(-1);
  function augment(i,seen) {
    for(let j=0;j<viewer.length;j++) {
      if(seen[j] || !windingMatch(native[i],viewer[j],orders,tolerance))continue;
      seen[j]=true;
      if(owner[j]===-1 || augment(owner[j],seen)) {
        owner[j]=i;
        return true;
      }
    }
    return false;
  }
  return native.every((_,i)=>augment(i,Array(viewer.length).fill(false)));
}
export function auditNative3mfWorldFacetWinding(nativeStl,viewerFacets,toleranceMm=0.05) {
  const unavailableWinding=()=>Object.freeze({winding:'unavailable',comparedTriangles:0});
  // Reuse the separate geometry comparison to reject shape discrepancies,
  // malformed arrays, and oversized inputs rather than inventing a
  // winding result for unequal triangle sets.
  const geometry=auditNative3mfWorldFacets(nativeStl,viewerFacets,toleranceMm);
  if(geometry.facets==='unavailable')return unavailableWinding();
  const report=winding=>Object.freeze({winding,comparedTriangles:geometry.comparedTriangles});
  if(geometry.facets!=='consistent')return report('mismatch');
  const native=parseBinaryStl(nativeStl);
  if(!native || ![...native,...viewerFacets].every(f=>nonDegenerateFacet(f,toleranceMm)))
    return unavailableWinding();
  const forward=fullWindingMatching(native,viewerFacets,cyclicOrders,toleranceMm);
  const reverse=fullWindingMatching(native,viewerFacets,reversedOrders,toleranceMm);
  if(forward && reverse)return report('ambiguous');
  if(forward)return report('consistent');
  if(reverse)return report('reversed');
  // The triangles coincide as an unoriented multiset but cannot all be
  // matched with one winding convention. Do not call that oriented parity.
  return report('mixed');
}

// A flattened native STL has no object/build IDs. This independent witness
// asks whether every native triangle has a UNIQUE matching viewer build under
// the same bounded geometry tolerance. It proves separability of the rendered
// build geometry, NOT native instance identity, local pivot, or save parity.
// Ambiguous coincident/intersecting facets must never be assigned by order.
export function auditNative3mfWorldFacetGroups(nativeStl, viewerFacetGroups, toleranceMm=0.05) {
  const unavailableGroups=()=>Object.freeze({partition:'unavailable',comparedBuilds:0,comparedTriangles:0});
  if (!Array.isArray(viewerFacetGroups) || viewerFacetGroups.length < 2 ||
      viewerFacetGroups.length > 64 || !Number.isFinite(toleranceMm) ||
      toleranceMm <= 0 || toleranceMm > 0.1 ||
      viewerFacetGroups.some(group => !Array.isArray(group) || group.length < 1 ||
        !group.every(validFacet))) return unavailableGroups();
  const count=viewerFacetGroups.reduce((sum,group)=>sum+group.length,0);
  if (count > MAX_WORLD_FACETS) return unavailableGroups();
  const flattened=viewerFacetGroups.flat();
  const global=auditNative3mfWorldFacets(nativeStl,flattened,toleranceMm);
  if (global.facets==='unavailable') return unavailableGroups();
  const report=partition=>Object.freeze({partition,
    comparedBuilds:viewerFacetGroups.length,comparedTriangles:global.comparedTriangles});
  if (global.facets!=='consistent') return report('mismatch');
  const native=parseBinaryStl(nativeStl);
  const counts=Array(viewerFacetGroups.length).fill(0);
  let overlapping=false;
  for(const face of native) {
    let match=-1;
    for(let build=0;build<viewerFacetGroups.length;build++) {
      if (!viewerFacetGroups[build].some(other=>equalFacet(face,other,toleranceMm))) continue;
      if (match!==-1) {overlapping=true;break;}
      match=build;
    }
    if (match<0) return report('mismatch');
    if (!overlapping) counts[match]++;
  }
  // A global perfect facet matching can exist even when two viewer builds
  // share identical faces. Never infer build attribution in that case.
  if (overlapping) return report('ambiguous');
  return report(counts.every((n,i)=>n===viewerFacetGroups[i].length)
    ? 'separable' : 'mismatch');
}
