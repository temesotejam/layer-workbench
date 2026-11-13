// Non-executable audit of inherited OrcaSlicer v2.5.0 material settings.
// A filament preset can contain variant vectors of different lengths; these
// are NOT four physical nozzle values and must not be routed by filament_map.
export const ORCA_FILAMENT_MATERIAL_SOURCE=Object.freeze({
  repository:"OrcaSlicer/OrcaSlicer",
  commit:"40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19",
  file:"src/libslic3r/PrintConfig.cpp"
});
const FIELDS=Object.freeze([
  {key:"nozzle_temperature",nativeType:"coInts",unit:"C",min:0},
  {key:"nozzle_temperature_initial_layer",nativeType:"coInts",unit:"C",min:0},
  {key:"filament_flow_ratio",nativeType:"coFloatsNullable",unit:"ratio",min:0,exclusive:true,nullable:true},
  {key:"filament_max_volumetric_speed",nativeType:"coFloats",unit:"mm3/s",min:0,exclusive:true},
  {key:"filament_diameter",nativeType:"coFloats",unit:"mm",min:0,exclusive:true}
]);
function parseNativeNumber(value,def) {
  if (def.nullable && value==="nil") return null;
  if ((typeof value!=="string" && typeof value!=="number") ||
      (typeof value==="string" && !/^(?:\d+)(?:\.\d+)?$/.test(value)))
    throw new Error("Invalid numeric material setting: "+def.key);
  const n=Number(value);
  if (!Number.isFinite(n) || (def.nativeType==="coInts" && !Number.isSafeInteger(n)) ||
      (def.exclusive ? n<=def.min : n<def.min))
    throw new Error("Invalid numeric material setting: "+def.key);
  return n;
}
export function inspectOrcaFilamentMaterialVectors(profile) {
  if (!profile || profile.type!=="filament" || typeof profile.name!=="string" ||
      !profile.settings || typeof profile.settings!=="object" ||
      Array.isArray(profile.settings) || !profile.sourceByKey ||
      typeof profile.sourceByKey!=="object")
    throw new Error("Expected resolved full Orca filament profile");
  const fields=FIELDS.map(def=>{
    const raw=profile.settings[def.key];
    if (raw===undefined)
      return {key:def.key,nativeType:def.nativeType,unit:def.unit,
        shape:"missing",length:0,source:null,rawValues:[],numericValues:[]};
    const shape=Array.isArray(raw)?"array":"scalar";
    const values=shape==="array"?raw:[raw];
    if (values.length===0 || values.length>64)
      throw new Error("Invalid material setting vector length: "+def.key);
    // Sparse arrays are not representable in valid upstream JSON.
    for(let i=0;i<values.length;i++)
      if(!Object.prototype.hasOwnProperty.call(values,i))
        throw new Error("Sparse material setting vector: "+def.key);
    return {key:def.key,nativeType:def.nativeType,unit:def.unit,
      shape,length:values.length,source:profile.sourceByKey[def.key]??null,
      rawValues:values.slice(),numericValues:values.map(v=>parseNativeNumber(v,def))};
  });
  const present=fields.filter(f=>f.shape!=="missing");
  const arrayLengths=[...new Set(present.filter(f=>f.shape==="array").map(f=>f.length))].sort((a,b)=>a-b);
  return {profile:profile.name,source:ORCA_FILAMENT_MATERIAL_SOURCE,fields,
    arrayLengths,hasMixedArrayLengths:arrayLengths.length>1,
    scalarNativeVectorKeys:present.filter(f=>f.shape==="scalar").map(f=>f.key),
    // Native scalar shapes do occur in selected vendor JSON even where ConfigDef
    // declares vector options. Preserve them; don't silently expand/flatten.
    requiresNativeVariantResolution:true,usableForPrinting:false};
}
