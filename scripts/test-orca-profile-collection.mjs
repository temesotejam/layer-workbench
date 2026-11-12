import assert from 'node:assert/strict';
import {resolveOrcaProfileCollection as resolve} from './orca-profile-collection.mjs';
const profiles=[
 {type:'machine',name:'base printer',nozzle_diameter:'0.4',printable_height:'250',machine_start_gcode:'G28'},
 {type:'machine',name:'TestPrinter 0.4 nozzle',inherits:'base printer',printable_height:'256'},
 {type:'filament',name:'Generic PLA @System',nozzle_temperature:'210',bed_temperature:'55'},
 {type:'filament',name:'Generic PLA @TestPrinter',inherits:'Generic PLA @System',nozzle_temperature:'215',compatible_printers:['TestPrinter 0.4 nozzle']},
 {type:'process',name:'fdm_process_common',layer_height:'0.2',wall_loops:'2'},
 {type:'process',name:'0.16mm Fine @TestPrinter',inherits:'fdm_process_common',layer_height:'0.16',sparse_infill_density:'22',compatible_printers:['TestPrinter 0.4 nozzle']},
];
const selection={machine:'TestPrinter 0.4 nozzle',filament:'Generic PLA @TestPrinter',process:'0.16mm Fine @TestPrinter'};
const result=resolve(profiles,selection);
assert.deepEqual(result.machine.chain,['base printer','TestPrinter 0.4 nozzle']);
assert.equal(result.machine.settings.nozzle_diameter,'0.4');
assert.equal(result.machine.settings.printable_height,'256');
assert.equal(result.filament.settings.nozzle_temperature,'215');
assert.equal(result.process.settings.layer_height,'0.16');
assert.ok(result.machine.unsupported.includes('machine_start_gcode'));
assert.throws(()=>resolve(profiles,{...selection,machine:'wrong printer'}),/Missing/);
assert.throws(()=>resolve(profiles.map(p=>p.name==='Generic PLA @TestPrinter'?{...p,compatible_printers:['Other printer']}:p),selection),/not compatible/);
assert.throws(()=>resolve([...profiles,{...profiles[0]}],selection),/Duplicate/);
assert.throws(()=>resolve(profiles.map(p=>p.name==='fdm_process_common'?{...p,inherits:'0.16mm Fine @TestPrinter'}:p),selection),/cycle/);
// Explicit plate selection is required: never silently treat hot_plate_temp
// as a generic bed temperature, nor forward first-layer temperatures implicitly.
const withPlate=profiles.map(p=>p.name==='Generic PLA @System'
  ? {...p,hot_plate_temp:['65'],hot_plate_temp_initial_layer:['70']} : p);
const implicit=resolve(withPlate,selection);
assert.equal(implicit.filament.settings.bed_temperature,'55');
assert.equal(implicit.filament.selectedBed,null);
assert.ok(implicit.filament.unsupported.includes('hot_plate_temp'));
const explicit=resolve(withPlate,selection,{plateType:'hot'});
assert.equal(explicit.filament.settings.bed_temperature,'65');
assert.deepEqual(explicit.filament.selectedBed,{
  plateType:'hot',source:'Generic PLA @System',bed_temperature:'65',
  initialLayerSource:'Generic PLA @System',initialLayerTemperature:'70'
});
assert.deepEqual(explicit.filament.settings.hot_plate_temp_initial_layer,['70']);
assert.deepEqual(explicit.filament.settings.hot_plate_temp,['65']);
assert.equal(explicit.filament.settings.curr_bed_type,'High Temp Plate');
assert.equal(implicit.filament.settings.curr_bed_type,undefined);
assert.ok(!explicit.filament.unsupported.includes('hot_plate_temp'));
assert.ok(!explicit.filament.unsupported.includes('hot_plate_temp_initial_layer'));
assert.ok(!Object.hasOwn(implicit.filament.settings,'hot_plate_temp_initial_layer'));
const withoutInitial=resolve(profiles.map(p=>p.name==='Generic PLA @System'
  ? {...p,hot_plate_temp:['65']} : p),selection,{plateType:'hot'});
assert.equal(withoutInitial.filament.selectedBed.initialLayerTemperature,null);
assert.ok(!Object.hasOwn(withoutInitial.filament.settings,'hot_plate_temp_initial_layer'));
assert.throws(()=>resolve(withPlate,selection,{plateType:'textured'}),/Unsupported Orca plate type/);
assert.throws(()=>resolve(withPlate.map(p=>p.name==='Generic PLA @System'
  ? {...p,hot_plate_temp:['150']} : p),selection,{plateType:'hot'}),/test limits/);
assert.throws(()=>resolve(withPlate.map(p=>p.name==='Generic PLA @System'
  ? {...p,hot_plate_temp:['55','65']} : p),selection,{plateType:'hot'}),/Multi-extruder/);
assert.throws(()=>resolve(withPlate.map(p=>p.name==='Generic PLA @System'
  ? {...p,hot_plate_temp_initial_layer:['75','80']} : p),selection,{plateType:'hot'}),/Multi-extruder/);
assert.throws(()=>resolve(withPlate.map(p=>p.name==='Generic PLA @System'
  ? {...p,hot_plate_temp_initial_layer:['-5']} : p),selection,{plateType:'hot'}),/Invalid numeric value|test limits/);
assert.throws(()=>resolve(withPlate.map(p=>p.name==='Generic PLA @System'
  ? {...p,hot_plate_temp_initial_layer:['140']} : p),selection,{plateType:'hot'}),/test limits/);
assert.throws(()=>resolve(profiles,selection,{plateType:'hot'}),/Selected hot plate temperature missing/);
// Nozzle temperature's first-layer native vector is separate from steady
// nozzle_temperature. Inheritance and child overrides must preserve that.
const nozzleBase=profiles.map(p=>p.name==='Generic PLA @System'
  ? {...p,nozzle_temperature_initial_layer:['235']} : p);
const inheritedNozzle=resolve(nozzleBase,selection);
assert.deepEqual(inheritedNozzle.filament.settings.nozzle_temperature_initial_layer,['235']);
assert.equal(inheritedNozzle.filament.settings.nozzle_temperature,'215');
assert.ok(!inheritedNozzle.filament.unsupported.includes('nozzle_temperature_initial_layer'));
const nozzleChild=nozzleBase.map(p=>p.name==='Generic PLA @TestPrinter'
  ? {...p,nozzle_temperature_initial_layer:['245']} : p);
assert.deepEqual(resolve(nozzleChild,selection).filament.settings.nozzle_temperature_initial_layer,['245']);
assert.equal(resolve(profiles,selection).filament.settings.nozzle_temperature_initial_layer,undefined);
for(const bad of [['235','245'],['305'],['0'],['oops']]){
  assert.throws(()=>resolve(nozzleBase.map(p=>p.name==='Generic PLA @System'
    ? {...p,nozzle_temperature_initial_layer:bad} : p),selection),
    /Multi-extruder|Invalid numeric value|test limits/);
}
// Native filament flow factor is a per-extruder vector. Validate its
// actual profile inheritance, overrides, single-filament shape, and bounds.
const flowBase=profiles.map(p=>p.name==='Generic PLA @System'
  ? {...p,filament_flow_ratio:['0.98']} : p);
const inheritedFlow=resolve(flowBase,selection);
assert.deepEqual(inheritedFlow.filament.settings.filament_flow_ratio,['0.98']);
assert.ok(!inheritedFlow.filament.unsupported.includes('filament_flow_ratio'));
const flowChild=flowBase.map(p=>p.name==='Generic PLA @TestPrinter'
  ? {...p,filament_flow_ratio:['1.05']} : p);
assert.deepEqual(resolve(flowChild,selection).filament.settings.filament_flow_ratio,['1.05']);
assert.equal(resolve(profiles,selection).filament.settings.filament_flow_ratio,undefined);
for(const bad of [['1','1.2'],['0.49'],['1.51'],['NaN'],[],['-1'],{}]){
  assert.throws(()=>resolve(flowBase.map(p=>p.name==='Generic PLA @System'
    ? {...p,filament_flow_ratio:bad} : p),selection),
    /Multi-extruder|Invalid|test limits/);
}
// A six-value Generic PLA flow cap refers to six explicitly named variants.
const variants=['Direct Drive Standard','Direct Drive High Flow','Direct Drive Extra High Flow',
  'Bowden Standard','Bowden High Flow','Bowden Extra High Flow'];
const limits=['12','21','40','12','21','30'];
const variantProfiles=profiles.map(p=>p.name==='Generic PLA @TestPrinter'
  ? {...p,filament_extruder_variant:variants,filament_max_volumetric_speed:limits}:p);
const omitted=resolve(variantProfiles,selection);
assert.equal(omitted.filament.settings.filament_max_volumetric_speed,undefined);
assert.ok(omitted.filament.unsupported.includes('filament_max_volumetric_speed'));
const dd=resolve(variantProfiles,selection,{filamentVariant:'Direct Drive High Flow'});
assert.deepEqual(dd.filament.settings.filament_max_volumetric_speed,['21']);
assert.equal(dd.filament.selectedFilamentVariant.index,1);
const bowden=resolve(variantProfiles,selection,{filamentVariant:'Bowden Extra High Flow'});
assert.deepEqual(bowden.filament.settings.filament_max_volumetric_speed,['30']);
assert.equal(bowden.filament.selectedFilamentVariant.index,5);
assert.throws(()=>resolve(variantProfiles,selection,{filamentVariant:'Unknown'}),/not found/);
assert.throws(()=>resolve(variantProfiles.map(p=>p.name==='Generic PLA @TestPrinter'
  ? {...p,filament_extruder_variant:variants.slice(1)}:p),selection,
  {filamentVariant:'Direct Drive Standard'}),/mismatched/);
assert.throws(()=>resolve(variantProfiles.map(p=>p.name==='Generic PLA @TestPrinter'
  ? {...p,filament_max_volumetric_speed:['0',...limits.slice(1)]}:p),selection,
  {filamentVariant:'Direct Drive Standard'}),/test limits/);
const single=resolve(profiles.map(p=>p.name==='Generic PLA @System'
  ? {...p,filament_max_volumetric_speed:['12']}:p),selection);
assert.deepEqual(single.filament.settings.filament_max_volumetric_speed,['12']);
console.log('PASS: exact filament extruder variant maps multi-value volumetric cap; no variant keeps unsupported');
console.log('PASS: native single-filament flow ratio inherited/overridden as vector; invalid inputs rejected');
console.log('PASS: separate inherited native first-layer nozzle temperature vector and bounds');
console.log('PASS: explicit inherited steady and first-layer hot plate temperatures, native vector shape, fail-closed validation');
console.log('PASS: Orca-style three-domain inheritance, compatibility and unsupported option reporting');
