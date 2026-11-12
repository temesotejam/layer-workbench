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
  if(typeof raw!=='number'&&typeof raw!=='string')throw new Error('Invalid value for '+key);
  if(typeof raw==='string'&&!/^\s*\d+(?:\.\d+)?\s*$/.test(raw))throw new Error('Invalid numeric value for '+key);
  const n=Number(raw);
  if(!Number.isFinite(n)||n<limits[0]||n>limits[1]||(INTEGERS.has(key)&&!Number.isInteger(n)))
    throw new Error('Setting out of test limits: '+key);
  return String(n);
}
export function resolveOrcaProfileCollection(records, selection) {
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
  function resolve(type,selected){
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
        if(key in SPECS[type])settings[key]=validateNum(key,value,SPECS[type][key]);
        else if(!META.has(key))unsupported.add(key);
      }
    }
    return {type,name:selected,chain:chain.map(p=>p.name),settings:{...settings},unsupported:[...unsupported].sort(),record:chain.at(-1)};
  }
  const machine=resolve('machine',selection.machine);
  const filament=resolve('filament',selection.filament);
  const process=resolve('process',selection.process);
  const printer=machine.name;
  for(const item of [filament,process]){
    const allowed=item.record.compatible_printers;
    if(Array.isArray(allowed)&&allowed.length&&!allowed.includes(printer))
      throw new Error(item.type+' preset is not compatible with printer '+printer);
  }
  const result={machine,filament,process};
  // Names and compatibility were resolved, but unsupported options remain
  // excluded from this local test. Never silently label result full parity.
  return result;
}
export async function readOrcaProfileCollection(file,selection){
  if(!file||!file.name.toLowerCase().endsWith('.json')||file.size>512*1024)
    throw new Error('Expected local JSON profile collection under 512 KB');
  const raw=JSON.parse(await file.text());
  return resolveOrcaProfileCollection(raw.profiles,selection);
}
