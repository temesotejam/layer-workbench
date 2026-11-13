import assert from "node:assert/strict";
import {extractOrcaVendorCatalog} from "./orca-vendor-catalog.mjs";

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
console.log("PASS: multi-vendor catalog namespaces, duplicate protection and profile isolation");
