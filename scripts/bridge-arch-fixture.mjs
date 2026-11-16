// One connected, outward-oriented bridge arch, diagnostic-only.
// The horizontal ceiling spans an unsupported open tunnel and should provoke
// genuine bridge-labelled deposition; the shape alone cannot prove that.
// OBJ units are assumed millimetres in the isolated localhost engine lab.
export function makeBridgeArchObj({width=40, depth=20, height=15, pier=12, clearance=10}={}) {
  if (![width,depth,height,pier,clearance].every(Number.isFinite) ||
      width<24 || width>100 || depth<8 || depth>50 ||
      height<6 || height>40 || pier<4 || pier>=width/2-4 ||
      clearance<3 || clearance>height-2)
    throw new Error("Invalid bounded bridge arch dimensions");

  // Ordered counter-clockwise in X/Z; a notch enters from below.
  const outline=[[0,0],[pier,0],[pier,clearance],
    [width-pier,clearance],[width-pier,0],[width,0],
    [width,height],[0,height]];
  const vertices=[
    ...outline.map(([x,z])=>[x,0,z]),
    ...outline.map(([x,z])=>[x,depth,z]),
  ];
  const signedArea=(a,b,c)=>
    (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const triangles=[],remaining=outline.map((_,i)=>i);
  // Triangulate the two concave endcaps. Fan triangulation would close the
  // tunnel and falsely create support under the supposed bridge.
  while(remaining.length>3) {
    let clipped=false;
    for(let i=0;i<remaining.length;i++) {
      const a=remaining[(i+remaining.length-1)%remaining.length];
      const b=remaining[i];
      const c=remaining[(i+1)%remaining.length];
      if(signedArea(outline[a],outline[b],outline[c])<=1e-9) continue;
      const contains=remaining.some(k=>k!==a&&k!==b&&k!==c&&
        signedArea(outline[a],outline[b],outline[k])>=-1e-9&&
        signedArea(outline[b],outline[c],outline[k])>=-1e-9&&
        signedArea(outline[c],outline[a],outline[k])>=-1e-9);
      if(contains) continue;
      triangles.push([a,b,c]);
      remaining.splice(i,1);
      clipped=true;
      break;
    }
    if(!clipped) throw new Error("Bridge arch cap triangulation failed");
  }
  triangles.push(remaining);
  const faces=[];
  for(const [a,b,c] of triangles) {
    faces.push([a+1,b+1,c+1]); // y=0, outward normal -Y
    faces.push([c+9,b+9,a+9]); // y=depth, outward normal +Y
  }
  for(let i=0;i<outline.length;i++) {
    const j=(i+1)%outline.length;
    faces.push([i+1,i+9,j+9],[i+1,j+9,j+1]);
  }
  return [
    "# localhost-only unsupported tunnel bridge test; units mm; not print-ready",
    ...vertices.map(v=>"v "+v.join(" ")),
    ...faces.map(f=>"f "+f.join(" ")),
  ].join("\n")+"\n";
}
