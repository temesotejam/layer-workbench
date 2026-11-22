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
