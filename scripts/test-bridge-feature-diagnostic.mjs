import assert from "node:assert/strict";
import {auditBridgeSpeedSegments} from "./bridge-feature-diagnostic.mjs";

const segment=(feature,feedrateMmMin,extrusion=true)=>
  ({feature,feedrateMmMin,extrusion});
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
