import assert from "node:assert/strict";
import {resolveRestrictedProcessSettings, sliceMultiStlWithEngine} from "./slice-stl.mjs";

const selected = {
  machine: {settings: {nozzle_diameter:"0.4", printable_height:"250"}},
  filament: {settings: {nozzle_temperature:"220"}},
  process: {settings: {layer_height:"0.24", wall_loops:"3", bridge_speed:"50"}},
};
assert.deepEqual(resolveRestrictedProcessSettings(null,selected),
  {layer_height:"0.24",wall_loops:"3",bridge_speed:"50"});
assert.deepEqual(resolveRestrictedProcessSettings({wall_loops:4},selected),
  {layer_height:"0.24",wall_loops:"4",bridge_speed:"50"});
assert.deepEqual(resolveRestrictedProcessSettings({layer_height:"0.3"}),
  {layer_height:"0.3"});
assert.equal(resolveRestrictedProcessSettings(),null);
assert.throws(()=>resolveRestrictedProcessSettings(null,{process:{settings:{}}}),/no supported settings/);
assert.throws(()=>resolveRestrictedProcessSettings(null,{process:{settings:{machine_start_gcode:"M104 S290"}}}),/Unsupported/);
assert.throws(()=>resolveRestrictedProcessSettings({bridge_speed:"50%"},selected),/Invalid numeric/);
// A malformed child override cannot hide an invalid selected native preset.
assert.throws(()=>resolveRestrictedProcessSettings({bridge_speed:25},
  {process:{settings:{bridge_speed:"50%"}}}),/Invalid numeric/);

const actualGcode = new TextEncoder().encode("G1 X10 Y10 E1 F1200\n".repeat(20));
function mockedEngine() {
  const calls=[];
  const engine={async createSession(){
    calls.push({name:"createSession"});
    return {
      async init(bytes){calls.push({name:"init", value:JSON.parse(new TextDecoder().decode(bytes))});},
      async applyProfile(format,bytes){calls.push({name:"applyProfile",format,
        value:JSON.parse(new TextDecoder().decode(bytes))});},
      async setObjects(blob,manifest){calls.push({name:"setObjects",blobLength:blob.length,manifest});},
      async slice(){calls.push({name:"slice"});return {schemaVersion:"0.7.0",plateResults:[{
        plateId:"plate-0",assets:[{kind:"gcode",id:"fixture"}],statistics:{}}]};},
      async getAsset(id){assert.equal(id,"fixture");calls.push({name:"getAsset"});return actualGcode;},
      async dispose(){calls.push({name:"dispose"});}
    };
  }};
  return {engine,calls};
}
const items=[{bytes:new Uint8Array(134)}];
{
  const {engine,calls}=mockedEngine();
  const result=await sliceMultiStlWithEngine(engine,items,null,null,selected);
  assert.equal(result.gcode.byteLength,actualGcode.byteLength);
  assert.deepEqual(calls.map(call=>call.name),
    ["createSession","init","applyProfile","setObjects","slice","getAsset","dispose"]);
  assert.equal(calls[1].value.nozzle_temperature,"220");
  assert.equal(calls[2].format,"orca.native-json");
  assert.deepEqual(calls[2].value,selected.process.settings,
    "selected inherited process settings must be applied without duplicate manual argument");
}
{
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null,{wall_loops:"4"},selected);
  assert.deepEqual(calls.filter(c=>c.name==="applyProfile").map(c=>c.value),
    [{layer_height:"0.24",wall_loops:"4",bridge_speed:"50"}]);
}
{
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null,null,null);
  assert.equal(calls.some(c=>c.name==="applyProfile"),false,
    "generic PLA fallback still works with no user-selected profile");
}
{
  const {engine,calls}=mockedEngine();
  await assert.rejects(()=>sliceMultiStlWithEngine(engine,items,null,null,{
    ...selected,process:{settings:{layer_height:"0.6"}}
  }),/outside the safe test range/);
  assert.equal(calls.length,0,"invalid selected profiles must be rejected before native session creation");
}
console.log("PASS: selected restricted Orca process auto-applied once, bounded override precedence and early failure");
