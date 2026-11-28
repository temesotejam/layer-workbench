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
// Source-pinned root-cause witness for the native-only Z=0.28 mm
// deposition plane. The original full machine startup script stays CI-only;
// never forward or execute it in the restricted browser profile adapter.
const pinnedCr10Start=indexed.records.find(
  p=>p.name==="Creality CR-10 0.4 nozzle").machine_start_gcode;
assert.equal(typeof pinnedCr10Start,"string");
const startupCommands=pinnedCr10Start.split(/\r?\n/).map(
  line=>line.split(";")[0].trim());
for(const command of [
  "G1 X10.1 Y20 Z0.28 F5000.0",
  "G1 X10.1 Y145.0 Z0.28 F1500.0 E15",
  "G1 X10.4 Y145.0 Z0.28 F5000.0",
  "G1 X10.4 Y20 Z0.28 F1500.0 E30",
]){
  assert.ok(startupCommands.includes(command),
    "Pinned official CR-10 priming move missing: "+command);
}
assert.ok(machine.unsupported.includes("machine_start_gcode"),
  "Executable start G-code must remain excluded from restricted WASM forwarding");
console.log("PASS: pinned native CR-10 Z=0.28 prime lines explained; browser startup G-code excluded");
assert.equal(machine.settings.nozzle_diameter,"0.4");
assert.equal(machine.settings.printable_height,"400");
assert.equal(process.settings.layer_height,"0.2");
// Official v2.5.0 CR-10 0.20mm child chooses the most extensive vertical
// shell infill mode. Without this setting solid/bridge area parity is not
// a controlled comparison, even if layer counts and thickness are equal.
const verticalModeChain=process.chain.map(name=>
  indexed.records.find(p=>p.name===name).ensure_vertical_shell_thickness);
assert.deepEqual(verticalModeChain,[undefined,undefined,"ensure_all"]);
assert.equal(process.settings.ensure_vertical_shell_thickness,"ensure_all");
// Real pinned v2.5.0 preset chain: top skin monotonicline -> monotonic,
// bottom monotonic in all three ancestors. Do not map either to internal solid.
assert.deepEqual(process.chain.map(n=>indexed.records.find(p=>p.name===n).top_surface_pattern),
  [undefined,"monotonicline","monotonic"]);
assert.deepEqual(process.chain.map(n=>indexed.records.find(p=>p.name===n).bottom_surface_pattern),
  [undefined,"monotonic","monotonic"]);
assert.equal(process.settings.top_surface_pattern,"monotonic");
assert.equal(process.settings.bottom_surface_pattern,"monotonic");
assert.ok(!process.unsupported.includes("top_surface_pattern"));
assert.ok(!process.unsupported.includes("bottom_surface_pattern"));
console.log("PASS: official CR-10 independent top/bottom skin pattern inheritance");
assert.ok(!process.unsupported.includes("ensure_vertical_shell_thickness"));
console.log("PASS: pinned CR-10 vertical shell mode ensure_all resolved independently");
assert.equal(process.settings.wall_loops,"2");
assert.equal(indexed.records.find(p=>p.name==="fdm_process_creality_common").skirt_loops,"1",
  "Pinned Creality ancestor skirt count");
assert.equal(indexed.records.find(p=>p.name==="0.20mm Standard @Creality CR-10 0.4 nozzle").skirt_loops,"2",
  "Pinned CR-10 child overrides skirt count");
assert.equal(process.settings.skirt_loops,"2",
  "Official inherited skirt loops must reach bounded WASM adapter");
assert.ok(!process.unsupported.includes("skirt_loops"));
assert.equal(indexed.records.find(p=>p.name==="fdm_process_creality_common").skirt_distance,"2",
  "Pinned Creality common skirt distance in mm");
assert.equal(indexed.records.find(p=>p.name==="0.20mm Standard @Creality CR-10 0.4 nozzle").skirt_distance,"2",
  "Pinned CR-10 child skirt distance in mm");
assert.equal(process.settings.skirt_distance,"2",
  "Official skirt_distance must reach bounded WASM adapter");
assert.ok(!process.unsupported.includes("skirt_distance"));
assert.deepEqual(process.chain.map(name=>indexed.records.find(p=>p.name===name).skirt_height),
  ["2","1","2"],"Pinned CR-10 skirt layer height inheritance");
assert.equal(process.settings.skirt_height,"2","Official skirt_height reaches restricted WASM bridge");
assert.ok(!process.unsupported.includes("skirt_height"));
assert.equal(indexed.records.find(p=>p.name==="0.20mm Standard @Creality CR-10 0.4 nozzle").skirt_speed,"20",
  "Pinned CR-10 child specifies an independent 20 mm/s skirt speed");
assert.equal(process.settings.skirt_speed,"20",
  "Official absolute skirt_speed must reach the restricted WASM test adapter");
assert.ok(!process.unsupported.includes("skirt_speed"));
assert.deepEqual(process.chain.map(name=>indexed.records.find(p=>p.name===name).infill_direction),
  ["45","45","45"],"Pinned native v2.5.0 CR-10 infill angle across process inheritance");
assert.equal(process.settings.infill_direction,"45",
  "Official infill_direction must reach the isolated WASM process adapter in degrees");
assert.ok(!process.unsupported.includes("infill_direction"));
// Directly pin native 0.20mm child bridge extrusion multiplier, not a speed.
assert.equal(indexed.records.find(p=>p.name==="0.20mm Standard @Creality CR-10 0.4 nozzle").bridge_flow,"0.95");
assert.equal(process.settings.bridge_flow,"0.95");
assert.ok(!process.unsupported.includes("bridge_flow"));
// Confirm the native child (not a guessed generic default) independently sets
// internal bridge flow to 1; bridge_flow in that same child remains 0.95.
const internalFlowChain=process.chain.map(name=>
  indexed.records.find(p=>p.name===name).internal_bridge_flow);
assert.deepEqual(internalFlowChain,[undefined,undefined,"1"]);
assert.equal(process.settings.internal_bridge_flow,"1");
assert.notEqual(process.settings.internal_bridge_flow,process.settings.bridge_flow);
assert.ok(!process.unsupported.includes("internal_bridge_flow"));
console.log("PASS: pinned v2.5.0 CR-10 internal-bridge flow is separate from external bridge flow");
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
// Source-pinned 0.20mm CR-10 child explicitly chooses monotonic for the
// INTERNAL SOLID area. Do not alias its setting to sparse or top surfaces.
const cr10Child=indexed.records.find(p=>p.name==="0.20mm Standard @Creality CR-10 0.4 nozzle");
assert.equal(cr10Child.internal_solid_infill_pattern,"monotonic");
assert.equal(process.settings.internal_solid_infill_pattern,"monotonic");
assert.equal(process.settings.sparse_infill_pattern,"grid");
assert.ok(!process.unsupported.includes("internal_solid_infill_pattern"));

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

// Genuine pinned Creality v2.5.0 child also carries minimum shell thickness
// in mm; zero disables the bottom thickness floor, not bottom shell layers.
const pinnedShellChain=process.chain.map(name=>indexed.records.find(p=>p.name===name));
assert.deepEqual(pinnedShellChain.map(p=>p.top_shell_thickness),
  [undefined,'0.8','0.8']);
assert.deepEqual(pinnedShellChain.map(p=>p.bottom_shell_thickness),
  [undefined,'0','0']);
assert.equal(process.settings.top_shell_thickness,'0.8');
assert.equal(process.settings.bottom_shell_thickness,'0');
assert.ok(!process.unsupported.includes('top_shell_thickness'));
assert.ok(!process.unsupported.includes('bottom_shell_thickness'));
console.log('PASS: real source-pinned top 0.8 mm and disabled bottom 0 mm thickness forwarded independently');

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

// Real pinned chain, not a synthetic test fixture: support is disabled and
// the three absolute support keys are only forwarded, not toolpath-verified.
for(const [key,expected] of Object.entries({
  support_line_width:['0.42','0.4','0.42'],
  support_speed:['40','150','30'],
  support_interface_speed:['80','80','30'],
})){
  assert.deepEqual(process.chain.map(name=>indexed.records.find(p=>p.name===name)[key]),
    expected,'Pinned official chain '+key);
  assert.equal(process.settings[key],expected[2]);
  assert.ok(!process.unsupported.includes(key));
}
assert.equal(process.record.enable_support,'0');
assert.equal(process.record.initial_layer_travel_speed,'50%');
assert.equal(process.settings.initial_layer_travel_speed,'50%',
  'Official CR-10 relative first-layer travel must remain 50% of travel_speed');
assert.ok(!process.unsupported.includes('initial_layer_travel_speed'),
  'Pinned relative first-layer travel now reaches bounded WASM adapter as a percent token');
console.log('PASS: pinned CR-10 support settings forwarded; support disabled and relative travel excluded');

 // The pinned source declares coPercent relative to inner_wall_line_width.
 // Native inheritance must preserve the exact child percent, not absolute mm.
assert.deepEqual(process.chain.map(name=>indexed.records.find(p=>p.name===name).infill_wall_overlap),
  ["25%","23%","30%"]);
assert.equal(process.settings.infill_wall_overlap,"30%");
assert.equal(combined.process.settings.infill_wall_overlap,"30%");
assert.ok(!process.unsupported.includes("infill_wall_overlap"));
console.log("PASS: actual pinned CR-10 infill/wall overlap 25% -> 23% -> 30%");

assert.equal(indexed.records.find(p=>p.name==="0.20mm Standard @Creality CR-10 0.4 nozzle").minimum_sparse_infill_area,"10");
assert.equal(process.settings.minimum_sparse_infill_area,"10");
assert.equal(combined.process.settings.minimum_sparse_infill_area,"10");
assert.ok(!process.unsupported.includes("minimum_sparse_infill_area"));
console.log("PASS: pinned CR-10 minimum sparse-infill threshold 10 square mm");

for(const [key,expected] of [["infill_anchor","400%"],["infill_anchor_max","20"]]){
  assert.equal(process.record[key],expected);
  assert.equal(process.settings[key],expected);
  assert.equal(combined.process.settings[key],expected);
  assert.ok(!process.unsupported.includes(key));
}
console.log("PASS: pinned CR-10 anchor length 400% and maximum 20 mm independently forwarded");

assert.equal(process.record.infill_combination,"0");
assert.equal(process.settings.infill_combination,"0");
assert.equal(combined.process.settings.infill_combination,"0");
assert.ok(!process.unsupported.includes("infill_combination"));
console.log("PASS: actual pinned CR-10 explicitly disables sparse infill combination");

// None of the three pinned CR-10 process records explicitly sets the cap.
// Do not manufacture the native 100% default in the collection adapter.
const combinationCapKey="infill_combination_max_layer_height";
assert.deepEqual(process.chain.map(n=>indexed.records.find(p=>p.name===n)[combinationCapKey]),
  [undefined,undefined,undefined]);
assert.equal(process.settings[combinationCapKey],undefined);
assert.equal(combined.process.settings[combinationCapKey],undefined);
console.log("PASS: pinned CR-10 missing combination cap remains unset");

const bottomFlowKey="bottom_solid_infill_flow_ratio";
assert.deepEqual(process.chain.map(n=>indexed.records.find(p=>p.name===n)[bottomFlowKey]),
  [undefined,undefined,"1"]);
assert.equal(process.settings[bottomFlowKey],"1");
assert.equal(combined.process.settings[bottomFlowKey],"1");
assert.ok(!process.unsupported.includes(bottomFlowKey));
const topFlowKey="top_solid_infill_flow_ratio";
assert.deepEqual(process.chain.map(n=>indexed.records.find(p=>p.name===n)[topFlowKey]),
  [undefined,undefined,"1"]);
assert.deepEqual(process.settings[topFlowKey],["1"]);
assert.deepEqual(combined.process.settings[topFlowKey],["1"]);
assert.ok(!process.unsupported.includes(topFlowKey));
console.log("PASS: official CR-10 bottom scalar and one-slot top nozzle vector remain independent");

// Pinned CR-10 opts into classic thin-wall detection; keep exact bool.
assert.deepEqual(process.chain.map(n=>indexed.records.find(p=>p.name===n).detect_thin_wall),["0","0","1"]);
assert.equal(process.settings.wall_generator,"classic");
assert.equal(process.settings.detect_thin_wall,"1");
assert.ok(!process.unsupported.includes("detect_thin_wall"));
console.log("PASS: pinned CR-10 classic thin-wall detection child override");

assert.equal(cr10Child.wall_sequence,"inner wall/outer wall");
assert.equal(process.settings.wall_sequence,"inner wall/outer wall");
assert.ok(!process.unsupported.includes("wall_sequence"));
console.log("PASS: pinned CR-10 explicit inner/outer wall sequence");

for(const [key,value] of Object.entries({only_one_wall_top:"1",only_one_wall_first_layer:"0"})){
  assert.equal(cr10Child[key],value);
  assert.equal(process.settings[key],value);
  assert.ok(!process.unsupported.includes(key));
}
console.log("PASS: pinned CR-10 top single wall on, first-layer single wall off");

assert.deepEqual(process.chain.map(n=>indexed.records.find(p=>p.name===n).seam_position),
  ["nearest","aligned","aligned"],"Pinned v2.5.0 CR-10 seam position inheritance");
assert.equal(process.settings.seam_position,"aligned");
assert.ok(!process.unsupported.includes("seam_position"));
console.log("PASS: pinned CR-10 seam position reaches restricted process adapter");

for(const [key,chainValues] of Object.entries({
  retraction_length:[["5"],["5"],"0.8"],
  retraction_speed:[["60"],["60"],"40"],
  deretraction_speed:[["40"],["40"],"40"],
  retraction_minimum_travel:[["2"],["2"],"1"],
  z_hop:[["0"],["0.4"],"0.4"],
})){
  assert.deepEqual(machine.chain.map(n=>indexed.records.find(p=>p.name===n)[key]),chainValues);
  assert.deepEqual(machine.settings[key],[chainValues.at(-1)]);
  assert.deepEqual(combined.machine.settings[key],[chainValues.at(-1)]);
  assert.ok(!machine.unsupported.includes(key));
}
console.log("PASS: pinned CR-10 machine retraction length and independent speeds reach restricted collection");

assert.deepEqual(machine.chain.map(n=>indexed.records.find(p=>p.name===n).z_hop_types),
  ["Normal Lift",undefined,"Auto Lift"]);
assert.deepEqual(machine.chain.map(n=>indexed.records.find(p=>p.name===n).travel_slope),
  [undefined,undefined,"3"]);
for(const [key,value] of Object.entries({z_hop_types:["Auto Lift"],travel_slope:["3"]})){
  assert.deepEqual(machine.settings[key],value);
  assert.deepEqual(combined.machine.settings[key],value);
  assert.ok(!machine.unsupported.includes(key));
}
console.log("PASS: pinned CR-10 Auto Lift and 3 degree traveling angle reach restricted collection");

for(const key of ["retract_lift_above","retract_lift_below"]){
  assert.deepEqual(machine.chain.map(n=>indexed.records.find(p=>p.name===n)[key]),
    [undefined,undefined,"0"]);
  assert.deepEqual(machine.settings[key],["0"]);
  assert.deepEqual(combined.machine.settings[key],["0"]);
  assert.ok(!machine.unsupported.includes(key));
}
console.log("PASS: pinned CR-10 explicit zero Z-hop height gates reach restricted collection");

assert.deepEqual(process.chain.map(n=>indexed.records.find(p=>p.name===n).enable_arc_fitting),
  [undefined,"0","0"]);
assert.equal(process.settings.enable_arc_fitting,"disabled");
assert.equal(combined.process.settings.enable_arc_fitting,"disabled");
assert.ok(!process.unsupported.includes("enable_arc_fitting"));
console.log("PASS: pinned CR-10 legacy arc-fitting 0 normalized to canonical disabled");

for(const [key,chainValues] of Object.entries({
  wipe:[["1"],["1"],"1"],
  wipe_distance:[undefined,undefined,"2"],
  retract_before_wipe:[["70%"],["70%"],"70%"],
})){
  assert.deepEqual(machine.chain.map(n=>indexed.records.find(p=>p.name===n)[key]),chainValues);
  assert.deepEqual(machine.settings[key],[chainValues.at(-1)]);
  assert.deepEqual(combined.machine.settings[key],[chainValues.at(-1)]);
  assert.ok(!machine.unsupported.includes(key));
}
console.log("PASS: pinned CR-10 explicit wipe toggle, distance and retract-before-wipe percent");

// The pinned chain omits the option: preserve absence rather than inject a default.
assert.deepEqual(machine.chain.map(n=>indexed.records.find(p=>p.name===n).retract_after_wipe),[undefined,undefined,undefined]);
assert.equal(machine.settings.retract_after_wipe,undefined);
assert.equal(combined.machine.settings.retract_after_wipe,undefined);
console.log("PASS: pinned CR-10 omits retract_after_wipe; native default is not fabricated");
