import assert from "node:assert/strict";
import {resolveFullOrcaProfileFamily} from "./orca-full-profile.mjs";
import {inspectOrcaVariantInputs,ORCA_VARIANT_SOURCE} from "./orca-variant-input-inspection.mjs";
const machine=resolveFullOrcaProfileFamily([{type:"machine",name:"u1",nozzle_diameter:["0.4","0.4","0.4","0.4"]}],"machine","u1");
const filament=resolveFullOrcaProfileFamily([{type:"filament",name:"pla",nozzle_temperature:["220","220"],filament_flow_ratio:["0.98","0.98"],filament_diameter:["1.75"]}],"filament","pla");
const report=inspectOrcaVariantInputs(machine,filament);
assert.equal(report.physicalNozzleCount,4);
assert.deepEqual(report.filamentInputs.nozzle_temperature,["220","220"]);
assert.deepEqual(report.filamentInputs.filament_flow_ratio,["0.98","0.98"]);
assert.equal(report.selectedVariantIndex,null);
assert.equal(report.usableForPrinting,false);
assert.ok(report.nativeResolutionInputsMissing.includes("machine.extruder_variant_list"));
assert.equal(ORCA_VARIANT_SOURCE.commit,"40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19");
assert.throws(()=>inspectOrcaVariantInputs(machine,{type:"filament"}),/Expected resolved/);
assert.throws(()=>inspectOrcaVariantInputs(
 resolveFullOrcaProfileFamily([{type:"machine",name:"bad",nozzle_diameter:"0.4"}],"machine","bad"),filament),/vector/);
console.log("PASS: variant inputs remain distinct from filament routing and no variant is guessed");
