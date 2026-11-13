// Check real pinned v2.5.0 vendor JSON, not merely synthetic catalog cases.
// This test does not claim that four-tool U1 slicing is implemented.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {extractOrcaVendorCatalog,selectOrcaFilamentPreset} from "./orca-vendor-catalog.mjs";

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
  assert.equal(found.entryCount,4);
  assert.equal(found.models.length,1);
  assert.equal(found.records.length,3);
  return found;
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

const prusa=vendor("Prusa");
assert.equal(prusa.models[0].name,"Prusa MK4S");
assert.ok(prusa.records.some(r=>r.name==="Prusa MK4S 0.4 nozzle"));
assert.ok(prusa.records.some(r=>r.name==="0.20mm STRUCTURAL @MK4S 0.4"));

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
console.log("PASS: actual v2.5.0 Snapmaker/Prusa/global vendor records, four-tool metadata and exact-printer filament precedence");
