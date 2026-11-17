import assert from 'node:assert/strict';
import {resolveOrcaProfileCollection as resolve} from './orca-profile-collection.mjs';
const profiles=[
 {type:'machine',name:'base printer',nozzle_diameter:'0.4',printable_height:'250',machine_start_gcode:'G28'},
 {type:'machine',name:'TestPrinter 0.4 nozzle',inherits:'base printer',printable_height:'256'},
 {type:'filament',name:'Generic PLA @System',filament_type:['PLA'],nozzle_temperature:'210',bed_temperature:'55'},
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
assert.equal(result.filament.settings.filament_type,'PLA');
assert.ok(!result.filament.unsupported.includes('filament_type'));
// A non-PLA or ambiguous native material vector must never be forwarded
// through the generic-PLA-only candidate, including child overrides.
for(const material of [['PETG'],['ABS'],['PLA','PETG'],[],['pla'],['PLA '],'PLA',[null]]){
  const materialProfiles=profiles.map(p=>p.name==='Generic PLA @TestPrinter'
    ? {...p,filament_type:material}:p);
  assert.throws(()=>resolve(materialProfiles,selection),/Only single-slot PLA filament_type/);
}
assert.equal(resolve(profiles.map(p=>p.name==='Generic PLA @TestPrinter'
  ? {...p,filament_type:['PLA']}:p),selection).filament.settings.filament_type,'PLA');
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
// Native enum values are distinct from visible UI labels. Validate all six
// paired steady/first-layer keys and inheritance, not only the hot plate.
const sixPlates=[
  ["cool","Cool Plate","cool_plate_temp","32","36"],
  ["engineering","Engineering Plate","eng_plate_temp","60","65"],
  ["hot","High Temp Plate","hot_plate_temp","65","70"],
  ["textured","Textured PEI Plate","textured_plate_temp","58","63"],
  ["textured-cool","Textured Cool Plate","textured_cool_plate_temp","38","42"],
  ["supertack","Supertack Plate","supertack_plate_temp","40","44"]
];
const sixProfiles=profiles.map(p=>p.name==="Generic PLA @System"
  ? {...p,...Object.fromEntries(sixPlates.flatMap(([, ,key,steady,initial])=>
      [[key,[steady]],[key+"_initial_layer",[initial]]]))} : p);
for(const [plateType,nativeName,key,steady,initial] of sixPlates){
  const selected=resolve(sixProfiles,selection,{plateType});
  assert.equal(selected.filament.settings.curr_bed_type,nativeName);
  assert.equal(selected.filament.settings.bed_temperature,steady);
  assert.deepEqual(selected.filament.settings[key],[steady]);
  assert.deepEqual(selected.filament.settings[key+"_initial_layer"],[initial]);
  assert.deepEqual(selected.filament.selectedBed,{
    plateType,source:"Generic PLA @System",bed_temperature:steady,
    initialLayerSource:"Generic PLA @System",initialLayerTemperature:initial
  });
  assert.ok(!selected.filament.unsupported.includes(key));
  assert.ok(!selected.filament.unsupported.includes(key+"_initial_layer"));
  const others=sixPlates.filter(([other])=>other!==plateType);
  for(const [, ,otherKey] of others)
    assert.equal(selected.filament.settings[otherKey],undefined,
      "never forward temperatures for an unselected bed");
  const noInitial=resolve(sixProfiles.map(p=>p.name==="Generic PLA @System"
    ? Object.fromEntries(Object.entries(p).filter(([k])=>k!==key+"_initial_layer")) : p),
    selection,{plateType});
  assert.equal(noInitial.filament.selectedBed.initialLayerTemperature,null);
  assert.equal(noInitial.filament.settings[key+"_initial_layer"],undefined);
  for(const bad of [["0"],["-1"],["121"],["20","30"],["n/a"]]){
    const modified=sixProfiles.map(p=>p.name==="Generic PLA @System"
      ? {...p,[key]:bad} : p);
    assert.throws(()=>resolve(modified,selection,{plateType}),
      /unsupported|Invalid|Multi-extruder|test limits/);
  }
  const missing=sixProfiles.map(p=>p.name==="Generic PLA @System"
    ? Object.fromEntries(Object.entries(p).filter(([k])=>k!==key)) : p);
  assert.throws(()=>resolve(missing,selection,{plateType}),/temperature missing/);
}
assert.equal(resolve(sixProfiles,selection).filament.settings.curr_bed_type,undefined);
assert.throws(()=>resolve(sixProfiles,selection,{plateType:"Smooth High Temp Plate"}),/Unsupported Orca plate type/);
assert.throws(()=>resolve(sixProfiles,selection,{plateType:"__proto__"}),/Unsupported Orca plate type/);
assert.throws(()=>resolve(sixProfiles.map(p=>p.name==="Generic PLA @System"
  ? {...p,textured_plate_temp_initial_layer:["0"]} : p),selection,{plateType:"textured"}),
  /first layer is unsupported/);

assert.throws(()=>resolve(withPlate,selection,{plateType:'unknown'}),/Unsupported Orca plate type/);
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
// Orca process presets inherit top/bottom solid shell counts independently.
// Only bounded scalar single-extruder values are applied to the test bridge.
const shellProfiles=profiles.map(p=>{
  if(p.name==='fdm_process_common')
    return {...p,top_shell_layers:'4',bottom_shell_layers:'3'};
  if(p.name==='0.16mm Fine @TestPrinter')
    return {...p,bottom_shell_layers:'2'};
  return p;
});
const shellResult=resolve(shellProfiles,selection);
assert.equal(shellResult.process.settings.top_shell_layers,'4');
assert.equal(shellResult.process.settings.bottom_shell_layers,'2');
assert.ok(!shellResult.process.unsupported.includes('top_shell_layers'));
assert.ok(!shellResult.process.unsupported.includes('bottom_shell_layers'));
assert.equal(resolve(profiles,selection).process.settings.top_shell_layers,undefined);
for(const bad of ['-1','13','2.5','nan',[],['2','3'],{},null]) {
  assert.throws(()=>resolve(shellProfiles.map(p=>p.name==='fdm_process_common'
    ? {...p,top_shell_layers:bad}:p),selection),/Invalid|out of test limits|Multi-extruder/);
}
assert.throws(()=>resolve(shellProfiles.map(p=>p.name==='0.16mm Fine @TestPrinter'
  ? {...p,bottom_shell_layers:'13'}:p),selection),/out of test limits/);
// First-layer height is an independent native process key, not a substitute
// for layer_height or a percentage of it. Inheritance must retain both.
const heightProfiles=profiles.map(p=>{
  if(p.name==='fdm_process_common')return {...p,initial_layer_print_height:'0.28'};
  if(p.name==='0.16mm Fine @TestPrinter')return {...p,initial_layer_print_height:'0.24'};
  return p;
});
const heights=resolve(heightProfiles,selection);
assert.equal(heights.process.settings.layer_height,'0.16');
assert.equal(heights.process.settings.initial_layer_print_height,'0.24');
assert.ok(!heights.process.unsupported.includes('initial_layer_print_height'));
const inheritedHeight=resolve(heightProfiles.map(p=>p.name==='0.16mm Fine @TestPrinter'
  ? {...p,initial_layer_print_height:undefined} : p).map(p=>{
    if(p.name==='0.16mm Fine @TestPrinter'){
      const copy={...p}; delete copy.initial_layer_print_height; return copy;
    }
    return p;
  }),selection);
assert.equal(inheritedHeight.process.settings.initial_layer_print_height,'0.28');
assert.equal(resolve(profiles,selection).process.settings.initial_layer_print_height,undefined);
for(const bad of ['75%',0,'0.51','bad',['0.2','0.3'],null]){
  assert.throws(()=>resolve(heightProfiles.map(p=>p.name==='0.16mm Fine @TestPrinter'
    ? {...p,initial_layer_print_height:bad}:p),selection),
    /Invalid|Multi-extruder|test limits/);
}
console.log('PASS: independent inherited and overridden initial-layer height, bad values rejected');
// Official process speeds are absolute millimetres/second when numeric.
 // Never interpret relative percentage strings as absolute feedrates.
const speedProfiles=profiles.map(p=>{
  if(p.name==='fdm_process_common')
    return {...p,outer_wall_speed:'45',inner_wall_speed:'70',travel_speed:'130'};
  if(p.name==='0.16mm Fine @TestPrinter')
    return {...p,outer_wall_speed:'38'};
  return p;
});
const speeds=resolve(speedProfiles,selection);
assert.deepEqual(
  {outer_wall_speed:speeds.process.settings.outer_wall_speed,
   inner_wall_speed:speeds.process.settings.inner_wall_speed,
   travel_speed:speeds.process.settings.travel_speed},
  {outer_wall_speed:'38',inner_wall_speed:'70',travel_speed:'130'});
for(const key of ['outer_wall_speed','inner_wall_speed','travel_speed'])
  assert.ok(!speeds.process.unsupported.includes(key));
for(const bad of ['50%','bad','0','-5',['45','60'],null]){
  assert.throws(()=>resolve(speedProfiles.map(p=>p.name==='0.16mm Fine @TestPrinter'
    ? {...p,outer_wall_speed:bad}:p),selection),/Invalid|Multi-extruder|test limits/);
}
assert.throws(()=>resolve(speedProfiles.map(p=>p.name==='fdm_process_common'
  ? {...p,travel_speed:'1501'}:p),selection),/test limits/);
// Official pinned OrcaSlicer v2.5.0 Creality Ender-3 Pro 0.20mm Standard
// has four separate absolute-mm/s process speeds (60 / 50 / 30 / 30).
// Preserve their independent inheritance; never substitute outer/inner speed.
// Source: OrcaSlicer 40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19
// resources/profiles/Creality/process/0.20mm Standard @Creality Ender3 Pro 0.4.json
const nativeDepositionSpeeds={
  sparse_infill_speed:'60',internal_solid_infill_speed:'50',
  top_surface_speed:'30',gap_infill_speed:'30'
};
const nativeSpeedProfiles=profiles.map(p=>{
  if(p.name==='fdm_process_common')
    return {...p,sparse_infill_speed:'55',internal_solid_infill_speed:'48',
      top_surface_speed:'26',gap_infill_speed:'24'};
  if(p.name==='0.16mm Fine @TestPrinter')
    return {...p,...nativeDepositionSpeeds};
  return p;
});
const resolvedDeposition=resolve(nativeSpeedProfiles,selection);
for(const [key,value] of Object.entries(nativeDepositionSpeeds)){
  assert.equal(resolvedDeposition.process.settings[key],value);
  assert.ok(!resolvedDeposition.process.unsupported.includes(key));
  const inherited=resolve(nativeSpeedProfiles.map(p=>{
    if(p.name!=='0.16mm Fine @TestPrinter')return p;
    const copy={...p};delete copy[key];return copy;
  }),selection);
  const common={sparse_infill_speed:'55',internal_solid_infill_speed:'48',
    top_surface_speed:'26',gap_infill_speed:'24'};
  assert.equal(inherited.process.settings[key],common[key],
    key+' must be inherited independently');
  for(const bad of ['50%','0','801',['50','60'],null,'fast']){
    const modified=nativeSpeedProfiles.map(p=>p.name==='0.16mm Fine @TestPrinter'
      ? {...p,[key]:bad}:p);
    assert.throws(()=>resolve(modified,selection),
      /Invalid|Multi-extruder|test limits/,key+' must reject '+String(bad));
  }
}
for(const key of Object.keys(nativeDepositionSpeeds))
  assert.equal(resolve(profiles,selection).process.settings[key],undefined);
console.log('PASS: pinned v2.5.0 four deposition speed fields; independent overrides/inheritance, relative/invalid values rejected');
console.log('PASS: inherited, bounded absolute mm/s process speeds and fail-closed percentage/array rejection');
console.log('PASS: real process field names top/bottom shell counts inherit and validate independently');

console.log('PASS: exact filament extruder variant maps multi-value volumetric cap; no variant keeps unsupported');
console.log('PASS: native single-filament flow ratio inherited/overridden as vector; invalid inputs rejected');
console.log('PASS: separate inherited native first-layer nozzle temperature vector and bounds');
console.log('PASS: explicit inherited steady and first-layer hot plate temperatures, native vector shape, fail-closed validation');
console.log('PASS: Orca-style three-domain inheritance, compatibility and unsupported option reporting');

// The actual Orca process fields are native string enums, never a percentage
// or an invented boolean. Child overrides replace inherited values.
const gapEnumProfiles=profiles.map(p=>{
  if(p.name==="fdm_process_common")
    return {...p,wall_generator:"arachne",gap_fill_target:"topbottom"};
  if(p.name==="0.16mm Fine @TestPrinter")
    return {...p,wall_generator:"classic",gap_fill_target:"everywhere"};
  return p;
});
const gapEnumSelection=resolve(gapEnumProfiles,selection);
assert.equal(gapEnumSelection.process.settings.wall_generator,"classic");
assert.equal(gapEnumSelection.process.settings.gap_fill_target,"everywhere");
for(const key of ["wall_generator","gap_fill_target"])
  assert.ok(!gapEnumSelection.process.unsupported.includes(key));
const inheritedEnums=resolve(gapEnumProfiles.map(p=>{
  if(p.name!=="0.16mm Fine @TestPrinter")return p;
  const child={...p};
  delete child.wall_generator;
  delete child.gap_fill_target;
  return child;
}),selection);
assert.equal(inheritedEnums.process.settings.wall_generator,"arachne");
assert.equal(inheritedEnums.process.settings.gap_fill_target,"topbottom");
for(const [key,bad] of [
  ["wall_generator",["Classic","auto",["classic"],null,0]],
  ["gap_fill_target",["top/bottom","all",["everywhere"],null,0]],
]) for(const value of bad) {
  assert.throws(()=>resolve(gapEnumProfiles.map(p=>
    p.name==="0.16mm Fine @TestPrinter"?{...p,[key]:value}:p),selection),
    /Invalid native process enum/);
}
console.log("PASS: inherited native process wall-generator and gap-fill enums reach restricted adapter; invalid forms rejected");
