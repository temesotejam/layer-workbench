import assert from "node:assert/strict";
import {parseGcodeToolpaths} from "./gcode-preview-parser.mjs";
import {ALL_GCODE_PATHS,gcodeFeatureOptions,visibleGcodeSegment} from "./gcode-feature-filter.mjs";

// Explicit feature tags, unlabelled deposition and travels are distinct.
// The header comment must not be interpreted as a feature label.
const input=[
  "; gap infill speed = 2", "G21", "G90", "M82",
  "G0 Z0.2", "G0 X0 Y0 F2400",
  ";TYPE:Outer wall", "G1 X10 E1 F1200",
  "G0 X11", ";FEATURE:Gap infill", "G1 X20 E2 F120",
  "G0 X21", "G1 X30 E3",
  ";TYPE:Unclassified", "G1 X40 E4",
  ";Type:Inner wall", "G0 Z0.4", "G1 X50 E5",
].join("\n");
const parsed=parseGcodeToolpaths(input);
const options=gcodeFeatureOptions(parsed);
assert.deepEqual(options,[
  {value:"all",label:"All paths",count:5},
  {value:"feature:gap infill",label:"gap infill",count:2},
  {value:"feature:inner wall",label:"inner wall",count:1},
  {value:"feature:outer wall",label:"outer wall",count:1},
  {value:"feature:unclassified",label:"unclassified",count:1},
]);
const segments=parsed.layers.flatMap(layer=>layer.segments);
assert.equal(segments.filter(s=>visibleGcodeSegment(s,ALL_GCODE_PATHS)).length,segments.length);
assert.equal(segments.filter(s=>visibleGcodeSegment(s,"feature:gap infill")).length,2);
assert.ok(segments.filter(s=>visibleGcodeSegment(s,"feature:gap infill")).every(s=>s.extrusion));
assert.equal(segments.filter(s=>visibleGcodeSegment(s,"feature:inner wall")).length,1);
assert.equal(segments.filter(s=>visibleGcodeSegment(s,"invalid")).length,0);
assert.equal(segments.filter(s=>visibleGcodeSegment(s,"unclassified")).length,0);

// Untagged deposition is selectable without mistakenly showing travel moves.
// A literal feature named "unclassified" must not collide with the unlabelled bucket.
const untagged=parseGcodeToolpaths("G90\nM82\nG0 X10\nG1 X20 E1\n;TYPE:unclassified\nG1 X30 E2");
assert.deepEqual(gcodeFeatureOptions(untagged),[
  {value:"all",label:"All paths",count:2},
  {value:"feature:unclassified",label:"unclassified",count:1},
  {value:"unclassified",label:"Unclassified deposition",count:1},
]);
const untaggedSegments=untagged.layers.flatMap(layer=>layer.segments);
assert.deepEqual(untaggedSegments.filter(s=>visibleGcodeSegment(s,"unclassified")).map(s=>s.x2),[20]);
assert.deepEqual(untaggedSegments.filter(s=>visibleGcodeSegment(s,"feature:unclassified")).map(s=>s.x2),[30]);
assert.deepEqual(gcodeFeatureOptions(parseGcodeToolpaths("G0 X10")),[{value:"all",label:"All paths",count:0}]);

console.log("PASS: feature choices and read-only 2D/3D filtering separate explicit tags, unclassified extrusion and travel");
