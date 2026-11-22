// Read-only hypothesis test: a native/viewer translation-anchor discrepancy
// might be produced by one local mesh-origin reframe shared by >=3 instances.
// This cannot recover native vertices or prove pivot conventions. All IDs,
// matrices, inferred offsets, and raw coordinates remain private.
const unavailable = Object.freeze({reframe:'unavailable',comparedInstances:0});
const finite = x => typeof x==='number' && Number.isFinite(x) && Math.abs(x)<=1e7;
const validAffine = (m,column) => Array.isArray(m) && m.length===16 && m.every(finite) &&
  (column ? [3,7,11] : [12,13,14]).every(i=>Math.abs(m[i])<1e-8) &&
  Math.abs(m[15]-1)<1e-8;
const fromNative = i => {
  const m=i?.transform?.matrix;
  return validAffine(m,false) ? {linear:[m[0],m[1],m[2],m[4],m[5],m[6],m[8],m[9],m[10]],
    translation:[m[3],m[7],m[11]]} : null;
};
const fromViewer = m => validAffine(m,true) ?
  {linear:[m[0],m[4],m[8],m[1],m[5],m[9],m[2],m[6],m[10]],
    translation:[m[12],m[13],m[14]]} : null;
const near=(a,b,t)=>a.every((v,i)=>Math.abs(v-b[i])<=t);
const difference=(a,b)=>a.map((v,i)=>v-b[i]);
const multiply=(matrix,vector)=>[0,1,2].map(r=>[0,1,2].reduce((s,c)=>s+matrix[r*3+c]*vector[c],0));
function solve3(matrix,vector) {
  const rows=[0,1,2].map(r=>[...matrix.slice(r*3,r*3+3),vector[r]]);
  for(let k=0;k<3;k++){
    let pivot=k;
    for(let r=k+1;r<3;r++)if(Math.abs(rows[r][k])>Math.abs(rows[pivot][k]))pivot=r;
    if(Math.abs(rows[pivot][k])<1e-6)return null;
    [rows[k],rows[pivot]]=[rows[pivot],rows[k]];
    for(let r=k+1;r<3;r++) {
      const ratio=rows[r][k]/rows[k][k];
      for(let c=k;c<=3;c++)rows[r][c]-=ratio*rows[k][c];
    }
  }
  const result=[0,0,0];
  for(let r=2;r>=0;r--)result[r]=(rows[r][3]-[r+1,r+2].filter(c=>c<3)
    .reduce((s,c)=>s+rows[r][c]*result[c],0))/rows[r][r];
  return result.every(finite)?result:null;
}

export function auditNative3mfSharedMeshReframe(manifest,viewerMatrices,toleranceMm=0.05,linearTolerance=1e-5){
  if(!manifest || !Array.isArray(manifest.instances) || !Array.isArray(manifest.objects) ||
      !Array.isArray(manifest.meshes) || !Array.isArray(viewerMatrices) ||
      manifest.instances.length<2 || manifest.instances.length>64 ||
      viewerMatrices.length!==manifest.instances.length ||
      !Number.isFinite(toleranceMm) || toleranceMm<=0 || toleranceMm>0.1 ||
      !Number.isFinite(linearTolerance) || linearTolerance<=0 || linearTolerance>1e-3)
    return unavailable;
  const a=manifest.instances.map(fromNative),b=viewerMatrices.map(fromViewer);
  if([...a,...b].some(x=>!x))return unavailable;
  // Do not choose duplicate rotations using the order in either manifest.
  const pairs=a.map(x=>b.flatMap((y,j)=>near(x.linear,y.linear,linearTolerance)?[j]:[]));
  if(pairs.some(x=>!x.length))return Object.freeze({reframe:'linear-mismatch',comparedInstances:0});
  if(pairs.some(x=>x.length!==1)||new Set(pairs.map(x=>x[0])).size!==pairs.length)
    return Object.freeze({reframe:'ambiguous',comparedInstances:0});
  const meshIds=new Set(), objectMesh=new Map();
  for(const item of manifest.meshes){
    if(typeof item?.id!=='string' || !item.id || meshIds.has(item.id))return unavailable;
    meshIds.add(item.id);
  }
  for(const obj of manifest.objects){
    if(typeof obj?.id!=='string'||!obj.id||objectMesh.has(obj.id)||!meshIds.has(obj.meshId))return unavailable;
    objectMesh.set(obj.id,obj.meshId);
  }
  const groups=new Map();
  for(let i=0;i<manifest.instances.length;i++){
    const mesh=objectMesh.get(manifest.instances[i].objectId);
    if(mesh===undefined)return unavailable;
    if(!groups.has(mesh))groups.set(mesh,[]);
    groups.get(mesh).push(i);
  }
  // Two instances always admit an exact-fit candidate when linear differences
  // are invertible. Require three independent observations for a residual.
  const eligible=[...groups.values()].filter(g=>g.length>=3);
  if(!eligible.length)return Object.freeze({reframe:'insufficient-shared-instances',comparedInstances:0});
  let compared=0;
  for(const group of eligible){
    const delta=i=>difference(a[i].translation,b[pairs[i][0]].translation);
    const base=group[0];
    let solution=null;
    for(const index of group.slice(1)){
      const shift=solve3(difference(a[index].linear,a[base].linear),
        difference(delta(index),delta(base)));
      if(shift && shift.every(n=>Math.abs(n)<=1e4)){solution=shift;break;}
    }
    if(!solution)continue;
    const offset=difference(delta(base),multiply(a[base].linear,solution));
    if(!group.every(i=>near(difference(delta(i),multiply(a[i].linear,solution)),offset,toleranceMm)))
      return Object.freeze({reframe:'hypothesis-mismatch',comparedInstances:group.length});
    compared+=group.length;
  }
  return Object.freeze({reframe:compared?'hypothesis-consistent':'underdetermined',comparedInstances:compared});
}
