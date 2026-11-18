import assert from 'node:assert/strict';
import {parseGcodeToolpaths,isPlanarLayerSegment} from './gcode-preview-parser.mjs';
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
// Helical G17 XY arcs interpolate Z linearly, not as a horizontal chord.
// The destination layer groups the entire arc so the 2D picker remains bounded.
const helix=parseGcodeToolpaths("G0 X10 Y0 Z0.2\nG3 X0 Y10 Z0.4 I-10 J0 E1\nG1 X0 Y20 E2");
assert.equal(helix.renderedArcs,1);
assert.equal(helix.skippedArcs,0);
assert.deepEqual(helix.layers.map(layer=>layer.z),[0.2,0.4]);
const helixParts=helix.layers.at(-1).segments.slice(0,-1);
assert.ok(helixParts.length>=15);
assert.equal(helixParts[0].z1,0.2);
assert.ok(helixParts.every(p=>p.z2>p.z1));
assert.ok(Math.abs(helixParts.at(-1).z2-0.4)<1e-9);
assert.deepEqual([helix.layers.at(-1).segments.at(-1).y1,helix.layers.at(-1).segments.at(-1).y2],[10,20]);

 // 2D must never project helical/vertical-plane deposition as a horizontal
 // line at the commanded destination layer. 3D keeps every XYZ segment.
assert.ok(helixParts.every(p=>!isPlanarLayerSegment(p,0.4)));
assert.ok(isPlanarLayerSegment(helix.layers.at(-1).segments.at(-1),0.4));
assert.equal(isPlanarLayerSegment({z1:0.2,z2:0.4},0.4),false);
assert.equal(isPlanarLayerSegment({z1:0.2,z2:0.2},0.4),false);
assert.equal(isPlanarLayerSegment({z1:0.20049,z2:0.20049},0.2),true);
assert.equal(isPlanarLayerSegment({z1:0.2,z2:0.2},NaN),false);
assert.equal(isPlanarLayerSegment({z1:NaN,z2:0.2},0.2),false);
assert.equal(isPlanarLayerSegment({},0.2),true); // old records without source heights
const zOnlyTravel=parseGcodeToolpaths("G0 X0 Y0 Z0.2\\nG0 Z0.4\\nG1 X10 E1");
assert.equal(isPlanarLayerSegment(zOnlyTravel.layers.at(-1).segments[0],0.4),false);
assert.equal(isPlanarLayerSegment(zOnlyTravel.layers.at(-1).segments[1],0.4),true);

// A full-circle helix has no XY endpoint displacement but still winds in 3D.
const risingCircle=parseGcodeToolpaths("G0 X10 Y0 Z0.2\nG2 Z0.6 I-10 J0 E1");
assert.equal(risingCircle.renderedArcs,1);
assert.ok(risingCircle.layers.at(-1).segments.length>=36);
assert.equal(risingCircle.layers.at(-1).segments[0].z1,0.2);
assert.ok(Math.abs(risingCircle.layers.at(-1).segments.at(-1).z2-0.6)<1e-9);
assert.ok(Math.abs(risingCircle.layers.at(-1).segments.at(-1).x2-10)<1e-9);
const rHelix=parseGcodeToolpaths("G0 X0 Y0 Z0.2\nG2 X10 Y0 Z0.7 R5 E1");
assert.equal(rHelix.renderedArcs,1);
assert.equal(rHelix.layers.at(-1).segments.at(-1).z2,0.7);
const relativeHelix=parseGcodeToolpaths("G0 X10 Y0 Z0.2\nG91\nG3 X-10 Y10 Z0.3 I-10 J0 E1");
assert.equal(relativeHelix.renderedArcs,1);
assert.ok(Math.abs(relativeHelix.layers.at(-1).segments.at(-1).z2-0.5)<1e-9);
// Non-XY planes remain unsupported and may not become fake straight chords;
// their endpoint still advances for the next valid motion.
const otherPlane=parseGcodeToolpaths("G18\nG2 X10 Z1 I5 E1\nG1 X20 E2");
assert.equal(otherPlane.skippedArcs,1);
assert.equal(otherPlane.layers.at(-1).segments.at(-1).x1,10);
// G18/G19 use the K word for a Z-center offset. The preview deliberately
// omits their curves, but must still advance XYZ/E before a later G1.
// Otherwise the later extrusion is falsely drawn from the old endpoint.
for(const [plane,arc,next,axis] of [
  ["G18","G2 X10 Z1 I5 K0 E1","G1 X20 E2","x"],
  ["G19","G3 Y10 Z1 J5 K0 E1","G1 Y20 E2","y"],
]){
  const nonXY=parseGcodeToolpaths(`G21\nG90\nM82\n${plane}\nG0 X0 Y0 Z0\n${arc}\n${next}`);
  assert.equal(nonXY.renderedArcs,0);
  assert.equal(nonXY.skippedArcs,1);
  assert.equal(nonXY.skippedMalformedMotion,0);
  assert.equal(nonXY.extrusions,1);
  const deposited=nonXY.layers.at(-1).segments.at(-1);
  assert.equal(deposited[axis+"1"],10);
  assert.equal(deposited[axis+"2"],20);
  assert.equal(deposited.z1,1);
  assert.equal(deposited.z2,1);
}
// K is not a center offset of the supported G17 XY plane. Reject the
// geometry as unhandled while preserving its commanded endpoint and E.
const xyWithK=parseGcodeToolpaths("G17\nG90\nM82\nG0 X10 Y0 Z0.2\nG3 X0 Y10 I-10 J0 K1 E1\nG1 X0 Y20 E2");
assert.equal(xyWithK.renderedArcs,0);
assert.equal(xyWithK.skippedArcs,1);
assert.equal(xyWithK.skippedMalformedMotion,0);
assert.deepEqual(xyWithK.layers.at(-1).segments.at(-1).y1,10);
assert.deepEqual(xyWithK.layers.at(-1).segments.at(-1).y2,20);
// A K word on linear moves is still unsupported: it cannot shift modal
// XYZ/E or silently create a false extrusion.
const linearWithK=parseGcodeToolpaths("G90\nM82\nG1 X10 K1 E1\nG1 X20 E2");
assert.equal(linearWithK.skippedMalformedMotion,1);
assert.deepEqual(linearWithK.layers[0].segments.map(s=>[s.x1,s.x2]),[[0,20]]);
console.log("PASS: invalid G18/G19 arcs preserve modal endpoints");

// Bounded vertical-plane arcs are now tessellated in real XYZ (not a
// misleading XY chord). G18 uses a right-handed ZX basis, G19 a YZ basis.
const verticalXZ=parseGcodeToolpaths("G21\nG90\nM82\nG0 X0 Y0 Z10\nG18\nG3 X10 Y5 Z0 I0 K-10 E1\nG1 X20 E2");
assert.equal(verticalXZ.renderedArcs,1);
assert.equal(verticalXZ.skippedArcs,0);
assert.equal(verticalXZ.skippedMalformedMotion,0);
const xzSegments=verticalXZ.layers.find(l=>l.z===0).segments;
assert.ok(xzSegments.some(p=>p.x2>6.5&&p.x2<7.5&&p.z2>6.5&&p.z2<7.5),
  'G18 midpoint should lie on the XZ quarter circle');
assert.ok(xzSegments.slice(0,-1).every(p=>p.y2>=p.y1&&p.y2<=5),
  'G18 third-axis Y helix must be interpolated');
assert.deepEqual([xzSegments.at(-1).x1,xzSegments.at(-1).x2,
  xzSegments.at(-1).y1,xzSegments.at(-1).z1],[10,20,5,0]);
assert.ok(xzSegments.slice(0,-1).every(p=>!isPlanarLayerSegment(p,0)));
assert.ok(isPlanarLayerSegment(xzSegments.at(-1),0));

const verticalYZ=parseGcodeToolpaths("G21\nG90\nM82\nG0 X0 Y10 Z0\nG19\nG3 X5 Y0 Z10 J-10 K0 E1\nG1 Y-10 E2");
assert.equal(verticalYZ.renderedArcs,1);
assert.equal(verticalYZ.skippedArcs,0);
const yzSegments=verticalYZ.layers.find(l=>l.z===10).segments;
assert.ok(yzSegments.some(p=>p.y2>6.5&&p.y2<7.5&&p.z2>6.5&&p.z2<7.5),
  'G19 midpoint should lie on the YZ quarter circle');
assert.ok(yzSegments.slice(0,-1).every(p=>p.x2>=p.x1&&p.x2<=5),
  'G19 third-axis X helix must be interpolated');
assert.deepEqual([yzSegments.at(-1).y1,yzSegments.at(-1).y2,
  yzSegments.at(-1).x1,yzSegments.at(-1).z1],[0,-10,5,10]);

for(const input of [
  "G18\nG0 X0 Z10\nG3 X10 Z0 R10 E1",
  "G19\nG0 Y10 Z0\nG3 Y0 Z10 R10 E1",
  "G18\nG0 X10 Z0\nG2 X0 Z10 I-10 K0 E1",
  "G18\nG0 X0 Z10\nG90.1\nG3 X10 Z0 I0 K0 E1",
  "G19\nG0 Y10 Z0\nG91\nG3 Y-10 Z10 J-10 K0 E1",
]){
  const rotated=parseGcodeToolpaths(input);
  assert.equal(rotated.renderedArcs,1,input);
  assert.equal(rotated.skippedArcs,0,input);
}
const verticalCircle=parseGcodeToolpaths("G18\nG0 X10 Z0\nG2 I-10 K0 E1");
assert.equal(verticalCircle.renderedArcs,1);
assert.ok(verticalCircle.extrusions>=36);
const invalidVertical=parseGcodeToolpaths("G18\nG0 X0 Z10\nG3 X10 Z0 I0 K-10 J1 E1\nG1 X20 E2");
assert.equal(invalidVertical.renderedArcs,0);
assert.equal(invalidVertical.skippedArcs,1);
assert.equal(invalidVertical.extrusions,1);
assert.equal(invalidVertical.layers.find(l=>l.z===0).segments.at(-1).x1,10);
const repeatTurnVertical=parseGcodeToolpaths("G19\nG0 Y10 Z0\nG3 Y0 Z10 J-10 K0 P2 E1\nG1 Y-10 E2");
assert.equal(repeatTurnVertical.renderedArcs,0);
assert.equal(repeatTurnVertical.skippedArcs,1);
assert.equal(repeatTurnVertical.layers.at(-1).segments.at(-1).y1,0);
assert.throws(()=>parseGcodeToolpaths("G18\nG0 X0 Z10\nG3 X10 Z0 I0 K-10 E1",{maxSegments:4}),/complex/);
console.log("PASS: bounded G18/G19 vertical arcs and helices render real 3D geometry; invalid/extra-turn forms omit safely");

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
// Auxiliary G2/G3 P words can represent multiple turns in some firmware.
// Without implementing their semantics, drawing a single-turn arc is wrong.
// S is also not interpreted; omit these arcs but preserve the commanded
// modal endpoint for the next supported linear move.
for(const auxiliary of ["P2","S1"]){
  const omitted=parseGcodeToolpaths("G90\nM82\nG0 X0 Y0 Z0.2\nG2 X10 Y0 R5 "+auxiliary+" E1\nG1 X20 Y0 E2");
  assert.equal(omitted.renderedArcs,0);
  assert.equal(omitted.skippedArcs,1);
  assert.equal(omitted.skippedMalformedMotion,0);
  assert.equal(omitted.extrusions,1);
  assert.deepEqual(omitted.layers[0].segments.filter(s=>s.extrusion).map(s=>[s.x1,s.x2]),[[10,20]]);
}
// Non-arc unhandled words must not change XYZ/E modal state or generate a
// phantom deposition path, including malformed G92 coordinate resets.
const ignoredAuxLinear=parseGcodeToolpaths("G90\nM82\nG1 X10 P2 E1\nG1 X20 E2");
assert.equal(ignoredAuxLinear.skippedMalformedMotion,1);
assert.deepEqual(ignoredAuxLinear.layers[0].segments.map(s=>[s.x1,s.x2]),[[0,20]]);
const ignoredAuxReset=parseGcodeToolpaths("G90\nM82\nG1 X10 E1\nG92 X99 S1\nG1 X20 E2");
assert.equal(ignoredAuxReset.skippedMalformedMotion,1);
assert.deepEqual(ignoredAuxReset.layers[0].segments.map(s=>[s.x1,s.x2]),[[0,10],[10,20]]);
console.log("PASS: unsupported auxiliary arc words omit misleading paths while retaining modal endpoints");

console.log('PASS: bounded XY planar/helical arcs (CW, CCW, full circle, absolute/relative center), R minor/major, Z interpolation and skipped endpoint safety');
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
// Commanded F is modal and measured in mm/min, not realized head speed.
// It applies to extrusion and travel, survives movements without F, and
// follows G20/G21 unit changes. Reject bad F without changing position.
const modalFeed=parseGcodeToolpaths("G21\nG90\nM82\nG0 X10 F2400\nG1 X20 E1 F1200\nG1 X30 E2\nG1 X40 E3 F900");
assert.deepEqual(modalFeed.layers[0].segments.map(s=>s.feedrateMmMin),[2400,1200,1200,900]);
const inchFeed=parseGcodeToolpaths("G20\nG1 X1 E1 F60\nG1 X2 E2");
assert.deepEqual(inchFeed.layers[0].segments.map(s=>s.feedrateMmMin),[1524,1524]);
const badFeed=parseGcodeToolpaths("G90\nM82\nG1 X10 E1 F0\nG1 X20 E2 F1200\nG1 X30 E3 Fbad\nG1 X40 E4");
assert.equal(badFeed.skippedMalformedMotion,2);
assert.deepEqual(badFeed.layers[0].segments.map(s=>[s.x1,s.x2,s.feedrateMmMin]),
  [[0,20,1200],[20,40,1200]]);
assert.equal(parseGcodeToolpaths("G1 X1 E1").layers[0].segments[0].feedrateMmMin,null);
console.log("PASS: modal commanded feedrate in mm/min, inch conversion, missing F and invalid F safety");
console.log("PASS: full-word lexing rejects malformed/duplicate/unknown motion words without phantom paths; compact numeric G-code supported");


// Preserve explicit slicer feature tags on real deposited path segments.
// Mere mentions of "gap infill" in config comments must NOT classify motion.
const typed=parseGcodeToolpaths([
  "; gap infill speed = 2", "G90", "M82", "G0 X0 Y0 Z0.2 F2400",
  ";TYPE:Outer wall", "G1 X10 Y0 E1 F1200",
  "; FEATURE: Gap infill", "G1 X20 Y0 E2 F120",
  ";TYPE:Sparse infill", "G1 X30 Y0 E3 F900",
  "; arbitrary gap infill note", "G1 X40 Y0 E4"
].join("\n"));
assert.deepEqual(typed.layers[0].segments.filter(s=>s.extrusion).map(s=>s.feature),
  ["outer wall","gap infill","sparse infill","sparse infill"]);
assert.deepEqual(typed.extrusionSegmentsByFeature,
  {"outer wall":1,"gap infill":1,"sparse infill":2});
const typedGap=typed.layers[0].segments.filter(s=>s.extrusion&&s.feature==="gap infill");
assert.deepEqual(typedGap.map(s=>s.feedrateMmMin),[120]);
// Ignore inline annotation that would ambiguously apply to a movement.
const inline=parseGcodeToolpaths("G90\nM82\nG1 X10 E1 F120 ;TYPE:Gap infill");
assert.deepEqual(inline.extrusionSegmentsByFeature,{unclassified:1});
// Feature labels alone are NOT evidence of an actual extruded gap-fill path.
const tagWithoutDeposition=parseGcodeToolpaths(";TYPE:Gap infill\nG0 X10 F120\nG1 E1");
assert.deepEqual(tagWithoutDeposition.extrusionSegmentsByFeature,{});
// Malformed explicit tags must clear the prior label, not silently attribute
// following extrusion to the last valid feature. Free-text comments still
// leave the current slicer feature intact.
const invalidFeatureTags=parseGcodeToolpaths([
  "G90", "M82", "G0 X0 Y0 Z0.2",
  ";TYPE:Gap infill", "G1 X10 E1",
  ";TYPE:", "G1 X20 E2",
  ";FEATURE:"+"x".repeat(81), "G1 X30 E3",
  ";TYPE:Outer wall", "G1 X40 E4",
  ";FEATURE:gap infill;trailing annotation", "G1 X50 E5",
  "; ordinary gap infill note", "G1 X60 E6",
].join("\n"));
assert.deepEqual(invalidFeatureTags.layers[0].segments.filter(s=>s.extrusion).map(s=>s.feature),
  ["gap infill",null,null,"outer wall",null,null]);
assert.deepEqual(invalidFeatureTags.extrusionSegmentsByFeature,
  {"gap infill":1,unclassified:4,"outer wall":1});
console.log("PASS: invalid explicit TYPE/FEATURE comments clear stale classification");
console.log("PASS: explicit type/feature tag attribution, modal F and comment-only false-positive guard");
