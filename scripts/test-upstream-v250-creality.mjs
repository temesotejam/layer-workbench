// Assert actual pinned v2.5.0 Creality machine/process inheritance.
// Source files are downloaded by CI and remain on that runner.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {extractVendorProfileRecords} from "./orca-vendor-index.mjs";
import {resolveOrcaProfileFamily,resolveOrcaProfileCollection} from "./orca-profile-collection.mjs";

const fixture=JSON.parse(readFileSync("upstream-v250-creality-fixture.json","utf8"));
assert.equal(fixture.upstream_commit,"40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19");
assert.equal(fixture.vendor_index.name,"Creality");
const indexed=extractVendorProfileRecords(fixture.vendor_index,fixture.files);
assert.equal(indexed.records.length,6);
const machine=resolveOrcaProfileFamily(indexed.records,"machine","Creality CR-10 0.4 nozzle");
const process=resolveOrcaProfileFamily(indexed.records,"process","0.20mm Standard @Creality CR-10 0.4 nozzle");
assert.deepEqual(machine.chain,["fdm_machine_common","fdm_creality_common","Creality CR-10 0.4 nozzle"]);
assert.deepEqual(process.chain,["fdm_process_common","fdm_process_creality_common","0.20mm Standard @Creality CR-10 0.4 nozzle"]);
assert.equal(machine.settings.nozzle_diameter,"0.4");
assert.equal(machine.settings.printable_height,"400");
assert.equal(process.settings.layer_height,"0.2");
assert.equal(process.settings.wall_loops,"2");
assert.equal(process.settings.line_width,"0.42",
  "Official v2.5.0 CR-10 0.20mm process must provide absolute line width");
assert.ok(!process.unsupported.includes("line_width"),
  "Source-pinned absolute line width must be included in restricted process settings");
assert.equal(indexed.records.find(p=>p.name==="fdm_process_common").initial_layer_line_width,"0.42",
  "Pinned base process first layer width is 0.42mm");
assert.equal(indexed.records.find(p=>p.name==="fdm_process_creality_common").initial_layer_line_width,"0.5",
  "Creality process ancestor overrides first layer width to 0.5mm");
assert.equal(process.settings.initial_layer_line_width,"0.5",
  "CR-10 0.20mm Standard must retain independent first-layer width");
assert.ok(!process.unsupported.includes("initial_layer_line_width"),
  "Initial-layer width must be forwarded as an explicit native setting");
assert.equal(indexed.records.find(p=>p.name==="fdm_process_common").outer_wall_line_width,"0.4",
  "Official v2.5.0 common profile must contain native outer-wall width");
assert.equal(process.settings.outer_wall_line_width,"0.42",
  "Official v2.5.0 CR-10 0.20mm child must override outer-wall width independently");
assert.ok(!process.unsupported.includes("outer_wall_line_width"),
  "Supported native outer-wall width must not be classified as ignored");
assert.equal(indexed.records.find(p=>p.name==="fdm_process_common").inner_wall_line_width,"0.45",
  "Official v2.5.0 common process defines native inner-wall width");
assert.equal(indexed.records.find(p=>p.name==="fdm_process_creality_common").inner_wall_line_width,"0.45",
  "Creality common process must preserve the independently inherited inner-wall width");
assert.equal(process.settings.inner_wall_line_width,"0.45",
  "Official v2.5.0 CR-10 0.20mm preset specifies 0.45 mm inner walls");
assert.ok(!process.unsupported.includes("inner_wall_line_width"),
  "Inner-wall line width must be forwarded as native setting");
assert.equal(indexed.records.find(p=>p.name==="fdm_process_common").sparse_infill_line_width,"0.45",
  "Pinned common process must declare independent sparse-infill width");
assert.equal(indexed.records.find(p=>p.name==="fdm_process_creality_common").sparse_infill_line_width,"0.45",
  "Pinned Creality common process must carry sparse-infill width");
assert.equal(process.settings.sparse_infill_line_width,"0.45",
  "Official CR-10 0.20mm preset independently uses 0.45 mm sparse infill");
assert.ok(!process.unsupported.includes("sparse_infill_line_width"),
  "Native sparse-infill width must not be silently dropped");
assert.equal(indexed.records.find(p=>p.name==="fdm_process_common").top_surface_line_width,"0.4");
assert.equal(indexed.records.find(p=>p.name==="fdm_process_creality_common").top_surface_line_width,"0.4");
assert.equal(process.settings.top_surface_line_width,"0.42",
  "Pinned CR-10 0.20mm child must override top-surface width to 0.42 mm");
assert.ok(!process.unsupported.includes("top_surface_line_width"));
assert.equal(indexed.records.find(p=>p.name==="fdm_process_common").internal_solid_infill_line_width,"0.45",
  "Source-pinned common process has 0.45mm internal solid infill");
assert.equal(indexed.records.find(p=>p.name==="fdm_process_creality_common").internal_solid_infill_line_width,"0.4",
  "Creality ancestor overrides the internal solid width to 0.4mm");
assert.equal(process.settings.internal_solid_infill_line_width,"0.45",
  "Pinned CR-10 0.20mm child restores independent internal solid width 0.45mm");
assert.ok(!process.unsupported.includes("internal_solid_infill_line_width"),
  "Internal solid infill width must reach the restricted WASM process adapter");
assert.equal(indexed.records.find(p=>p.name==="fdm_process_common").sparse_infill_pattern,"crosshatch",
  "Source-pinned Creality ancestor must define exact native crosshatch token");
assert.equal(process.settings.sparse_infill_pattern,"grid",
  "CR-10 0.20mm child must override inherited crosshatch with grid");
assert.ok(!process.unsupported.includes("sparse_infill_pattern"),
  "Resolved native pattern must be forwarded rather than silently dropped");

assert.equal(indexed.records.find(p=>p.name==="fdm_process_common").initial_layer_speed,"20",
  "Pinned common process first-layer perimeter speed is 20mm/s");
assert.equal(indexed.records.find(p=>p.name==="fdm_process_creality_common").initial_layer_speed,"15",
  "Creality common overrides first-layer perimeter speed to 15mm/s");
assert.equal(process.settings.initial_layer_speed,"15",
  "Pinned CR-10 standard preset inherits 15mm/s first-layer perimeter speed");
assert.ok(!process.unsupported.includes("initial_layer_speed"),
  "First-layer speed must reach the restricted process adapter");
// The pinned base common process has no explicit first-layer infill value;
// Creality common and CR-10 Standard both explicitly specify 20 mm/s.
assert.ok(!Object.hasOwn(indexed.records.find(p=>p.name==="fdm_process_common"),
  "initial_layer_infill_speed"),"Pinned base must not imply first-layer infill speed");
assert.equal(indexed.records.find(p=>p.name==="fdm_process_creality_common")
  .initial_layer_infill_speed,"20","Creality common first-layer infill speed");
assert.equal(indexed.records.find(p=>p.name==="0.20mm Standard @Creality CR-10 0.4 nozzle")
  .initial_layer_infill_speed,"20","CR-10 Standard first-layer infill speed");
assert.equal(process.settings.initial_layer_infill_speed,"20",
  "Pinned CR-10 first-layer infill must be independent of perimeter speed 15");
assert.ok(!process.unsupported.includes("initial_layer_infill_speed"),
  "Pinned first-layer infill speed must reach the restricted process adapter");

 // Exact native v2.5.0 CR-10 0.20mm settings from the pinned upstream
 // child/ancestor chain. These are independent absolute mm/s speeds,
 // never percent relative presets or replacements for shell/inner speeds.
for(const [key,speed] of Object.entries({
  sparse_infill_speed:"50",
  internal_solid_infill_speed:"50",
  top_surface_speed:"30",
  gap_infill_speed:"30",
  bridge_speed:"50",
})){
  assert.equal(process.settings[key],speed,"pinned Creality process "+key);
  assert.ok(!process.unsupported.includes(key),"supported speed must not appear as unsupported: "+key);
}

// Pinned Orca v2.5.0 ships child overrides: 5 top and 4 bottom solid layers.
// These are tested native process keys, not inferred desktop GUI defaults.
assert.equal(process.settings.top_shell_layers,"5");
assert.equal(process.settings.bottom_shell_layers,"4");
assert.ok(!process.unsupported.includes("top_shell_layers"));
assert.ok(!process.unsupported.includes("bottom_shell_layers"));
assert.equal(process.settings.sparse_infill_density,"15");
assert.ok(process.compatible.includes("Creality CR-10 0.4 nozzle"));
assert.ok(machine.unsupported.length>10);
assert.ok(process.unsupported.length>10);
// Resolve one actual printer/process and the actual upstream Generic PLA
// library across TWO distinct vendor indexes. It is valid for a simple
// compatibility audit, not proof that all unsupported fields were applied.
const filamentFixture=JSON.parse(readFileSync("upstream-v250-filament-fixture.json","utf8"));
const filamentIndexed=extractVendorProfileRecords(filamentFixture.vendor_index,filamentFixture.files);
const combined=resolveOrcaProfileCollection(
  [...indexed.records,...filamentIndexed.records],
  {
    machine:"Creality CR-10 0.4 nozzle",
    filament:"Generic PLA @System",
    process:"0.20mm Standard @Creality CR-10 0.4 nozzle",
  },
);
assert.equal(combined.machine.settings.nozzle_diameter,"0.4");
assert.equal(combined.filament.settings.nozzle_temperature,"220");
assert.equal(combined.process.settings.sparse_infill_density,"15");
assert.equal(combined.process.compatible.length,1);
assert.equal(combined.process.compatible[0],combined.machine.name);
console.log("PASS: combined actual CR-10 printer + generic PLA + 0.20mm process compatibility");
console.log("PASS: actual pinned CR-10 machine inheritance and 0.20mm process profile");
console.log("Real machine supported keys:",JSON.stringify(machine.settings));
console.log("Real process supported keys:",JSON.stringify(process.settings));
console.log("Unsupported real machine/process keys:",machine.unsupported.length,process.unsupported.length);
