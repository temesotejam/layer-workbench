import {resolveIndexedOrcaProfiles} from "./orca-vendor-index.mjs";
// Restricted reader for OrcaSlicer's REAL flat JSON profile record shape.
// A vendor index references files under machine/, filament/, process/; this
// tool accepts an explicitly selected local collection of those JSON records.
// It does not execute start/end G-code and does not approve print safety.
const MAX_RECORDS=96,MAX_DEPTH=20;
const SPECS={
  machine:{nozzle_diameter:[0.2,1.2],printable_height:[10,1000]},
  filament:{nozzle_temperature:[160,290],bed_temperature:[0,120]},
  process:{layer_height:[0.06,0.4],wall_loops:[1,8],sparse_infill_density:[0,100]},
};
const INTEGERS=new Set(['wall_loops']);
const META=new Set(['type','name','inherits','instantiation','from','compatible_printers','setting_id','filament_id','alias']);
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
        if(Object.hasOwn(SPECS[type],key))settings[key]=validateNum(key,value,SPECS[type][key]);
        else if(!META.has(key))unsupported.add(key);
      }
    }
    // Native OrcaSlicer exposes first-layer nozzle temperature as a
    // per-filament vector. Resolve it independently of steady nozzle temp;
    // forwarding a scalar or silently using the steady temperature would
    // discard the shipped profile's initial-layer distinction.
    if(type==="filament"){
      const initialNozzle=[...chain].reverse().find(p=>Object.hasOwn(p,"nozzle_temperature_initial_layer"));
      if(initialNozzle){
        const temp=validateNum("nozzle_temperature",initialNozzle.nozzle_temperature_initial_layer,SPECS.filament.nozzle_temperature);
        settings.nozzle_temperature_initial_layer=[temp];
        unsupported.delete("nozzle_temperature_initial_layer");
      }
    }
    // A real Orca filament has plate-specific bed temperatures, not a generic
    // 'bed_temperature' field. Only map an explicitly selected hot plate in
    // this local development proof. Never assume other plate types are equal.
    let selectedBed=null;
    if(type==="filament" && options.plateType!=null) {
      if(options.plateType!=="hot")throw new Error("Unsupported Orca plate type");
      const source=[...chain].reverse().find(p=>Object.hasOwn(p,"hot_plate_temp"));
      if(!source)throw new Error("Selected hot plate temperature missing");
      const temp=validateNum("bed_temperature",source.hot_plate_temp,SPECS.filament.bed_temperature);
      // OrcaSlicer's PrintConfig selects the bed temperature through
      // curr_bed_type. Merely changing a compatibility bed_temperature field
      // can alter a G-code metadata header WITHOUT issuing an M140/M190.
      // Require a user-selected plate and pass BOTH native options so that
      // the G-code writer sees the matching High Temp Plate settings.
      settings.bed_temperature=temp;
      settings.curr_bed_type="High Temp Plate";
      settings.hot_plate_temp=[temp];
      unsupported.delete("hot_plate_temp");
      // The pinned OrcaWasm one-slicer-api bridge accepts native per-filament
      // temperature vectors (see its smoke-test.mjs). Unlike the steady-state
      // bridge value, the first-layer temperature must retain the native key
      // and one-element vector shape; NEVER replace it with bed_temperature.
      // There is deliberately no inferred default if the field is absent.
      const initial=[...chain].reverse().find(p=>Object.hasOwn(p,"hot_plate_temp_initial_layer"));
      let initialLayerTemp=null;
      if(initial){
        initialLayerTemp=validateNum("bed_temperature",initial.hot_plate_temp_initial_layer,SPECS.filament.bed_temperature);
        settings.hot_plate_temp_initial_layer=[initialLayerTemp];
        unsupported.delete("hot_plate_temp_initial_layer");
      }
      selectedBed={plateType:"hot",source:source.name,bed_temperature:temp,
        initialLayerSource:initial?.name??null,initialLayerTemperature:initialLayerTemp};
    }
    // Compatibility may be inherited from the nearest ancestor that defines it.
    const compatible=[...chain].reverse().find(p=>Object.hasOwn(p,'compatible_printers'))?.compatible_printers;
    return {type,name:selected,chain:chain.map(p=>p.name),settings:{...settings},unsupported:[...unsupported].sort(),record:chain.at(-1),compatible,selectedBed};
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
    if(rec.compatible_printers!=null&&(!Array.isArray(rec.compatible_printers)||rec.compatible_printers.some(p=>typeof p!=='string')))
      throw new Error('Invalid compatible_printers');
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
