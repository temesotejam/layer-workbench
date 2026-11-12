// Restricted process preset inheritance, evaluated entirely in the browser.
// Supports Orca-style inherits chains but deliberately resolves only the
// five process keys accepted by the existing generic-PLA test bridge.
// It DOES NOT implement full native machine/filament presets or scripts.
import {parseTestProcessOverrides} from "./test-process-profile.mjs";

const MAX_PRESETS=64;
const MAX_DEPTH=16;
const MAX_BYTES=256*1024;
const RESERVED=new Set(["__proto__","prototype","constructor"]);
function plain(value) {
  return !!value && typeof value==="object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value)===Object.prototype;
}
function safeName(value) {
  if(typeof value!=="string" || value.length<1 || value.length>120 ||
     RESERVED.has(value) || /[\u0000-\u001f]/.test(value))throw new Error("Invalid preset name.");
  return value;
}
function parsedDocument(document) {
  if (!plain(document))throw new Error("Preset bundle must be a JSON object.");
  const list=document.presets;
  if(!Array.isArray(list) || !list.length || list.length>MAX_PRESETS)
    throw new Error("Preset bundle must contain 1–64 entries.");
  const map=new Map();
  for(const entry of list){
    if(!plain(entry))throw new Error("Malformed preset.");
    const name=safeName(entry.name);
    if(map.has(name))throw new Error("Duplicate preset: "+name);
    if(entry.type!==undefined && entry.type!=="process")
      throw new Error("Only process presets are supported by this lab.");
    const parent=entry.inherits==null || entry.inherits===""?null:safeName(entry.inherits);
    if(!plain(entry.settings))throw new Error("Preset settings must be an object: "+name);
    const settings=Object.create(null);
    // Validate EACH layer; do not let inherited valid values hide a bad key.
    if(Object.keys(entry.settings).length)Object.assign(settings,parseTestProcessOverrides(entry.settings));
    map.set(name,{name,parent,settings});
  }
  return map;
}
export function resolveProcessPreset(bundle, selected) {
  const presets=parsedDocument(bundle);
  const target=safeName(selected);
  const visited=new Set();
  const layers=[];
  function visit(name,depth) {
    if(depth>MAX_DEPTH)throw new Error("Preset inheritance exceeds 16 levels.");
    if(visited.has(name))throw new Error("Preset inheritance cycle at "+name);
    const entry=presets.get(name);
    if(!entry)throw new Error("Missing inherited preset: "+name);
    visited.add(name);
    if(entry.parent)visit(entry.parent,depth+1);
    layers.push(entry);
  }
  visit(target,0);
  const resolved=Object.create(null);
  for(const layer of layers)Object.assign(resolved,layer.settings);
  if(!Object.keys(resolved).length)throw new Error("Selected preset has no supported settings.");
  return {name:target,chain:layers.map(layer=>layer.name),settings:{...resolved}};
}
export async function readProcessPresetBundle(file,selected) {
  if(!file)throw new Error("Select a preset bundle JSON file.");
  if(!file.name.toLowerCase().endsWith(".json") || file.size>MAX_BYTES)
    throw new Error("Expected a JSON bundle smaller than 256 KB.");
  const document=JSON.parse(await file.text());
  return resolveProcessPreset(document,selected);
}
