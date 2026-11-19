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
assert.equal(splitAudit.bridge_path_geometry_consistent,true,
  "Different segmentation of the same path must remain eligible");
assert.deepEqual(splitAudit.bridge_path_geometry_mismatched_features,[]);

assert.deepEqual(splitAudit.candidate_tagged_bridge_xy_lengths_mm_by_feature,{bridge:2});
// Finite endpoints can overflow when subtracted: those are not usable paths.
const overflowAudit=auditBridgeSpeedSegments(oneSegment,[
  {...segment("Bridge",120),x1:-1e308,x2:1e308},
]);
assert.equal(overflowAudit.candidate_tagged_bridge_extrusion_segments,0);
assert.equal(overflowAudit.candidate_tagged_bridge_xy_length_mm,0);
console.log("PASS: bridge XY lengths are segmentation-aware and non-finite-safe");

// A newly appearing F120 is NOT enough if the alleged speed-only override
// also changes feature geometry. Preserve the evidence, but fail closed.
const shifted=auditBridgeSpeedSegments(
  [segment("Bridge",2400)],
  [{...segment("Bridge",120),x1:10,x2:11}]);
assert.deepEqual(shifted.new_tagged_bridge_feedrates_mm_min,[120]);
assert.equal(shifted.target_feedrate_observed,false);
assert.equal(shifted.result,"bridge_geometry_changed_speed_unverified");
assert.deepEqual(shifted.bridge_path_geometry_mismatched_features,["bridge"]);
assert.equal(shifted.baseline_tagged_bridge_xy_length_mm,
  shifted.candidate_tagged_bridge_xy_length_mm,
  "Shifted path has the SAME cumulative length; envelope guard is required");
assert.notDeepEqual(shifted.baseline_tagged_bridge_xy_bounds_mm_by_feature,
  shifted.candidate_tagged_bridge_xy_bounds_mm_by_feature);

const shortened=auditBridgeSpeedSegments(
  [{...segment("Bridge",2400),x2:2}],
  [segment("Bridge",120)]);
assert.equal(shortened.target_feedrate_observed,false);
assert.deepEqual(shortened.bridge_path_geometry_mismatched_features,["bridge"]);

const retagged=auditBridgeSpeedSegments(
  [segment("Bridge",2400)],
  [segment("Internal bridge",120)]);
assert.equal(retagged.target_feedrate_observed,false);
assert.deepEqual(retagged.bridge_path_geometry_mismatched_features,
  ["bridge","internal bridge"]);

// The 0.01 mm threshold is for this SAME-engine diagnostic only.
// It is intentionally not a toolpath-parity tolerance.
const tinyDrift=auditBridgeSpeedSegments(
  [segment("Bridge",2400)],
  [{...segment("Bridge",120),x2:1.005}]);
assert.equal(tinyDrift.bridge_path_geometry_consistent,true);
assert.equal(tinyDrift.target_feedrate_observed,true);
assert.equal(shifted.native_desktop_parity,false);
console.log("PASS: bridge speed evidence requires subtype length/envelope invariance, not merely a new F target");

// Native internal_bridge_flow must not be "proved" by a conventional Bridge
// label or by changed headers/hash. These are synthetic negative controls;
// the real, still opt-in Chrome arch runs are independently recorded.
const {auditInternalBridgeFlowSegments}=await import("./bridge-feature-diagnostic.mjs");
const flow=(feature,e,x1=0,x2=10)=>({
  feature,commandedPositiveEMm:e,extrusion:true,x1,x2,y1:0,y2:0
});
const baseFlow=[flow("Internal bridge",4),flow("Bridge",6),
  flow("External bridge",2)];
const reducedFlow=[flow("Internal bridge",2),flow("Bridge",6),
  flow("External bridge",2)];
const goodFlow=auditInternalBridgeFlowSegments(baseFlow,reducedFlow);
assert.equal(goodFlow.result,"observed_internal_bridge_flow_effect");
assert.equal(goodFlow.internal_positive_e_decreased,true);
assert.equal(goodFlow.external_bridge_e_stable,true);
assert.equal(goodFlow.baseline.internal.positive_e_mm,4);
assert.equal(goodFlow.candidate.internal.positive_e_mm,2);
assert.equal(goodFlow.baseline.other_bridge.positive_e_mm,8);
assert.equal(goodFlow.native_desktop_parity,false);
assert.equal(goodFlow.printer_safe,false);
assert.equal(goodFlow.public_pages_enabled,false);
assert.equal(auditInternalBridgeFlowSegments(
  [flow("Bridge",4)],[flow("Bridge",2)]
).result,"inconclusive_no_tagged_internal_bridge");
assert.equal(auditInternalBridgeFlowSegments(
  [flow("Internal bridge",4)],[flow("Internal bridge",2)]
).result,"inconclusive_no_external_bridge_control");
assert.equal(auditInternalBridgeFlowSegments(baseFlow,[
  flow("Internal bridge",2),flow("Bridge",5),flow("External bridge",1)
]).result,"external_bridge_flow_changed_control_failed");
assert.equal(auditInternalBridgeFlowSegments(baseFlow,[
  flow("Internal bridge",2,1,11),flow("Bridge",6),
  flow("External bridge",2)
]).result,"bridge_geometry_changed_flow_unverified");
assert.equal(auditInternalBridgeFlowSegments(baseFlow,[
  flow("Internal bridge",4),flow("Bridge",6),flow("External bridge",2)
]).result,"internal_bridge_flow_effect_unverified");
for(const impostor of ["Cambridge","not bridge","bridge overhang",
  "internal bridge support","unknown internal bridge"]){
  assert.equal(auditInternalBridgeFlowSegments(
    [flow(impostor,4),flow("Bridge",6)],
    [flow(impostor,2),flow("Bridge",6)]
  ).result,"inconclusive_no_tagged_internal_bridge",impostor);
}
// Reject phantom extrusion-only moves, unbounded numbers and missing E.
for(const invalid of [
  {...flow("Internal bridge",1),x2:0},
  {...flow("Internal bridge",1),x2:NaN},
  {...flow("Internal bridge",1),commandedPositiveEMm:null},
  {...flow("Internal bridge",1),commandedPositiveEMm:0},
  {...flow("Internal bridge",1),extrusion:false},
]){
  assert.equal(auditInternalBridgeFlowSegments(
    [invalid,flow("Bridge",6)],[invalid,flow("Bridge",6)]
  ).result,"inconclusive_no_tagged_internal_bridge");
}
assert.throws(()=>auditInternalBridgeFlowSegments(null,[]),/Invalid/);
console.log("PASS: internal bridge flow evidence separates true internal G1 E, ordinary bridge controls, and invalid/impostor paths");
