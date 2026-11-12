// Minimal, bounded read-only G-code toolpath parser for the local WASM lab.
// G0/G1 linear moves, G90/G91, M82/M83, G92 and G20/G21 units supported.
// Arcs, firmware macros, tool changes, retractions and acceleration rendering
// are intentionally out of scope. Never interpret G-code as executable JS.
export function parseGcodeToolpaths(source, options = {}) {
  if (typeof source !== "string" || source.length > (options.maxChars ?? 20_000_000))
    throw new Error("Invalid or oversized G-code preview input");
  const maxSegments = options.maxSegments ?? 200_000;
  const byZ = new Map();
  const state = {x:0,y:0,z:0,e:0, absoluteXYZ:true, absoluteE:true, units:1};
  let count=0, deposited=0, travels=0, skippedArcs=0;
  const lines=source.split(/\r?\n/);
  for (const input of lines) {
    const line = input.split(";")[0].replace(/\([^)]*\)/g,"").trim().toUpperCase();
    if (!line) continue;
    const m = /^(?:N\d+\s+)?(G\d+|M\d+)(?=\s|$)/.exec(line);
    if (!m) continue;
    const cmd=m[1];
    if (cmd==="G90"){state.absoluteXYZ=true;continue;}
    if (cmd==="G91"){state.absoluteXYZ=false;continue;}
    if (cmd==="M82"){state.absoluteE=true;continue;}
    if (cmd==="M83"){state.absoluteE=false;continue;}
    if (cmd==="G20"){state.units=25.4;continue;}
    if (cmd==="G21"){state.units=1;continue;}
    if (cmd==="G2" || cmd==="G3"){skippedArcs++; continue;}
    if (!["G0","G1","G00","G01","G92"].includes(cmd)) continue;
    const words={};
    const body=line.slice(m[0].length);
    for (const part of body.matchAll(/([XYZE])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?)/g)) {
      const v=Number(part[2]);
      if(Number.isFinite(v)) words[part[1]]=v*state.units;
    }
    if(cmd==="G92"){
      for(const axis of ["X","Y","Z","E"]) if(axis in words) state[axis.toLowerCase()]=words[axis];
      continue;
    }
    const start={...state};
    for(const axis of ["X","Y","Z","E"]){
      if(!(axis in words))continue;
      const lower=axis.toLowerCase();
      const absolute=axis==="E"?state.absoluteE:state.absoluteXYZ;
      state[lower]=absolute?words[axis]:state[lower]+words[axis];
    }
    if (["x","y","z"].every(axis=>Math.abs(state[axis]-start[axis])<1e-9)) continue;
    if (![state.x,state.y,state.z,state.e].every(Number.isFinite)) throw new Error("Non-finite toolpath coordinate");
    if(Math.max(Math.abs(state.x),Math.abs(state.y),Math.abs(state.z))>100_000)
      throw new Error("Toolpath coordinate exceeds preview limits");
    const extrusion=state.e>start.e+1e-7;
    const layerZ=Math.round(state.z*1000)/1000;
    const key=String(layerZ);
    if(!byZ.has(key)) byZ.set(key,{z:layerZ,segments:[]});
    byZ.get(key).segments.push({x1:start.x,y1:start.y,x2:state.x,y2:state.y,extrusion});
    count++; extrusion?deposited++:travels++;
    if(count>maxSegments)throw new Error("Toolpath too complex for this preview");
  }
  const layers=[...byZ.values()].sort((a,b)=>a.z-b.z);
  return {layers,segments:count,extrusions:deposited,travels,skippedArcs};
}
