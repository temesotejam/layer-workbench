// Pure geometry helper for the localhost-only G-code 3D diagnostic.
// Legacy parsed records without z1/z2 are assumed horizontal at layer Z;
// new parser records preserve the actual source/destination heights.
export function gcodeSegment3DVertices(segment,layerZ){
  const z1=segment.z1??layerZ;
  const z2=segment.z2??layerZ;
  const coordinates=[segment.x1,segment.y1,z1,segment.x2,segment.y2,z2];
  if(!coordinates.every(Number.isFinite))
    throw new Error("Invalid G-code preview segment coordinates");
  return coordinates;
}
