// Bounded read-only preview parser for G-code from the isolated WASM lab.
// Linear G0/G1 and common planar G2/G3 (XY, I/J center or R radius) are visualized.
// Unsupported arc forms are *not* drawn as misleading straight chords, but
// their modal XYZE end positions still advance so subsequent paths stay aligned.
// This is a diagnostic renderer, not a firmware interpreter or print safety check.
const TAU=2*Math.PI;
const EPS=1e-9;
// Validate complete G-code words before plotting. A global parameter regex
// silently accepted a valid-looking substring of an invalid movement such as
// "G1 X10oops Y5 E1", drawing a path that was never unambiguously commanded.
// Read numeric words in order; allow common compact forms like G1X10Y20.
// For compact X1E2, E2 is a separate extrusion word. Exponents require a sign
// (X1E+2), avoiding that ambiguity in diagnostic input.
function parseMovementWords(body, units) {
  const words={};
  const seen=new Set();
  const pattern=/\s*([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]\d+)?)/y;
  let offset=0;
  while(offset<body.length) {
    if(/^\s*$/.test(body.slice(offset)))break;
    pattern.lastIndex=offset;
    const match=pattern.exec(body);
    if(!match)return null;
    const key=match[1];
    // F is a modal commanded feedrate (mm/min after unit conversion),
    // not actual toolhead velocity; S/P remain uninterpreted auxiliary words.
    // Unrecognised axes and repeated words are not safe to infer.
    if(seen.has(key)||!"XYZEIJRFSP".includes(key))return null;
    const value=Number(match[2]);
    if(!Number.isFinite(value))return null;
    seen.add(key);
    if("XYZEIJRF".includes(key))words[key]=value*units;
    offset=pattern.lastIndex;
  }
  return words;
}
export function parseGcodeToolpaths(source, options={}) {
  if(typeof source!=="string" || source.length>(options.maxChars??20_000_000))
    throw new Error("Invalid or oversized G-code preview input");
  const maxSegments=options.maxSegments??200_000;
  if(!Number.isSafeInteger(maxSegments)||maxSegments<0||maxSegments>1_000_000)
    throw new Error("Invalid preview segment budget");
  const byZ=new Map();
  const state={x:0,y:0,z:0,e:0,absoluteXYZ:true,absoluteE:true,units:1,plane:"G17",absoluteArcCenters:false,feedrateMmMin:null};
  // Tool selectors in G-code label paths, NOT physical extruder IDs or filament colors.
  // Reserved/vendor tool commands (e.g. T1000) do not set a label.
  // Bambu X1E emits T255 while unloading AMS filament: clear the label.
  let activeTool=null;
  const selectedTools=new Set();
  const extrusionsByTool=new Map();
  let count=0,deposited=0,travels=0,skippedArcs=0,renderedArcs=0,skippedMalformedMotion=0;
  function append(x1,y1,x2,y2,z,extrusion){
    if(![x1,y1,x2,y2,z].every(Number.isFinite) ||
       Math.max(Math.abs(x1),Math.abs(y1),Math.abs(x2),Math.abs(y2),Math.abs(z))>100_000)
      throw new Error("Toolpath coordinate exceeds preview limits");
    if(++count>maxSegments)throw new Error("Toolpath too complex for this preview");
    const layerZ=Math.round(z*1000)/1000;
    const key=String(layerZ);
    if(!byZ.has(key))byZ.set(key,{z:layerZ,segments:[]});
    byZ.get(key).segments.push({x1,y1,x2,y2,extrusion,toolId:activeTool,
      feedrateMmMin:state.feedrateMmMin});
    if(extrusion){
      deposited++;
      extrusionsByTool.set(activeTool,(extrusionsByTool.get(activeTool)??0)+1);
    }else travels++;
  }
  for(const input of source.split(/\r?\n/)){
    const line=input.split(";")[0].replace(/\([^)]*\)/g,"").trim().toUpperCase();
    if(!line)continue;
    const toolMatch=/^(?:N\d+\s+)?T(\d+)(?=\s|$)/.exec(line);
    if(toolMatch){
      const id=Number(toolMatch[1]);
      if(id===255)activeTool=null; // vendor unload sentinel, not a material path
      else if(Number.isSafeInteger(id)&&id>=0&&id<255){activeTool=id;selectedTools.add(id);}
      continue;
    }
    const m=/^(?:N\d+\s*)?(G\d+(?:\.\d+)?|M\d+)(?=[A-Z\s]|$)/.exec(line);
    if(!m)continue;
    let cmd=m[1];
    // Accept leading-zero G-codes, e.g. G02/G03, without rewriting G90.1.
    if(/^G\d+$/.test(cmd))cmd="G"+String(Number(cmd.slice(1)));
    if(cmd==="G90"){state.absoluteXYZ=true;continue;}
    if(cmd==="G91"){state.absoluteXYZ=false;continue;}
    if(cmd==="G90.1"){state.absoluteArcCenters=true;continue;}
    if(cmd==="G91.1"){state.absoluteArcCenters=false;continue;}
    if(cmd==="M82"){state.absoluteE=true;continue;}
    if(cmd==="M83"){state.absoluteE=false;continue;}
    if(cmd==="G20"){state.units=25.4;continue;}
    if(cmd==="G21"){state.units=1;continue;}
    if(["G17","G18","G19"].includes(cmd)){state.plane=cmd;continue;}
    const isArc=cmd==="G2"||cmd==="G3";
    if(!isArc && !["G0","G1","G92"].includes(cmd))continue;
    const words=parseMovementWords(line.slice(m[0].length),state.units);
    if(words===null){skippedMalformedMotion++;continue;}
    // Reject nonpositive or implausibly large F instead of displaying a
    // misleading commanded speed. Never mutate modal state on rejection.
    if("F" in words && (words.F<=0 || words.F>10_000_000)){
      skippedMalformedMotion++;continue;
    }
    if(cmd==="G92"){
      for(const axis of ["X","Y","Z","E"])if(axis in words)state[axis.toLowerCase()]=words[axis];
      continue;
    }
    if("F" in words)state.feedrateMmMin=words.F;
    const start={...state};
    for(const axis of ["X","Y","Z","E"]){
      if(!(axis in words))continue;
      const lower=axis.toLowerCase();
      const absolute=axis==="E"?state.absoluteE:state.absoluteXYZ;
      state[lower]=absolute?words[axis]:state[lower]+words[axis];
    }
    if(![state.x,state.y,state.z,state.e].every(Number.isFinite) ||
       Math.max(Math.abs(state.x),Math.abs(state.y),Math.abs(state.z))>100_000)
      throw new Error("Toolpath coordinate exceeds preview limits");
    const extrusion=state.e>start.e+1e-7;
    if(!isArc){
      if(Math.abs(state.x-start.x)>EPS||Math.abs(state.y-start.y)>EPS||Math.abs(state.z-start.z)>EPS)
        append(start.x,start.y,state.x,state.y,state.z,extrusion);
      continue;
    }
    // Even for omitted arcs, the modal endpoint above must advance.
    // R is a signed radius: positive selects the minor arc, negative the
    // major arc. Reject ambiguous R+I/J, impossible chords, and R full circles.
    const hasRadius="R" in words;
    const hasCenter="I" in words||"J" in words;
    if(state.plane!=="G17"||Math.abs(state.z-start.z)>EPS||
       hasRadius===hasCenter){
      skippedArcs++;continue;
    }
    let cx,cy;
    if(hasRadius){
      const dx=state.x-start.x,dy=state.y-start.y;
      const chord=Math.hypot(dx,dy),radius=Math.abs(words.R);
      if(!Number.isFinite(radius)||radius<EPS||chord<EPS||
         chord>2*radius+1e-7){
        skippedArcs++;continue;
      }
      const h2=radius*radius-chord*chord/4;
      if(h2< -1e-7){skippedArcs++;continue;}
      const h=Math.sqrt(Math.max(0,h2));
      const mx=(start.x+state.x)/2,my=(start.y+state.y)/2;
      const ox=-dy*h/chord,oy=dx*h/chord;
      const candidates=[[mx+ox,my+oy],[mx-ox,my-oy]].map(([x,y])=>{
        const from=Math.atan2(start.y-y,start.x-x);
        const to=Math.atan2(state.y-y,state.x-x);
        const sweep=cmd==="G3"?((to-from)%TAU+TAU)%TAU:
          -((from-to)%TAU+TAU)%TAU;
        return {x,y,sweep};
      });
      const selected=candidates.find(c=>words.R<0
        ? Math.abs(c.sweep)>Math.PI+1e-7
        : Math.abs(c.sweep)>EPS&&Math.abs(c.sweep)<=Math.PI+1e-7);
      if(!selected){skippedArcs++;continue;}
      cx=selected.x;cy=selected.y;
    }else{
      cx=state.absoluteArcCenters?(words.I??start.x):start.x+(words.I??0);
      cy=state.absoluteArcCenters?(words.J??start.y):start.y+(words.J??0);
    }
    const r0=Math.hypot(start.x-cx,start.y-cy);
    const r1=Math.hypot(state.x-cx,state.y-cy);
    if(!Number.isFinite(r0)||!Number.isFinite(r1)||r0<EPS||
       Math.abs(r0-r1)>Math.max(0.05,r0*0.001)){
      skippedArcs++;continue;
    }
    const a0=Math.atan2(start.y-cy,start.x-cx);
    const a1=Math.atan2(state.y-cy,state.x-cx);
    let sweep=cmd==="G3"?((a1-a0)%TAU+TAU)%TAU:-((a0-a1)%TAU+TAU)%TAU;
    const fullCircle=Math.hypot(state.x-start.x,state.y-start.y)<1e-7;
    if(Math.abs(sweep)<1e-9 && fullCircle)sweep=cmd==="G3"?TAU:-TAU;
    if(Math.abs(sweep)<1e-9){skippedArcs++;continue;}
    // At least one segment per millimeter or 10 degrees. Large arcs fail
    // closed rather than silently drawing a grossly simplified trajectory.
    const steps=Math.ceil(Math.max(Math.abs(sweep)*r0,Math.abs(sweep)/(Math.PI/18)));
    if(steps>4096){skippedArcs++;continue;}
    let px=start.x,py=start.y;
    for(let i=1;i<=steps;i++){
      const a=a0+sweep*i/steps;
      const x=i===steps?state.x:cx+r0*Math.cos(a);
      const y=i===steps?state.y:cy+r0*Math.sin(a);
      append(px,py,x,y,state.z,extrusion);
      px=x;py=y;
    }
    renderedArcs++;
  }
  const layers=[...byZ.values()].sort((a,b)=>a.z-b.z);
  return {layers,segments:count,extrusions:deposited,travels,renderedArcs,skippedArcs,skippedMalformedMotion,
    selectedToolIds:[...selectedTools].sort((a,b)=>a-b),
    extrusionSegmentsByTool:Object.fromEntries([...extrusionsByTool].map(([id,n])=>[id===null?"unselected":String(id),n]))};
}
