import assert from 'node:assert/strict';
import {resolveOrcaProfileCollection as resolve, resolveOrcaProfileFamily} from './orca-profile-collection.mjs';
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
// Invalid compatibility metadata must fail closed in both public resolver
// entry points, not just when the complete machine/filament/process collection
// is supplied. In particular, a string must never act like a substring list.
const badCompatibility=[
  'TestPrinter 0.4 nozzle',null,3,{},[''],['  '],[9],
  [['TestPrinter 0.4 nozzle']],
  ['TestPrinter 0.4 nozzle','TestPrinter 0.4 nozzle'],
  ['x'.repeat(161)],
  Array(1025).fill('Unused printer')
];
for(const compatible_printers of badCompatibility) {
  const badRecords=profiles.map(p=>p.name==='Generic PLA @TestPrinter'
    ? {...p,compatible_printers}:p);
  assert.throws(
    ()=>resolveOrcaProfileFamily(badRecords,'filament','Generic PLA @TestPrinter'),
    /Invalid compatible_printers/);
  assert.throws(()=>resolve(badRecords,selection),/Invalid compatible_printers/);
}
const multiCompatible=profiles.map(p=>p.name==='Generic PLA @TestPrinter'
  ? {...p,compatible_printers:['TestPrinter 0.4 nozzle','Other printer 0.4 nozzle']}:p);
assert.deepEqual(resolveOrcaProfileFamily(multiCompatible,'filament',
  'Generic PLA @TestPrinter').compatible,
  ['TestPrinter 0.4 nozzle','Other printer 0.4 nozzle']);
assert.equal(resolve(multiCompatible,selection).filament.name,'Generic PLA @TestPrinter');
assert.throws(()=>resolve(multiCompatible,{...selection,machine:'base printer'}),/not compatible/);
console.log('PASS: exact compatible_printers metadata is validated in direct family and collection resolvers');

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
// Outer wall line width is an independent source-pinned native process key.
// Exercise inherited base, child precedence and rejection of relative widths.
const outerWidthProfiles=profiles.map(rec=>{
  if(rec.name==='fdm_process_common')
    return {...rec,line_width:'0.45',outer_wall_line_width:'0.4'};
  if(rec.name==='0.16mm Fine @TestPrinter')
    return {...rec,outer_wall_line_width:'0.42'};
  return rec;
});
const outerResolved=resolve(outerWidthProfiles,selection);
assert.equal(outerResolved.process.settings.line_width,'0.45');
assert.equal(outerResolved.process.settings.outer_wall_line_width,'0.42');
assert.ok(!outerResolved.process.unsupported.includes('outer_wall_line_width'));
const outerInherited=resolve(outerWidthProfiles.map(rec=>{
  if(rec.name!=='0.16mm Fine @TestPrinter')return rec;
  const child={...rec};delete child.outer_wall_line_width;return child;
}),selection);
assert.equal(outerInherited.process.settings.outer_wall_line_width,'0.4');
assert.equal(resolve(outerWidthProfiles.map(rec=>
  rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,outer_wall_line_width:['0.42']}:rec),selection)
  .process.settings.outer_wall_line_width,'0.42',
  'Native one-nozzle arrays must be normalized without changing units');
for(const bad of ['105%',0,'2.01',['0.42','0.45'],null,'auto']){
  assert.throws(()=>resolve(outerWidthProfiles.map(rec=>
    rec.name==='0.16mm Fine @TestPrinter'
      ? {...rec,outer_wall_line_width:bad}:rec),selection),
    /Invalid|Multi-extruder|test limits/);
}
// Native bridge_flow follows process inheritance, with no inferred default.
const bridgeFlowProfiles=profiles.map(p=>p.name==="fdm_process_common"
  ? {...p,bridge_flow:'0.95'}:p.name==="0.16mm Fine @TestPrinter"
    ? {...p,bridge_flow:'0.55'}:p);
assert.equal(resolve(bridgeFlowProfiles,selection).process.settings.bridge_flow,'0.55');
assert.equal(resolve(bridgeFlowProfiles.map(p=>{
  if(p.name!=="0.16mm Fine @TestPrinter")return p;
  const child={...p};delete child.bridge_flow;return child;
}),selection).process.settings.bridge_flow,'0.95');
for(const bad of ['95%',0,'2.01',['0.55','0.95'],null,'auto'])
  assert.throws(()=>resolve(bridgeFlowProfiles.map(p=>p.name==="0.16mm Fine @TestPrinter"
    ? {...p,bridge_flow:bad}:p),selection),/Invalid|Multi-extruder|test limits/);
assert.equal(result.process.settings.bridge_flow,undefined);
console.log('PASS: native bridge_flow inheritance and safe scalar bounds');
// Source-pinned internal_bridge_flow is an independent native process key, not
// an alias of bridge_flow. Keep ancestor inheritance and child precedence.
const internalBridgeProfiles=profiles.map(p=>p.name==="fdm_process_common"
  ? {...p,bridge_flow:'0.95',internal_bridge_flow:'0.9'}
  : p.name==="0.16mm Fine @TestPrinter"
    ? {...p,bridge_flow:'0.55',internal_bridge_flow:'1'}:p);
const internalChild=resolve(internalBridgeProfiles,selection).process;
assert.equal(internalChild.settings.internal_bridge_flow,'1');
assert.equal(internalChild.settings.bridge_flow,'0.55');
assert.ok(!internalChild.unsupported.includes('internal_bridge_flow'));
const internalInherited=resolve(internalBridgeProfiles.map(p=>{
  if(p.name!=="0.16mm Fine @TestPrinter")return p;
  const child={...p};delete child.internal_bridge_flow;return child;
}),selection).process;
assert.equal(internalInherited.settings.internal_bridge_flow,'0.9');
assert.equal(internalInherited.settings.bridge_flow,'0.55');
for(const bad of ['95%',0,'2.01',['0.9','1'],null,'auto'])
  assert.throws(()=>resolve(internalBridgeProfiles.map(p=>p.name==="0.16mm Fine @TestPrinter"
    ? {...p,internal_bridge_flow:bad}:p),selection),/Invalid|Multi-extruder|test limits/);
assert.equal(result.process.settings.internal_bridge_flow,undefined);
console.log('PASS: independent internal_bridge_flow source inheritance and scalar bounds');
assert.equal(result.process.settings.outer_wall_line_width,undefined);
console.log('PASS: independent outer-wall width inheritance and bounds');
// The child overrides its inherited inner-wall width without changing outer
// or general widths. Missing values are not fabricated from other settings.
const innerWidthProfiles=profiles.map(rec=>{
  if(rec.name==='fdm_process_common')
    return {...rec,line_width:'0.45',outer_wall_line_width:'0.4',inner_wall_line_width:'0.46'};
  if(rec.name==='0.16mm Fine @TestPrinter')
    return {...rec,inner_wall_line_width:'0.5'};
  return rec;
});
const innerResolved=resolve(innerWidthProfiles,selection);
assert.equal(innerResolved.process.settings.inner_wall_line_width,'0.5');
assert.equal(innerResolved.process.settings.line_width,'0.45');
assert.equal(innerResolved.process.settings.outer_wall_line_width,'0.4');
assert.ok(!innerResolved.process.unsupported.includes('inner_wall_line_width'));
const innerInherited=resolve(innerWidthProfiles.map(rec=>{
  if(rec.name!=='0.16mm Fine @TestPrinter')return rec;
  const child={...rec};delete child.inner_wall_line_width;return child;
}),selection);
assert.equal(innerInherited.process.settings.inner_wall_line_width,'0.46');
assert.equal(resolve(innerWidthProfiles.map(rec=>
  rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,inner_wall_line_width:['0.5']}:rec),selection)
  .process.settings.inner_wall_line_width,'0.5',
  'Single-nozzle native width vector must normalize to absolute mm');
for(const bad of ['105%',0,'2.01',['0.45','0.5'],null,'auto']){
  assert.throws(()=>resolve(innerWidthProfiles.map(rec=>
    rec.name==='0.16mm Fine @TestPrinter'
      ? {...rec,inner_wall_line_width:bad}:rec),selection),
    /Invalid|Multi-extruder|test limits/);
}
assert.equal(result.process.settings.inner_wall_line_width,undefined);
console.log('PASS: inherited and overridden inner-wall width, one-nozzle normalization and bounds');
// Native sparse-infill width must follow its own parent/child precedence,
// without overwriting wall widths or deriving a missing value.
const sparseWidthProfiles=profiles.map(rec=>{
  if(rec.name==='fdm_process_common')
    return {...rec,line_width:'0.42',inner_wall_line_width:'0.45',sparse_infill_line_width:'0.44'};
  if(rec.name==='0.16mm Fine @TestPrinter')
    return {...rec,sparse_infill_line_width:'0.5'};
  return rec;
});
const sparseResolved=resolve(sparseWidthProfiles,selection);
assert.equal(sparseResolved.process.settings.sparse_infill_line_width,'0.5');
assert.equal(sparseResolved.process.settings.line_width,'0.42');
assert.equal(sparseResolved.process.settings.inner_wall_line_width,'0.45');
assert.ok(!sparseResolved.process.unsupported.includes('sparse_infill_line_width'));
const sparseInherited=resolve(sparseWidthProfiles.map(rec=>{
  if(rec.name!=='0.16mm Fine @TestPrinter')return rec;
  const child={...rec};delete child.sparse_infill_line_width;return child;
}),selection);
assert.equal(sparseInherited.process.settings.sparse_infill_line_width,'0.44');
assert.equal(resolve(sparseWidthProfiles.map(rec=>
  rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,sparse_infill_line_width:['0.5']}:rec),selection)
  .process.settings.sparse_infill_line_width,'0.5');
for(const bad of ['105%',0,'2.01',['0.45','0.5'],null,'auto']){
  assert.throws(()=>resolve(sparseWidthProfiles.map(rec=>
    rec.name==='0.16mm Fine @TestPrinter'
      ? {...rec,sparse_infill_line_width:bad}:rec),selection),
    /Invalid|Multi-extruder|test limits/);
}
assert.equal(result.process.settings.sparse_infill_line_width,undefined);
console.log('PASS: independent sparse infill width inheritance, precedence and bounded input');
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
// The pinned v2.5.0 common PLA profile contains a one-slot diameter vector.
// It is independent of nozzle count, selected extruder variant and flow ratio.
const diameterBase=profiles.map(p=>p.name==='Generic PLA @System'
  ? {...p,filament_diameter:['1.75']} : p);
const inheritedDiameter=resolve(diameterBase,selection);
assert.deepEqual(inheritedDiameter.filament.settings.filament_diameter,['1.75']);
assert.ok(!inheritedDiameter.filament.unsupported.includes('filament_diameter'));
const diameterChild=diameterBase.map(p=>p.name==='Generic PLA @TestPrinter'
  ? {...p,filament_diameter:['2.85']} : p);
assert.deepEqual(resolve(diameterChild,selection).filament.settings.filament_diameter,['2.85']);
assert.equal(resolve(profiles,selection).filament.settings.filament_diameter,undefined);
for(const bad of [['1.75','2.85'],['0.9'],['3.01'],[],['bad'],{},['-1']]){
  assert.throws(()=>resolve(diameterBase.map(p=>p.name==='Generic PLA @System'
    ? {...p,filament_diameter:bad}:p),selection),
    /Multi-extruder|Invalid|test limits/);
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
// A single limit is not necessarily for the explicitly selected extruder
// variant. Verify actual native slot metadata before acknowledging a choice.
const oneSlotVariant=profiles.map(p=>p.name==='Generic PLA @System'
  ? {...p,filament_extruder_variant:['Direct Drive Standard'],
     filament_max_volumetric_speed:['12']}:p);
const oneSlotExplicit=resolve(oneSlotVariant,selection,
  {filamentVariant:'Direct Drive Standard'});
assert.deepEqual(oneSlotExplicit.filament.settings.filament_max_volumetric_speed,['12']);
assert.deepEqual(oneSlotExplicit.filament.selectedFilamentVariant,{
  name:'Direct Drive Standard',index:0,source:'Generic PLA @System',maxVolumetricSpeed:'12'
});
for(const chosen of ['Bowden Standard','Direct Drive High Flow','',
  '__proto__',null,1]) {
  assert.throws(()=>resolve(oneSlotVariant,selection,{filamentVariant:chosen}),
    /Invalid selected filament variant|not found/,
    'Explicit mismatched or invalid single-slot selection must fail closed');
}
const unnamedSingle=profiles.map(p=>p.name==='Generic PLA @System'
  ? {...p,filament_max_volumetric_speed:['12']}:p);
assert.throws(()=>resolve(unnamedSingle,selection,
  {filamentVariant:'Direct Drive Standard'}),
  /Invalid or mismatched filament extruder variant vector/,
  'An unnamed one-slot limit must not silently satisfy an explicit selection');
for(const variants of [[],['Direct Drive Standard','Bowden Standard'],
  [''],[null],['Direct Drive Standard','Direct Drive Standard']]) {
  const invalid=profiles.map(p=>p.name==='Generic PLA @System'
    ? {...p,filament_extruder_variant:variants,
      filament_max_volumetric_speed:['12']}:p);
  assert.throws(()=>resolve(invalid,selection,
    {filamentVariant:'Direct Drive Standard'}),
    /Invalid or mismatched filament extruder variant vector/);
}
assert.equal(single.filament.selectedFilamentVariant,null,
  'Without an explicit variant, a single preset limit must remain unlabelled');
console.log('PASS: explicit one-slot flow variant requires exact source metadata; implicit scalar behavior preserved');
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
// The actual pinned Creality process inheritance uses crosshatch in common
// and grid in the CR-10 0.20mm child. Exercise exact override precedence
// separately from numeric density (which retains percent syntax).
const fillBase=profiles.map(p=>p.name==="fdm_process_common"
  ? {...p,sparse_infill_pattern:"crosshatch"} : p);
const fillChild=fillBase.map(p=>p.name==="0.16mm Fine @TestPrinter"
  ? {...p,sparse_infill_pattern:"grid"} : p);
assert.equal(resolve(fillBase,selection).process.settings.sparse_infill_pattern,"crosshatch");
assert.equal(resolve(fillChild,selection).process.settings.sparse_infill_pattern,"grid");
assert.ok(!resolve(fillChild,selection).process.unsupported.includes("sparse_infill_pattern"));
for(const bad of ["Grid","gyroid","",["grid"],null,0]){
  assert.throws(()=>resolve(fillBase.map(p=>p.name==="0.16mm Fine @TestPrinter"
    ? {...p,sparse_infill_pattern:bad} : p),selection),/Invalid native process enum/);
}
// Native internal solid infill pattern is distinct from sparse infill. The
// pinned CR-10 0.20mm child selects monotonic; never default it by inference.
const solidPatternProfiles=fillChild.map(p=>p.name==="0.16mm Fine @TestPrinter"
  ? {...p,internal_solid_infill_pattern:"monotonic"}:p);
const solidPattern=resolve(solidPatternProfiles,selection).process;
assert.equal(solidPattern.settings.internal_solid_infill_pattern,"monotonic");
assert.equal(solidPattern.settings.sparse_infill_pattern,"grid");
assert.ok(!solidPattern.unsupported.includes("internal_solid_infill_pattern"));
assert.equal(resolve(fillChild,selection).process.settings.internal_solid_infill_pattern,undefined);
// PrintConfig.cpp at the pinned native commit explicitly enumerates
// rectilinear as another valid internal solid pattern, not as sparse fill.
const solidRectilinear=resolve(solidPatternProfiles.map(p=>
  p.name==="0.16mm Fine @TestPrinter"
    ? {...p,internal_solid_infill_pattern:"rectilinear"}:p),selection).process;
assert.equal(solidRectilinear.settings.internal_solid_infill_pattern,"rectilinear");
assert.equal(solidRectilinear.settings.sparse_infill_pattern,"grid");
for(const bad of ["Monotonic","grid","zig-zag","",["monotonic"],null,0]) {
  assert.throws(()=>resolve(fillChild.map(p=>p.name==="0.16mm Fine @TestPrinter"
    ? {...p,internal_solid_infill_pattern:bad}:p),selection),/Invalid native process enum/);
}
console.log("PASS: source-pinned native monotonic/rectilinear internal solid enums are independent and fail-closed");
console.log("PASS: source-pinned crosshatch -> grid infill-pattern inheritance and strict enums");
console.log("PASS: inherited native process wall-generator and gap-fill enums reach restricted adapter; invalid forms rejected");

const topWidthRecords=profiles.map(rec=>rec.name==='fdm_process_common'
  ? {...rec,line_width:'0.45',top_surface_line_width:'0.4'} :
  rec.name==='0.16mm Fine @TestPrinter' ? {...rec,top_surface_line_width:'0.42'}:rec);
const topWidth=resolve(topWidthRecords,selection).process;
assert.equal(topWidth.settings.top_surface_line_width,'0.42');
assert.equal(topWidth.settings.line_width,'0.45');
assert.ok(!topWidth.unsupported.includes('top_surface_line_width'));
const topInherited=topWidthRecords.map(rec=>{
  if(rec.name!=='0.16mm Fine @TestPrinter')return rec;
  const copy={...rec};delete copy.top_surface_line_width;return copy;
});
assert.equal(resolve(topInherited,selection).process.settings.top_surface_line_width,'0.4');
assert.equal(resolve(topWidthRecords.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
  ? {...rec,top_surface_line_width:['0.42']}:rec),selection).process.settings.top_surface_line_width,'0.42');
for(const bad of ['105%',0,'2.01',['0.42','0.5'],null,'auto']){
  assert.throws(()=>resolve(topWidthRecords.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,top_surface_line_width:bad}:rec),selection),
    /Invalid|Multi-extruder|test limits/);
}
assert.equal(result.process.settings.top_surface_line_width,undefined);
console.log('PASS: top-surface width inheritance, independent override and safety bounds');

// Source-pinned internal solid infill width uses a separate native field.
// The parent, child and missing-key paths must preserve its identity.
const solidWidthProfiles=profiles.map(rec=>rec.name==='fdm_process_common'
  ? {...rec,line_width:'0.42',sparse_infill_line_width:'0.45',
      top_surface_line_width:'0.4',internal_solid_infill_line_width:'0.4'} :
    rec.name==='0.16mm Fine @TestPrinter'
      ? {...rec,internal_solid_infill_line_width:'0.45'}:rec);
const solidWidth=resolve(solidWidthProfiles,selection).process;
assert.equal(solidWidth.settings.internal_solid_infill_line_width,'0.45');
assert.equal(solidWidth.settings.line_width,'0.42');
assert.equal(solidWidth.settings.sparse_infill_line_width,'0.45');
assert.equal(solidWidth.settings.top_surface_line_width,'0.4');
assert.ok(!solidWidth.unsupported.includes('internal_solid_infill_line_width'));
const inheritedSolid=solidWidthProfiles.map(rec=>{
  if(rec.name!=='0.16mm Fine @TestPrinter')return rec;
  const child={...rec};delete child.internal_solid_infill_line_width;return child;
});
assert.equal(resolve(inheritedSolid,selection).process.settings.internal_solid_infill_line_width,'0.4');
assert.equal(resolve(solidWidthProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
  ? {...rec,internal_solid_infill_line_width:['0.45']}:rec),selection)
  .process.settings.internal_solid_infill_line_width,'0.45');
for(const bad of ['105%',0,'2.01',['0.45','0.5'],null,'auto']){
  assert.throws(()=>resolve(solidWidthProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,internal_solid_infill_line_width:bad}:rec),selection),
    /Invalid|Multi-extruder|test limits/);
}
assert.equal(result.process.settings.internal_solid_infill_line_width,undefined);
console.log('PASS: internal-solid width inheritance and child override, one-nozzle normalization and fail-closed bounds');

// Native initial-layer width is a separate process field and must honor
// parent/child precedence instead of inheriting generic line_width.
const firstWidthRecords=profiles.map(rec=>rec.name==='fdm_process_common'
  ? {...rec,line_width:'0.42',initial_layer_line_width:'0.42'}:
  rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,initial_layer_line_width:'0.5'}:rec);
const firstWidth=resolve(firstWidthRecords,selection).process;
assert.equal(firstWidth.settings.initial_layer_line_width,'0.5');
assert.equal(firstWidth.settings.line_width,'0.42');
assert.ok(!firstWidth.unsupported.includes('initial_layer_line_width'));
const firstInherited=firstWidthRecords.map(rec=>{
  if(rec.name!=='0.16mm Fine @TestPrinter')return rec;
  const child={...rec};delete child.initial_layer_line_width;return child;
});
assert.equal(resolve(firstInherited,selection).process.settings.initial_layer_line_width,'0.42');
assert.equal(resolve(firstWidthRecords.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
  ? {...rec,initial_layer_line_width:['0.5']}:rec),selection)
  .process.settings.initial_layer_line_width,'0.5');
for(const bad of ['110%',0,'2.01',['0.5','0.6'],null,'auto']){
  assert.throws(()=>resolve(firstWidthRecords.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,initial_layer_line_width:bad}:rec),selection),
    /Invalid|Multi-extruder|test limits/);
}
assert.equal(result.process.settings.initial_layer_line_width,undefined);
console.log('PASS: pinned first-layer width inherits independently, normalizes one slot and rejects invalid formats');

// First-layer perimeter speed must inherit independently from the native
// process chain; no fabricated defaults, percentage or multi-tool coercion.
const firstSpeedProfiles=profiles.map(rec=>rec.name==='fdm_process_common'
  ? {...rec,initial_layer_speed:'20',outer_wall_speed:'30'}:
  rec.name==='0.16mm Fine @TestPrinter' ? {...rec,initial_layer_speed:'15'}:rec);
const firstSpeed=resolve(firstSpeedProfiles,selection).process;
assert.equal(firstSpeed.settings.initial_layer_speed,'15');
assert.equal(firstSpeed.settings.outer_wall_speed,'30');
assert.ok(!firstSpeed.unsupported.includes('initial_layer_speed'));
const inheritedSpeed=firstSpeedProfiles.map(rec=>{
  if(rec.name!=='0.16mm Fine @TestPrinter')return rec;
  const child={...rec};delete child.initial_layer_speed;return child;
});
assert.equal(resolve(inheritedSpeed,selection).process.settings.initial_layer_speed,'20');
assert.equal(resolve(firstSpeedProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
  ? {...rec,initial_layer_speed:['15']}:rec),selection).process.settings.initial_layer_speed,'15');
for(const bad of ['50%',0,'801',['15','20'],null,'auto']){
  assert.throws(()=>resolve(firstSpeedProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,initial_layer_speed:bad}:rec),selection),
    /Invalid|Multi-extruder|test limits/);
}
assert.equal(result.process.settings.initial_layer_speed,undefined);
console.log('PASS: first-layer speed inheritance, single-nozzle normalization and strict input limits');

// The pinned CR-10 first-layer infill speed overrides independently of
// first-layer perimeter speed and is never inferred when absent.
const firstInfillProfiles=profiles.map(rec=>rec.name==='fdm_process_common'
  ? {...rec,initial_layer_speed:'20',initial_layer_infill_speed:'25'}:
  rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,initial_layer_speed:'15',initial_layer_infill_speed:'20'}:rec);
const firstInfill=resolve(firstInfillProfiles,selection).process;
assert.equal(firstInfill.settings.initial_layer_speed,'15');
assert.equal(firstInfill.settings.initial_layer_infill_speed,'20');
assert.ok(!firstInfill.unsupported.includes('initial_layer_infill_speed'));
const inheritedFirstInfill=firstInfillProfiles.map(rec=>{
  if(rec.name!=='0.16mm Fine @TestPrinter')return rec;
  const child={...rec};delete child.initial_layer_infill_speed;return child;
});
assert.equal(resolve(inheritedFirstInfill,selection).process.settings.initial_layer_infill_speed,'25');
assert.equal(resolve(firstInfillProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
  ? {...rec,initial_layer_infill_speed:['20']}:rec),selection)
  .process.settings.initial_layer_infill_speed,'20');
for(const bad of ['50%',0,'801',['20','30'],null,'auto']){
  assert.throws(()=>resolve(firstInfillProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,initial_layer_infill_speed:bad}:rec),selection),
    /Invalid|Multi-extruder|test limits/);
}
assert.equal(result.process.settings.initial_layer_infill_speed,undefined);
console.log('PASS: independent first-layer infill speed parent/child, one slot and strict bounds');

// Support width, body speed and interface speed must be independently inherited,
// with no synthetic defaults for missing native process settings.
const supportKeys=['support_line_width','support_speed','support_interface_speed'];
const supportDefaults={support_line_width:'0.42',support_speed:'40',support_interface_speed:'80'};
const supportOverrides={support_line_width:'0.4',support_speed:'30',support_interface_speed:'25'};
const supportProfiles=profiles.map(rec=>rec.name==='fdm_process_common'
  ? {...rec,...supportDefaults}:rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,...supportOverrides}:rec);
const supportResult=resolve(supportProfiles,selection).process;
for(const key of supportKeys) {
  assert.equal(supportResult.settings[key],supportOverrides[key]);
  assert.ok(!supportResult.unsupported.includes(key));
  const inherited=supportProfiles.map(rec=>{
    if(rec.name!=='0.16mm Fine @TestPrinter')return rec;
    const child={...rec};delete child[key];return child;
  });
  assert.equal(resolve(inherited,selection).process.settings[key],supportDefaults[key]);
  assert.equal(resolve(supportProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,[key]:[supportOverrides[key]]}:rec),selection).process.settings[key],
    supportOverrides[key]);
  for(const bad of ['50%',0,key==='support_line_width'?2.01:801,
    ['20','30'],null,'auto'])
    assert.throws(()=>resolve(supportProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
      ? {...rec,[key]:bad}:rec),selection),/Invalid|Multi-extruder|test limits/);
  assert.equal(result.process.settings[key],undefined,'No fabricated '+key);
}
console.log('PASS: bounded independent source-pinned support profile inheritance and vector rejection');


// CR-10 v2.5.0 style skirt count must inherit and override independently.
const skirtProfiles=profiles.map(rec=>rec.name==='fdm_process_common'
  ? {...rec,skirt_loops:'1'} : rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,skirt_loops:'2'} : rec);
assert.equal(resolve(skirtProfiles,selection).process.settings.skirt_loops,'2');
assert.equal(resolve(skirtProfiles.map(rec=>{
  if(rec.name!=='0.16mm Fine @TestPrinter')return rec;
  const child={...rec};delete child.skirt_loops;return child;
}),selection).process.settings.skirt_loops,'1');
assert.equal(resolve(skirtProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
  ? {...rec,skirt_loops:['2']} : rec),selection).process.settings.skirt_loops,'2');
for(const bad of ['2%',2.5,-1,11,'auto',['2','3'],null]) {
  assert.throws(()=>resolve(skirtProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,skirt_loops:bad}:rec),selection),/Invalid|Multi-extruder|test limits/);
}
assert.ok(!resolve(skirtProfiles,selection).process.unsupported.includes('skirt_loops'));
console.log('PASS: native skirt_loops selection, inheritance and bounded integer validation');

// Native coFloat skirt_distance (0..60 mm) inherits independently of skirt_loops.
const skirtDistanceProfiles=profiles.map(rec=>rec.name==='fdm_process_common'
  ? {...rec,skirt_distance:'2'} : rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,skirt_distance:'8.5'} : rec);
assert.equal(resolve(skirtDistanceProfiles,selection).process.settings.skirt_distance,'8.5');
assert.equal(resolve(skirtDistanceProfiles.map(rec=>{
  if(rec.name!=='0.16mm Fine @TestPrinter')return rec;
  const child={...rec};delete child.skirt_distance;return child;
}),selection).process.settings.skirt_distance,'2');
for(const value of ['0','60']) {
  assert.equal(resolve(skirtDistanceProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,skirt_distance:value}:rec),selection).process.settings.skirt_distance,value);
}
for(const bad of ['2%',-1,60.01,['2','3'],null,'auto']) {
  assert.throws(()=>resolve(skirtDistanceProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,skirt_distance:bad}:rec),selection),/Invalid|Multi-extruder|test limits/);
}
assert.ok(!resolve(skirtDistanceProfiles,selection).process.unsupported.includes('skirt_distance'));
console.log('PASS: native skirt_distance inheritance, bounded floating-point and invalid input rejection');

// Three-level native skirt height must override/inherit independently of
// skirt loops or distance without inventing a missing default.
const skirtHeightProfiles=profiles.map(rec=>rec.name==='fdm_process_common'
  ? {...rec,skirt_height:'2'} : rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,skirt_height:'3'} : rec);
assert.equal(resolve(skirtHeightProfiles,selection).process.settings.skirt_height,'3');
assert.equal(resolve(skirtHeightProfiles.map(rec=>{
  if(rec.name!=='0.16mm Fine @TestPrinter')return rec;
  const child={...rec};delete child.skirt_height;return child;
}),selection).process.settings.skirt_height,'2');
assert.equal(resolve(skirtHeightProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
  ? {...rec,skirt_height:['3']}:rec),selection).process.settings.skirt_height,'3');
for (const bad of ['0',21,2.5,'2%',['2','3'],null])
  assert.throws(()=>resolve(skirtHeightProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,skirt_height:bad}:rec),selection),
    /Invalid|Multi-extruder|test limits/);
assert.ok(!resolve(skirtHeightProfiles,selection).process.unsupported.includes('skirt_height'));
assert.equal(result.process.settings.skirt_height,undefined);
console.log('PASS: source-pinned skirt_height inherits as an independent bounded integer');

// The source-pinned child overrides an ancestor's independent coFloat skirt
// speed; absence must not fabricate one from travel or perimeter speed.
const skirtSpeedProfiles=profiles.map(rec=>rec.name==='fdm_process_common'
  ? {...rec,skirt_speed:'50'} : rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,skirt_speed:'20'} : rec);
const skirtSpeedResolved=resolve(skirtSpeedProfiles,selection);
assert.equal(skirtSpeedResolved.process.settings.skirt_speed,'20');
assert.ok(!skirtSpeedResolved.process.unsupported.includes('skirt_speed'));
assert.equal(resolve(skirtSpeedProfiles.map(rec=>{
  if(rec.name!=='0.16mm Fine @TestPrinter')return rec;
  const child={...rec};delete child.skirt_speed;return child;
}),selection).process.settings.skirt_speed,'50');
assert.equal(resolve(skirtSpeedProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
  ? {...rec,skirt_speed:['20']}:rec),selection).process.settings.skirt_speed,'20');
for(const bad of ['-1','301','20%',null,'auto',['20','30']])
  assert.throws(()=>resolve(skirtSpeedProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,skirt_speed:bad}:rec),selection),/Invalid|Multi-extruder|test limits/);
assert.equal(result.process.settings.skirt_speed,undefined);
console.log('PASS: source-pinned independent skirt_speed inheritance and strict mm/s bounds');

// Native CR-10 v2.5.0 process has infill_direction=45 degrees. A child may
// override the angle, or inherit it without fabricating missing defaults.
const directionProfiles=profiles.map(rec=>rec.name==='fdm_process_common'
  ? {...rec,infill_direction:'45'} : rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,infill_direction:'30'} : rec);
const directionResolved=resolve(directionProfiles,selection);
assert.equal(directionResolved.process.settings.infill_direction,'30');
assert.ok(!directionResolved.process.unsupported.includes('infill_direction'));
assert.equal(resolve(directionProfiles.map(rec=>{
  if(rec.name!=='0.16mm Fine @TestPrinter')return rec;
  const child={...rec};delete child.infill_direction;return child;
}),selection).process.settings.infill_direction,'45');
assert.equal(resolve(directionProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
  ? {...rec,infill_direction:['30']}:rec),selection).process.settings.infill_direction,'30');
for(const bad of [-1,'360.01','45%',null,'auto',['30','45']])
  assert.throws(()=>resolve(directionProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,infill_direction:bad}:rec),selection),/Invalid|Multi-extruder|test limits/);
assert.equal(result.process.settings.infill_direction,undefined);
console.log('PASS: bounded native infill_direction inheritance, angle and bad input rejection');

// Pinned CR-10 child uses ensure_all independently of shell layer counts.
// The source-pinned native PrintConfig.cpp defines exactly four wire tokens.
const guardedProcess=profiles.map(p=>p.name==='fdm_process_common'
  ? {...p,ensure_vertical_shell_thickness:'ensure_moderate'} :
    p.name==='0.16mm Fine @TestPrinter'
      ? {...p,ensure_vertical_shell_thickness:'ensure_all'} : p);
const guardedResolved=resolve(guardedProcess,selection).process;
assert.equal(guardedResolved.settings.ensure_vertical_shell_thickness,'ensure_all');
assert.ok(!guardedResolved.unsupported.includes('ensure_vertical_shell_thickness'));
assert.equal(resolve(guardedProcess.map(p=>{
  if(p.name!=='0.16mm Fine @TestPrinter')return p;
  const rec={...p};delete rec.ensure_vertical_shell_thickness;return rec;
}),selection).process.settings.ensure_vertical_shell_thickness,'ensure_moderate');
assert.equal(resolve(profiles,selection).process.settings.ensure_vertical_shell_thickness,undefined);
for(const mode of ['none','ensure_critical_only','ensure_moderate','ensure_all'])
  assert.equal(resolve(guardedProcess.map(p=>p.name==='0.16mm Fine @TestPrinter'
    ? {...p,ensure_vertical_shell_thickness:mode}:p),selection)
    .process.settings.ensure_vertical_shell_thickness,mode);
for(const bad of ['all','critical only','1','0','',null,true,0,
  ['ensure_all'],['ensure_all','none'],{}])
  assert.throws(()=>resolve(guardedProcess.map(p=>p.name==='0.16mm Fine @TestPrinter'
    ? {...p,ensure_vertical_shell_thickness:bad}:p),selection),
    /Invalid native process enum/,'Invalid native vertical-shell enum must fail closed');
console.log('PASS: vertical shell enum native inheritance, wire values and invalid rejection');

// Real Orca schema has separate minimum shell thicknesses (mm), which
// override zero or absent ancestors independently of shell layer counts.
const shellThicknessParents=profiles.map(p=>p.name==='fdm_process_common'
  ? {...p,top_shell_thickness:'0.6',bottom_shell_thickness:'0.4'} :
    p.name==='0.16mm Fine @TestPrinter'
      ? {...p,top_shell_thickness:'0.8',bottom_shell_thickness:'0'} : p);
const thickResolved=resolve(shellThicknessParents,selection).process;
assert.equal(thickResolved.settings.top_shell_thickness,'0.8');
assert.equal(thickResolved.settings.bottom_shell_thickness,'0');
assert.equal(thickResolved.settings.wall_loops,'2');
assert.ok(!thickResolved.unsupported.includes('top_shell_thickness'));
assert.ok(!thickResolved.unsupported.includes('bottom_shell_thickness'));
const inheritedThickness=resolve(shellThicknessParents.map(p=>{
  if(p.name!=='0.16mm Fine @TestPrinter')return p;
  const child={...p};delete child.top_shell_thickness;
  delete child.bottom_shell_thickness;return child;
}),selection).process;
assert.equal(inheritedThickness.settings.top_shell_thickness,'0.6');
assert.equal(inheritedThickness.settings.bottom_shell_thickness,'0.4');
for(const key of ['top_shell_thickness','bottom_shell_thickness']) {
  assert.equal(resolve(shellThicknessParents.map(p=>p.name==='0.16mm Fine @TestPrinter'
    ? {...p,[key]:['0.8']}:p),selection).process.settings[key],'0.8');
  for(const bad of ['1.2%','-1','5.01',['0.8','1.2'],null,'auto'])
    assert.throws(()=>resolve(shellThicknessParents.map(p=>
      p.name==='0.16mm Fine @TestPrinter'?{...p,[key]:bad}:p),selection),
      /Invalid|Multi-extruder|test limits/);
}
assert.equal(resolve(profiles,selection).process.settings.top_shell_thickness,undefined);
console.log('PASS: source native top/bottom shell thickness, inheritance, zero-disable, one-slot bounds');

// Official v2.5.0 CR-10 inherits top skin monotonicline from Creality common,
// then overrides it to monotonic in its 0.20mm child. Bottom is independent.
const skinRecords=[
  {type:"process",name:"Skin Base",top_surface_pattern:"monotonicline",bottom_surface_pattern:"monotonic"},
  {type:"process",name:"Skin Child",inherits:"Skin Base",top_surface_pattern:"monotonic"}
];
const skinResolved=resolveOrcaProfileFamily(skinRecords,"process","Skin Child");
assert.equal(skinResolved.settings.top_surface_pattern,"monotonic");
assert.equal(skinResolved.settings.bottom_surface_pattern,"monotonic");
assert.ok(!skinResolved.unsupported.includes("top_surface_pattern"));
assert.ok(!skinResolved.unsupported.includes("bottom_surface_pattern"));
const skinBase=resolveOrcaProfileFamily(skinRecords,"process","Skin Base");
assert.equal(skinBase.settings.top_surface_pattern,"monotonicline");
const skinRect=resolveOrcaProfileFamily([
  {...skinRecords[0],bottom_surface_pattern:"rectilinear"},skinRecords[1]
],"process","Skin Child");
assert.equal(skinRect.settings.bottom_surface_pattern,"rectilinear");
assert.equal(skinRect.settings.top_surface_pattern,"monotonic");
for(const key of ["top_surface_pattern","bottom_surface_pattern"]){
  for(const bad of ["Concentric","",["monotonic"],null,123,"__proto__"])
    assert.throws(()=>resolveOrcaProfileFamily([
      {type:"process",name:"Bad Skin",[key]:bad}
    ],"process","Bad Skin"),/native process enum/,key+" rejects "+String(bad));
}
console.log("PASS: independent top/bottom surface pattern inheritance and fail-closed native enums");

// Pinned v2.5.0 first-layer travel is a native coFloatOrPercent, not mm/s.
// Validate both child precedence and parent inheritance without changing units.
const relativeTravelProfiles=profiles.map(rec=>rec.name==='fdm_process_common'
  ? {...rec,travel_speed:'200',initial_layer_travel_speed:'125%'}
  :rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,initial_layer_travel_speed:['50%']}:rec);
assert.equal(resolve(relativeTravelProfiles,selection).process.settings.initial_layer_travel_speed,'50%');
const travelInherited=relativeTravelProfiles.map(rec=>{
  if(rec.name!=='0.16mm Fine @TestPrinter')return rec;
  const child={...rec};delete child.initial_layer_travel_speed;return child;
});
assert.equal(resolve(travelInherited,selection).process.settings.initial_layer_travel_speed,'125%');
assert.equal(resolve(relativeTravelProfiles,selection).process.settings.travel_speed,'200');
for(const bad of ['0%','201%','50%%','auto',null,0,1501,['50%','60%'],{},'50% G28'])
  assert.throws(()=>resolve(relativeTravelProfiles.map(rec=>rec.name==='0.16mm Fine @TestPrinter'
    ? {...rec,initial_layer_travel_speed:bad}:rec),selection),
    /Invalid|Multi-extruder|test limits/,String(bad));
console.log('PASS: native first-layer travel percent is preserved with single-slot inheritance and invalid values rejected');

const overlapProfiles=profiles.map(rec=>rec.name==="fdm_process_common"
  ? {...rec,infill_wall_overlap:"25%"} : rec.name==="0.16mm Fine @TestPrinter"
    ? {...rec,infill_wall_overlap:"30%"} : rec);
const overlap=resolve(overlapProfiles,selection).process;
assert.equal(overlap.settings.infill_wall_overlap,"30%");
assert.ok(!overlap.unsupported.includes("infill_wall_overlap"));
assert.equal(resolve(overlapProfiles.map(rec=>{
  if(rec.name!=="0.16mm Fine @TestPrinter")return rec;
  const child={...rec};delete child.infill_wall_overlap;return child;
}),selection).process.settings.infill_wall_overlap,"25%");
assert.equal(result.process.settings.infill_wall_overlap,undefined);
for(const bad of [30,"30",["30%"],null,"-1%","101%","30% G28"])
  assert.throws(()=>resolve(overlapProfiles.map(rec=>rec.name==="0.16mm Fine @TestPrinter"
    ? {...rec,infill_wall_overlap:bad}:rec),selection),/Invalid|safe test range/);
console.log("PASS: native infill/wall overlap percent inheritance and rejection");
