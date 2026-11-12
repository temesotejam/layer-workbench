import assert from 'node:assert/strict';
import {parseGcodeToolpaths} from './gcode-preview-parser.mjs';
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
assert.equal(result.travels,4);
assert.equal(result.skippedArcs,1);
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
// Skipped R arcs still advance X/Y/E so later lines have correct endpoints.
const skipped=parseGcodeToolpaths("G0 X0 Y0 Z0.2\nG2 X10 Y0 R5 E1\nG1 X20 Y0 E2");
assert.equal(skipped.renderedArcs,0);
assert.equal(skipped.skippedArcs,1);
assert.deepEqual([skipped.layers[0].segments.at(-1).x1,skipped.layers[0].segments.at(-1).x2],[10,20]);
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
console.log('PASS: bounded XY arcs (CW, CCW, full circle, absolute and relative center), skipped endpoint safety');
console.log('PASS: G-code linear extrusion, travel, layers, relative moves, safety limits');
