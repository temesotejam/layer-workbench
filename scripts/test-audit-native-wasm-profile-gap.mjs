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
// Even exact keys/values cannot certify actual native/WASM execution parity.
const exactlyMatched={machine:{settings:{nozzle_diameter:["0.4"],printable_height:"200",machine_start_gcode:"M104 S200"}},
 process:{settings:{layer_height:"0.2",sparse_infill_density:"15%",bridge_speed:"40"}},
 filament:{settings:{nozzle_temperature:"220",filament_flow_ratio:["0.98"],filament_max_volumetric_speed:["12","21"]}}};
const all=auditProfileCoverage(full,exactlyMatched);
assert.equal(all.total_not_forwarded_count,0);
assert.equal(all.overlapping_raw_value_differences,0);
assert.equal(all.full_profile_parity_established,false);
assert.throws(()=>auditProfileCoverage(full,{...restricted,machine:{settings:{}}}),/Empty native or restricted machine/);
assert.throws(()=>auditProfileCoverage(full,{...restricted,process:null}),/Missing resolved native or restricted process/);
// Synthetic derived settings are recorded separately; do not imply native key application.
const derived=auditProfileCoverage(full,{...restricted,filament:{settings:{...restricted.filament.settings,curr_bed_type:"High Temp Plate"}}});
assert.deepEqual(derived.families.filament.restricted_only_keys,["curr_bed_type"]);
assert.equal(derived.families.filament.overlapping_option_count,2);
console.log("PASS: key-level native/restricted coverage audit and fail-closed parity labels");
