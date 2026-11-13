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
export function findOrcaVariantIndex(variant,id,variants,ids) {
  checkedParallel(variants,ids,"variant");
  if(!Number.isSafeInteger(id)||id<1)throw new Error("Variant ID must be 1-based");
  if(variants.length===0)return ids.length===0?0:Math.max(0,ids.findIndex(x=>x===id));
  const exact=[];
  for(let i=0;i<variants.length;i++) {
    const entryId=ids.length>i?ids[i]:-1;
    if((entryId===id||entryId===-1)&&variants[i]===variant)exact.push(i);
  }
  if(exact.length>1)throw new Error("Ambiguous duplicate Orca variant entry");
  if(exact.length===1)return exact[0];
  const fallback=[];
  for(let i=0;i<variants.length;i++)if(ids.length>i&&ids[i]===id)fallback.push(i);
  if(fallback.length>1)throw new Error("Ambiguous Orca variant fallback");
  if(fallback.length===1)return fallback[0];
  // Native contract: no variant for this ID falls back to slot zero.
  return 0;
}
export function resolveOrcaFilamentVariantSlot({extruderId,extruderType,nozzleVolumeType,
  filamentVariants,filamentVariantIds}) {
  if(!EXTRUDER_NAMES.has(extruderType))throw new Error("Unsupported extruder type");
  if(!VOLUME_NAMES.has(nozzleVolumeType)||nozzleVolumeType==="Hybrid")
    throw new Error("Hybrid/unknown is not a physical preset variant");
  const variant=extruderType+" "+nozzleVolumeType;
  const index=findOrcaVariantIndex(variant,extruderId,filamentVariants,filamentVariantIds);
  return {variant,index,extruderId,extruderType,nozzleVolumeType,
    source:"native v2.5.0 variant lookup contract",
    usableForPrinting:false};
}
