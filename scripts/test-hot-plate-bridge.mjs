// Explicit hot-plate selection must reach actual one-slicer-api session.init,
// not merely be displayed in the localhost UI. A fake engine isolates JSON
// forwarding; this is NOT an actual slicer/print safety or parity test.
import assert from "node:assert/strict";
import {resolveOrcaProfileCollection} from "./orca-profile-collection.mjs";
import {sliceMultiStlWithEngine,GENERIC_PLA_TEST_CONFIG} from "./slice-stl.mjs";

const records=[
  {name:"TestPrinter",type:"machine",nozzle_diameter:["0.4"],printable_height:"250"},
  {name:"PLA Base",type:"filament",nozzle_temperature:["220"],nozzle_temperature_initial_layer:["235"],filament_flow_ratio:["0.98"],hot_plate_temp:["65"],hot_plate_temp_initial_layer:["75"],
    filament_extruder_variant:["Direct Drive Standard","Direct Drive High Flow"],
    filament_max_volumetric_speed:["12","21"]},
  {name:"PLA Selected",type:"filament",inherits:"PLA Base"},
  {name:"Standard",type:"process",layer_height:"0.2",wall_loops:"2",sparse_infill_density:"15%"},
];
const selection={machine:"TestPrinter",filament:"PLA Selected",process:"Standard"};
async function run(plateType,filamentVariant) {
  let config=null,disposed=false;
  const fakeEngine={createSession:async()=>({
    init:async bytes=>{config=JSON.parse(new TextDecoder().decode(bytes));},
    setObjects:async()=>{},
    slice:async()=>({schemaVersion:"0.7.0",plateResults:[{
      plateId:"plate-0",assets:[{kind:"gcode",id:"fixture"}],
    }]}),
    getAsset:async()=>new TextEncoder().encode("G1 X0 Y0\n".repeat(30)),
    dispose:async()=>{disposed=true;},
  })};
  const resolved=resolveOrcaProfileCollection(records,selection,{plateType,filamentVariant});
  await sliceMultiStlWithEngine(fakeEngine,[{bytes:new Uint8Array(134)}],null,null,resolved);
  assert.ok(disposed,"Slicer session must be disposed");
  return {config,resolved};
}
const implicit=await run(undefined);
assert.equal(implicit.config.bed_temperature,GENERIC_PLA_TEST_CONFIG.bed_temperature);
assert.equal(implicit.resolved.filament.selectedBed,null);
const explicit=await run("hot","Direct Drive High Flow");
assert.equal(explicit.config.bed_temperature,"65");
assert.equal(explicit.config.nozzle_temperature,"220");
assert.deepEqual(explicit.config.nozzle_temperature_initial_layer,["235"]);
assert.deepEqual(implicit.config.nozzle_temperature_initial_layer,["235"]);
assert.deepEqual(implicit.config.filament_flow_ratio,["0.98"]);
assert.deepEqual(explicit.config.filament_flow_ratio,["0.98"]);
assert.ok(!implicit.resolved.filament.unsupported.includes("filament_flow_ratio"));
assert.equal(explicit.resolved.filament.selectedBed.source,"PLA Base");
assert.equal(explicit.resolved.filament.selectedBed.initialLayerSource,"PLA Base");
assert.equal(explicit.resolved.filament.selectedBed.initialLayerTemperature,"75");
assert.deepEqual(explicit.config.hot_plate_temp_initial_layer,["75"]);
assert.deepEqual(explicit.config.hot_plate_temp,["65"]);
assert.equal(explicit.config.curr_bed_type,"High Temp Plate");
assert.deepEqual(explicit.config.filament_max_volumetric_speed,["21"]);
assert.equal(implicit.config.filament_max_volumetric_speed,undefined);
assert.ok(implicit.resolved.filament.unsupported.includes("filament_max_volumetric_speed"));
assert.equal(implicit.config.curr_bed_type,undefined);
assert.equal(implicit.config.hot_plate_temp_initial_layer,undefined);
assert.ok(!explicit.resolved.filament.unsupported.includes("hot_plate_temp_initial_layer"));
console.log("PASS: explicitly selected volumetric flow cap forwarded into session.init; implicit multi-limit excluded");
console.log("PASS: native inherited first-layer nozzle and flow-ratio vectors reach actual session.init payload");
console.log("PASS: native first-layer hot_plate_temp_initial_layer vector and steady hot bed reach session.init only after opt-in");
// The actual session.init payload must retain the selected native enum and
// per-filament vector for a non-hot plate; this uses a fake engine only.
const texturedRecords=records.map(p=>p.name==="PLA Base"
  ? {...p,textured_plate_temp:["55"],textured_plate_temp_initial_layer:["60"]}:p);
const texturedResolved=resolveOrcaProfileCollection(texturedRecords,selection,{plateType:"textured"});
let texturedInit=null;
await sliceMultiStlWithEngine({createSession:async()=>({
  init:async bytes=>{texturedInit=JSON.parse(new TextDecoder().decode(bytes));},
  setObjects:async()=>{},slice:async()=>({schemaVersion:"0.7.0",plateResults:[{plateId:"plate-0",assets:[{kind:"gcode",id:"fixture"}]}]}),
  getAsset:async()=>new TextEncoder().encode("G1 X1 Y1 E1\n".repeat(30)),
  dispose:async()=>{}
})},[{bytes:new Uint8Array(134)}],null,null,texturedResolved);
assert.equal(texturedInit.curr_bed_type,"Textured PEI Plate");
assert.equal(texturedInit.bed_temperature,"55");
assert.deepEqual(texturedInit.textured_plate_temp,["55"]);
assert.deepEqual(texturedInit.textured_plate_temp_initial_layer,["60"]);
assert.equal(texturedInit.hot_plate_temp,undefined);
console.log("PASS: opt-in textured plate native enum and first/other-layer vectors reach session.init");

// Local-only source-resolved process speeds must pass the *second* override
// allow-list and reach session.applyProfile, not merely resolve as JSON.
// This fake engine tests the bridge payload, NOT actual sliced G-code speeds.
const speedSettings = {
  sparse_infill_speed:"50", internal_solid_infill_speed:"50",
  top_surface_speed:"30", gap_infill_speed:"30", bridge_speed:"50",
  // Exact native mode selection is opt-in and independent of the numeric speeds.
  wall_generator:"classic", gap_fill_target:"everywhere",
};
const speedRecords = records.map(p => p.name === "Standard"
  ? {...p, ...speedSettings} : p);
const speedCollection = resolveOrcaProfileCollection(speedRecords,selection);
let appliedProfile = null, speedSessionDisposed = false;
await sliceMultiStlWithEngine({createSession:async()=>({
  init:async()=>{},
  applyProfile:async(format,bytes)=>{
    appliedProfile={format,settings:JSON.parse(new TextDecoder().decode(bytes))};
  },
  setObjects:async()=>{},
  slice:async()=>({schemaVersion:"0.7.0",plateResults:[{
    plateId:"plate-0",assets:[{kind:"gcode",id:"fixture"}],
  }]}),
  getAsset:async()=>new TextEncoder().encode("G1 X1 Y1 E1\n".repeat(30)),
  dispose:async()=>{speedSessionDisposed=true;},
})},[{bytes:new Uint8Array(134)}],null,speedCollection.process.settings,speedCollection);
assert.ok(speedSessionDisposed,"Speed bridge session must be disposed");
assert.equal(appliedProfile?.format,"orca.native-json");
for(const [key,value] of Object.entries(speedSettings))
  assert.equal(appliedProfile.settings[key],value,
    key+" must reach session.applyProfile without being silently dropped");
console.log("PASS: four pinned process speeds and explicit classic/everywhere modes reach session.applyProfile in isolated mock bridge");

