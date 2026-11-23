// Read-only one-slicer-api 0.7.0 manifest consistency diagnostic.
// This checks exposed ID/link and affine matrix shapes, NOT browser-to-native
// instance correspondence, desktop 3MF parity, or project editability.
// No object IDs, paths, coordinates, or profile metadata leave this function.
const unavailable=Object.freeze({
  ids:'unavailable', references:'unavailable', affineMatrices:'unavailable'
});
const validId=value=>typeof value==='string' && value.length>0 && value.length<=128 &&
  !/[\x00-\x1f\x7f]/.test(value);
// A shape-correct 4x4 transform may still flatten a mesh onto a plane or
// line. Native editing/round-trip must not label a singular basis as valid.
// Normalize each basis row first: tiny but invertible unit/scaling matrices
// must not fail an arbitrary absolute determinant threshold.
const affine=matrix=>{
  if(!Array.isArray(matrix)||matrix.length!==16||
     !matrix.every(Number.isFinite)||
     Math.abs(matrix[12])>1e-8||Math.abs(matrix[13])>1e-8||
     Math.abs(matrix[14])>1e-8||Math.abs(matrix[15]-1)>1e-8)
    return false;
  const rows=[
    [matrix[0],matrix[1],matrix[2]],
    [matrix[4],matrix[5],matrix[6]],
    [matrix[8],matrix[9],matrix[10]]
  ];
  const norms=rows.map(row=>Math.hypot(...row));
  if(norms.some(value=>!Number.isFinite(value)||value===0))return false;
  const [[a,b,c],[d,e,f],[g,h,i]]=rows.map((row,index)=>
    row.map(value=>value/norms[index]));
  const normalizedDet=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  return Number.isFinite(normalizedDet)&&Math.abs(normalizedDet)>1e-10;
};

export function auditNative3mfRelations(manifest) {
  if(!manifest || !['plates','meshes','objects','instances'].every(k=>Array.isArray(manifest[k])))
    return unavailable;
  const sets={};
  let idStatus='unique';
  for(const domain of ['plates','meshes','objects','instances']) {
    const values=manifest[domain].map(item=>item?.id);
    if(!values.every(validId)) {
      idStatus='unavailable'; break;
    }
    if(new Set(values).size!==values.length) {
      idStatus='duplicate'; break;
    }
    sets[domain]=new Set(values);
  }
  let references='unverified';
  if(idStatus==='unique') {
    const exposed=manifest.objects.every(o=>validId(o?.meshId)) &&
      manifest.instances.every(i=>validId(i?.objectId) && validId(i?.plateId));
    references=!exposed ? 'unavailable' :
      manifest.objects.every(o=>sets.meshes.has(o.meshId)) &&
      manifest.instances.every(i=>sets.objects.has(i.objectId) && sets.plates.has(i.plateId))
        ? 'valid' : 'broken';
  }
  const allMatrices=manifest.instances.every(i=>i?.transform && 'matrix' in i.transform);
  const affineMatrices=!allMatrices ? 'unavailable' :
    manifest.instances.every(i=>affine(i.transform.matrix)) ? 'valid' : 'invalid';
  return Object.freeze({ids:idStatus,references,affineMatrices});
}
