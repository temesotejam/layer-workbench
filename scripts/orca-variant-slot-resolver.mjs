// Conservative port of OrcaSlicer v2.5.0's variant-slot lookup contract.
// Source: PrintConfig.hpp declarations and test_config_variant_expansion.cpp
// at 40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19.
// This resolves metadata slots only; it does not build a PrintConfig.
const VOLUME_NAMES = new Map([
  ["Standard","Standard"],["High Flow","High Flow"],
  ["TPU High Flow","TPU High Flow"],["E3D High Flow","E3D High Flow"]
]);
const EXTRUDER_NAMES = new Map([["Direct Drive","Direct Drive"],["Bowden","Bowden"]]);
function checkedParallel(list,ids,label) {
  if(!Array.isArray(list)||!Array.isArray(ids)||list.length>256||ids.length>256)
    throw new Error("Invalid "+label+" variant vectors");
  for(let i=0;i<list.length;i++)if(!Object.hasOwn(list,i)||typeof list[i]!=="string"||!list[i].trim())
    throw new Error("Invalid "+label+" variant entry");
  for(let i=0;i<ids.length;i++)if(!Object.hasOwn(ids,i)||!Number.isSafeInteger(ids[i])||ids[i]<1)
    throw new Error("Invalid "+label+" variant ID");
  return list;
}
// Mirrors PrintConfig.cpp::find_variant_index (pinned v2.5.0):
// exact same-ID variant, else that ID's FIRST variant, else -1.
// The get_config_index_base wrapper, not this function, clamps -1 to 0.
// An ID below zero or an empty ID vector matches any ID.
export function findOrcaVariantIndex(variant,id,variants,ids) {
  checkedParallel(variants,ids,"variant");
  if(!Number.isSafeInteger(id)||id===0)
    throw new Error("Variant ID must be 1-based or -1 (any ID)");
  const count=variants.length===0?ids.length:variants.length;
  if(count===0)return 0;
  const sameId=index=>id<0||ids.length===0||(index<ids.length&&ids[index]===id);
  for(let i=0;i<variants.length;i++)
    if(variants[i]===variant&&sameId(i))return i;
  for(let i=0;i<count;i++)
    if(sameId(i))return i;
  return -1;
}
export function resolveOrcaFilamentVariantSlot({extruderId,extruderType,nozzleVolumeType,
  filamentVariants,filamentVariantIds}) {
  if(!EXTRUDER_NAMES.has(extruderType))throw new Error("Unsupported extruder type");
  if(!VOLUME_NAMES.has(nozzleVolumeType)||nozzleVolumeType==="Hybrid")
    throw new Error("Hybrid/unknown is not a physical preset variant");
  const variant=extruderType+" "+nozzleVolumeType;
  const index=Math.max(0,findOrcaVariantIndex(variant,extruderId,filamentVariants,filamentVariantIds));
  return {variant,index,extruderId,extruderType,nozzleVolumeType,
    source:"native v2.5.0 variant lookup contract",
    usableForPrinting:false};
}
