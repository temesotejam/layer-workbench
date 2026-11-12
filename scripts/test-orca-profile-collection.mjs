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
// as a generic bed temperature, and do not map initial-layer temperatures.
const withPlate=profiles.map(p=>p.name==='Generic PLA @System'
  ? {...p,hot_plate_temp:['65'],hot_plate_temp_initial_layer:['70']} : p);
const implicit=resolve(withPlate,selection);
assert.equal(implicit.filament.settings.bed_temperature,'55');
assert.equal(implicit.filament.selectedBed,null);
assert.ok(implicit.filament.unsupported.includes('hot_plate_temp'));
const explicit=resolve(withPlate,selection,{plateType:'hot'});
assert.equal(explicit.filament.settings.bed_temperature,'65');
assert.deepEqual(explicit.filament.selectedBed,{
  plateType:'hot',source:'Generic PLA @System',bed_temperature:'65'
});
assert.ok(!explicit.filament.unsupported.includes('hot_plate_temp'));
assert.ok(explicit.filament.unsupported.includes('hot_plate_temp_initial_layer'));
assert.throws(()=>resolve(withPlate,selection,{plateType:'textured'}),/Unsupported Orca plate type/);
assert.throws(()=>resolve(withPlate.map(p=>p.name==='Generic PLA @System'
  ? {...p,hot_plate_temp:['150']} : p),selection,{plateType:'hot'}),/test limits/);
assert.throws(()=>resolve(withPlate.map(p=>p.name==='Generic PLA @System'
  ? {...p,hot_plate_temp:['55','65']} : p),selection,{plateType:'hot'}),/Multi-extruder/);
assert.throws(()=>resolve(profiles,selection,{plateType:'hot'}),/Selected hot plate temperature missing/);
console.log('PASS: explicit inherited Orca hot-plate temperature selection and fail-closed validation');
console.log('PASS: Orca-style three-domain inheritance, compatibility and unsupported option reporting');
