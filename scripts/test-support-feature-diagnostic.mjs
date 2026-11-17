import assert from "node:assert/strict";
import {parseGcodeToolpaths} from "./gcode-preview-parser.mjs";
import {auditSupportDeposition,auditSupportSpeedEffect} from "./support-feature-diagnostic.mjs";
const parse=source=>parseGcodeToolpaths(["G21","G90","M82","G92 E0",
  "G0 X0 Y0 Z0.2 F2400",source].join("\n"));
const base=parse([
  ";TYPE:Support material","G1 X10 Y0 E1 F1800",
  ";TYPE:Support material interface","G1 X20 Y0 E2 F900",
  ";TYPE:Support transition","G1 X30 Y0 E3 F2100",
  ";TYPE:Support ironing","G1 X40 Y0 E4 F600",
].join("\n"));
const report=auditSupportDeposition(base);
assert.equal(report.result,"tagged_support_body_or_interface_observed");
assert.deepEqual(Object.keys(report.roles),["body","interface","transition","ironing"]);
assert.deepEqual(report.roles.body.feedrates_mm_min,[1800]);
assert.deepEqual(report.roles.interface.feedrates_mm_min,[900]);
assert.equal(report.roles.body.xy_length_mm,10);
assert.equal(report.roles.interface.bounds_mm.maxX,20);
assert.equal(report.roles.transition.extrusion_xy_segments,1);
assert.equal(report.roles.ironing.extrusion_xy_segments,1);
assert.equal(report.native_desktop_parity,false);
assert.equal(report.printer_safe,false);
console.log("PASS: exact v2.5.0 support body/interface/transition/ironing labels are independent");

const ignored=parse([
  "; support material interface","G1 X10 Y0 E1 F120",
  ";TYPE:Non-support material","G1 X20 Y0 E2",
  ";TYPE:Support material impostor","G1 X30 Y0 E3",
  ";TYPE:Support material","G0 X40 Y0 F120", // travel only
  "G1 E4 F120", // pure E prime
  "G1 Z0.5 E5", // vertical prime
  ";TYPE:","G1 X50 Y0 E6 F120", // invalid tag clears classification
  ";TYPE:Support material interface;trailing","G1 X60 Y0 E7",
].join("\n"));
const empty=auditSupportDeposition(ignored);
assert.equal(empty.result,"no_tagged_support_body_or_interface");
for(const role of Object.values(empty.roles))assert.equal(role.extrusion_xy_segments,0);
assert.equal(empty.support_generation_verified,false);
console.log("PASS: unverified support comments, travel, priming, malformed tags fail closed");

const candidate=parse([
  "; TYPE : Support material","G1 X10 Y0 E1 F120",
  ";TYPE:Support material interface","G1 X20 Y0 E2 F900",
].join("\n"));
// White-space between TYPE and ':' is supported by the parser.
const positive=auditSupportSpeedEffect(base,candidate,"body",120);
assert.equal(positive.result,"observed_tagged_support_feedrate_effect");
assert.equal(positive.target_feedrate_observed,true);
assert.equal(positive.geometry_stable,true);
assert.deepEqual(positive.new_tagged_feedrates_mm_min,[120]);
const unrelated=auditSupportSpeedEffect(base,candidate,"interface",120);
assert.equal(unrelated.target_feedrate_observed,false);
const shifted=parse(";TYPE:Support material\nG0 X10 Y0\nG1 X20 Y0 E1 F120");
const moved=auditSupportSpeedEffect(base,shifted,"body",120);
assert.equal(moved.result,"support_geometry_changed_speed_unverified");
assert.equal(moved.target_feedrate_observed,false);
const travelOnly=auditSupportSpeedEffect(base,ignored,"body",120);
assert.equal(travelOnly.result,"inconclusive_no_matching_support_deposition");
assert.equal(travelOnly.target_feedrate_observed,false);
assert.throws(()=>auditSupportSpeedEffect(base,candidate,"transition",120),/Invalid/);
assert.throws(()=>auditSupportSpeedEffect(base,candidate,"body",0),/Invalid/);
assert.throws(()=>auditSupportDeposition({layers:[{segments:null}]}),/Invalid/);
console.log("PASS: support F effect requires new role-specific rate AND stationary XY/Z geometry");
