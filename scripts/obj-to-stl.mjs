// Local-only, geometry-only OBJ -> binary STL bridge for the isolated WASM lab.
// Matches OBJLoader's face-fan triangulation, but drops UVs/materials/groups.
// Not a CAD/STEP converter, watertightness check, or print-safety validator.
const MAX_SOURCE_CHARS = 20 * 1024 * 1024;
const MAX_TRIANGLES = 300_000;
const MAX_FACE_VERTICES = 256;
const MAX_COORD = 100_000;
const VERTEX_INDEX = /^[+-]?[1-9]\d*$/;
const FACE_VERTEX = /^[+-]?[1-9]\d*(?:\/(?:[+-]?[1-9]\d*)?(?:\/[+-]?[1-9]\d*)?)?$/;

export function objToBinaryStl(source) {
  if (typeof source !== 'string' || !source.length || source.length > MAX_SOURCE_CHARS || source.includes('\0'))
    throw new Error('OBJ text is empty, invalid or exceeds the 20 MiB test limit');
  const vertices = [], triangles = [];
  let lineNumber = 0;
  for (const rawLine of source.split(/\r?\n/)) {
    lineNumber++;
    const line = rawLine.split('#', 1)[0].trim();
    if (!line) continue;
    const words = line.split(/\s+/);
    if (words[0] === 'v') {
      if (words.length !== 4 && words.length !== 7)
        throw new Error('Unsupported OBJ vertex layout at line ' + lineNumber);
      const xyz = words.slice(1, 4).map(Number);
      if (xyz.some(v => !Number.isFinite(v) || Math.abs(v) > MAX_COORD))
        throw new Error('Invalid OBJ vertex at line ' + lineNumber);
      // Optional RGB vertex colors may be present; STL intentionally omits them.
      if (words.length === 7 && words.slice(4).some(v => !Number.isFinite(Number(v))))
        throw new Error('Invalid OBJ vertex color at line ' + lineNumber);
      vertices.push(xyz);
      if (vertices.length > 500_000) throw new Error('OBJ vertex count exceeds test limit');
    } else if (words[0] === 'f') {
      if (words.length < 4 || words.length > MAX_FACE_VERTICES + 1)
        throw new Error('Invalid OBJ face vertex count at line ' + lineNumber);
      const face = words.slice(1).map(token => {
        if (!FACE_VERTEX.test(token)) throw new Error('Invalid OBJ face reference at line ' + lineNumber);
        const raw = token.split('/')[0];
        if (!VERTEX_INDEX.test(raw)) throw new Error('Invalid OBJ vertex index at line ' + lineNumber);
        const index = Number(raw);
        if (!Number.isSafeInteger(index)) throw new Error('OBJ index exceeds safe integer limit');
        const resolved = index < 0 ? vertices.length + index : index - 1;
        if (resolved < 0 || resolved >= vertices.length)
          throw new Error('OBJ face references unavailable vertex at line ' + lineNumber);
        return resolved;
      });
      // Three.js OBJLoader renders polygon faces as a fan from vertex zero.
      // Retain exactly that geometry, without inventing material/solid metadata.
      for (let i = 1; i < face.length - 1; i++) {
        triangles.push([face[0], face[i], face[i + 1]]);
        if (triangles.length > MAX_TRIANGLES) throw new Error('OBJ triangle count exceeds test limit');
      }
    }
  }
  if (!triangles.length) throw new Error('OBJ contains no triangle faces');
  const binary = new Uint8Array(84 + 50 * triangles.length);
  const view = new DataView(binary.buffer);
  view.setUint32(80, triangles.length, true);
  for (let i = 0; i < triangles.length; i++) {
    const [a,b,c] = triangles[i].map(index => vertices[index]);
    const ab = b.map((v,j)=>v-a[j]), ac=c.map((v,j)=>v-a[j]);
    const cross = [ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]];
    const magnitude = Math.hypot(...cross);
    if (!(magnitude > 1e-9) || !Number.isFinite(magnitude))
      throw new Error('OBJ contains degenerate or invalid triangle ' + i);
    const start = 84 + i*50;
    for (let axis=0;axis<3;axis++) view.setFloat32(start+axis*4,cross[axis]/magnitude,true);
    [a,b,c].forEach((vertex,j)=>vertex.forEach((value,axis)=>view.setFloat32(start+12+j*12+axis*4,value,true)));
  }
  return binary;
}
