import assert from "node:assert/strict";
import {scanSupportExtrusion,auditSupportWidthEffect} from "./support-extrusion-diagnostic.mjs";

const make=(bodyE,interfaceE=1)=>[
  "G21","G90","M82","G92 E0","G0 X0 Y0 Z0.2",
  ";TYPE:Support","G1 X10 Y0 E"+bodyE+" F1800",
  "G92 E0",";TYPE:Support interface","G1 X20 Y0 E"+interfaceE+" F900",
].join("\n");
const baseline=make(1),wider=make(1.8);
const measured=scanSupportExtrusion(baseline);
assert.equal(measured.body.deposited_xy_segments,1);
assert.equal(measured.body.positive_filament_e_mm,1);
assert.equal(measured.body.filament_e_per_xy_mm,0.1);
assert.equal(measured.interface.positive_filament_e_mm,1);
const changed=auditSupportWidthEffect(baseline,wider);
assert.equal(changed.result,"observed_support_body_filament_feed_difference");
assert.equal(changed.body_filament_e_delta_mm,0.8);
assert.equal(changed.candidate.interface.positive_filament_e_mm,1);
assert.equal(changed.native_desktop_parity,false);
assert.equal(changed.printer_safe,false);
assert.equal(auditSupportWidthEffect(baseline,baseline).body_filament_e_changed,false);
console.log("PASS: exact positive-E XY support body deposition isolates E from interface");

const relative=[
  "G21","G90","M83","G0 X0 Y0 Z0.2",
  ";FEATURE:Support","G1 X10 Y0 E0.5","G1 X20 Y0 E0.5",
  "G1 E-0.4","G1 E0.4","G0 X30 Y0",
  ";TYPE:Support interface","G1 X40 Y0 E0.25",
].join("\n");
assert.equal(scanSupportExtrusion(relative).body.positive_filament_e_mm,1);
assert.equal(scanSupportExtrusion(relative).body.deposited_xy_segments,2);
assert.equal(scanSupportExtrusion(relative).interface.positive_filament_e_mm,0.25);
const inches=["G20","G91","M83",";TYPE:Support","G1 X1 Y0 E0.1"].join("\n");
assert.equal(scanSupportExtrusion(inches).body.positive_filament_e_mm,2.54);
assert.equal(scanSupportExtrusion(inches).body.deposited_xy_length_mm,25.4);
console.log("PASS: absolute/relative E, G92, retractions, pure E, unit changes");

const ignored=[
  "G21","G90","M82","G92 E0","G0 X0 Y0",
  ";TYPE:Support","G0 X10 Y0",
  ";TYPE:Unsupported","G1 X20 Y0 E1",
  ";TYPE:Support impostor","G1 X30 Y0 E2",
  ";TYPE:Support;spoof","G1 X40 Y0 E3",
  ";TYPE:constructor","G1 X50 Y0 E4",
  ";TYPE:Support","G1 E5",
  "G1 Z0.3 E6",
].join("\n");
assert.equal(scanSupportExtrusion(ignored).body.deposited_xy_segments,0);
assert.equal(auditSupportWidthEffect(ignored,ignored).result,"inconclusive_no_tagged_support_body");
assert.throws(()=>scanSupportExtrusion(";TYPE:Support\nG1 X10oops E1"),/Ambiguous/);
assert.throws(()=>scanSupportExtrusion(";TYPE:Support\nG2 X10 Y10 I5 J0 E1"),/Unsupported/);
assert.throws(()=>scanSupportExtrusion("G1 X100001"),/Out-of-range/);
assert.throws(()=>scanSupportExtrusion("x".repeat(20_000_001)),/oversized/);
console.log("PASS: spoof labels, travel, pure E and malformed/unsupported motion fail closed");
