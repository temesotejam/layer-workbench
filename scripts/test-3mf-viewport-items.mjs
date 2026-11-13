import assert from 'node:assert/strict';
import {get3mfViewportBuildItems} from './three-mf-viewport-items.mjs';

function node(children = [], isMesh = false) {
  const value = {
    isObject3D:true, isMesh,
    geometry: isMesh ? {attributes:{position:{count:9}}} : undefined,
    children,
    traverse(fn) { fn(this); for(const child of this.children) child.traverse(fn); },
  };
  return value;
}
const one = node([node([],true)]);
const two = node([node([node([],true),node([],true)])]);
const root = {isGroup:true,children:[one,two]};
const result=get3mfViewportBuildItems(root);
assert.deepEqual(result.map(item=>[item.buildIndex,item.meshCount]),[[1,1],[2,2]]);
assert.equal(result[0].object,one);
assert.equal(result[1].object,two);
assert.equal(root.children.length,2,'Source scene hierarchy must not be modified');
for (const [input, msg] of [
  [null,/project group/],
  [{isGroup:true,children:[]},/count/],
  [{isGroup:true,children:[node()]},/no mesh/],
  [{isGroup:true,children:[{}]},/scene node/],
  [{isGroup:true,children:Array.from({length:65},()=>one)},/limit/],
]) assert.throws(()=>get3mfViewportBuildItems(input),msg);
assert.throws(()=>get3mfViewportBuildItems(root,100),/limit/);
console.log('PASS: non-mutating 3MF build-item selection and fail-closed limits');
