// Read-only diagnostic for a bounded binary STL from a locally selected,
// pinned 3MF->STL WASM candidate. The 12-byte STL normal field is advisory:
// it cannot establish Core import winding or certify mesh topology.
// Never expose positions, original normals, or source identifiers.
const MAX_FACETS = 256;
const UNAVAILABLE = Object.freeze({normalAlignment:'unavailable',comparedTriangles:0});
const result = (status, count) => Object.freeze({normalAlignment:status,comparedTriangles:count});
const valid = value => Number.isFinite(value) && Math.abs(value) <= 1e7;

export function auditNative3mfStlNormalAlignment(bytes, toleranceMm=0.05) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 134 ||
      bytes.byteLength > 84+50*MAX_FACETS || !Number.isFinite(toleranceMm) ||
      toleranceMm <= 0 || toleranceMm > 0.1) return UNAVAILABLE;
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const count = view.getUint32(80,true);
  if (count < 1 || count > MAX_FACETS || bytes.byteLength !== 84+50*count)
    return UNAVAILABLE;
  let aligned = 0, opposed = 0, inconsistent = 0;
  for (let i=0;i<count;i++) {
    const start=84+50*i;
    const values=Array.from({length:12},(_,j)=>view.getFloat32(start+4*j,true));
    if (!values.every(valid)) return UNAVAILABLE;
    const normal=values.slice(0,3);
    const a=values.slice(3,6), b=values.slice(6,9), c=values.slice(9,12);
    const u=b.map((x,j)=>x-a[j]), v=c.map((x,j)=>x-a[j]);
    const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const normalLength=Math.hypot(...normal), area=Math.hypot(...cross);
    // A zero normal is legal in binary STL. Do not synthesize a claim.
    // Tiny triangles may flip winding under the 0.05mm position tolerance.
    if (normalLength <= 1e-7 || area <= 4*toleranceMm*toleranceMm)
      return UNAVAILABLE;
    const cosine=cross.reduce((sum,x,j)=>sum+x*normal[j],0)/(area*normalLength);
    if (!Number.isFinite(cosine)) return UNAVAILABLE;
    if (cosine >= 0.95) aligned++;
    else if (cosine <= -0.95) opposed++;
    else inconsistent++;
  }
  if (inconsistent) return result('inconsistent',count);
  if (aligned && opposed) return result('mixed',count);
  return result(aligned ? 'aligned':'opposed',count);
}
