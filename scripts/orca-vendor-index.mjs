// Offline OrcaSlicer vendor-index adapter for locally supplied profile files.
// Input is a versioned vendor index JSON plus a map of sub_path -> JSON record;
// never fetch sub_paths over the network. Filament-library index is optional.
// This stages Orca resources/profiles structure for validation, not production.
import {resolveOrcaProfileCollection} from "./orca-profile-collection.mjs";

const SECTIONS={
  machine_list:"machine",
  filament_list:"filament",
  process_list:"process",
  machine_model_list:"machine_model",
};
const MAX_INDEX_ENTRIES=3000;
const MAX_PROFILE_BYTES=1024*1024;
const MAX_FILE_RECORDS=3000;
function isRecord(o) {
  return o!==null&&typeof o==="object"&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;
}
export function validateProfilePath(path) {
  if(typeof path!=="string" || path.length<6 || path.length>240 ||
     path.startsWith("/") || path.includes("\\") || path.includes("?") ||
     path.split("/").some(part=>!part || part==="." || part===".." || part.startsWith(".")) ||
     !path.endsWith(".json") || !/^[a-zA-Z0-9 @+._()\-\/]+\.json$/.test(path))
    throw new Error("Unsafe Orca profile sub_path: "+String(path));
  const folder=path.split("/")[0];
  if(!["machine","filament","process"].includes(folder))
    throw new Error("Unsupported Orca profile folder: "+folder);
  return path;
}
export function extractVendorProfileRecords(index,files,options={}) {
  if(!isRecord(index)||typeof index.name!=="string"||!index.name||
     !/^\d{2}\.\d{2}\.\d{2}\.\d{2}$/.test(index.version||""))
    throw new Error("Invalid Orca vendor index metadata");
  if(!isRecord(files)||Object.keys(files).length>MAX_FILE_RECORDS)
    throw new Error("Invalid supplied profile files");
  const records=[],modelRecords=[],seenPaths=new Set(),seenEntries=new Set();
  let entries=0;
  for(const [section,type] of Object.entries(SECTIONS)) {
    const list=index[section]??[];
    if(!Array.isArray(list))throw new Error("Invalid vendor index list: "+section);
    for(const item of list) {
      if(++entries>MAX_INDEX_ENTRIES)throw new Error("Index contains too many profiles");
      if(!isRecord(item)||typeof item.name!=="string"||!item.name)
        throw new Error("Malformed vendor index entry: "+section);
      const path=validateProfilePath(item.sub_path);
      if(path.split("/")[0]!==({machine_model:"machine"}[type]||type))
        throw new Error("Profile folder/type mismatch: "+path);
      const key=type+":"+item.name;
      if(seenEntries.has(key)||seenPaths.has(path))
        throw new Error("Duplicate indexed profile: "+key);
      seenEntries.add(key);seenPaths.add(path);
      const rec=files[path];
      if(!isRecord(rec))throw new Error("Missing indexed profile file: "+path);
      const length=JSON.stringify(rec).length;
      if(length>MAX_PROFILE_BYTES)throw new Error("Profile record too large: "+path);
      if(rec.name!==item.name||rec.type!==type)
        throw new Error("Profile name/type mismatch: "+path);
      if(type==="machine_model")modelRecords.push(rec);
      else records.push(rec);
    }
  }
  if(options.strictUnlisted!==false) {
    const extras=Object.keys(files).filter(path=>!seenPaths.has(path));
    if(extras.length)throw new Error("Unindexed profile files: "+extras.join(", "));
  }
  return {vendor:index.name,version:index.version,records,models:modelRecords,entryCount:entries};
}
export function resolveIndexedOrcaProfiles(index,files,selection,options={}) {
  const extracted=extractVendorProfileRecords(index,files,options);
  const result=resolveOrcaProfileCollection(extracted.records,selection);
  return {...result,source:{vendor:extracted.vendor,version:extracted.version,entries:extracted.entryCount}};
}
