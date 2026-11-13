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
