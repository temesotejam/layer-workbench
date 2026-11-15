import assert from "node:assert/strict";
import {makeGapRingObj} from "./gap-ring-fixture.mjs";

const source=makeGapRingObj();
const lines=source.split(/\r?\n/);
const vertices=lines.filter(s=>s.startsWith("v ")).map(s=>s.split(/\s+/).slice(1).map(Number));
const faces=lines.filter(s=>s.startsWith("f ")).map(s=>s.split(/\s+/).slice(1).map(Number));
assert.equal(vertices.length,16);
assert.equal(faces.length,32);
assert.ok(vertices.every(v=>v.length===3&&v.every(Number.isFinite)));
assert.deepEqual(vertices[0],[0,0,0]);
assert.deepEqual(vertices[4],[1.5,1.5,0]);
assert.deepEqual(vertices[12],[1.5,1.5,8]);
// Every undirected triangle edge must be shared by exactly two triangles:
// the open center is an intentionally hollow solid, not an open mesh.
const edges=new Map();
for(const face of faces) {
  assert.equal(face.length,3);
  assert.ok(face.every(i=>Number.isInteger(i)&&i>=1&&i<=vertices.length));
  for(let i=0;i<3;i++) {
    const a=face[i],b=face[(i+1)%3];
    assert.notEqual(a,b);
    const key=[Math.min(a,b),Math.max(a,b)].join("-");
    edges.set(key,(edges.get(key)||0)+1);
  }
}
assert.ok(edges.size>30);
assert.ok([...edges.values()].every(n=>n===2),"Gap ring OBJ must be watertight");
// Triangles must be nonzero area, consistently outward-facing, and the
// 40 x 40 x 8 bounding box must retain a true 37 x 37 mm center hole.
const cross=(a,b)=>[
 a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]
];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
let volume=0;
for(const [a,b,c] of faces) {
  const x=vertices[a-1],y=vertices[b-1],z=vertices[c-1];
  const normal=cross(y.map((v,i)=>v-x[i]),z.map((v,i)=>v-x[i]));
  assert.ok(Math.hypot(...normal)>1e-8,"Degenerate OBJ face");
  volume+=dot(x,cross(y,z))/6;
}
assert.ok(Math.abs(volume-(40*40-37*37)*8)<1e-6,
  "Incorrect signed annular solid volume/orientation");
for(const bad of [{outer:10,wall:5},{wall:0},{height:0},
  {outer:Infinity},{wall:NaN},{outer:1000}])
  assert.throws(()=>makeGapRingObj(bad),/Invalid/);
console.log("PASS: bounded closed 1.5 mm wall OBJ ring, valid outward faces and empty center");
