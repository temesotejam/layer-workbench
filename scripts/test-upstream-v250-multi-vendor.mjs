// Check real pinned v2.5.0 vendor JSON, not merely synthetic catalog cases.
// This test does not claim that four-tool U1 slicing is implemented.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {extractOrcaVendorCatalog,selectOrcaFilamentPreset} from "./orca-vendor-catalog.mjs";
import {resolveOrcaProfileFamily} from "./orca-profile-collection.mjs";
import {resolveFullOrcaProfileFamily,inspectOrcaNozzleVector} from "./orca-full-profile.mjs";

const multi=JSON.parse(readFileSync("upstream-v250-multi-vendor-fixture.json","utf8"));
const global=JSON.parse(readFileSync("upstream-v250-filament-fixture.json","utf8"));
assert.equal(multi.upstream_commit,global.upstream_commit,"fixtures must share pinned commit");
assert.equal(multi.upstream_commit,"40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19");

const catalog=extractOrcaVendorCatalog([
  ...multi.vendors,
  {name:global.vendor_index.name,index:global.vendor_index,files:global.files}
]);
assert.deepEqual(catalog.vendorNames,["Snapmaker","Prusa","OrcaFilamentLibrary"]);
function vendor(name) {
  const found=catalog.vendors.find(v=>v.name===name);
  assert.ok(found,"expected vendor missing: "+name);
  assert.equal(found.entryCount,11,"expected full bounded root-to-leaf ancestry");
  assert.equal(found.models.length,1);
  assert.equal(found.records.length,10);
  return found;
}
function assertAncestry(vendorRecord,type,expected) {
  const records=vendorRecord.records.filter(r=>r.type===type);
  assert.deepEqual(records.map(r=>r.name),expected,type+" inheritance names");
  for(let i=1;i<records.length;i++)
    assert.equal(records[i].inherits,records[i-1].name,
      type+" ancestor must be the indexed record, not an invented fallback");
  assert.ok(!records[0].inherits,"root ancestor must not reference a missing parent");
  return records;
}
const snap=vendor("Snapmaker");
const u1=snap.records.find(r=>r.name==="Snapmaker U1 (0.4 nozzle)");
assert.equal(u1?.type,"machine");
assert.equal(u1.inherits,"fdm_U1");
assert.deepEqual(u1.nozzle_diameter,["0.4","0.4","0.4","0.4"]);
assert.match(u1.machine_start_gcode,/PRINT_START/);
const snapFilament=snap.records.find(r=>r.name==="Snapmaker PLA Basic @U1");
assert.deepEqual(snapFilament?.compatible_printers,["Snapmaker U1 (0.4 nozzle)"]);
assert.equal(snap.models[0].name,"Snapmaker U1");

assertAncestry(snap,"machine",["fdm_klipper","fdm_toolchanger","fdm_U1","Snapmaker U1 (0.4 nozzle)"]);
assertAncestry(snap,"filament",["Snapmaker PLA Basic @U1 base","Snapmaker PLA Basic @U1"]);
assertAncestry(snap,"process",["fdm_process_U1","fdm_process_U1_common",
  "fdm_process_U1_0.20","0.20 Standard @Snapmaker U1 (0.4 nozzle)"]);
// The restricted one-extruder WASM config importer must refuse four nozzles,
// not silently substitute the first vector element.
assert.throws(()=>resolveOrcaProfileFamily(snap.records,"machine","Snapmaker U1 (0.4 nozzle)"),
  /Multi-extruder setting not supported/);

const prusa=vendor("Prusa");
assert.equal(prusa.models[0].name,"Prusa MK4S");
assert.ok(prusa.records.some(r=>r.name==="Prusa MK4S 0.4 nozzle"));
assert.ok(prusa.records.some(r=>r.name==="0.20mm STRUCTURAL @MK4S 0.4"));

assertAncestry(prusa,"machine",["fdm_machine_common","fdm_machine_common_nextruder",
  "fdm_machine_common_mk4s","Prusa MK4S 0.4 nozzle"]);
assertAncestry(prusa,"filament",["fdm_filament_common","fdm_filament_pla",
  "Generic PLA @Prusa MK4S"]);
assertAncestry(prusa,"process",["fdm_process_common","process_common_mk4s",
  "0.20mm STRUCTURAL @MK4S 0.4"]);

const specialized=selectOrcaFilamentPreset(catalog,"Generic PLA","Prusa MK4S 0.4 nozzle");
assert.equal(specialized.vendor,"Prusa");
assert.equal(specialized.name,"Generic PLA @Prusa MK4S");
assert.equal(specialized.selectionReason,"printer-specific alias override");

const fallback=selectOrcaFilamentPreset(catalog,"Generic PLA","Snapmaker U1 (0.4 nozzle)");
assert.equal(fallback.vendor,"OrcaFilamentLibrary");
assert.equal(fallback.name,"Generic PLA @System");
assert.equal(fallback.selectionReason,"global @System fallback");

// Original multi-extruder shape must remain intact: this is not an approved
// one-extruder nozzle diameter or printer-specific G-code configuration.
assert.equal(u1.nozzle_diameter.length,4);

// The source-only resolver merges EVERY indexed native setting without turning
// the 4-nozzle printer into a single-extruder WASM configuration.
const snapFull=resolveFullOrcaProfileFamily(snap.records,"machine","Snapmaker U1 (0.4 nozzle)");
assert.deepEqual(snapFull.chain,["fdm_klipper","fdm_toolchanger","fdm_U1","Snapmaker U1 (0.4 nozzle)"]);
assert.deepEqual([...snapFull.settings.nozzle_diameter],["0.4","0.4","0.4","0.4"]);
assert.equal(snapFull.sourceByKey.nozzle_diameter,"Snapmaker U1 (0.4 nozzle)");
assert.equal(snapFull.settings.machine_start_gcode,u1.machine_start_gcode);
assert.deepEqual(inspectOrcaNozzleVector(snapFull).nozzleDiametersMm,[0.4,0.4,0.4,0.4]);
assert.equal(inspectOrcaNozzleVector(snapFull).supportedBySingleToolWasmAdapter,false);
assert.equal(snapFull.usableForPrinting,false);
const snapProcess=resolveFullOrcaProfileFamily(snap.records,"process","0.20 Standard @Snapmaker U1 (0.4 nozzle)");
assert.equal(snapProcess.chain.length,4);
assert.ok(Object.keys(snapProcess.settings).length>10);
const snapMaterial=resolveFullOrcaProfileFamily(snap.records,"filament","Snapmaker PLA Basic @U1");
assert.equal(snapMaterial.chain.length,2);
assert.deepEqual([...snapMaterial.settings.compatible_printers],["Snapmaker U1 (0.4 nozzle)"]);
const prusaFull=resolveFullOrcaProfileFamily(prusa.records,"machine","Prusa MK4S 0.4 nozzle");
assert.equal(prusaFull.chain.length,4);
assert.equal(inspectOrcaNozzleVector(prusaFull).toolCount,1);

console.log("PASS: actual v2.5.0 multi-vendor complete ancestry, full-option preservation, four-tool inspection and filament precedence");
