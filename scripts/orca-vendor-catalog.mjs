// Multi-vendor Orca profile catalog. Keep vendor namespaces separate: common
// preset names may recur across vendors and must never be merged implicitly.
import {extractVendorProfileRecords} from "./orca-vendor-index.mjs";

const MAX_VENDORS=256;
export function extractOrcaVendorCatalog(entries) {
  if(!Array.isArray(entries)||entries.length===0||entries.length>MAX_VENDORS)
    throw new Error("Invalid Orca vendor catalog size");
  const seen=new Set(),vendors=[];
  for(const entry of entries) {
    if(!entry||typeof entry!=="object"||Array.isArray(entry)||
       typeof entry.name!=="string"||!entry.name.trim()||entry.name.length>160||
       !entry.index||!entry.files||typeof entry.files!=="object"||Array.isArray(entry.files))
      throw new Error("Invalid Orca vendor catalog entry");
    if(entry.index.name!==entry.name)
      throw new Error("Vendor catalog name/index mismatch: "+entry.name);
    if(seen.has(entry.name))throw new Error("Duplicate Orca vendor: "+entry.name);
    seen.add(entry.name);
    const extracted=extractVendorProfileRecords(entry.index,entry.files);
    vendors.push({
      name:entry.name,version:extracted.version,entryCount:extracted.entryCount,
      records:extracted.records,models:extracted.models,
      // Preserve explicit namespace and provenance for downstream selection.
      namespace:entry.name
    });
  }
  return {vendors, vendorNames:vendors.map(v=>v.name)};
}

function aliasOf(name) {
  return name.split("@",1)[0].trim();
}
// Resolve compatibility inside ONE vendor's filament inheritance chain.
// A child with an explicit [] disables an ancestor's compatibility; unknown or
// malformed metadata is never treated as an implicit "compatible" match.
function compatibleWith(vendor, record, printerVariant) {
  const family=new Map();
  for(const item of vendor.records||[]) {
    if(item.type!=="filament")continue;
    if(family.has(item.name))throw new Error("Duplicate vendor filament: "+item.name);
    family.set(item.name,item);
  }
  let current=record;
  const visited=new Set();
  for(let depth=0;depth<=20;depth++) {
    if(visited.has(current.name))throw new Error("Filament compatibility inheritance cycle: "+current.name);
    visited.add(current.name);
    if(Object.hasOwn(current,"compatible_printers")) {
      const values=current.compatible_printers;
      if(!Array.isArray(values)||values.length>1024||
          values.some(v=>typeof v!=="string"||!v.trim()||v.length>160)||
          new Set(values).size!==values.length)
        throw new Error("Invalid inherited compatible_printers: "+current.name);
      return values.includes(printerVariant);
    }
    if(!current.inherits)return false;
    const parent=family.get(current.inherits);
    if(!parent)throw new Error("Missing vendor filament ancestor: "+current.inherits);
    current=parent;
  }
  throw new Error("Filament compatibility inheritance too deep");
}
// Orca's global filament library is a separate bundle. A vendor-specific
// preset may replace a global preset with the same alias for compatible
// printer variants; otherwise the global preset remains the fallback.
export function selectOrcaFilamentPreset(catalog,filamentAlias,printerVariant) {
  if(!catalog||!Array.isArray(catalog.vendors)||typeof filamentAlias!=="string"||
     !filamentAlias.trim()||typeof printerVariant!=="string"||!printerVariant.trim())
    throw new Error("Invalid filament selection context");
  const matches=[];
  for(const vendor of catalog.vendors) {
    for(const record of vendor.records||[]) {
      if(record.type!=="filament"||aliasOf(record.name)!==filamentAlias.trim())continue;
      const global=vendor.name==="OrcaFilamentLibrary"&&record.name.endsWith("@System");
      const compatible=compatibleWith(vendor,record,printerVariant);
      if(global||compatible)matches.push({vendor:vendor.name,name:record.name,record,global,compatible});
    }
  }
  const specific=matches.filter(x=>!x.global&&x.compatible);
  if(specific.length>1)throw new Error("Ambiguous printer-specific filament preset: "+filamentAlias);
  if(specific.length===1)return {...specific[0],selectionReason:"printer-specific alias override"};
  const global=matches.filter(x=>x.global);
  if(global.length!==1)throw new Error(global.length?"Ambiguous global filament preset":"No compatible filament preset: "+filamentAlias);
  return {...global[0],selectionReason:"global @System fallback"};
}
