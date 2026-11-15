import assert from "node:assert/strict";
import {parseGcodeToolpaths} from "./gcode-preview-parser.mjs";
import {gcodeSegment3DVertices} from "./gcode-3d-vertices.mjs";

// Z-only travel must have distinct 3D endpoint heights. An XY+Z slope
// must not appear as horizontal extrusion at the destination layer.
const result=parseGcodeToolpaths([
  "G21","G90","M82",
  "G0 Z0.2",
  "G1 X10 E1",
  "G0 Z0.4",
  "G1 X20 Z0.6 E2"
].join("\n"));
assert.deepEqual(result.layers.map(layer=>layer.z),[0.2,0.4,0.6]);
const all=result.layers.flatMap(layer=>layer.segments.map(s=>({layerZ:layer.z,s})));
assert.equal(all.length,4);
assert.deepEqual(gcodeSegment3DVertices(all[0].s,all[0].layerZ),[0,0,0,0,0,0.2]);
assert.deepEqual(gcodeSegment3DVertices(all[1].s,all[1].layerZ),[0,0,0.2,10,0,0.2]);
assert.deepEqual(gcodeSegment3DVertices(all[2].s,all[2].layerZ),[10,0,0.2,10,0,0.4]);
assert.deepEqual(gcodeSegment3DVertices(all[3].s,all[3].layerZ),[10,0,0.4,20,0,0.6]);
assert.equal(all[2].s.extrusion,false);
assert.equal(all[3].s.extrusion,true);

// Relative Z movements and inch input are stored as absolute millimeters.
const relative=parseGcodeToolpaths("G20\nG90\nG0 Z1\nG91\nG0 Z0.5");
const zMoves=relative.layers.flatMap(layer=>layer.segments);
assert.deepEqual(gcodeSegment3DVertices(zMoves[0],25.4),[0,0,0,0,0,25.4]);
const secondInchMove=gcodeSegment3DVertices(zMoves[1],38.1);
assert.deepEqual(secondInchMove.slice(0,5),[0,0,25.4,0,0]);
assert.ok(Math.abs(secondInchMove[5]-38.1)<1e-8, "relative inches remain accurate in mm");

// Rendered helix segments must keep continuous, increasing 3D Z coordinates.
const helix=parseGcodeToolpaths("G0 X10 Y0 Z0.2\nG3 X0 Y10 Z0.4 I-10 J0 E1");
assert.equal(helix.renderedArcs,1);
const helixSegments=helix.layers.at(-1).segments;
assert.ok(helixSegments.length>=15);
const firstHelix3D=gcodeSegment3DVertices(helixSegments[0],0.4);
const lastHelix3D=gcodeSegment3DVertices(helixSegments.at(-1),0.4);
assert.equal(firstHelix3D[2],0.2);
assert.ok(firstHelix3D[5]>firstHelix3D[2]);
assert.ok(Math.abs(lastHelix3D[5]-0.4)<1e-9);
for(let i=1;i<helixSegments.length;i++){
  const previous=gcodeSegment3DVertices(helixSegments[i-1],0.4);
  const current=gcodeSegment3DVertices(helixSegments[i],0.4);
  assert.ok(Math.abs(previous[5]-current[2])<1e-9);
}

// The helper continues to accept legacy horizontal segments, but does not
// silently accept malformed non-finite 3D coordinates.
assert.deepEqual(gcodeSegment3DVertices({x1:1,y1:2,x2:3,y2:4},0.2),[1,2,0.2,3,4,0.2]);
assert.throws(()=>gcodeSegment3DVertices({x1:1,y1:2,x2:3,y2:4,z1:Infinity,z2:0.2},0.2),/Invalid/);
console.log("PASS: G-code 3D endpoints preserve Z-only, sloped, helical, relative and inch moves");
