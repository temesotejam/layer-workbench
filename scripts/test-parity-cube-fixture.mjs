import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {makeParityCubeStl, PARITY_CUBE_STL_SHA256} from "./parity-cube-fixture.mjs";

const cube = makeParityCubeStl();
assert.equal(cube.byteLength, 684);
assert.equal(cube.readUInt32LE(80), 12);
assert.equal(createHash("sha256").update(cube).digest("hex"), PARITY_CUBE_STL_SHA256);
assert.ok(cube.subarray(0, 80).every(byte => byte === 0),
  "Binary STL header must remain byte-identical to the original browser cube");
const coordinates = [];
const edges = new Map();
for (let i = 0; i < 12; i++) {
  const offset = 84 + 50 * i;
  assert.ok(cube.subarray(offset, offset + 12).every(byte => byte === 0),
    "The existing WASM smoke fixture has zero normals");
  const vertices = Array.from({length: 3}, (_, vertex) =>
    Array.from({length: 3}, (_, axis) =>
      cube.readFloatLE(offset + 12 + vertex * 12 + axis * 4)));
  assert.equal(new Set(vertices.map(v => v.join(","))).size, 3);
  for (const vertex of vertices) coordinates.push(vertex);
  for (let edge = 0; edge < 3; edge++) {
    const endpoints = [vertices[edge].join(","), vertices[(edge + 1) % 3].join(",")].sort();
    const key = endpoints.join("|");
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
}
for (let axis = 0; axis < 3; axis++) {
  assert.equal(Math.min(...coordinates.map(v => v[axis])), 0);
  assert.equal(Math.max(...coordinates.map(v => v[axis])), 20);
}
assert.equal(edges.size, 18);
assert.ok([...edges.values()].every(n => n === 2),
  "Each undirected cube mesh edge must belong to exactly two facets");
const separate = makeParityCubeStl();
separate[0] = 255;
assert.equal(cube[0], 0, "Each consumer must get an independent byte buffer");
console.log("PASS: native/Chrome cube fixture is byte-pinned, manifold, 20 mm per side");
