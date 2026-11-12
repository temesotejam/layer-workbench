// Check actual, pinned v2.5.0 upstream filament records fetched by CI.
// Assertions are on the authoritative source files, not synthetic fixtures.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {extractVendorProfileRecords} from "./orca-vendor-index.mjs";
import {resolveOrcaProfileFamily} from "./orca-profile-collection.mjs";

const fixture=JSON.parse(readFileSync("upstream-v250-filament-fixture.json","utf8"));
assert.equal(fixture.upstream_commit,"40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19");
assert.equal(fixture.vendor_index.name,"OrcaFilamentLibrary");
const indexed=extractVendorProfileRecords(fixture.vendor_index,fixture.files);
assert.equal(indexed.records.length,3);
assert.equal(indexed.entryCount,3);
const resolved=resolveOrcaProfileFamily(indexed.records,"filament","Generic PLA @System");
assert.deepEqual(resolved.chain,["fdm_filament_common","fdm_filament_pla","Generic PLA @System"]);
assert.equal(resolved.settings.nozzle_temperature,"220");
assert.ok(resolved.unsupported.includes("hot_plate_temp"),
  "Native bed-type temperature handling must remain explicitly unsupported");
assert.ok(resolved.unsupported.includes("filament_flow_ratio"),
  "Native filament flow-ratio handling must remain explicitly unsupported");
assert.deepEqual(resolved.compatible,[]);
assert.equal(resolved.record.name,"Generic PLA @System");
const hotBed=resolveOrcaProfileFamily(indexed.records,"filament","Generic PLA @System",{plateType:"hot"});
assert.equal(hotBed.settings.nozzle_temperature,"220");
assert.equal(hotBed.settings.bed_temperature,"55");
assert.equal(hotBed.selectedBed.plateType,"hot");
assert.equal(hotBed.selectedBed.source,"fdm_filament_pla");
assert.ok(!hotBed.unsupported.includes("hot_plate_temp"));
assert.deepEqual(hotBed.settings.hot_plate_temp_initial_layer,["55"]);
assert.deepEqual(hotBed.settings.hot_plate_temp,["55"]);
assert.equal(hotBed.settings.curr_bed_type,"High Temp Plate");
assert.equal(hotBed.selectedBed.initialLayerSource,"fdm_filament_pla");
assert.equal(hotBed.selectedBed.initialLayerTemperature,"55");
assert.ok(!hotBed.unsupported.includes("hot_plate_temp_initial_layer"));
console.log("PASS: official inherited hot-plate and first-layer temperatures 55 C selected explicitly");

assert.ok(resolved.unsupported.length>=10,
  "Real shipped preset must not be misrepresented as fully supported");
console.log("PASS: pinned real OrcaSlicer v2.5.0 Generic PLA @System indexed inheritance");
console.log("Confirmed native nozzle temperature:",resolved.settings.nozzle_temperature);
console.log("Unsupported official fields across selected chain:",resolved.unsupported.length);
