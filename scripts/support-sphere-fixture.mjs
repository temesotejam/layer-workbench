// Isolated localhost support diagnostic: closed low-poly sphere with a point
// touching Z=0 and a wide unsupported lower hemisphere. Derived directly
// from latitude rings, not imported from or redistributing upstream assets.
// Not a print-quality, dimensions-accurate, or printer-ready model.
export function makeSupportSphereObj({radius=10,rings=10,sectors=16}={}) {
  if (!Number.isFinite(radius)||radius<6||radius>20||
      !Number.isInteger(rings)||rings<6||rings>16||
      !Number.isInteger(sectors)||sectors<12||sectors>32)
    throw new Error("Invalid bounded support sphere geometry");
  const vertices=[[0,0,0]];
  for(let ring=1;ring<rings;ring++){
    const polar=Math.PI*ring/rings;
    const z=radius*(1-Math.cos(polar));
    const xy=radius*Math.sin(polar);
    for(let sector=0;sector<sectors;sector++){
      const theta=2*Math.PI*sector/sectors;
      vertices.push([xy*Math.cos(theta),xy*Math.sin(theta),z]);
    }
  }
  vertices.push([0,0,2*radius]);
  const faces=[];
  // OBJ vertices are one-based. Reverse the south cap to point down.
  for(let i=0;i<sectors;i++){
    const next=(i+1)%sectors;
    faces.push([1,2+next,2+i]);
  }
  for(let ring=0;ring<rings-2;ring++){
    const lower=2+ring*sectors,upper=lower+sectors;
    for(let i=0;i<sectors;i++){
      const next=(i+1)%sectors;
      faces.push([lower+i,lower+next,upper+next]);
      faces.push([lower+i,upper+next,upper+i]);
    }
  }
  const last=2+(rings-2)*sectors,top=vertices.length;
  for(let i=0;i<sectors;i++){
    const next=(i+1)%sectors;
    faces.push([last+i,last+next,top]);
  }
  return [
    "# Support-only diagnostic hemisphere overhang, native OBJ mm, never print",
    ...vertices.map(v=>"v "+v.map(n=>Number(n.toFixed(8))).join(" ")),
    ...faces.map(f=>"f "+f.join(" ")),
  ].join("\n")+"\n";
}
