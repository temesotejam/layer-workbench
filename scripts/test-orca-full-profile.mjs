import assert from "node:assert/strict";
import {resolveFullOrcaProfileFamily,inspectOrcaNozzleVector,inspectOrcaArraySettings} from "./orca-full-profile.mjs";

const records = [
  {type:"machine",name:"base",nozzle_diameter:["0.4"],machine_start_gcode:"M117 base",settings_map:{nested:[true,12]},retract_length:["0.8"]},
  {type:"machine",name:"toolchanger",inherits:"base",nozzle_diameter:["0.4","0.6","0.4","0.4"],machine_start_gcode:"PRINT_START EXTRUDER=0"},
  {type:"machine",name:"leaf",inherits:"toolchanger",retract_length:["0.4","0.8","0.4","0.6"]},
];
const result=resolveFullOrcaProfileFamily(records,"machine","leaf");
assert.deepEqual(result.chain,["base","toolchanger","leaf"]);
assert.deepEqual([...result.settings.nozzle_diameter],["0.4","0.6","0.4","0.4"]);
assert.deepEqual([...result.settings.retract_length],["0.4","0.8","0.4","0.6"]);
assert.equal(result.settings.machine_start_gcode,"PRINT_START EXTRUDER=0");
assert.equal(result.sourceByKey.nozzle_diameter,"toolchanger");
assert.equal(result.sourceByKey.retract_length,"leaf");
assert.equal(result.usableForPrinting,false);
const arrays=inspectOrcaArraySettings(result);
assert.ok(arrays.possiblePerToolVectors.includes("nozzle_diameter"));
assert.ok(arrays.possiblePerToolVectors.includes("retract_length"));
assert.equal(arrays.classification.startsWith("inspection-only"),true);
assert.deepEqual(inspectOrcaNozzleVector(result),{toolCount:4,nozzleDiametersMm:[0.4,0.6,0.4,0.4],source:"toolchanger",supportedBySingleToolWasmAdapter:false});
result.settings.settings_map.nested[0]=false;
assert.equal(records[0].settings_map.nested[0],true,"input must be isolated");
assert.equal(inspectOrcaNozzleVector(resolveFullOrcaProfileFamily(records,"machine","base")).supportedBySingleToolWasmAdapter,true);
assert.throws(()=>resolveFullOrcaProfileFamily([{type:"machine",name:"missing",inherits:"none"}],"machine","missing"),/Missing/);
assert.throws(()=>resolveFullOrcaProfileFamily([{type:"machine",name:"a",inherits:"b"},{type:"machine",name:"b",inherits:"a"}],"machine","a"),/cycle/);
assert.throws(()=>resolveFullOrcaProfileFamily([...records,records[0]],"machine","leaf"),/Duplicate/);
assert.throws(()=>resolveFullOrcaProfileFamily([{type:"machine",name:"evil",extras:JSON.parse('{"__proto__":{"polluted":true}}')}],"machine","evil"),/Unsafe/);
assert.equal({}.polluted,undefined);
assert.throws(()=>resolveFullOrcaProfileFamily([{type:"machine",name:"bad",nozzle_diameter:[NaN]}],"machine","bad"),/Non-JSON/);
assert.throws(()=>inspectOrcaNozzleVector(resolveFullOrcaProfileFamily([{type:"machine",name:"bad",nozzle_diameter:["0.4","oops"]}],"machine","bad")),/Invalid native nozzle/);
assert.throws(()=>inspectOrcaNozzleVector(resolveFullOrcaProfileFamily([{type:"machine",name:"bad",nozzle_diameter:"0.4"}],"machine","bad")),/vector/);
assert.throws(()=>resolveFullOrcaProfileFamily([{type:"machine",name:"long",note:"x".repeat(1048577)}],"machine","long"),/size limit/);
console.log("PASS: full Orca option inheritance, four-nozzle vector, provenance and fail-closed safety");
