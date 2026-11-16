import assert from "node:assert/strict";
import {buildNativeSettings,PIN} from "./prepare-native-v250-presets.mjs";
const machineNames=["fdm_machine_common","fdm_creality_common","Creality CR-10 0.4 nozzle"];
const processNames=["fdm_process_common","fdm_process_creality_common","0.20mm Standard @Creality CR-10 0.4 nozzle"];
const filamentNames=["fdm_filament_common","fdm_filament_pla","Generic PLA @System"];
function fixture(vendor,kinds) {
  const sections={machine_list:[],process_list:[],filament_list:[]},files={};
  for(const [kind,names] of Object.entries(kinds)){
    const base={};
    for(let i=0;i<65;i++)base["native_option_"+i]=["value_"+i,String(i)];
    if(kind==="machine")base.nozzle_diameter=["0.4"];
    if(kind==="process")Object.assign(base,{layer_height:"0.2",wall_loops:"2"});
    if(kind==="filament")base.filament_max_volumetric_speed=["12","21"];
    for(const [i,name] of names.entries()){
      const sub_path=kind+"/"+i+".json";
      sections[kind+"_list"].push({name,sub_path});
      files[sub_path]={type:kind,name,...(i===0?base:{}),...(i>0?{inherits:names[i-1]}:{}),
        ...(i===2?{override_parent_array:["child", "retained"]}:{})};
    }
  }
  return {upstream_commit:PIN,vendor_index:{name:vendor,version:"01.02.03.04",machine_model_list:[],...sections},files};
}
const creality=fixture("Creality",{machine:machineNames,process:processNames});
const library=fixture("OrcaFilamentLibrary",{filament:filamentNames});
const first=buildNativeSettings(creality,library);
assert.equal(first.output.machine.type,"machine");
assert.deepEqual(first.output.machine.nozzle_diameter,["0.4"]);
assert.deepEqual(first.output.filament.filament_max_volumetric_speed,["12","21"]);
assert.deepEqual(first.output.process.override_parent_array,["child","retained"]);
assert.equal(first.output.process.native_option_64[0],"value_64");
assert.deepEqual(first.chains.machine,machineNames);
assert.deepEqual(first.chains.process,processNames);
assert.deepEqual(first.chains.filament,filamentNames);
assert.ok(first.counts.machine>30);
assert.equal(creality.files["machine/0.json"].nozzle_diameter[0],"0.4",
  "source fixture must remain unmodified");
assert.throws(()=>buildNativeSettings({...creality,upstream_commit:"untrusted"},library),
  /untrusted Creality commit/);
assert.throws(()=>buildNativeSettings(creality,{...library,upstream_commit:"untrusted"}),
  /untrusted filament commit/);
const corrupt=structuredClone(creality);
delete corrupt.files["machine/1.json"];
assert.throws(()=>buildNativeSettings(corrupt,library),/Missing indexed profile file/);
const cycle=structuredClone(creality);
cycle.files["machine/0.json"].inherits=machineNames[2];
assert.throws(()=>buildNativeSettings(cycle,library),/cycle/);
console.log("PASS: native CLI preset exporter retains complete vectors, rejects unpinned/missing/cyclic official fixture");
