import assert from "node:assert/strict";
import {inspectOrcaFilamentMaterialVectors,ORCA_FILAMENT_MATERIAL_SOURCE} from "./orca-filament-material-inspection.mjs";

const profile={
  type:"filament",name:"U1 test",sourceByKey:Object.fromEntries(
    ["nozzle_temperature","nozzle_temperature_initial_layer",
     "filament_flow_ratio","filament_max_volumetric_speed","filament_diameter"]
    .map(k=>[k,"U1 child"])),
  settings:{
    nozzle_temperature:["220","220"],
    nozzle_temperature_initial_layer:["220","220"],
    filament_flow_ratio:["0.98","0.98"],
    filament_max_volumetric_speed:["15","15"],
    filament_diameter:["1.75"]
  }
};
assert.equal(ORCA_FILAMENT_MATERIAL_SOURCE.commit,"40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19");
const report=inspectOrcaFilamentMaterialVectors(profile);
assert.equal(report.usableForPrinting,false);
assert.equal(report.requiresNativeVariantResolution,true);
assert.deepEqual(report.arrayLengths,[1,2],"filament diameter is NOT coerced to two nozzle-temperature variants");
assert.equal(report.hasMixedArrayLengths,true);
assert.deepEqual(report.scalarNativeVectorKeys,[]);
assert.deepEqual(report.fields.find(f=>f.key==="nozzle_temperature").numericValues,[220,220]);
assert.equal(report.fields.find(f=>f.key==="filament_flow_ratio").nativeType,"coFloatsNullable");
assert.deepEqual(report.fields.find(f=>f.key==="filament_max_volumetric_speed").numericValues,[15,15]);
report.fields[0].rawValues[0]="999";
assert.equal(profile.settings.nozzle_temperature[0],"220","audit must not mutate raw profile");

const prusa=inspectOrcaFilamentMaterialVectors({
  type:"filament",name:"Prusa scalar test",sourceByKey:{nozzle_temperature_initial_layer:"Prusa child"},
  settings:{nozzle_temperature_initial_layer:"230"}
});
assert.deepEqual(prusa.scalarNativeVectorKeys,["nozzle_temperature_initial_layer"]);
assert.equal(prusa.fields.find(f=>f.key==="nozzle_temperature_initial_layer").numericValues[0],230);
assert.equal(prusa.fields.find(f=>f.key==="nozzle_temperature").shape,"missing");
const nil=inspectOrcaFilamentMaterialVectors({
  type:"filament",name:"Nullable test",sourceByKey:{},
  settings:{filament_flow_ratio:["nil","1.03"]}
});
assert.deepEqual(nil.fields.find(f=>f.key==="filament_flow_ratio").numericValues,[null,1.03]);
assert.throws(()=>inspectOrcaFilamentMaterialVectors({type:"machine",name:"bad",settings:{},sourceByKey:{}}),/filament profile/);
for(const bad of [[],Array(1),Array(65).fill("220"),"oops","NaN",null,{},false,-2]){
  assert.throws(()=>inspectOrcaFilamentMaterialVectors({
    type:"filament",name:"bad",settings:{nozzle_temperature:bad},sourceByKey:{}
  }),/material setting/);
}
for(const bad of ["0","-1","Infinity","1e5","nil"]){
  assert.throws(()=>inspectOrcaFilamentMaterialVectors({
    type:"filament",name:"bad",settings:{filament_max_volumetric_speed:[bad]},sourceByKey:{}
  }),/material setting/);
}
assert.throws(()=>inspectOrcaFilamentMaterialVectors({
  type:"filament",name:"bad",settings:{nozzle_temperature:[200.5]},sourceByKey:{}
}),/material setting/);
console.log("PASS: material vector cardinalities, scalar native shapes, nullable values and fail-closed parsing");
