// Assert actual pinned v2.5.0 Creality machine/process inheritance.
// Source files are downloaded by CI and remain on that runner.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {extractVendorProfileRecords} from "./orca-vendor-index.mjs";
import {resolveOrcaProfileFamily} from "./orca-profile-collection.mjs";

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
assert.equal(process.settings.sparse_infill_density,"15");
assert.ok(process.compatible.includes("Creality CR-10 0.4 nozzle"));
assert.ok(machine.unsupported.length>10);
assert.ok(process.unsupported.length>10);
console.log("PASS: actual pinned CR-10 machine inheritance and 0.20mm process profile");
console.log("Real machine supported keys:",JSON.stringify(machine.settings));
console.log("Real process supported keys:",JSON.stringify(process.settings));
console.log("Unsupported real machine/process keys:",machine.unsupported.length,process.unsupported.length);
