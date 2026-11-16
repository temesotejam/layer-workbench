import assert from "node:assert/strict";
import {makeBridgeArchObj} from "./bridge-arch-fixture.mjs";

function inspect(source,{width=40,depth=20,height=15,pier=12,clearance=10}={}) {
  const lines=source.trim().split(/\r?\n/);
  const vertices=lines.filter(s=>s.startsWith("v "))
    .map(s=>s.split(/\s+/).slice(1).map(Number));
  const faces=lines.filter(s=>s.startsWith("f "))
    .map(s=>s.split(/\s+/).slice(1).map(Number));
  assert.equal(vertices.length,16);
  assert.equal(faces.length,28);
  assert.ok(vertices.every(v=>v.length===3&&v.every(Number.isFinite)));
  assert.ok(faces.every(f=>f.length===3&&f.every(i=>
    Number.isInteger(i)&&i>=1&&i<=vertices.length)));
  const edges=new Map();
  for(const face of faces) for(let i=0;i<3;i++) {
    const a=face[i],b=face[(i+1)%3];
    assert.notEqual(a,b);
    const key=[Math.min(a,b),Math.max(a,b)].join("-");
    edges.set(key,(edges.get(key)||0)+1);
  }
  assert.ok([...edges.values()].every(n=>n===2),"Arch must be closed/manifold");
  const cross=(a,b)=>[
    a[1]*b[2]-a[2]*b[1],
    a[2]*b[0]-a[0]*b[2],
    a[0]*b[1]-a[1]*b[0],
  ];
  const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
  let signedVolume=0;
  for(const [a,b,c] of faces) {
    const x=vertices[a-1],y=vertices[b-1],z=vertices[c-1];
    const normal=cross(y.map((v,i)=>v-x[i]),z.map((v,i)=>v-x[i]));
    assert.ok(Math.hypot(...normal)>1e-8,"No degenerate triangles");
    signedVolume+=dot(x,cross(y,z))/6;
  }
  const expected=depth*(width*height-(width-2*pier)*clearance);
  assert.ok(Math.abs(signedVolume-expected)<1e-6,
    "Arch must have correct oriented solid volume (open tunnel retained)");
  const bound=(dim)=>[
    Math.min(...vertices.map(v=>v[dim])),
    Math.max(...vertices.map(v=>v[dim]))
  ];
  assert.deepEqual(bound(0),[0,width]);
  assert.deepEqual(bound(1),[0,depth]);
  assert.deepEqual(bound(2),[0,height]);
  assert.ok(vertices.some(v=>v[0]===pier&&v[2]===clearance));
  assert.ok(vertices.some(v=>v[0]===width-pier&&v[2]===clearance));
}
inspect(makeBridgeArchObj());
const variant={width:46,depth:16,height:18,pier:13,clearance:12};
inspect(makeBridgeArchObj(variant),variant);
for(const bad of [{width:24,pier:9},{width:Infinity},{depth:0},
  {height:6,clearance:5},{pier:0},{clearance:NaN},{width:101}])
  assert.throws(()=>makeBridgeArchObj(bad),/Invalid/);
console.log("PASS: watertight concave bridge arch with real open tunnel and safe dimensions");
