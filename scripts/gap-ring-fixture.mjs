// Watertight narrow-wall ring OBJ for isolated gap-infill diagnostics.
// A 1.5 mm classic-wall ring is a better gap-fill candidate than a solid wedge,
// but geometry alone never proves that a slicer emitted gap-infill paths.
// Diagnostic-only: no printer calibration or print-readiness claim.
export function makeGapRingObj({outer=40,wall=1.5,height=8}={}) {
  if (![outer,wall,height].every(Number.isFinite) ||
      outer<10 || outer>100 || wall<0.5 || wall>2 ||
      wall*2>=outer || height<1 || height>30)
    throw new Error("Invalid bounded gap ring dimensions");
  const around=(min,max)=>[[min,min],[max,min],[max,max],[min,max]];
  const outerXY=[[0,0],[outer,0],[outer,outer],[0,outer]];
  const innerXY=around(wall,outer-wall);
  // OBJ indices are 1-based: outer bottom 1..4, inner bottom 5..8,
  // outer top 9..12, inner top 13..16.
  const vertices=[
    ...outerXY.map(([x,y])=>[x,y,0]),
    ...innerXY.map(([x,y])=>[x,y,0]),
    ...outerXY.map(([x,y])=>[x,y,height]),
    ...innerXY.map(([x,y])=>[x,y,height]),
  ];
  const faces=[];
  const quad=(a,b,c,d)=>{faces.push([a,b,c],[a,c,d]);};
  for(let i=0;i<4;i++) {
    const j=(i+1)%4;
    // Outer wall points out; inner wall points towards the empty center.
    quad(i+1,j+1,j+9,i+9);
    quad(j+5,i+5,i+13,j+13);
    // Annular top/bottom surfaces keep the center a true through-hole.
    quad(i+9,j+9,j+13,i+13);
    quad(j+1,i+1,i+5,j+5);
  }
  return [
    "# localhost-only gap ring fixture; units assumed mm",
    ...vertices.map(p=>"v "+p.join(" ")),
    ...faces.map(f=>"f "+f.join(" ")),
  ].join("\n")+"\n";
}
