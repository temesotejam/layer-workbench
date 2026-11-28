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
    filament_flow_ratio:["0.98"],filament_diameter:["1.75"],filament_max_volumetric_speed:["21"],
    curr_bed_type:"High Temp Plate",bed_temperature:"65",
    hot_plate_temp:["65"],hot_plate_temp_initial_layer:["75"],
  }}};
  const init=makeRestrictedInitConfig(withBed);
  assert.deepEqual(init.filament_max_volumetric_speed,["21"]);
  assert.deepEqual(init.filament_diameter,["1.75"]);
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
  {...selected,filament:{settings:{nozzle_temperature:"220",filament_diameter:["1.75","2.85"]}}},
  {...selected,filament:{settings:{nozzle_temperature:"220",filament_diameter:["0.99"]}}},
  {...selected,filament:{settings:{nozzle_temperature:"220",filament_diameter:["3.01"]}}},
  {...selected,filament:{settings:{nozzle_temperature:"220",filament_diameter:["oops"]}}},
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

// Fake transport verifies independent keys reach the native-json call.
// Not evidence that support geometry is generated by the engine.
{
  const preset={...selected,process:{settings:{
    ...selected.process.settings,support_line_width:'0.42',
    support_speed:'30',support_interface_speed:'25',
  }}};
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null,null,preset);
  const applied=calls.find(x=>x.name==='applyProfile');
  assert.equal(applied.format,'orca.native-json');
  for(const key of ['support_line_width','support_speed','support_interface_speed'])
    assert.equal(applied.value[key],preset.process.settings[key]);
}
console.log('PASS: support width/body/interface settings reach mocked native-json applyProfile');
// Verify that the separate internal-bridge ratio survives the final
// restricted process parser and reaches the native-json API transport.
{
  const preset={...selected,process:{settings:{
    ...selected.process.settings,bridge_flow:'0.95',internal_bridge_flow:'1'
  }}};
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null,null,preset);
  const applied=calls.find(c=>c.name==='applyProfile');
  assert.equal(applied.format,'orca.native-json');
  assert.equal(applied.value.bridge_flow,'0.95');
  assert.equal(applied.value.internal_bridge_flow,'1');
  assert.notEqual(applied.value.bridge_flow,applied.value.internal_bridge_flow);
}
console.log('PASS: independent internal bridge ratio reaches mocked native-json profile transport');

// Ensure the vertical-shell enum reaches the restricted engine API unchanged.
// A mocked transport proves forwarding, not slicer geometry equivalence.
{
  const preset={...selected,process:{settings:{
    ...selected.process.settings,ensure_vertical_shell_thickness:'ensure_all',
    top_shell_layers:'5',bottom_shell_layers:'4'
  }}};
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null,null,preset);
  const applied=calls.find(c=>c.name==='applyProfile');
  assert.equal(applied.format,'orca.native-json');
  assert.equal(applied.value.ensure_vertical_shell_thickness,'ensure_all');
  assert.equal(applied.value.top_shell_layers,'5');
  assert.equal(applied.value.bottom_shell_layers,'4');
}
console.log('PASS: exact v2.5.0 vertical shell enum reaches mocked native-json transport');

// Source-pinned v2.5.0 PrintConfig registers "enable_support" as its native
// boolean; "support_enable" in the OrcaWasm smoke is an unknown/ignored key.
// Check BOTH init and native-json transport against the real native key.
// The generic fallback must never enable supports.
{
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null,{enable_support:'1',support_speed:'30'});
  const init=calls.find(c=>c.name==='init').value;
  const applied=calls.find(c=>c.name==='applyProfile').value;
  assert.equal(init.enable_support,'1');
  assert.equal(init.support_type,'normal(auto)');
  assert.equal(init.support_threshold_angle,70);
  assert.equal(applied.support_speed,'30');
  assert.equal(applied.enable_support,'1');
  assert.equal(applied.support_type,'normal(auto)');
  assert.equal(applied.support_threshold_angle,70);
  assert.equal(Object.hasOwn(applied,'support_enable'),false);
  assert.equal(Object.hasOwn(init,'support_enable'),false);
}
{
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null,{enable_support:'0'});
  assert.equal(calls.find(c=>c.name==='init').value.enable_support,'0');
  assert.equal(calls.find(c=>c.name==='init').value.support_type,'normal(auto)');
  assert.equal(calls.find(c=>c.name==='init').value.support_threshold_angle,70);
  assert.deepEqual(calls.find(c=>c.name==='applyProfile').value,
    {enable_support:'0',support_type:'normal(auto)',support_threshold_angle:70},
    'A single support toggle also sets the pinned native support profile explicitly');
}
for (const bad of [true,1,2,'true','2',null,['1']]){
  const {engine,calls}=mockedEngine();
  await assert.rejects(()=>sliceMultiStlWithEngine(engine,items,null,
    {enable_support:bad}),/native enum/);
  assert.equal(calls.length,0,'Unverified support toggles must fail before createSession');
}
{
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null);
  assert.equal(Object.hasOwn(calls.find(c=>c.name==='init').value,'enable_support'),false);
  assert.equal(Object.hasOwn(calls.find(c=>c.name==='init').value,'support_enable'),false);
  assert.equal(Object.hasOwn(calls.find(c=>c.name==='init').value,'support_type'),false);
  assert.equal(Object.hasOwn(calls.find(c=>c.name==='init').value,'support_threshold_angle'),false);
}
console.log('PASS: explicit support toggle reaches both native init and native-json profile, while generic fallback stays disabled');

{
  const preset={...selected,process:{settings:{
    ...selected.process.settings,infill_wall_overlap:"30%",inner_wall_line_width:"0.45"
  }}};
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null,null,preset);
  const applied=calls.find(c=>c.name==="applyProfile");
  assert.equal(applied.format,"orca.native-json");
  assert.equal(applied.value.infill_wall_overlap,"30%");
  assert.equal(applied.value.inner_wall_line_width,"0.45");
}
for(const bad of [30,"30",["30%"],"101%"]){
  const {engine,calls}=mockedEngine();
  await assert.rejects(()=>sliceMultiStlWithEngine(engine,items,null,{infill_wall_overlap:bad}),
    /Invalid|safe test range/);
  assert.equal(calls.length,0);
}
console.log("PASS: overlap percent reaches mock native-json unchanged, invalid inputs refuse session");

{
  const preset={...selected,process:{settings:{
    ...selected.process.settings,minimum_sparse_infill_area:"10",sparse_infill_density:"15"
  }}};
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null,null,preset);
  const applied=calls.find(c=>c.name==="applyProfile");
  assert.equal(applied.format,"orca.native-json");
  assert.equal(applied.value.minimum_sparse_infill_area,"10");
  assert.equal(applied.value.sparse_infill_density,"15");
}
for(const bad of [-1,"10%",["10"],10001]){
  const {engine,calls}=mockedEngine();
  await assert.rejects(()=>sliceMultiStlWithEngine(engine,items,null,{minimum_sparse_infill_area:bad}),
    /Invalid|safe test range/);
  assert.equal(calls.length,0);
}

{
  const preset={...selected,process:{settings:{
    ...selected.process.settings,infill_anchor:"400%",infill_anchor_max:"20",sparse_infill_line_width:"0.45"
  }}};
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null,null,preset);
  const applied=calls.find(c=>c.name==="applyProfile");
  assert.equal(applied.format,"orca.native-json");
  assert.equal(applied.value.infill_anchor,"400%");
  assert.equal(applied.value.infill_anchor_max,"20");
  assert.equal(applied.value.sparse_infill_line_width,"0.45");
}
for(const key of ["infill_anchor","infill_anchor_max"]){
  for(const bad of [-1,"1001%",["20"],null]){
    const {engine,calls}=mockedEngine();
    await assert.rejects(()=>sliceMultiStlWithEngine(engine,items,null,{[key]:bad}),/Invalid|safe test range/);
    assert.equal(calls.length,0);
  }
}
console.log("PASS: both anchor lengths reach native-json unchanged; bad overrides refuse session");

for(const value of ["0","1"]){
  const preset={...selected,process:{settings:{
    ...selected.process.settings,infill_combination:value
  }}};
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null,null,preset);
  assert.equal(calls.find(c=>c.name==="applyProfile").format,"orca.native-json");
  assert.equal(calls.find(c=>c.name==="applyProfile").value.infill_combination,value);
}
for(const bad of [0,true,"2","true",["1"],null]){
  const {engine,calls}=mockedEngine();
  await assert.rejects(()=>sliceMultiStlWithEngine(engine,items,null,{infill_combination:bad}),/Unsupported native enum/);
  assert.equal(calls.length,0);
}
console.log("PASS: both serialized infill combination states reach native-json; invalid values refuse session");

const combinationCapKey="infill_combination_max_layer_height";
for(const value of ["0","50%","0.2","100%"]){
  const preset={...selected,process:{settings:{
    ...selected.process.settings,infill_combination:"1",[combinationCapKey]:value
  }}};
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null,null,preset);
  const applied=calls.find(c=>c.name==="applyProfile");
  assert.equal(applied.format,"orca.native-json");
  assert.equal(applied.value[combinationCapKey],value);
  assert.equal(applied.value.infill_combination,"1");
}
for(const bad of [-1,"101%",["50%"],null,true]){
  const {engine,calls}=mockedEngine();
  await assert.rejects(()=>sliceMultiStlWithEngine(engine,items,null,{[combinationCapKey]:bad}),/Invalid|safe test range/);
  assert.equal(calls.length,0);
}
console.log("PASS: native sparse combination cap transport preserves both units and sentinel");

const bottomFlowKey="bottom_solid_infill_flow_ratio";
for(const value of ["1","0.75"]){
  const preset={...selected,process:{settings:{...selected.process.settings,[bottomFlowKey]:value}}};
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null,null,preset);
  const applied=calls.find(c=>c.name==="applyProfile");
  assert.equal(applied.format,"orca.native-json");
  assert.equal(applied.value[bottomFlowKey],value);
  assert.equal(applied.value.top_solid_infill_flow_ratio,undefined);
}
for(const bad of [0,"75%",["1"],null,true]){
  const {engine,calls}=mockedEngine();
  await assert.rejects(()=>sliceMultiStlWithEngine(engine,items,null,{[bottomFlowKey]:bad}),/Invalid|safe test range/);
  assert.equal(calls.length,0);
}
console.log("PASS: bounded bottom surface flow reaches native-json, independent of top flow");

const topFlowKey="top_solid_infill_flow_ratio";
for(const value of ["0.75",["0.75"]]){
  const preset={...selected,process:{settings:{...selected.process.settings,[topFlowKey]:value,[bottomFlowKey]:"1"}}};
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null,null,preset);
  const applied=calls.find(c=>c.name==="applyProfile");
  assert.equal(applied.format,"orca.native-json");
  assert.deepEqual(applied.value[topFlowKey],["0.75"]);
  assert.equal(applied.value[bottomFlowKey],"1");
}
for(const bad of [0,"75%",["1","0.75"],null,["nil"],[null],true]){
  const {engine,calls}=mockedEngine();
  await assert.rejects(()=>sliceMultiStlWithEngine(engine,items,null,{[topFlowKey]:bad}),/Invalid|safe test range/);
  assert.equal(calls.length,0);
}
console.log("PASS: one-slot native top flow transport preserves separate bottom scalar");

// Thin-wall forwarding is not proof of thin-wall geometry generation.
{
  const preset={...selected,process:{settings:{...selected.process.settings,
    wall_generator:"classic",detect_thin_wall:"1"}}};
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null,{detect_thin_wall:"0"},preset);
  const applied=calls.find(c=>c.name==="applyProfile");
  assert.equal(applied.format,"orca.native-json");
  assert.equal(applied.value.wall_generator,"classic");
  assert.equal(applied.value.detect_thin_wall,"0");
  const enabled=mockedEngine();
  await sliceMultiStlWithEngine(enabled.engine,items,null,null,preset);
  assert.equal(enabled.calls.find(c=>c.name==="applyProfile").value.detect_thin_wall,"1");
  const invalid=mockedEngine();
  await assert.rejects(()=>sliceMultiStlWithEngine(invalid.engine,items,null,{detect_thin_wall:true},preset),/native enum/);
  assert.equal(invalid.calls.length,0);
}
console.log("PASS: classic thin-wall selection reaches mocked native-json with explicit override precedence");

{
  const preset={...selected,process:{settings:{...selected.process.settings,
    wall_generator:"classic",wall_sequence:"inner wall/outer wall"}}};
  for(const order of ["outer wall/inner wall","inner-outer-inner wall",null]){
    const {engine,calls}=mockedEngine();
    await sliceMultiStlWithEngine(engine,items,null,order===null?null:{wall_sequence:order},preset);
    const applied=calls.find(c=>c.name==="applyProfile");
    assert.equal(applied.format,"orca.native-json");
    assert.equal(applied.value.wall_generator,"classic");
    assert.equal(applied.value.wall_sequence,order??"inner wall/outer wall");
  }
  const invalid=mockedEngine();
  await assert.rejects(()=>sliceMultiStlWithEngine(invalid.engine,items,null,
    {wall_sequence:"Inner/Outer"},preset),/native enum/);
  assert.equal(invalid.calls.length,0);
}
console.log("PASS: wall sequence reaches mocked native-json with override precedence");

{
  const preset={...selected,process:{settings:{...selected.process.settings,
    only_one_wall_top:"1",only_one_wall_first_layer:"0"}}};
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null,{only_one_wall_first_layer:"1"},preset);
  const applied=calls.find(c=>c.name==="applyProfile");
  assert.equal(applied.format,"orca.native-json");
  assert.equal(applied.value.only_one_wall_top,"1");
  assert.equal(applied.value.only_one_wall_first_layer,"1");
  const baseline=mockedEngine();
  await sliceMultiStlWithEngine(baseline.engine,items,null,null,preset);
  assert.equal(baseline.calls.find(c=>c.name==="applyProfile").value.only_one_wall_first_layer,"0");
  for(const key of ["only_one_wall_top","only_one_wall_first_layer"]){
    const invalid=mockedEngine();
    await assert.rejects(()=>sliceMultiStlWithEngine(invalid.engine,items,null,{[key]:true},preset),/native enum/);
    assert.equal(invalid.calls.length,0);
  }
}
console.log("PASS: single-wall surface toggle native transfer and independent override");

{
  const preset={...selected,process:{settings:{...selected.process.settings,seam_position:"aligned"}}};
  for(const seam of [null,"nearest","aligned_back","back","random"]){
    const {engine,calls}=mockedEngine();
    await sliceMultiStlWithEngine(engine,items,null,seam===null?null:{seam_position:seam},preset);
    const applied=calls.find(c=>c.name==="applyProfile");
    assert.equal(applied.format,"orca.native-json");
    assert.equal(applied.value.seam_position,seam??"aligned");
  }
  const invalid=mockedEngine();
  await assert.rejects(()=>sliceMultiStlWithEngine(invalid.engine,items,null,
    {seam_position:"Aligned"},preset),/native enum/);
  assert.equal(invalid.calls.length,0);
}
console.log("PASS: seam-position native transfer and explicit override");

{
  const vectors={retraction_length:["0.8"],retraction_speed:["40"],deretraction_speed:["0"],retraction_minimum_travel:["0"],z_hop:["0.4"],travel_slope:["3"]};
  const preset={...selected,machine:{settings:{...selected.machine.settings,...vectors}}};
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null,null,preset);
  const init=calls.find(c=>c.name==="init").value;
  for(const [key,value] of Object.entries(vectors)){
    assert.deepEqual(init[key],value);
    assert.equal(makeRestrictedInitConfig(selected)[key],undefined);
    for(const bad of ["1",[],["1","2"],["1%"],[null],["-1"],["101"]]){
      const invalid=mockedEngine();
      await assert.rejects(()=>sliceMultiStlWithEngine(invalid.engine,items,null,null,
        {...preset,machine:{settings:{...preset.machine.settings,[key]:bad}}}),
        /Expected single-tool|Invalid restricted|outside diagnostic bounds/);
      assert.equal(invalid.calls.length,0);
    }
  }
  assert.throws(()=>makeRestrictedInitConfig({...preset,machine:{settings:{
    ...preset.machine.settings,retraction_speed:["0"]}}}),/outside diagnostic bounds/);
  assert.throws(()=>makeRestrictedInitConfig({...preset,machine:{settings:{
    ...preset.machine.settings,z_hop:["5.01"]}}}),/outside diagnostic bounds/);
  for(const value of ["0","5"])
    assert.deepEqual(makeRestrictedInitConfig({...preset,machine:{settings:{
      ...preset.machine.settings,z_hop:[value]}}}).z_hop,[value]);
}
console.log("PASS: machine retraction vectors reach native init; malformed inputs refused before session");

{
  for(const mode of ["Auto Lift","Normal Lift","Slope Lift","Spiral Lift"]){
    const preset={...selected,machine:{settings:{...selected.machine.settings,z_hop_types:[mode],travel_slope:["3"]}}};
    const {engine,calls}=mockedEngine();
    await sliceMultiStlWithEngine(engine,items,null,null,preset);
    const init=calls.find(c=>c.name==="init").value;
    assert.deepEqual(init.z_hop_types,[mode]);
    assert.deepEqual(init.travel_slope,["3"]);
  }
  assert.equal(makeRestrictedInitConfig(selected).z_hop_types,undefined);
  for(const bad of ["Auto Lift",[],["Auto Lift","Normal Lift"],["Auto"],["auto lift"],[null],[1],[true],{}]){
    const invalid=mockedEngine();
    await assert.rejects(()=>sliceMultiStlWithEngine(invalid.engine,items,null,null,
      {...selected,machine:{settings:{...selected.machine.settings,z_hop_types:bad}}}),/Invalid single-tool native Z-hop type vector/);
    assert.equal(invalid.calls.length,0);
  }
  for(const bad of [["0"],["90.01"]])
    assert.throws(()=>makeRestrictedInitConfig({...selected,machine:{settings:{...selected.machine.settings,travel_slope:bad}}}),/outside diagnostic bounds/);
  for(const value of ["1","90"])
    assert.deepEqual(makeRestrictedInitConfig({...selected,machine:{settings:{...selected.machine.settings,travel_slope:[value]}}}).travel_slope,[value]);
}
console.log("PASS: native Z-hop enum vector and traveling angle reach init; invalid input refused");

{
  const gates={retract_lift_above:["5"],retract_lift_below:["0"]};
  const preset={...selected,machine:{settings:{...selected.machine.settings,...gates}}};
  const {engine,calls}=mockedEngine();
  await sliceMultiStlWithEngine(engine,items,null,null,preset);
  const init=calls.find(c=>c.name==="init").value;
  for(const [key,value] of Object.entries(gates)){
    assert.deepEqual(init[key],value);
    assert.equal(makeRestrictedInitConfig(selected)[key],undefined);
    for(const bad of ["1",[],["1","2"],["1%"],[null],["-1"],["1000.01"]]){
      const invalid=mockedEngine();
      await assert.rejects(()=>sliceMultiStlWithEngine(invalid.engine,items,null,null,
        {...preset,machine:{settings:{...preset.machine.settings,[key]:bad}}}),
        /Expected single-tool|Invalid restricted|outside diagnostic bounds/);
      assert.equal(invalid.calls.length,0);
    }
  }
}
console.log("PASS: Z-hop height gates reach native init; invalid inputs refused");

{
  const preset={...selected,process:{settings:{...selected.process.settings,enable_arc_fitting:"disabled"}}};
  for(const mode of [null,"enabled","sparse_infill","disabled"]){
    const {engine,calls}=mockedEngine();
    await sliceMultiStlWithEngine(engine,items,null,mode===null?null:{enable_arc_fitting:mode},preset);
    const applied=calls.find(c=>c.name==="applyProfile");
    assert.equal(applied.format,"orca.native-json");
    assert.equal(applied.value.enable_arc_fitting,mode??"disabled");
  }
  const invalid=mockedEngine();
  await assert.rejects(()=>sliceMultiStlWithEngine(invalid.engine,items,null,{enable_arc_fitting:"1"},preset),/native enum/);
  assert.equal(invalid.calls.length,0);
}
console.log("PASS: canonical arc-fitting mode reaches native process application");
