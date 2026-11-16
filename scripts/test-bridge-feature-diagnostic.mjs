import assert from "node:assert/strict";
import {auditBridgeSpeedSegments} from "./bridge-feature-diagnostic.mjs";

const segment=(feature,feedrateMmMin,extrusion=true)=>
  ({feature,feedrateMmMin,extrusion,x1:0,y1:0,x2:1,y2:0});
const baseline=[segment("Bridge",2400),segment("External bridge",1800),
  segment("Inner wall",120)];
const candidate=[segment("Bridge",120),segment("External bridge",120),
  segment("Inner wall",120)];
const found=auditBridgeSpeedSegments(baseline,candidate);
assert.equal(found.result,"observed_tagged_bridge_feedrate_effect");
assert.equal(found.baseline_tagged_bridge_extrusion_segments,2);
assert.equal(found.candidate_tagged_bridge_extrusion_segments,2);
assert.deepEqual(found.new_tagged_bridge_feedrates_mm_min,[120]);
assert.deepEqual(found.baseline_tagged_bridge_feature_counts,
  {"bridge":1,"external bridge":1});
assert.deepEqual(found.candidate_tagged_bridge_feature_counts,
  {"bridge":1,"external bridge":1});
assert.equal(found.baseline_tagged_bridge_xy_length_mm,2);
assert.equal(found.candidate_tagged_bridge_xy_length_mm,2);
assert.deepEqual(found.baseline_tagged_bridge_xy_lengths_mm_by_feature,
  {"bridge":1,"external bridge":1});
assert.deepEqual(found.candidate_tagged_bridge_xy_lengths_mm_by_feature,
  {"bridge":1,"external bridge":1});
assert.equal(found.native_desktop_parity,false);
assert.equal(found.printer_safe,false);
// Travel-only F120 and unrelated wall speeds cannot prove bridge-speed control.
assert.equal(auditBridgeSpeedSegments(baseline,[
  segment("Bridge",120,false),segment("Outer wall",120)
]).result,"bridge_paths_observed_but_speed_unverified");
assert.equal(auditBridgeSpeedSegments([segment("Top surface",2400)],
  [segment("Top surface",120)]).result,"inconclusive_no_tagged_bridge_paths");
// A G-code comment or a missing/invalid modal F must never be a bridge segment.
assert.equal(auditBridgeSpeedSegments(baseline,[
  segment("Bridge",NaN),segment("Bridge",0),segment("Bridge",-1),
  {feature:"Bridge",feedrateMmMin:120,extrusion:false}
]).target_feedrate_observed,false);
// Vertical positive-E and zero-XY priming must not be called bridge
// deposition even if a valid bridge feature tag and target F are present.
for (const bogus of [
  {...segment("Bridge",120),x2:0,y2:0},
  {...segment("Bridge",120),x1:1,y1:1,x2:1,y2:1},
  {...segment("Bridge",120),x1:NaN},
  {...segment("Bridge",120),x2:Infinity},
]) {
  const audit=auditBridgeSpeedSegments([segment("Bridge",2400)],[bogus]);
  assert.equal(audit.target_feedrate_observed,false);
  assert.equal(audit.candidate_tagged_bridge_extrusion_segments,0);
}
assert.match(found.measured_subset,/positive-E XY/);
// Existing bridge F120 in baseline is not a newly observed effect.
assert.equal(auditBridgeSpeedSegments([segment("Bridge",120)],
  [segment("Bridge",120)]).target_feedrate_observed,false);
// Negative controls: unsupported labels and accidental substring matches.
assert.equal(auditBridgeSpeedSegments([segment("Cambridge",2400)],
  [segment("Cambridge",120)]).target_feedrate_observed,false);
// Only the same six feature labels recognized by the native audit may
// contribute. Case/whitespace normalization must not change their meaning.
const nativeBridgeLabels=["bridge","external bridge","internal bridge",
  "bridge infill","internal bridge infill","bridge over infill"];
const allLabels=auditBridgeSpeedSegments(
  nativeBridgeLabels.map(f=>segment(f.toUpperCase(),2400)),
  nativeBridgeLabels.map(f=>segment(" "+f.replaceAll(" ","   ")+" ",120)));
assert.equal(allLabels.baseline_tagged_bridge_extrusion_segments,6);
assert.equal(allLabels.candidate_tagged_bridge_extrusion_segments,6);
assert.deepEqual(Object.keys(allLabels.candidate_tagged_bridge_feature_counts).sort(),
  nativeBridgeLabels.slice().sort());

// A loose /\bbridge\b/ test previously misclassified these explicitly
// unrecognized labels as deposition bridges. Never accept invented types.
for(const impostor of ["not bridge","non-bridge","bridge overhang",
  "bridge support","unknown bridge", "pre-bridge"]) {
  const audit=auditBridgeSpeedSegments(
    [segment(impostor,2400)],[segment(impostor,120)]);
  assert.equal(audit.result,"inconclusive_no_tagged_bridge_paths",impostor);
  assert.deepEqual(audit.candidate_tagged_bridge_feature_counts,{},impostor);
}
assert.equal(auditBridgeSpeedSegments(
  [segment("bridge",2400)],[segment("bridge overhang",120)])
  .target_feedrate_observed,false);
assert.throws(()=>auditBridgeSpeedSegments({},[]),/Invalid/);
assert.throws(()=>auditBridgeSpeedSegments([],[],0),/Invalid/);
console.log("PASS: tagged bridge extrusion F-only diagnostic cannot promote unrelated paths");

// A slicer may split one geometrically identical bridge path into several
// positive-E XY moves. Counts differ, but cumulative subtype length must not.
const oneSegment=[{...segment("Bridge",2400),x2:2}];
const twoSegments=[
  {...segment("Bridge",120),x2:1},
  {...segment("Bridge",120),x1:1,x2:2},
];
const splitAudit=auditBridgeSpeedSegments(oneSegment,twoSegments);
assert.equal(splitAudit.baseline_tagged_bridge_extrusion_segments,1);
assert.equal(splitAudit.candidate_tagged_bridge_extrusion_segments,2);
assert.equal(splitAudit.baseline_tagged_bridge_xy_length_mm,2);
assert.equal(splitAudit.candidate_tagged_bridge_xy_length_mm,2);
assert.deepEqual(splitAudit.candidate_tagged_bridge_xy_lengths_mm_by_feature,{bridge:2});
// Finite endpoints can overflow when subtracted: those are not usable paths.
const overflowAudit=auditBridgeSpeedSegments(oneSegment,[
  {...segment("Bridge",120),x1:-1e308,x2:1e308},
]);
assert.equal(overflowAudit.candidate_tagged_bridge_extrusion_segments,0);
assert.equal(overflowAudit.candidate_tagged_bridge_xy_length_mm,0);
console.log("PASS: bridge XY lengths are segmentation-aware and non-finite-safe");
