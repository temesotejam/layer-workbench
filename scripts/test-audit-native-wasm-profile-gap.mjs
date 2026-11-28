import assert from "node:assert/strict";
import {auditProfileCoverage} from "./audit-native-wasm-profile-gap.mjs";

const full={
  machine:{type:"machine",name:"Test",nozzle_diameter:["0.4"],printable_height:"200",machine_start_gcode:"M104 S200"},
  process:{type:"process",name:"Test",layer_height:"0.2",sparse_infill_density:"15%",bridge_speed:"40"},
  filament:{type:"filament",name:"Test",nozzle_temperature:"220",filament_flow_ratio:["0.98"],filament_max_volumetric_speed:["12","21"]}
};
const restricted={
  machine:{settings:{nozzle_diameter:"0.4",printable_height:"200"}},
  process:{settings:{layer_height:"0.2",sparse_infill_density:"15"}},
  filament:{settings:{nozzle_temperature:"220",filament_flow_ratio:["0.98"]}}
};
const report=auditProfileCoverage(full,restricted);
assert.equal(report.full_profile_parity_established,false);
assert.equal(report.native_vs_wasm_gcode_compared,false);
assert.equal(report.print_ready,false);
assert.equal(report.total_native_option_count,9);
assert.equal(report.total_not_forwarded_count,3);
assert.deepEqual(report.families.machine.not_forwarded_keys,["machine_start_gcode"]);
assert.deepEqual(report.families.process.not_forwarded_keys,["bridge_speed"]);
assert.deepEqual(report.families.filament.not_forwarded_keys,["filament_max_volumetric_speed"]);
assert.deepEqual(report.families.machine.raw_value_differences_requiring_review,["nozzle_diameter"]);
assert.deepEqual(report.families.process.raw_value_differences_requiring_review,["sparse_infill_density"]);
assert.deepEqual(report.families.filament.raw_value_differences_requiring_review,[]);
// Two known adapter conversions are classified as syntax-only evidence,
// never removed from the raw-difference review or called semantic parity.
assert.equal(report.recognized_syntax_only_count,2);
assert.equal(report.unexplained_raw_value_difference_count,0);
assert.deepEqual(report.families.machine.raw_value_difference_shapes,[{
  key:"nozzle_diameter",native_shape:"array(1)",restricted_shape:"string",
  syntax_only_hint:"single-nozzle-vector-to-scalar"
}]);
assert.deepEqual(report.families.process.raw_value_difference_shapes,[{
  key:"sparse_infill_density",native_shape:"string",restricted_shape:"string",
  syntax_only_hint:"density-percent-token-to-numeric"
}]);
// Native v2.5.0's single-PLA vector and one-slot nozzle-temperature vector
// are explicitly normalized by the restricted filament resolver. The syntax
// hints remain weaker than PrintConfig or real WASM behavior.
const filamentVectorFull={
  ...full,filament:{...full.filament,filament_type:["PLA"],nozzle_temperature:["220"]}
};
const filamentScalarRestricted={
  ...restricted,filament:{settings:{...restricted.filament.settings,filament_type:"PLA"}}
};
const filamentVectorAudit=auditProfileCoverage(filamentVectorFull,filamentScalarRestricted);
assert.equal(filamentVectorAudit.families.filament.recognized_syntax_only_count,2);
assert.deepEqual(filamentVectorAudit.families.filament.raw_value_difference_shapes,[
  {key:"filament_type",native_shape:"array(1)",restricted_shape:"string",
    syntax_only_hint:"single-PLA-vector-to-scalar"},
  {key:"nozzle_temperature",native_shape:"array(1)",restricted_shape:"string",
    syntax_only_hint:"single-nozzle-temperature-vector-to-scalar"}
]);
assert.equal(filamentVectorAudit.full_profile_parity_established,false);
// A different material, a two-temperature vector or out-of-range temperature
// cannot be silently explained as a safe known adapter transformation.
const unsafeFilament=auditProfileCoverage({
  ...full,filament:{...full.filament,filament_type:["ABS"],nozzle_temperature:["200","220"]}
},filamentScalarRestricted);
assert.equal(unsafeFilament.families.filament.unexplained_raw_value_difference_count,2);
assert.equal(auditProfileCoverage({
  ...full,filament:{...full.filament,nozzle_temperature:["350"]}
},{
  ...restricted,filament:{settings:{...restricted.filament.settings,nozzle_temperature:"350"}}
}).families.filament.unexplained_raw_value_difference_count,1);

// Deliberately ambiguous values must NOT inherit the narrow hints:
// a multi-nozzle array, a percent-relative speed and a filament vector
// represented as a scalar can have different native semantics.
const ambiguousNative={
  ...full,
  machine:{...full.machine,nozzle_diameter:["0.4","0.6"]},
  process:{...full.process,bridge_speed:"50%"},
};
const ambiguousRestricted={
  ...restricted,
  process:{settings:{...restricted.process.settings,bridge_speed:"50"}},
  filament:{settings:{...restricted.filament.settings,filament_flow_ratio:"0.98"}}
};
const ambiguous=auditProfileCoverage(ambiguousNative,ambiguousRestricted);
assert.equal(ambiguous.recognized_syntax_only_count,1);
assert.equal(ambiguous.unexplained_raw_value_difference_count,3);
assert.deepEqual(ambiguous.families.machine.raw_value_difference_shapes,[{
  key:"nozzle_diameter",native_shape:"array(2)",restricted_shape:"string",
  syntax_only_hint:"unexplained"
}]);
assert.ok(ambiguous.families.process.raw_value_difference_shapes.some(
  v=>v.key==="bridge_speed" && v.syntax_only_hint==="unexplained"));
assert.ok(ambiguous.families.filament.raw_value_difference_shapes.some(
  v=>v.key==="filament_flow_ratio" && v.syntax_only_hint==="unexplained"));
assert.equal(ambiguous.full_profile_parity_established,false);
// Even a superficially similar percentage on an unrelated speed must not
// be reclassified as an accepted conversion.
assert.equal(auditProfileCoverage({
  ...full,process:{...full.process,bridge_speed:"50%"}
},{
  ...restricted,process:{settings:{...restricted.process.settings,bridge_speed:"50"}}
}).families.process.unexplained_raw_value_difference_count,1);

// Top flow is explicitly forwarded as one positive canonical nozzle slot.
function topFlowAudit(native, forwarded, key="top_solid_infill_flow_ratio") {
  return auditProfileCoverage({
    ...full,process:{...full.process,[key]:native}
  },{
    ...restricted,process:{settings:{...restricted.process.settings,[key]:forwarded}}
  });
}
for(const [native,forwarded] of [["1",["1"]],["0.75",["0.75"]],[2,["2"]],["0.10",["0.1"]]]) {
  const audited=topFlowAudit(native,forwarded);
  assert.ok(audited.families.process.raw_value_difference_shapes.some(item=>
    item.key==="top_solid_infill_flow_ratio" &&
    item.syntax_only_hint==="single-top-flow-scalar-to-nozzle-vector"));
  assert.equal(audited.families.process.unexplained_raw_value_difference_count,0);
  assert.equal(audited.full_profile_parity_established,false);
  assert.equal(audited.native_vs_wasm_gcode_compared,false);
  assert.equal(audited.print_ready,false);
}
for(const [native,forwarded] of [
  ["1",["1","1"]],["1",["0.75"]],["1",[1]],["1",["1.00"]],
  ["0",["0"]],["0.05",["0.05"]],["2.1",["2.1"]],
  [null,["1"]],["nil",["1"]],["100%",["1"]],["1",null]
]) {
  assert.equal(topFlowAudit(native,forwarded).families.process.unexplained_raw_value_difference_count,1);
}
assert.equal(topFlowAudit("1",["1"],"bottom_solid_infill_flow_ratio")
  .families.process.unexplained_raw_value_difference_count,1);

// Known bounded machine coFloats are normalized without claiming semantics.
function machineVectorAudit(key,native,forwarded){
  return auditProfileCoverage({...full,machine:{...full.machine,[key]:native}},
    {...restricted,machine:{settings:{...restricted.machine.settings,[key]:forwarded}}});
}
for(const [key,lo,hi] of [["retraction_length",0,10],["retraction_speed",1,100],
  ["deretraction_speed",0,100],["retraction_minimum_travel",0,100],["z_hop",0,5],
  ["travel_slope",1,90],["retract_lift_above",0,1000],["retract_lift_below",0,1000]]){
  for(const n of [lo,hi]){
    const audit=machineVectorAudit(key,String(n),[String(n)]);
    assert.ok(audit.families.machine.raw_value_difference_shapes.some(v=>
      v.key===key&&v.syntax_only_hint==="single-machine-retraction-scalar-to-vector"));
    assert.ok(audit.families.machine.raw_value_differences_requiring_review.includes(key));
    assert.equal(audit.full_profile_parity_established,false);
  }
  for(const [native,forwarded] of [[String(hi+1),[String(hi+1)]],
    [String(lo-1),[String(lo-1)]],[String(lo)+"%",[String(lo)]],
    [String(lo),[String(lo),String(lo)]],[String(lo),[lo]],
    [String(lo),[String(lo)+".0"]],[String(lo),[String(hi)]],[null,["0"]]])
    assert.equal(machineVectorAudit(key,native,forwarded).families.machine.unexplained_raw_value_difference_count,1);
}
assert.equal(machineVectorAudit("wipe_distance","1",["1"]).families.machine.unexplained_raw_value_difference_count,1);

// Exact machine lift enum vector and legacy process arc fitting conversions.
for(const mode of ["Auto Lift","Normal Lift","Slope Lift","Spiral Lift"]){
  const a=machineVectorAudit("z_hop_types",mode,[mode]);
  assert.deepEqual(a.families.machine.raw_value_difference_shapes.find(v=>v.key==="z_hop_types"),
    {key:"z_hop_types",native_shape:"string",restricted_shape:"array(1)",syntax_only_hint:"single-machine-lift-enum-scalar-to-vector"});
  assert.ok(a.families.machine.raw_value_differences_requiring_review.includes("z_hop_types"));
  assert.equal(a.full_profile_parity_established,false);
}
for(const [native,forwarded] of [
  ["auto lift",["auto lift"]],["Auto Lift",["Normal Lift"]],["Spiral Lift",["Spiral Lift","Spiral Lift"]],
  ["Normal Lift",["Normal Lift "]],[null,["Normal Lift"]],[["Normal Lift","Normal Lift"],["Normal Lift"]]
]){
  assert.equal(machineVectorAudit("z_hop_types",native,forwarded).families.machine.unexplained_raw_value_difference_count,1);
}
function arcAudit(native,forwarded,key="enable_arc_fitting"){
  return auditProfileCoverage({...full,process:{...full.process,[key]:native}},
    {...restricted,process:{settings:{...restricted.process.settings,[key]:forwarded}}});
}
for(const [native,forwarded] of [["0","disabled"],["FALSE","disabled"],["false","disabled"],["1","enabled"],["True","enabled"],["true","enabled"]]){
  const a=arcAudit(native,forwarded);
  assert.ok(a.families.process.raw_value_difference_shapes.some(v=>v.key==="enable_arc_fitting"&&v.syntax_only_hint==="legacy-arc-fitting-string-to-enum"));
  assert.ok(a.families.process.raw_value_differences_requiring_review.includes("enable_arc_fitting"));
  assert.equal(a.families.process.unexplained_raw_value_difference_count,0);
  assert.equal(a.full_profile_parity_established,false);
  assert.equal(a.native_vs_wasm_gcode_compared,false);
  assert.equal(a.print_ready,false);
}
for(const [native,forwarded] of [["0","enabled"],["1","disabled"],["0","sparse_infill"],[" false","disabled"],["true ", "enabled"],
  [0,"disabled"],[true,"enabled"],[["0"],"disabled"],["disabled","enabled"],["enabled","sparse_infill"],["1",["enabled"]]]){
  assert.equal(arcAudit(native,forwarded).families.process.unexplained_raw_value_difference_count,1);
}
assert.equal(arcAudit("0","disabled","unrelated_enum").families.process.unexplained_raw_value_difference_count,1);

// Even exact keys/values cannot certify actual native/WASM execution parity.
const exactlyMatched={machine:{settings:{nozzle_diameter:["0.4"],printable_height:"200",machine_start_gcode:"M104 S200"}},
 process:{settings:{layer_height:"0.2",sparse_infill_density:"15%",bridge_speed:"40"}},
 filament:{settings:{nozzle_temperature:"220",filament_flow_ratio:["0.98"],filament_max_volumetric_speed:["12","21"]}}};
const all=auditProfileCoverage(full,exactlyMatched);
assert.equal(all.total_not_forwarded_count,0);
assert.equal(all.overlapping_raw_value_differences,0);
assert.equal(all.recognized_syntax_only_count,0);
assert.equal(all.unexplained_raw_value_difference_count,0);
assert.equal(all.full_profile_parity_established,false);
assert.throws(()=>auditProfileCoverage(full,{...restricted,machine:{settings:{}}}),/Empty native or restricted machine/);
assert.throws(()=>auditProfileCoverage(full,{...restricted,process:null}),/Missing resolved native or restricted process/);
// Synthetic derived settings are recorded separately; do not imply native key application.
const derived=auditProfileCoverage(full,{...restricted,filament:{settings:{...restricted.filament.settings,curr_bed_type:"High Temp Plate"}}});
assert.deepEqual(derived.families.filament.restricted_only_keys,["curr_bed_type"]);
assert.equal(derived.families.filament.overlapping_option_count,2);

// Missing-key classifications are a disjoint exhaustive partition, not a
// new parity gate. Metadata and compatibility remain in the original count.
const withRoles={
  machine:{...full.machine,from:"system",version:"2.5.0",compatible_printers:["X"],
    default_print_profile:"Test",unknown_motion_key:"1"},
  process:{...full.process,setting_id:"id",instantiation:"true",
    compatible_printers:["Test"],compatible_printers_condition:"x",
    machine_start_gcode:"M104 S200",description:"test"},
  filament:{...full.filament,filament_id:"test",compatible_printers:["Test"],
    filament_flow_ratio:["0.98"],filament_max_volumetric_speed:["12","21"]}
};
const classified=auditProfileCoverage(withRoles,restricted);
assert.deepEqual(classified.families.machine.not_forwarded_keys_by_role,{
  "preset-record-metadata":["from","version"],"printer-compatibility":[],
  "custom-gcode-hook":["machine_start_gcode"],
  unclassified:["compatible_printers","default_print_profile","unknown_motion_key"]
});
assert.deepEqual(classified.families.process.not_forwarded_keys_by_role,{
  "preset-record-metadata":["description","instantiation","setting_id"],
  "printer-compatibility":["compatible_printers","compatible_printers_condition"],
  "custom-gcode-hook":[],unclassified:["bridge_speed","machine_start_gcode"]
});
assert.deepEqual(classified.families.filament.not_forwarded_keys_by_role,{
  "preset-record-metadata":["filament_id"],
  "printer-compatibility":["compatible_printers"],"custom-gcode-hook":[],unclassified:["filament_max_volumetric_speed"]
});
for(const row of Object.values(classified.families)) {
  const partition=Object.values(row.not_forwarded_keys_by_role).flat().sort();
  assert.deepEqual(partition,row.not_forwarded_keys);
  assert.equal(partition.length,row.not_forwarded_count);
}
assert.equal(classified.total_not_forwarded_count,16);
assert.equal(classified.full_profile_parity_established,false);
assert.equal(classified.native_vs_wasm_gcode_compared,false);
assert.equal(classified.print_ready,false);

// Recognize only exact source-declared hook families and shapes. Values
// must never be included in the audit; nonempty does not imply execution.
const hookReport=auditProfileCoverage({
  machine:{...full.machine,machine_end_gcode:"  ",before_layer_change_gcode:[],
    file_start_gcode:"; PRIVATE_SENTINEL",unknown_gcode:"PRIVATE_SENTINEL",
    filament_end_gcode:["PRIVATE_SENTINEL"]},
  process:{...full.process,machine_start_gcode:"PRIVATE_SENTINEL"},
  filament:{...full.filament,filament_start_gcode:["","PRIVATE_SENTINEL"],
    filament_end_gcode:[" "],filament_change_extrusion_role_gcode:[null],
    machine_end_gcode:"PRIVATE_SENTINEL"}
},restricted);
assert.deepEqual(hookReport.families.machine.not_forwarded_custom_gcode_hooks,[
  {key:"before_layer_change_gcode",presence:"unrecognized-shape"},
  {key:"file_start_gcode",presence:"nonempty"},
  {key:"machine_end_gcode",presence:"blank"},
  {key:"machine_start_gcode",presence:"nonempty"}
]);
assert.deepEqual(hookReport.families.filament.not_forwarded_custom_gcode_hooks,[
  {key:"filament_change_extrusion_role_gcode",presence:"unrecognized-shape"},
  {key:"filament_end_gcode",presence:"blank"},
  {key:"filament_start_gcode",presence:"nonempty"}
]);
assert.deepEqual(hookReport.families.process.not_forwarded_custom_gcode_hooks,[]);
assert.ok(hookReport.families.machine.not_forwarded_keys_by_role.unclassified.includes("unknown_gcode"));
assert.ok(hookReport.families.machine.not_forwarded_keys_by_role.unclassified.includes("filament_end_gcode"));
assert.ok(hookReport.families.filament.not_forwarded_keys_by_role.unclassified.includes("machine_end_gcode"));
assert.ok(!JSON.stringify(hookReport).includes("PRIVATE_SENTINEL"));
assert.equal(hookReport.full_profile_parity_established,false);
assert.equal(hookReport.print_ready,false);
assert.deepEqual(all.families.machine.not_forwarded_custom_gcode_hooks,[]);
console.log("PASS: native/restricted key coverage and conservative value-shape classification, never parity");
