import assert from "node:assert/strict";
import {resolveFullOrcaProfileFamily} from "./orca-full-profile.mjs";
import {inspectOrcaFilamentRouting,ORCA_FILAMENT_MAP_SOURCE} from "./orca-filament-routing.mjs";

const machine=resolveFullOrcaProfileFamily([
  {type:"machine",name:"root",nozzle_diameter:["0.4"]},
  {type:"machine",name:"four-tool",inherits:"root",nozzle_diameter:["0.4","0.6","0.25","0.4"]}
],"machine","four-tool");
assert.equal(ORCA_FILAMENT_MAP_SOURCE.commit,"40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19");
const values=["1",4,3,"2"];
const output=inspectOrcaFilamentRouting(machine,values);
assert.equal(output.toolCount,4);
assert.equal(output.filamentCount,4);
assert.equal(output.usableForPrinting,false);
assert.deepEqual(output.routing.map(x=>x.extruderId),[1,4,3,2]);
assert.deepEqual(output.routing.map(x=>x.extruderIndex),[0,3,2,1]);
assert.deepEqual(output.routing.map(x=>x.nozzleDiameterMm),[0.4,0.4,0.25,0.6]);
assert.deepEqual(output.routing.map(x=>x.filamentId),[1,2,3,4]);
assert.deepEqual(values,["1",4,3,"2"],"input map must not be mutated");
assert.equal(inspectOrcaFilamentRouting(machine,[1,1,1]).filamentCount,3,
  "multiple filaments may map to the same physical extruder");
assert.equal(inspectOrcaFilamentRouting(machine,["4"]).filamentCount,1,
  "a four-tool printer does not imply four loaded filaments");
for (const invalid of [undefined,null,[],{},Array(65).fill(1)])
  assert.throws(()=>inspectOrcaFilamentRouting(machine,invalid),/explicit non-empty/);
for (const invalid of [0,-1,5,"0","5","02","2.0"," 2","2 ",NaN,Infinity,1.5,null,{},true])
  assert.throws(()=>inspectOrcaFilamentRouting(machine,[invalid]),/filament_map/);
const one=resolveFullOrcaProfileFamily([
  {type:"machine",name:"one",nozzle_diameter:["0.4"]}
],"machine","one");
assert.deepEqual(inspectOrcaFilamentRouting(one,[1]).routing.map(x=>x.extruderIndex),[0]);
assert.throws(()=>inspectOrcaFilamentRouting(one,[2]),/outside available nozzle/);
console.log("PASS: explicit one-based filament_map inspection, four-tool routing, duplicate tools and fail-closed inputs");
