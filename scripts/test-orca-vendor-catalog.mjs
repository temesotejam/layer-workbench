import assert from "node:assert/strict";
import {extractOrcaVendorCatalog,selectOrcaFilamentPreset} from "./orca-vendor-catalog.mjs";

function vendor(name,nozzle) {
  const index={name,version:"01.00.00.00",machine_model_list:[],filament_list:[],process_list:[],
    machine_list:[{name:"Common Printer",sub_path:"machine/Common Printer.json"}]};
  const files={"machine/Common Printer.json":{type:"machine",name:"Common Printer",nozzle_diameter:[String(nozzle)],printable_height:"250"}};
  return {name,index,files};
}
const catalog=extractOrcaVendorCatalog([vendor("Vendor A",0.4),vendor("Vendor B",0.6)]);
assert.deepEqual(catalog.vendorNames,["Vendor A","Vendor B"]);
assert.equal(catalog.vendors[0].records[0].name,catalog.vendors[1].records[0].name);
assert.equal(catalog.vendors[0].namespace,"Vendor A");
assert.equal(catalog.vendors[1].namespace,"Vendor B");
assert.equal(catalog.vendors[0].records[0].nozzle_diameter[0],"0.4");
assert.equal(catalog.vendors[1].records[0].nozzle_diameter[0],"0.6");
assert.throws(()=>extractOrcaVendorCatalog([vendor("Same",0.4),vendor("Same",0.6)]),/Duplicate Orca vendor/);
assert.throws(()=>extractOrcaVendorCatalog([vendor("Outer",0.4),{...vendor("Inner",0.6),index:{...vendor("Inner",0.6).index,name:"Wrong"}}]),/mismatch/);
assert.throws(()=>extractOrcaVendorCatalog([]),/catalog size/);

function filamentVendor(name,profiles) {
  const filament_list=profiles.map((p,i)=>({name:p.name,sub_path:"filament/f"+i+".json"}));
  const files=Object.fromEntries(profiles.map((p,i)=>["filament/f"+i+".json",{type:"filament",...p}]));
  return {name,index:{name,version:"01.00.00.00",machine_model_list:[],machine_list:[],process_list:[],filament_list},files};
}
const globalFilaments=filamentVendor("OrcaFilamentLibrary",[
  {name:"Generic PLA @System",filament_vendor:"Generic",filament_type:"PLA"}
]);
const tunedFilaments=filamentVendor("Snapmaker",[
  {name:"Generic PLA @Snapmaker U1",compatible_printers:["Snapmaker U1 0.4 nozzle"],filament_vendor:"Generic",filament_type:"PLA"}
]);
const filamentCatalog=extractOrcaVendorCatalog([globalFilaments,tunedFilaments]);
const selected=selectOrcaFilamentPreset(filamentCatalog,"Generic PLA","Snapmaker U1 0.4 nozzle");
assert.equal(selected.name,"Generic PLA @Snapmaker U1");
assert.equal(selected.selectionReason,"printer-specific alias override");
const fallback=selectOrcaFilamentPreset(filamentCatalog,"Generic PLA","Other Printer 0.4 nozzle");
assert.equal(fallback.name,"Generic PLA @System");
assert.equal(fallback.selectionReason,"global @System fallback");
assert.throws(()=>selectOrcaFilamentPreset(filamentCatalog,"Missing PLA","Other Printer"),/No compatible/);
const ambiguous=extractOrcaVendorCatalog([
  globalFilaments,
  filamentVendor("Vendor A",[{name:"Generic PLA @A",compatible_printers:["Printer X"]}]),
  filamentVendor("Vendor B",[{name:"Generic PLA @B",compatible_printers:["Printer X"]}])
]);
assert.throws(()=>selectOrcaFilamentPreset(ambiguous,"Generic PLA","Printer X"),/Ambiguous/);
// Real Orca compatible_printers may be inherited; selection must use the
// nearest ancestor within the same vendor, not just the leaf's own JSON.
const inheritedCatalog=extractOrcaVendorCatalog([
  globalFilaments,
  filamentVendor("Tuned",[
    {name:"local PLA base",compatible_printers:["Printer X"],filament_type:"PLA"},
    {name:"Generic PLA @Tuned",inherits:"local PLA base"}
  ])
]);
assert.equal(selectOrcaFilamentPreset(inheritedCatalog,"Generic PLA","Printer X").vendor,"Tuned");
assert.equal(selectOrcaFilamentPreset(inheritedCatalog,"Generic PLA","Printer Y").vendor,
  "OrcaFilamentLibrary");
const disabledOverride=extractOrcaVendorCatalog([
  globalFilaments,
  filamentVendor("Tuned",[
    {name:"local PLA base",compatible_printers:["Printer X"]},
    {name:"Generic PLA @Tuned",inherits:"local PLA base",compatible_printers:[]}
  ])
]);
assert.equal(selectOrcaFilamentPreset(disabledOverride,"Generic PLA","Printer X").vendor,
  "OrcaFilamentLibrary","Explicit empty child list must override inherited compatibility");
for(const invalid of ["Printer X",null,["Printer X","Printer X"],[null],[""]]) {
  const malformed=extractOrcaVendorCatalog([
    globalFilaments,
    filamentVendor("Tuned",[
      {name:"local PLA base",compatible_printers:invalid},
      {name:"Generic PLA @Tuned",inherits:"local PLA base"}
    ])
  ]);
  assert.throws(()=>selectOrcaFilamentPreset(malformed,"Generic PLA","Printer X"),
    /Invalid inherited compatible_printers/);
}
for(const [kind,base] of [
  ["missing",{name:"Generic PLA @Tuned",inherits:"absent base"}],
  ["cycle",{name:"Generic PLA @Tuned",inherits:"Generic PLA @Tuned"}]
]) {
  const bad=extractOrcaVendorCatalog([globalFilaments,filamentVendor("Tuned",[base])]);
  assert.throws(()=>selectOrcaFilamentPreset(bad,"Generic PLA","Printer X"),
    kind==="missing"?/Missing vendor filament ancestor/:/inheritance cycle/);
}
console.log("PASS: inherited filament compatibility, explicit override, malformed and cyclic ancestry");

console.log("PASS: multi-vendor namespaces, filament alias precedence and global fallback");
