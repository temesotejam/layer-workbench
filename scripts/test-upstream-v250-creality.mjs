// Assert actual pinned v2.5.0 Creality machine/process inheritance.
// Source files are downloaded by CI and remain on that runner.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {extractVendorProfileRecords} from "./orca-vendor-index.mjs";
import {resolveOrcaProfileFamily,resolveOrcaProfileCollection} from "./orca-profile-collection.mjs";

const fixture=JSON.parse(readFileSync("upstream-v250-creality-fixture.json","utf8"));
assert.equal(fixture.upstream_commit,"40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19");
assert.equal(fixture.vendor_index.name,"Creality");
const indexed=extractVendorProfileRecords(fixture.vendor_index,fixture.files);
assert.equal(indexed.records.length,6);
const machine=resolveOrcaProfileFamily(indexed.records,"machine","Creality CR-10 0.4 nozzle");
const process=resolveOrcaProfileFamily(indexed.records,"process","0.20mm Standard @Creality CR-10 0.4 nozzle");
assert.deepEqual(machine.chain,["fdm_machine_common","fdm_creality_common","Creality CR-10 0.4 nozzle"]);
assert.deepEqual(process.chain,["fdm_process_common","fdm_process_creality_common","0.20mm Standard @Creality CR-10 0.4 nozzle"]);
assert.equal(machine.settings.nozzle_diameter,"0.4");
assert.equal(machine.settings.printable_height,"400");
assert.equal(process.settings.layer_height,"0.2");
assert.equal(process.settings.wall_loops,"2");
// Pinned Orca v2.5.0 ships child overrides: 5 top and 4 bottom solid layers.
// These are tested native process keys, not inferred desktop GUI defaults.
assert.equal(process.settings.top_shell_layers,"5");
assert.equal(process.settings.bottom_shell_layers,"4");
assert.ok(!process.unsupported.includes("top_shell_layers"));
assert.ok(!process.unsupported.includes("bottom_shell_layers"));
assert.equal(process.settings.sparse_infill_density,"15");
assert.ok(process.compatible.includes("Creality CR-10 0.4 nozzle"));
assert.ok(machine.unsupported.length>10);
assert.ok(process.unsupported.length>10);
// Resolve one actual printer/process and the actual upstream Generic PLA
// library across TWO distinct vendor indexes. It is valid for a simple
// compatibility audit, not proof that all unsupported fields were applied.
const filamentFixture=JSON.parse(readFileSync("upstream-v250-filament-fixture.json","utf8"));
const filamentIndexed=extractVendorProfileRecords(filamentFixture.vendor_index,filamentFixture.files);
const combined=resolveOrcaProfileCollection(
  [...indexed.records,...filamentIndexed.records],
  {
    machine:"Creality CR-10 0.4 nozzle",
    filament:"Generic PLA @System",
    process:"0.20mm Standard @Creality CR-10 0.4 nozzle",
  },
);
assert.equal(combined.machine.settings.nozzle_diameter,"0.4");
assert.equal(combined.filament.settings.nozzle_temperature,"220");
assert.equal(combined.process.settings.sparse_infill_density,"15");
assert.equal(combined.process.compatible.length,1);
assert.equal(combined.process.compatible[0],combined.machine.name);
console.log("PASS: combined actual CR-10 printer + generic PLA + 0.20mm process compatibility");
console.log("PASS: actual pinned CR-10 machine inheritance and 0.20mm process profile");
console.log("Real machine supported keys:",JSON.stringify(machine.settings));
console.log("Real process supported keys:",JSON.stringify(process.settings));
console.log("Unsupported real machine/process keys:",machine.unsupported.length,process.unsupported.length);
