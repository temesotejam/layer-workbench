import assert from 'node:assert/strict';
import {makeBridgeArchStl} from './export-bridge-arch-stl.mjs';
import {makeBridgeArchObj} from './bridge-arch-fixture.mjs';
import {objToBinaryStl} from './obj-to-stl.mjs';

const bytes=makeBridgeArchStl();
assert.deepEqual(bytes,objToBinaryStl(makeBridgeArchObj()));
const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
const triangles=view.getUint32(80,true);
assert.equal(triangles,28);
assert.equal(bytes.length,84+triangles*50);
const seen=[new Set(),new Set(),new Set()];
const edges=new Map();
const key=p=>p.map(v=>v.toFixed(5)).join(',');
for(let i=0;i<triangles;i++) {
  const base=84+i*50,pts=[];
  for(let j=0;j<3;j++) {
    const p=Array.from({length:3},(_,a)=>view.getFloat32(base+12+j*12+a*4,true));
    for(let a=0;a<3;a++) seen[a].add(p[a]);
    pts.push(key(p));
  }
  assert.equal(new Set(pts).size,3,'No degenerate triangle vertices');
  for(let j=0;j<3;j++) {
    const edge=[pts[j],pts[(j+1)%3]].sort().join('|');
    edges.set(edge,(edges.get(edge)||0)+1);
  }
}
assert.deepEqual([...seen[0]].sort((a,b)=>a-b),[0,12,28,40]);
assert.deepEqual([...seen[1]].sort((a,b)=>a-b),[0,20]);
assert.deepEqual([...seen[2]].sort((a,b)=>a-b),[0,10,15]);
assert.ok([...edges.values()].every(n=>n===2),'Mesh must have two triangles per edge');
console.log('PASS: deterministic 28-triangle watertight bridge STL matches isolated WASM OBJ fixture');
