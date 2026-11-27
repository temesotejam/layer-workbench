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
console.log("PASS: native/restricted key coverage and conservative value-shape classification, never parity");
