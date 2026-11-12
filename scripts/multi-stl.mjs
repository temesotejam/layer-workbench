// One-plate, multiple STL mesh adapter for one-slicer-api 0.7.0.
// Every mesh's original bytes are concatenated without conversion.
// Every instance is assigned its own unique ID and checked affine transform.
import { viewerMatrixToNative } from "./transform-matrix.mjs";

const IDENTITY_NATIVE = [1,0,0,128, 0,1,0,128, 0,0,1,0, 0,0,0,1];
const MAX_TOTAL = 80 * 1024 * 1024;

export function makeMultiStlProject(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 24)
    throw new Error("Expected 1–24 STL models on one plate.");
  let offset = 0;
  const meshes=[], objects=[], instances=[], chunks=[];
  items.forEach((item,i) => {
    if (!(item.bytes instanceof Uint8Array) || item.bytes.byteLength < 134)
      throw new Error("Model " + i + " has invalid or empty STL bytes.");
    if (offset + item.bytes.byteLength > MAX_TOTAL)
      throw new Error("Combined STL files exceed the 80 MB test limit.");
    const meshId="mesh-"+i, objectId="object-"+i;
    meshes.push({id:meshId,format:"stl",dataRange:{offset,length:item.bytes.byteLength}});
    objects.push({id:objectId,meshId});
    instances.push({
      id:"instance-"+i,objectId,plateId:"plate-0",
      transform:{matrix:item.viewerElements
        ? viewerMatrixToNative(item.viewerElements)
        : [...IDENTITY_NATIVE]},
    });
    chunks.push(item.bytes);
    offset+=item.bytes.byteLength;
  });
  const blob = new Uint8Array(offset);
  let cursor=0;
  for (const chunk of chunks) {blob.set(chunk,cursor);cursor+=chunk.byteLength;}
  return {
    blob,
    manifest:{
      schemaVersion:"0.7.0",
      plates:[{id:"plate-0",index:0}],
      meshes,objects,instances,modifierVolumes:[],
    },
  };
}
