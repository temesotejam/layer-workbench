// Explicit hot-plate selection must reach actual one-slicer-api session.init,
// not merely be displayed in the localhost UI. A fake engine isolates JSON
// forwarding; this is NOT an actual slicer/print safety or parity test.
import assert from "node:assert/strict";
import {resolveOrcaProfileCollection} from "./orca-profile-collection.mjs";
import {sliceMultiStlWithEngine,GENERIC_PLA_TEST_CONFIG} from "./slice-stl.mjs";

const records=[
  {name:"TestPrinter",type:"machine",nozzle_diameter:["0.4"],printable_height:"250"},
  {name:"PLA Base",type:"filament",nozzle_temperature:["220"],hot_plate_temp:["65"],hot_plate_temp_initial_layer:["75"]},
  {name:"PLA Selected",type:"filament",inherits:"PLA Base"},
  {name:"Standard",type:"process",layer_height:"0.2",wall_loops:"2",sparse_infill_density:"15%"},
];
const selection={machine:"TestPrinter",filament:"PLA Selected",process:"Standard"};
async function run(plateType) {
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
  const resolved=resolveOrcaProfileCollection(records,selection,plateType?{plateType}:{});
  await sliceMultiStlWithEngine(fakeEngine,[{bytes:new Uint8Array(134)}],null,null,resolved);
  assert.ok(disposed,"Slicer session must be disposed");
  return {config,resolved};
}
const implicit=await run(undefined);
assert.equal(implicit.config.bed_temperature,GENERIC_PLA_TEST_CONFIG.bed_temperature);
assert.equal(implicit.resolved.filament.selectedBed,null);
const explicit=await run("hot");
assert.equal(explicit.config.bed_temperature,"65");
assert.equal(explicit.config.nozzle_temperature,"220");
assert.equal(explicit.resolved.filament.selectedBed.source,"PLA Base");
assert.ok(explicit.resolved.filament.unsupported.includes("hot_plate_temp_initial_layer"));
console.log("PASS: explicit inherited hot plate temperature reaches session.init; default stays unchanged");
