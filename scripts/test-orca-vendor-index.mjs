import assert from "node:assert/strict";
import {extractVendorProfileRecords,resolveIndexedOrcaProfiles,validateProfilePath} from "./orca-vendor-index.mjs";

const index={
 name:"Sample Vendor",version:"01.00.00.00",
 machine_model_list:[{name:"Test Printer",sub_path:"machine/Test Printer.json"}],
 machine_list:[
  {name:"fdm_machine_common",sub_path:"machine/fdm_machine_common.json"},
  {name:"Test Printer 0.4 nozzle",sub_path:"machine/Test Printer 0.4 nozzle.json"},
 ],
 filament_list:[{name:"Generic PLA @Test",sub_path:"filament/Generic PLA @Test.json"}],
 process_list:[{name:"0.20mm Standard @Test",sub_path:"process/0.20mm Standard @Test.json"}],
};
const files={
 "machine/Test Printer.json":{type:"machine_model",name:"Test Printer",nozzle_diameter:"0.4"},
 "machine/fdm_machine_common.json":{type:"machine",name:"fdm_machine_common",nozzle_diameter:["0.4"],printable_height:"250"},
 "machine/Test Printer 0.4 nozzle.json":{type:"machine",name:"Test Printer 0.4 nozzle",inherits:"fdm_machine_common"},
 "filament/Generic PLA @Test.json":{type:"filament",name:"Generic PLA @Test",nozzle_temperature:["210"],bed_temperature:["55"],compatible_printers:["Test Printer 0.4 nozzle"]},
 "process/0.20mm Standard @Test.json":{type:"process",name:"0.20mm Standard @Test",layer_height:"0.2",wall_loops:"2",compatible_printers:["Test Printer 0.4 nozzle"]},
};
const selection={machine:"Test Printer 0.4 nozzle",filament:"Generic PLA @Test",process:"0.20mm Standard @Test"};
const extracted=extractVendorProfileRecords(index,files);
assert.equal(extracted.models[0].type,"machine_model");
assert.equal(extracted.records.length,4);
const resolved=resolveIndexedOrcaProfiles(index,files,selection);
assert.equal(resolved.machine.settings.nozzle_diameter,"0.4");
assert.equal(resolved.filament.settings.nozzle_temperature,"210");
assert.equal(resolved.source.vendor,"Sample Vendor");
for (const unsafe of ["../escape.json","machine/../../file.json","/machine/foo.json","machine\\bad.json","machine/.hidden.json","filament/../x.json","https://host/x.json"]) {
  assert.throws(()=>validateProfilePath(unsafe),/Unsafe|Unsupported/);
}
assert.throws(()=>extractVendorProfileRecords(index,{...files,"process/rogue.json":{}}),/Unindexed/);
assert.throws(()=>extractVendorProfileRecords(index,{...files,"machine/fdm_machine_common.json":undefined}),/Missing/);
assert.throws(()=>extractVendorProfileRecords(index,{...files,"machine/fdm_machine_common.json":{type:"filament",name:"fdm_machine_common"}}),/mismatch/);
assert.throws(()=>extractVendorProfileRecords({...index,version:"invalid"},files),/metadata/);
console.log("PASS: Orca vendor index registration, model separation, single-value vectors and path safety");
