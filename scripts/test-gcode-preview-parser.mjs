import assert from 'node:assert/strict';
import {parseGcodeToolpaths} from './gcode-preview-parser.mjs';
import {gcodeSelectorColor} from './gcode-tool-colors.mjs';
const sample=`G21
G90
M82
G92 E0
G0 X10 Y10 Z0.2
G1 X20 Y10 E1
G1 X20 Y20 E2
G0 X10 Y20
G1 X10 Y10 E3
G0 Z0.4
M83
G91
G1 X10 E0.6
G1 Y10 E0.6
G0 X-20
G92 E0
G2 X1 Y1 I1 J0
`;
const result=parseGcodeToolpaths(sample);
assert.equal(result.extrusions,5);
assert.ok(result.travels>4, 'the final clockwise arc is tessellated as travel');
assert.equal(result.skippedArcs,0);
assert.equal(result.renderedArcs,1);
assert.deepEqual(result.layers.map(layer=>layer.z),[0.2,0.4]);
assert.equal(result.layers[0].segments[0].x2,10);
assert.equal(result.layers[1].segments[1].x2,20);
assert.throws(()=>parseGcodeToolpaths('G1 X10', {maxSegments:0}), /complex/);
assert.throws(()=>parseGcodeToolpaths('G1 X100001'), /limits/);
// Quarter-circle: XY I/J are relative to the move start by default.
const arc=parseGcodeToolpaths("G21\nG90\nM82\nG0 X10 Y0 Z0.2\nG3 X0 Y10 I-10 J0 E1\nG1 X0 Y20 E2");
assert.equal(arc.renderedArcs,1);
assert.equal(arc.skippedArcs,0);
assert.ok(arc.extrusions>2);
const path=arc.layers[0].segments;
assert.deepEqual([path[1].x1,path[1].y1],[10,0]);
assert.ok(path.some(p=>p.x2>6.5&&p.x2<7.5&&p.y2>6.5&&p.y2<7.5));
assert.deepEqual([path.at(-1).x1,path.at(-1).y1,path.at(-1).x2,path.at(-1).y2],[0,10,0,20]);
// Full circles must be visualized, even with no explicit X/Y endpoint.
const circle=parseGcodeToolpaths("G0 X10 Y0 Z0.2\nG2 I-10 J0 E1");
assert.equal(circle.renderedArcs,1);
assert.ok(circle.extrusions>=36);
assert.ok(Math.abs(circle.layers[0].segments.at(-1).x2-10)<1e-8);
// A supported R semicircle is rendered; subsequent XY/E modal motion still aligns.
const semicircleFollowed=parseGcodeToolpaths("G0 X0 Y0 Z0.2\nG2 X10 Y0 R5 E1\nG1 X20 Y0 E2");
assert.equal(semicircleFollowed.renderedArcs,1);
assert.equal(semicircleFollowed.skippedArcs,0);
assert.deepEqual([semicircleFollowed.layers[0].segments.at(-1).x1,semicircleFollowed.layers[0].segments.at(-1).x2],[10,20]);
// Unsupported helical and non-XY arcs must not draw misleading chords.
const helix=parseGcodeToolpaths("G0 X10 Y0 Z0.2\nG3 X0 Y10 Z0.4 I-10 J0 E1\nG1 X0 Y20 E2");
assert.equal(helix.skippedArcs,1);
assert.equal(helix.layers.at(-1).segments.at(-1).y1,10);
const otherPlane=parseGcodeToolpaths("G18\nG2 X10 Z1 I5 E1\nG1 X20 E2");
assert.equal(otherPlane.skippedArcs,1);
assert.equal(otherPlane.layers.at(-1).segments.at(-1).x1,10);
// Relative XYZ and explicit absolute I/J center semantics.
const relative=parseGcodeToolpaths("G90\nG0 X10 Y0 Z0.2\nG91\nG3 X-10 Y10 I-10 J0 E1");
assert.equal(relative.renderedArcs,1);
const absCenter=parseGcodeToolpaths("G0 X10 Y0 Z0.2\nG90.1\nG3 X0 Y10 I0 J0 E1");
assert.equal(absCenter.renderedArcs,1);
assert.throws(()=>parseGcodeToolpaths("G0 X10 Y0\nG3 X0 Y10 I-10 J0 E1",{maxSegments:2}),/complex/);
assert.throws(()=>parseGcodeToolpaths("G0 X0",{maxSegments:-1}),/budget/);

// R radius center selection: positive R is the minor path, negative R the
// major path. Both must end exactly at the commanded point.
const rMinor=parseGcodeToolpaths("G0 X10 Y0 Z0.2\nG3 X0 Y10 R10 E1\nG1 X0 Y20 E2");
const rMajor=parseGcodeToolpaths("G0 X10 Y0 Z0.2\nG3 X0 Y10 R-10 E1\nG1 X0 Y20 E2");
const rClockwise=parseGcodeToolpaths("G0 X10 Y0 Z0.2\nG2 X0 Y10 R10 E1");
assert.equal(rMinor.renderedArcs,1);
assert.equal(rMajor.renderedArcs,1);
assert.equal(rClockwise.renderedArcs,1);
assert.ok(rMinor.segments<rMajor.segments, 'negative R takes the long way');
assert.ok(rMinor.layers[0].segments.some(p=>p.x2>6.5&&p.x2<7.5&&p.y2>6.5&&p.y2<7.5));
assert.deepEqual([rMajor.layers[0].segments.at(-1).x1,rMajor.layers[0].segments.at(-1).y1],[0,10]);
assert.ok(rClockwise.layers[0].segments.some(p=>p.x2<3.5&&p.y2<3.5));
const rSemicircle=parseGcodeToolpaths("G0 X0 Y0 Z0.2\nG2 X10 Y0 R5 E1");
assert.equal(rSemicircle.renderedArcs,1);
assert.ok(rSemicircle.layers[0].segments.some(p=>p.y2>4.9));
const invalidRadius=parseGcodeToolpaths("G0 X0 Y0 Z0.2\nG2 X10 Y0 R4 E1\nG1 X20 Y0 E2");
assert.equal(invalidRadius.skippedArcs,1);
assert.deepEqual([invalidRadius.layers[0].segments.at(-1).x1,invalidRadius.layers[0].segments.at(-1).x2],[10,20]);
assert.equal(parseGcodeToolpaths("G0 X0 Y0 Z0.2\nG2 R10").skippedArcs,1);
assert.equal(parseGcodeToolpaths("G0 X0 Y0 Z0.2\nG2 X10 Y0 R5 I5").skippedArcs,1);
assert.equal(parseGcodeToolpaths("G0 X0 Y0 Z0.2\nG2 X10 Y0 R-5").skippedArcs,1);
const inchRadius=parseGcodeToolpaths("G20\nG0 X1 Y0 Z0.01\nG3 X0 Y1 R1");
assert.equal(inchRadius.renderedArcs,1);
assert.throws(()=>parseGcodeToolpaths("G0 X10 Y0\nG3 X0 Y10 R10",{maxSegments:2}),/complex/);
console.log('PASS: bounded XY arcs (CW, CCW, full circle, absolute and relative center), R minor/major/semicircles, skipped endpoint safety');
console.log('PASS: G-code linear extrusion, travel, layers, relative moves, safety limits');

// Material preview labels are the explicit T selectors, not filament slots or nozzle count.
// T1000 (reserved vendor command) must not be reported as a material label.
const multiToolGcode=[
  "G90","M82","G0 X0 Y0 Z0.2","T0","G1 X10 Y0 E1",
  "T3","G1 X20 Y0 E2","T1000","G1 X30 Y0 E3",
  "N15 T2","G1 X40 Y0 E4"
].join("\n");
const labeled=parseGcodeToolpaths(multiToolGcode);
assert.deepEqual(labeled.selectedToolIds,[0,2,3]);
assert.deepEqual(labeled.extrusionSegmentsByTool,{"0":1,"2":1,"3":2});
assert.deepEqual(labeled.layers[0].segments.filter(s=>s.extrusion).map(s=>s.toolId),[0,3,3,2]);
assert.equal(labeled.extrusions,4);
const noTool=parseGcodeToolpaths("G1 X1 Y1 E1");
assert.deepEqual(noTool.selectedToolIds,[]);
assert.deepEqual(noTool.extrusionSegmentsByTool,{unselected:1});
assert.equal(noTool.layers[0].segments[0].toolId,null);
assert.equal(gcodeSelectorColor(0,false),gcodeSelectorColor(3,false));
assert.notEqual(gcodeSelectorColor(0,true),gcodeSelectorColor(3,true));
assert.equal(gcodeSelectorColor(null,true),gcodeSelectorColor(0,false));
assert.throws(()=>gcodeSelectorColor(256,true),/selector/);
// The supplied real X1E G-code unloads filament using M620 S255 / T255.
// This vendor sentinel is not a third material. Subsequent deposition is unlabeled.
const afterUnload=parseGcodeToolpaths("G90\nM82\nT0\nG1 X1 Y0 E1\nT255\nG1 X2 Y0 E2\nT1000\nG1 X3 Y0 E3");
assert.deepEqual(afterUnload.selectedToolIds,[0]);
assert.deepEqual(afterUnload.layers[0].segments.map(s=>s.toolId),[0,null,null]);
assert.deepEqual(afterUnload.extrusionSegmentsByTool,{"0":1,unselected:2});
console.log("PASS: tool-aware G-code toolpaths, vendor T1000 guard, 2D/3D palette mapping");

// A malformed word must not be silently shortened and plotted. Preserve
// the last valid modal position when rejecting the whole movement.
const malformed=parseGcodeToolpaths(
  "G90\nM82\nG1 X10oops Y5 E1\nG1 X20 Y0 E2\nG1 X30 Y0 E3"
);
assert.equal(malformed.skippedMalformedMotion,1);
assert.equal(malformed.extrusions,2);
assert.deepEqual(
  malformed.layers[0].segments.map(s=>[s.x1,s.x2]),[[0,20],[20,30]]
);
const duplicateWords=parseGcodeToolpaths("G1 X10 X20 E1\nG1 X5 E2");
assert.equal(duplicateWords.skippedMalformedMotion,1);
assert.equal(duplicateWords.extrusions,1);
assert.equal(duplicateWords.layers[0].segments[0].x1,0);
const malformedChecksum=parseGcodeToolpaths("G1 X10 E1*99\nG1 X2 E2");
assert.equal(malformedChecksum.skippedMalformedMotion,1);
assert.equal(malformedChecksum.extrusions,1);
const compact=parseGcodeToolpaths("G90\nM82\nG1X10Y0Z0.2E1F1200\nN15G1X20Y0E2");
assert.equal(compact.skippedMalformedMotion,0);
assert.equal(compact.extrusions,2);
assert.deepEqual(compact.layers[0].segments.map(s=>s.x2),[10,20]);
const signedExponent=parseGcodeToolpaths("G1 X1E+1 Y0 E1");
assert.equal(signedExponent.skippedMalformedMotion,0);
assert.equal(signedExponent.layers[0].segments[0].x2,10);
const unsupportedAxis=parseGcodeToolpaths("G1 X10 A10 E1\nG1 X2 E2");
assert.equal(unsupportedAxis.skippedMalformedMotion,1);
console.log("PASS: full-word lexing rejects malformed/duplicate/unknown motion words without phantom paths; compact numeric G-code supported");
