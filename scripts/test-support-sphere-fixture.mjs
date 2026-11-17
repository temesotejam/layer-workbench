import assert from "node:assert/strict";
import {makeSupportSphereObj} from "./support-sphere-fixture.mjs";

const cross=(a,b)=>[
  a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],
  a[0]*b[1]-a[1]*b[0],
];
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
function audit({radius=10,rings=10,sectors=16}={}){
  const lines=makeSupportSphereObj({radius,rings,sectors}).split(/\r?\n/);
  const vertices=lines.filter(l=>l.startsWith("v "))
    .map(l=>l.split(/\s+/).slice(1).map(Number));
  const faces=lines.filter(l=>l.startsWith("f "))
    .map(l=>l.split(/\s+/).slice(1).map(Number));
  assert.equal(vertices.length,2+(rings-1)*sectors);
  assert.equal(faces.length,2*(rings-1)*sectors);
  assert.ok(vertices.every(v=>v.length===3&&v.every(Number.isFinite)));
  assert.ok(faces.every(f=>f.length===3&&f.every(i=>Number.isInteger(i)&&i>0&&i<=vertices.length)));
  const edges=new Map();
  let volume=0;
  for(const face of faces) {
    for(let k=0;k<3;k++){
      const a=face[k],b=face[(k+1)%3];
      const key=[Math.min(a,b),Math.max(a,b)].join("-");
      edges.set(key,(edges.get(key)||0)+1);
    }
    const [a,b,c]=face.map(i=>vertices[i-1]);
    const norm=cross(b.map((v,i)=>v-a[i]),c.map((v,i)=>v-a[i]));
    assert.ok(Math.hypot(...norm)>1e-7,"Degenerate support sphere face");
    volume+=dot(a,cross(b,c))/6;
  }
  assert.ok([...edges.values()].every(n=>n===2),"Sphere must be closed manifold");
  const target=4*Math.PI*radius**3/3;
  assert.ok(volume>target*0.85&&volume<target,
    "Sphere must have outward normals and expected positive volume: "+volume);
  const z=vertices.map(v=>v[2]);
  assert.ok(Math.abs(Math.min(...z))<1e-8);
  assert.ok(Math.abs(Math.max(...z)-2*radius)<1e-7);
  assert.ok(vertices.some(v=>v[0]===0&&v[1]===0&&v[2]===0));
}
audit();
audit({radius:8,rings:12,sectors:20});
for(const bad of [{radius:5},{radius:Infinity},{sectors:8},
  {sectors:15.2},{rings:20},{rings:4},{radius:NaN}]){
  assert.throws(()=>makeSupportSphereObj(bad),/Invalid/);
}
console.log("PASS: bounded watertight outward support sphere with broad lower overhang and Z=0 point");
