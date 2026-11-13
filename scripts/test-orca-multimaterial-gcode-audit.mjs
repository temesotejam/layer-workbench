import assert from "node:assert/strict";
import {auditMultiMaterialGcode} from "./orca-multimaterial-gcode-audit.mjs";
const fixture = `; CONFIG_BLOCK_START
; filament_map = 1,1,1,1
; nozzle_diameter = 0.4
; filament_flow_ratio = 0.98,0.98,0.98,0.98
; nozzle_temperature = 220,220,220,220
; filament_max_volumetric_speed = 21,21,21,21
; flush_volumes_matrix = 0,209,61,193,79,0,77,120,61,213,0,197,65,95,65,0
; enable_prime_tower = 1
; prime_tower_width = 35
; nozzle_volume_type = Standard
; CONFIG_BLOCK_END
T0
M620 S0A
M621 S0A
M620.1 E F523.843 T240
T3
M624 AgAAAAAAAAA=
M625
T1000
`;
const r=auditMultiMaterialGcode(fixture);
assert.equal(r.classification,"multiple-filament-slots-single-physical-extruder");
assert.equal(r.config.physicalNozzleCount,1);
assert.equal(r.config.filamentSlotCount,4);
assert.deepEqual(r.config.filamentMap,[1,1,1,1]);
assert.equal(r.config.flushMatrixSize,4);
assert.equal(r.config.primeTowerEnabled,true);
assert.equal(r.config.primeTowerWidth,35);
assert.deepEqual(r.commands.distinctToolIds,[0,3]);
assert.equal(r.commands.ams.M620,1);
assert.equal(r.commands.ams.M621,1);
assert.equal(r.commands.ams["M620.1"],1);
assert.equal(r.commands.primeTower.M624,1);
assert.equal(r.commands.primeTower.M625,1);
assert.throws(()=>auditMultiMaterialGcode(fixture.replace("1,1,1,1","1,2,1,1")),/missing physical extruder/);
assert.throws(()=>auditMultiMaterialGcode(fixture.replace("0,209,61,193,79,0,77,120,61,213,0,197,65,95,65,0","0,1,2")),/square/);
assert.throws(()=>auditMultiMaterialGcode("; CONFIG_BLOCK_START\n".repeat(1000000)),/oversized|Too many/);
const fourTool=fixture.replace("; nozzle_diameter = 0.4","; nozzle_diameter = 0.4,0.4,0.4,0.4").replace("; filament_map = 1,1,1,1","; filament_map = 1,4,2,3");
assert.equal(auditMultiMaterialGcode(fourTool).classification,"multiple-physical-extruders");
console.log("PASS: single-nozzle multi-filament vs multi-extruder classification, flush matrix and command counts");
