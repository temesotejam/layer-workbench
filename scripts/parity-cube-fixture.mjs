// Synthetic source geometry shared by official native v2.5.0 and isolated WASM
// Chrome probes. This is a TEST FIXTURE, not a printer-ready model or profile.
// Preserve the byte encoding, triangle order and zeroed header/normals: the
// SHA256 is an intentionally pinned source-input identity check.
import {createHash} from "node:crypto";
import {writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const triangles = [
  [[0,0,0],[20,0,0],[20,20,0]], [[0,0,0],[20,20,0],[0,20,0]],
  [[0,0,20],[20,20,20],[20,0,20]], [[0,0,20],[0,20,20],[20,20,20]],
  [[0,0,0],[20,0,20],[20,0,0]], [[0,0,0],[0,0,20],[20,0,20]],
  [[0,20,0],[20,20,0],[20,20,20]], [[0,20,0],[20,20,20],[0,20,20]],
  [[0,0,0],[0,20,0],[0,20,20]], [[0,0,0],[0,20,20],[0,0,20]],
  [[20,0,0],[20,0,20],[20,20,20]], [[20,0,0],[20,20,20],[20,20,0]],
];

export const PARITY_CUBE_STL_SHA256 =
  "7b59223183b5c34815cbf197e1207b108932779a650bd9e6c9a6d2be811f8e93";

export function makeParityCubeStl() {
  const cube = Buffer.alloc(84 + 50 * triangles.length);
  cube.writeUInt32LE(triangles.length, 80);
  triangles.forEach((tri, i) => tri.forEach((vertex, v) => vertex.forEach((value, axis) =>
    cube.writeFloatLE(value, 84 + i * 50 + 12 + v * 12 + axis * 4))));
  const actual = createHash("sha256").update(cube).digest("hex");
  if (actual !== PARITY_CUBE_STL_SHA256)
    throw new Error("Shared parity-cube STL bytes changed without a reviewed fixture revision");
  return cube;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.length !== 3)
    throw new Error("Usage: node scripts/parity-cube-fixture.mjs output.stl");
  // The native test runner must not silently overwrite any existing source file.
  writeFileSync(process.argv[2], makeParityCubeStl(), {flag: "wx", mode: 0o600});
  console.log("Synthetic STL source SHA256: " + PARITY_CUBE_STL_SHA256);
}
