import {resolveIndexedOrcaProfiles} from "./orca-vendor-index.mjs";
import {parseTestProcessOverrides} from "./test-process-profile.mjs";
// Restricted reader for OrcaSlicer's REAL flat JSON profile record shape.
// A vendor index references files under machine/, filament/, process/; this
// tool accepts an explicitly selected local collection of those JSON records.
// It does not execute start/end G-code and does not approve print safety.
const MAX_RECORDS=96,MAX_DEPTH=20;
// Pinned PrintConfig.cpp coFloats: one selected extruder only. The CR-10
// chain uses one-slot arrays in its parents and scalar tokens in the child.
// Preserve a one-slot native vector; never interpret a multi-variant vector.
const MACHINE_RETRACTION_VECTORS=Object.freeze({
  retraction_length:[0,10],retraction_speed:[1,100],deretraction_speed:[0,100],
  // Pinned coFloats in mm; zero is an explicit threshold, not absence.
  retraction_minimum_travel:[0,100],
  // Pinned coFloats; zero disables lift, native maximum is 5 mm.
  z_hop:[0,5],travel_slope:[1,90],
  // Absolute Z in mm, locally bounded; zero below means no upper limit.
  retract_lift_above:[0,1000],retract_lift_below:[0,1000],
  // Local diagnostic bound, not an upstream maximum.
  wipe_distance:[0,20],
});
// Pinned coEnums; the serialized tokens (including spaces) are not UI labels.
const MACHINE_Z_HOP_TYPES=new Set(['Auto Lift','Normal Lift','Slope Lift','Spiral Lift']);
const SPECS={
  machine:{nozzle_diameter:[0.2,1.2],printable_height:[10,1000]},
  filament:{nozzle_temperature:[160,290],bed_temperature:[0,120]},
  process:{layer_height:[0.06,0.4],initial_layer_print_height:[0.06,0.5],
    // Source-pinned CR-10 v2.5.0 process uses an absolute 0.42 mm width.
    // Relative percentage widths remain unsupported in this test adapter.
    line_width:[0.1,2],
    // The pinned CR-10 0.20mm child independently uses 0.5mm on layer one.
    // Accept only absolute width (mm), not native percentage expressions.
    initial_layer_line_width:[0.1,2],
    // v2.5.0 Creality CR-10 0.20mm specifies 0.42 mm outer walls.
    // Only a bounded absolute width; percentage and vector forms fail closed.
    outer_wall_line_width:[0.1,2],
    // Official CR-10 0.20mm process specifies independent 0.45 mm inner walls.
    // Native coFloatOrPercent also supports %, but this diagnostic bridge
    // deliberately rejects relative or multi-nozzle widths.
    inner_wall_line_width:[0.1,2],
    // Source-pinned v2.5.0 common and CR-10 0.20mm process use 0.45 mm.
    // Restrict to absolute single-nozzle widths; percentages fail closed.
    // Pinned CR-10 top surfaces independently use 0.42mm, absolute only.
    top_surface_line_width:[0.1,2],
    sparse_infill_line_width:[0.1,2],
    // In the pinned CR-10 profile the internal SOLID infill width is an
    // independent 0.45mm value (Creality common: 0.4mm). Accept only absolute
    // single-nozzle widths; relative percentages remain unsupported.
    internal_solid_infill_line_width:[0.1,2],
    // Official v2.5.0 CR-10 0.20mm Standard sets two skirt loops.
    // Only an explicit bounded integer count is accepted in the localhost bridge.
    // Pinned CR-10 skirt_distance is 2 mm; upstream coFloat is bounded to 0..60 mm.
    // This remains a localhost diagnostic and is independent of skirt_loops.
    wall_loops:[1,8],skirt_loops:[0,10],skirt_distance:[0,60],
    // Native v2.5.0 CR-10 chain resolves skirt_height 2 -> 1 -> 2.
    // Locally accept only bounded positive integer deposition layer counts.
    skirt_height:[1,20],
    // Official v2.5.0 CR-10 child uses absolute skirt_speed=20 mm/s.
    // Native zero means fall back to the layer extrusion speed. Bound the
    // localhost diagnostic to 0..300; never reinterpret percentages as speed.
    skirt_speed:[0,300],sparse_infill_density:[0,100],
    // Native v2.5.0 CR-10 process pins this absolute direction in degrees.
    // Do not accept relative angles or multi-tool vectors in localhost lab.
    infill_direction:[0,360],
    top_shell_layers:[0,12],bottom_shell_layers:[0,12],
    // Source-pinned Creality v2.5.0 child: top 0.8 mm, bottom 0 mm.
    // These native coFloat values are absolute minimum solid thicknesses,
    // independent of integer layer counts. 0 disables the minimum.
    // Local single-nozzle proof only; no relative or vector inputs.
    top_shell_thickness:[0,5],bottom_shell_thickness:[0,5],
    // Absolute mm/s only; relative percentage-based speeds are not converted.
    // These bounds constrain diagnostic inputs, not real printer capability.
    outer_wall_speed:[1,800],inner_wall_speed:[1,800],travel_speed:[1,1500],
    // v2.5.0 Creality 0.20mm Standard supplies these four as absolute mm/s.
    // Percentages (e.g. "50%") are relative presets: never reinterpret
    // them as mm/s or silently fall back to another speed.
    sparse_infill_speed:[1,800],internal_solid_infill_speed:[1,800],
    top_surface_speed:[1,800],gap_infill_speed:[1,800],
    // The source-pinned CR-10 0.20mm profile uses absolute 50 mm/s.
    // Relative percentages and engine behavior are NOT inferred here.
    bridge_speed:[1,800],
    // Source-pinned CR-10 v2.5.0 bridge_flow is a dimensionless extrusion
    // multiplier (0.95 in the child). No percent strings or vectors in lab.
    bridge_flow:[0.1,2],
    // Pinned CR-10 v2.5.0 child explicitly sets internal_bridge_flow=1,
    // separately from bridge_flow=0.95. Scalar, bounded, localhost only.
    internal_bridge_flow:[0.1,2],
    // Source-pinned CR-10 v2.5.0 first-layer perimeter speed is 15 mm/s.
    // Percentages, relative expressions and multiple nozzle values fail closed.
    initial_layer_speed:[1,800],
    // CR-10 0.20mm Standard specifies its first-layer INFILL speed as
    // 20 mm/s, distinct from the first-layer perimeter 15 mm/s.
    // Bounded absolute scalar only; no % or multi-nozzle inference.
    initial_layer_infill_speed:[1,800],
    // Native coFloatOrPercent: retain exact first-layer travel % relative to
    // travel_speed rather than turning 50% into 50 mm/s. Localhost only.
    initial_layer_travel_speed:[1,1500],
    // Source-pinned CR-10 support width and independent body/interface speeds.
    // Localhost diagnostic only: support enablement is NOT permitted.
    support_line_width:[0.1,2],support_speed:[1,800],
    support_interface_speed:[1,800]},
};
const INTEGERS=new Set(['wall_loops','skirt_loops','skirt_height','top_shell_layers','bottom_shell_layers']);
// Pinned native process enums; the limited adapter retains exact wire values.
// No inferred default or desktop/print parity is implied by this allow-list.
const PROCESS_ENUMS=Object.freeze({
  // Pinned v2.5.0 PrintConfig.cpp coEnum: how solid regions are added
  // alongside sloped walls. The CR-10 0.20mm Standard child uses ensure_all.
  // Retain exact serialized values, never the desktop UI labels.
  ensure_vertical_shell_thickness:new Set(["none","ensure_critical_only","ensure_moderate","ensure_all"]),
  wall_generator:new Set(["classic","arachne"]),
  // CR-10 inherits aligned from Creality; preserve exact native enum tokens.
  seam_position:new Set(["nearest","aligned","aligned_back","back","random"]),
  enable_arc_fitting:new Set(["disabled","enabled","sparse_infill"]),
  // Pinned native wall-order enum; preserve exact serialized tokens.
  wall_sequence:new Set(["inner wall/outer wall","outer wall/inner wall","inner-outer-inner wall"]),
  gap_fill_target:new Set(["everywhere","topbottom","nowhere"]),
  // Pinned v2.5.0 Creality common uses crosshatch; its CR-10 0.20mm child
  // overrides this to grid. Other enum tokens require separate verification.
  sparse_infill_pattern:new Set(["grid","crosshatch"]),
  // CR-10 0.20mm Standard pins monotonic. PrintConfig.cpp in source-pinned
  // v2.5.0 also explicitly lists rectilinear for the same coEnum via
  // def_top_fill_pattern. Limit this localhost test bridge to these two
  // audited wire values; no invented default or unrelated sparse pattern.
  internal_solid_infill_pattern:new Set(["monotonic","rectilinear"]),
  // Pinned CR-10 0.20mm child overrides top monotonicline -> monotonic;
  // bottom stays monotonic. These independent native surface enums affect
  // OUTERMOST skins, not sparse/internal solid infill. Localhost proof only.
  top_surface_pattern:new Set(["monotonic","monotonicline","rectilinear"]),
  bottom_surface_pattern:new Set(["monotonic","monotonicline","rectilinear"]),
  // Pinned native coBool serialized as a string; no inferred default.
  infill_combination:new Set(["0","1"]),
  // Pinned CR-10 classic wall generator explicitly enables thin-wall detection.
  detect_thin_wall:new Set(["0","1"]),
  // Preserve independent native single-wall surface toggles.
  only_one_wall_top:new Set(["0","1"]),
  only_one_wall_first_layer:new Set(["0","1"]),
});
// Pinned OrcaSlicer v2.5.0 PrintConfig.cpp: curr_bed_type enum and
// six native per-filament steady/first-layer coInts pairs. UI labels are
// NOT the serialized enum values (e.g. "Smooth Cool Plate" vs "Cool Plate").
// Never infer a plate type from an unrelated bed_temperature fallback.
const PLATE_OPTIONS=Object.freeze({
  hot:{name:"High Temp Plate",temperature:"hot_plate_temp"},
  cool:{name:"Cool Plate",temperature:"cool_plate_temp"},
  engineering:{name:"Engineering Plate",temperature:"eng_plate_temp"},
  textured:{name:"Textured PEI Plate",temperature:"textured_plate_temp"},
  "textured-cool":{name:"Textured Cool Plate",temperature:"textured_cool_plate_temp"},
  supertack:{name:"Supertack Plate",temperature:"supertack_plate_temp"}
});

const META=new Set(['type','name','inherits','instantiation','from','compatible_printers','setting_id','filament_id','alias']);
// A malformed compatible_printers record must not bypass machine selection.
// Check this in the family resolver too: it is also used directly by callers
// that do not pass through resolveOrcaProfileCollection.
function validateCompatiblePrinters(raw) {
  if (!Array.isArray(raw) || raw.length > 1024 ||
      raw.some(p => typeof p !== "string" || !p.trim() || p.length > 160) ||
      new Set(raw).size !== raw.length)
    throw new Error("Invalid compatible_printers");
}
function dict(x){return x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;}
function name(x){if(typeof x!=='string'||!x||x.length>160||['__proto__','constructor','prototype'].includes(x))throw new Error('Invalid profile name');return x;}
function validateNum(key,raw,limits){
  // OrcaSlicer often represents single-nozzle options as one-element arrays.
  if(Array.isArray(raw)){
    if(raw.length!==1)throw new Error('Multi-extruder setting not supported: '+key);
    raw=raw[0];
  }
  if(typeof raw!=='number'&&typeof raw!=='string')throw new Error('Invalid value for '+key);
  // OrcaSlicer ships infill density as e.g. "15%", unlike the test bridge's
  // canonical numeric percentage. Strip '%' ONLY for the documented field.
  if(typeof raw==='string'&&key==='initial_layer_travel_speed'){
    const percent=/^\s*(\d+(?:\.\d+)?)%\s*$/.exec(raw);
    if(percent){
      const n=Number(percent[1]);
      if(!Number.isFinite(n)||n<1||n>200)throw new Error('Setting out of test limits: '+key);
      return String(n)+'%';
    }
  }
  if(typeof raw==='string'&&key==='sparse_infill_density'&&/^\s*\d+(?:\.\d+)?%\s*$/.test(raw))
    raw=raw.trim().slice(0,-1);
  if(typeof raw==='string'&&!/^\s*\d+(?:\.\d+)?\s*$/.test(raw))throw new Error('Invalid numeric value for '+key);
  const n=Number(raw);
  if(!Number.isFinite(n)||n<limits[0]||n>limits[1]||(INTEGERS.has(key)&&!Number.isInteger(n)))
    throw new Error('Setting out of test limits: '+key);
  return String(n);
}
export function resolveOrcaProfileFamily(records,type,selected,options={}) {
  if(!Object.hasOwn(SPECS,type))throw new Error("Unknown Orca profile type");
  if(!Array.isArray(records)||records.length===0||records.length>MAX_RECORDS)throw new Error("Invalid profile collection size");
  const registry=new Map();
  for(const rec of records) {
    if(!dict(rec)||!SPECS[rec.type])throw new Error("Unknown Orca profile type");
    const key=rec.type+':'+name(rec.name);
    if(registry.has(key))throw new Error("Duplicate profile "+key);
    if(rec.inherits!=null&&rec.inherits!=='')name(rec.inherits);
    if(Object.hasOwn(rec,'compatible_printers'))validateCompatiblePrinters(rec.compatible_printers);
    registry.set(key,rec);
  }
  function resolve(){
    const chain=[],visited=new Set();
    function walk(n,depth){
      if(depth>MAX_DEPTH)throw new Error('Profile inheritance too deep');
      const key=type+':'+n;
      if(visited.has(key))throw new Error('Profile inheritance cycle: '+key);
      const rec=registry.get(key);
      if(!rec)throw new Error('Missing inherited profile: '+key);
      visited.add(key);
      if(rec.inherits)walk(rec.inherits,depth+1);
      chain.push(rec);
    }
    walk(name(selected),0);
    const settings=Object.create(null);
    const unsupported=new Set();
    for(const rec of chain){
      for(const [key,value] of Object.entries(rec)){
        if(type==="machine" && Object.hasOwn(MACHINE_RETRACTION_VECTORS,key)) {
          settings[key]=[validateNum(key,value,MACHINE_RETRACTION_VECTORS[key])];
        }else if(type==="machine" && key==="wipe") {
          // Pinned coBools: accept only the actual serialized single-slot tokens.
          const token=Array.isArray(value)&&value.length===1?value[0]:value;
          if(token!=="0"&&token!=="1")throw new Error("Invalid single-tool native wipe toggle");
          settings[key]=[token];
        }else if(type==="machine" && (key==="retract_before_wipe" || key==="retract_after_wipe")) {
          // Pinned coPercents: retain the explicit percent unit, never mm.
          const token=Array.isArray(value)&&value.length===1?value[0]:value;
          if(typeof token!=="string"||!/^\d+(?:\.\d+)?%$/.test(token)||Number(token.slice(0,-1))>100)
            throw new Error("Invalid single-tool native "+key.replaceAll("_","-")+" percent");
          settings[key]=[String(Number(token.slice(0,-1)))+"%"];
        }else if(type==="machine" && key==="z_hop_types") {
          const token=Array.isArray(value)&&value.length===1?value[0]:value;
          if(typeof token!=="string"||!MACHINE_Z_HOP_TYPES.has(token))
            throw new Error('Invalid single-tool native Z-hop type');
          settings[key]=[token];
        }else if(type==="process" && key==="infill_wall_overlap") {
          // Native coPercent is scalar, not a nozzle vector or absolute width.
          // Share the final native-json validation, preserving the % token.
          settings[key]=parseTestProcessOverrides({[key]:value})[key];
        }else if(type==="process" && (key==="infill_anchor" || key==="infill_anchor_max" || key==="infill_combination_max_layer_height")) {
          // Native FloatOrPercent scalar; preserve mm vs % across inheritance.
          settings[key]=parseTestProcessOverrides({[key]:value})[key];
        }else if(type==="process" && (key==="minimum_sparse_infill_area" || key==="bottom_solid_infill_flow_ratio")) {
          // Native coFloat is a scalar (area or flow multiplier), never a filament vector.
          settings[key]=parseTestProcessOverrides({[key]:value})[key];
        }else if(type==="process" && key==="top_solid_infill_flow_ratio") {
          // Preserve one explicit native nozzle slot; never flatten it into bottom flow.
          settings[key]=parseTestProcessOverrides({[key]:value})[key];
        }else if(Object.hasOwn(SPECS[type],key))settings[key]=validateNum(key,value,SPECS[type][key]);
        else if(type==="process" && Object.hasOwn(PROCESS_ENUMS,key)) {
          // Pinned PrintConfig.cpp handle_legacy: legacy string booleans for
          // arc fitting are mapped before native enum deserialization.
          let token=value;
          if(key==="enable_arc_fitting" && typeof token==="string"){
            if(token==="0" || token.toLowerCase()==="false")token="disabled";
            else if(token==="1" || token.toLowerCase()==="true")token="enabled";
          }
          if(typeof token!=="string" || !PROCESS_ENUMS[key].has(token))
            throw new Error("Invalid native process enum: "+key);
          settings[key]=token;
        }else if(!META.has(key))unsupported.add(key);
      }
    }
    // Native OrcaSlicer exposes first-layer nozzle temperature as a
    // per-filament vector. Resolve it independently of steady nozzle temp;
    // forwarding a scalar or silently using the steady temperature would
    // discard the shipped profile's initial-layer distinction.
    let selectedFilamentVariant=null;
    if(type==="filament"){
      // The source-pinned v2.5.0 PLA base uses a one-slot material vector.
      // The approved localhost WASM candidate has only been exercised as PLA;
      // never misrepresent another selected material as generic test PLA.
      const materialSource=[...chain].reverse().find(p=>Object.hasOwn(p,"filament_type"));
      if(materialSource){
        const material=materialSource.filament_type;
        if(!Array.isArray(material)||material.length!==1||material[0]!=="PLA")
          throw new Error("Only single-slot PLA filament_type is verified in the local WASM test");
        // session.init's proven generic-PLA test wire shape is scalar, while
        // official material presets store a one-element vector.
        settings.filament_type="PLA";
        unsupported.delete("filament_type");
      }
      // The pinned native v2.5.0 common filament preset supplies a single
      // physical filament diameter (1.75 mm), not a variant/nozzle map.
      // Only a bounded, explicit one-slot vector enters the WASM test adapter.
      const diameterSource=[...chain].reverse().find(p=>Object.hasOwn(p,"filament_diameter"));
      if(diameterSource){
        const diameter=validateNum("filament_diameter",diameterSource.filament_diameter,[1,3]);
        settings.filament_diameter=[diameter];
        unsupported.delete("filament_diameter");
      }
      const initialNozzle=[...chain].reverse().find(p=>Object.hasOwn(p,"nozzle_temperature_initial_layer"));
      if(initialNozzle){
        const temp=validateNum("nozzle_temperature",initialNozzle.nozzle_temperature_initial_layer,SPECS.filament.nozzle_temperature);
        settings.nozzle_temperature_initial_layer=[temp];
        unsupported.delete("nozzle_temperature_initial_layer");
      }
      // Native OrcaSlicer stores flow ratio per filament/extruder, not as a
      // generic scalar percentage. A missing ratio is left unspecified;
      // never infer it from the nozzle, extrusion width or temperature.
      // Deliberately limited to one filament and a bounded diagnostic range:
      // passing a multi-value vendor vector as one extruder would be unsafe.
      const flowSource=[...chain].reverse().find(p=>Object.hasOwn(p,"filament_flow_ratio"));
      if(flowSource){
        const ratio=validateNum("filament_flow_ratio",flowSource.filament_flow_ratio,[0.5,1.5]);
        settings.filament_flow_ratio=[ratio];
        unsupported.delete("filament_flow_ratio");
      }
      // Pinned v2.5.0 Generic PLA has SIX nozzle/extruder-variant flow limits,
      // not six filaments. Never silently choose an arbitrary index.
      const maxSource=[...chain].reverse().find(p=>Object.hasOwn(p,"filament_max_volumetric_speed"));
      if(maxSource){
        const values=Array.isArray(maxSource.filament_max_volumetric_speed)
          ? maxSource.filament_max_volumetric_speed : [maxSource.filament_max_volumetric_speed];
        // A single value may be used without selecting a nozzle variant.
        // When the user explicitly selects one, however, its native variant
        // metadata MUST match: otherwise an unrelated flow cap is silently
        // applied and the requested selection is falsely reported as honored.
        if(values.length===1 && options.filamentVariant===undefined){
          const limit=validateNum("filament_max_volumetric_speed",values[0],[0.1,200]);
          settings.filament_max_volumetric_speed=[limit];
          unsupported.delete("filament_max_volumetric_speed");
        }else if(options.filamentVariant!==undefined){
          const variants=[...chain].reverse()
            .find(p=>Object.hasOwn(p,"filament_extruder_variant"))?.filament_extruder_variant;
          if(!Array.isArray(variants)||variants.length!==values.length||
              variants.some(v=>typeof v!=="string"||!v.trim()||v.length>120)||
              new Set(variants).size!==variants.length)
            throw new Error("Invalid or mismatched filament extruder variant vector");
          if(typeof options.filamentVariant!=="string"||options.filamentVariant.length>120)
            throw new Error("Invalid selected filament variant");
          const index=variants.indexOf(options.filamentVariant);
          if(index<0)throw new Error("Selected filament extruder variant not found");
          const limit=validateNum("filament_max_volumetric_speed",values[index],[0.1,200]);
          settings.filament_max_volumetric_speed=[limit];
          unsupported.delete("filament_max_volumetric_speed");
          selectedFilamentVariant={name:variants[index],index,source:maxSource.name,maxVolumetricSpeed:limit};
        }
      }else if(options.filamentVariant!==undefined)
        throw new Error("Selected filament variant has no volumetric speed settings");
    }
    // Explicit plate choice only. The upstream v2.5.0 enum has six values
    // and paired per-filament temperature vectors, selected independently.
    // '0' means the filament does not support that plate: refuse selection
    // rather than emitting a cold-bed setting that appears print-ready.
    let selectedBed=null;
    if(type==="filament" && options.plateType!=null) {
      if(typeof options.plateType!=="string" ||
         !Object.hasOwn(PLATE_OPTIONS,options.plateType))
        throw new Error("Unsupported Orca plate type");
      const plate=PLATE_OPTIONS[options.plateType];
      const source=[...chain].reverse().find(p=>Object.hasOwn(p,plate.temperature));
      if(!source)throw new Error("Selected "+options.plateType+" plate temperature missing");
      const temp=validateNum("bed_temperature",source[plate.temperature],SPECS.filament.bed_temperature);
      if(Number(temp)===0)throw new Error("Selected Orca plate is unsupported by filament");
      // Retain the native vector and enum; the limited bridge also accepts
      // bed_temperature for its development-profile compatibility path.
      settings.bed_temperature=temp;
      settings.curr_bed_type=plate.name;
      settings[plate.temperature]=[temp];
      unsupported.delete(plate.temperature);
      const initialKey=plate.temperature+"_initial_layer";
      const initial=[...chain].reverse().find(p=>Object.hasOwn(p,initialKey));
      let initialLayerTemp=null;
      if(initial){
        initialLayerTemp=validateNum("bed_temperature",initial[initialKey],SPECS.filament.bed_temperature);
        if(Number(initialLayerTemp)===0)
          throw new Error("Selected Orca plate first layer is unsupported by filament");
        settings[initialKey]=[initialLayerTemp];
        unsupported.delete(initialKey);
      }
      selectedBed={plateType:options.plateType,source:source.name,bed_temperature:temp,
        initialLayerSource:initial?.name??null,initialLayerTemperature:initialLayerTemp};
    }
    // Compatibility may be inherited from the nearest ancestor that defines it.
    const compatible=[...chain].reverse().find(p=>Object.hasOwn(p,'compatible_printers'))?.compatible_printers;
    return {type,name:selected,chain:chain.map(p=>p.name),settings:{...settings},unsupported:[...unsupported].sort(),record:chain.at(-1),compatible,selectedBed,selectedFilamentVariant};
  }
  return resolve();
}
export function resolveOrcaProfileCollection(records, selection, options={}) {
  if(!Array.isArray(records)||records.length===0||records.length>MAX_RECORDS)throw new Error('Invalid profile collection size');
  if(!dict(selection))throw new Error('Expected machine/filament/process names');
  const registry=new Map();
  for(const rec of records){
    if(!dict(rec)||!SPECS[rec.type])throw new Error('Unknown Orca profile type');
    const key=rec.type+':'+name(rec.name);
    if(registry.has(key))throw new Error('Duplicate profile '+key);
    if(rec.inherits!=null&&rec.inherits!=='')name(rec.inherits);
    if(Object.hasOwn(rec,'compatible_printers'))validateCompatiblePrinters(rec.compatible_printers);
    registry.set(key,rec);
  }
  const machine=resolveOrcaProfileFamily(records,'machine',selection.machine);
  const filament=resolveOrcaProfileFamily(records,'filament',selection.filament,options);
  const process=resolveOrcaProfileFamily(records,'process',selection.process);
  const printer=machine.name;
  for(const item of [filament,process]){
    const allowed=item.compatible;
    if(Array.isArray(allowed)&&allowed.length&&!allowed.includes(printer))
      throw new Error(item.type+' preset is not compatible with printer '+printer);
  }
  const result={machine,filament,process};
  // Names and compatibility were resolved, but unsupported options remain
  // excluded from this local test. Never silently label result full parity.
  return result;
}
export async function readOrcaProfileCollection(file,selection,options={}){
  if(!file||!file.name.toLowerCase().endsWith('.json')||file.size>512*1024)
    throw new Error('Expected local JSON profile collection under 512 KB');
  const raw=JSON.parse(await file.text());
  if(raw.vendor_index && raw.files)
    return resolveIndexedOrcaProfiles(raw.vendor_index,raw.files,selection,options);
  return resolveOrcaProfileCollection(raw.profiles,selection,options);
}
