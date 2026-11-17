import assert from "node:assert/strict";
import {resolveRestrictedProcessSettings, makeRestrictedInitConfig, sliceMultiStlWithEngine} from "./slice-stl.mjs";

const selected = {
  machine: {settings: {nozzle_diameter:"0.4", printable_height:"250"}},
  filament: {settings: {nozzle_temperature:"220",filament_type:"PLA"}},
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

// Session.init must be just as fail-closed as session.applyProfile. A caller
// bypassing the upstream resolver must not inject native G-code or unknown
// machine/filament options that the localhost diagnostic cannot audit.
{
  const init=makeRestrictedInitConfig(selected);
  assert.equal(init.nozzle_diameter,"0.4");
  assert.equal(init.printable_height,"250");
  assert.equal(init.nozzle_temperature,"220");
  assert.equal(init.filament_type,"PLA");
  assert.equal(init.layer_height,0.2,"generic process defaults remain diagnostic-only");
  const legacy=makeRestrictedInitConfig({...selected,filament:{settings:{
    nozzle_temperature:"220",bed_temperature:"55"
  }}});
  assert.equal(legacy.bed_temperature,"55",
    "legacy bounded scalar bed temperature is allowed without inferring a plate");
  assert.equal(legacy.curr_bed_type,undefined);
}
{
  const withBed={...selected,filament:{settings:{
    nozzle_temperature:"220",nozzle_temperature_initial_layer:["235"],
    filament_flow_ratio:["0.98"],filament_max_volumetric_speed:["21"],
    curr_bed_type:"High Temp Plate",bed_temperature:"65",
    hot_plate_temp:["65"],hot_plate_temp_initial_layer:["75"],
  }}};
  const init=makeRestrictedInitConfig(withBed);
  assert.deepEqual(init.filament_max_volumetric_speed,["21"]);
  assert.deepEqual(init.nozzle_temperature_initial_layer,["235"]);
  assert.equal(init.curr_bed_type,"High Temp Plate");
  assert.deepEqual(init.hot_plate_temp_initial_layer,["75"]);
}
const invalidCollections=[
  {...selected,machine:{settings:{...selected.machine.settings,
    machine_start_gcode:"M104 S290"}}},
  {...selected,filament:{settings:{...selected.filament.settings,
    filament_start_gcode:"M109 S290"}}},
  {...selected,machine:{settings:{nozzle_diameter:["0.4","0.6"],printable_height:"250"}}},
  {...selected,filament:{settings:{nozzle_temperature:["210","240"]}}},
  {...selected,filament:{settings:{nozzle_temperature:"220",filament_type:"PETG"}}},
  {...selected,filament:{settings:{nozzle_temperature:"220",filament_type:["PLA"]}}},
  {...selected,filament:{settings:{nozzle_temperature:"220",hot_plate_temp:["65"]}}},
  {...selected,filament:{settings:{nozzle_temperature:"220",
    curr_bed_type:"High Temp Plate",bed_temperature:"65",hot_plate_temp:["55"]}}},
  {...selected,filament:{settings:{nozzle_temperature:"220",
    curr_bed_type:"Textured PEI Plate",bed_temperature:"55",
    hot_plate_temp:["55"]}}},
  {...selected,filament:{settings:JSON.parse(
    '{"nozzle_temperature":"220","__proto__":{"machine_start_gcode":"M104 S290"}}')}},
  {...selected,machine:{settings:{nozzle_diameter:"0.4"}}},
];
for(const bad of invalidCollections){
  assert.throws(()=>makeRestrictedInitConfig(bad),
    /Unsupported|Expected|Invalid|requires|outside|disagree|vector|Only PLA/,
    "Unvetted restricted session.init settings must not pass validation");
  const {engine,calls}=mockedEngine();
  await assert.rejects(
    ()=>sliceMultiStlWithEngine(engine,items,null,null,bad),
    /Unsupported|Expected|Invalid|requires|outside|disagree|vector|Only PLA/);
  assert.equal(calls.length,0,
    "Invalid machine/filament configuration must be refused before createSession");
}
console.log("PASS: only bounded single-tool machine/filament settings reach native session.init");

console.log("PASS: selected restricted Orca process auto-applied once, bounded override precedence and early failure");
