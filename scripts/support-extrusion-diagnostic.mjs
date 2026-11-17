// Read-only, localhost-only v2.5.0 support-width material diagnostic.
// Unlike the viewport parser, this scanner follows M82/M83 and G92 E to
// measure actual positive G1 XY filament-feed length (E in mm), NOT a header
// value, virtual line width, extruded plastic volume, or printer safety.
// Reject uncertain motion instead of attributing arbitrary G-code to support.
const SUPPORT_ROLES=Object.freeze({
  "support":"body","support material":"body",
  "support interface":"interface","support material interface":"interface",
});
const normalize=value=>value.trim().toLowerCase().replace(/\s+/g," ");
const round=value=>Number(value.toFixed(6));
function motionWords(body,unit) {
  const words=Object.create(null);
  const pattern=/\s*([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]\d+)?)/gy;
  let offset=0;
  while(offset<body.length) {
    if(/^\s*$/.test(body.slice(offset)))break;
    pattern.lastIndex=offset;
    const match=pattern.exec(body);
    if(!match || !"XYZEFSPRIJ".includes(match[1]) ||
       Object.hasOwn(words,match[1]))return null;
    const value=Number(match[2]);
    if(!Number.isFinite(value))return null;
    words[match[1]]="XYZEFIJR".includes(match[1])?value*unit:value;
    offset=pattern.lastIndex;
  }
  return words;
}
export function scanSupportExtrusion(gcode) {
  if(typeof gcode!=="string" || gcode.length>20_000_000)
    throw new Error("Invalid or oversized support G-code");
  const roles={
    body:{segments:0,xyLength:0,positiveE:0},
    interface:{segments:0,xyLength:0,positiveE:0},
  };
  const state={x:0,y:0,z:0,e:0,absoluteXYZ:true,absoluteE:true,unit:1};
  let role=null,commands=0;
  for(const original of gcode.split(/\r?\n/)) {
    const comment=original.trim();
    if(/^;\s*(?:TYPE|FEATURE)\s*:/i.test(comment)) {
      const match=/^;\s*(?:TYPE|FEATURE)\s*:\s*([^;\r\n]{1,80})\s*$/i.exec(comment);
      const label=match?normalize(match[1]):"";
      role=Object.hasOwn(SUPPORT_ROLES,label)?SUPPORT_ROLES[label]:null;
      continue;
    }
    const line=original.split(";")[0].replace(/\([^)]*\)/g,"").trim().toUpperCase();
    if(!line)continue;
    const command=/^(?:N\d+\s*)?(G\d+(?:\.\d+)?|M\d+)(?=[A-Z\s]|$)/.exec(line);
    if(!command)continue;
    let cmd=command[1];
    if(/^G\d+$/.test(cmd))cmd="G"+String(Number(cmd.slice(1)));
    if(cmd==="G90"){state.absoluteXYZ=true;continue;}
    if(cmd==="G91"){state.absoluteXYZ=false;continue;}
    if(cmd==="M82"){state.absoluteE=true;continue;}
    if(cmd==="M83"){state.absoluteE=false;continue;}
    if(cmd==="G20"){state.unit=25.4;continue;}
    if(cmd==="G21"){state.unit=1;continue;}
    if(!["G0","G1","G2","G3","G92"].includes(cmd))continue;
    const words=motionWords(line.slice(command[0].length),state.unit);
    if(words===null)throw new Error("Ambiguous G-code motion in support diagnostic");
    if(cmd==="G92"){
      for(const axis of ["X","Y","Z","E"])
        if(Object.hasOwn(words,axis))state[axis.toLowerCase()]=words[axis];
      continue;
    }
    const old={x:state.x,y:state.y,z:state.z,e:state.e};
    for(const axis of ["X","Y","Z","E"]) {
      if(!Object.hasOwn(words,axis))continue;
      const key=axis.toLowerCase(),absolute=axis==="E"?state.absoluteE:state.absoluteXYZ;
      state[key]=absolute?words[axis]:state[key]+words[axis];
    }
    if(![state.x,state.y,state.z,state.e].every(Number.isFinite) ||
       Math.max(Math.abs(state.x),Math.abs(state.y),Math.abs(state.z))>100_000)
      throw new Error("Out-of-range G-code movement");
    const deltaE=state.e-old.e;
    const xy=Math.hypot(state.x-old.x,state.y-old.y);
    if(role!==null && deltaE>1e-7 && xy>1e-9) {
      if(cmd!=="G1")throw new Error("Unsupported deposited support arc or rapid move");
      const r=roles[role];
      r.segments++;
      r.xyLength+=xy;
      r.positiveE+=deltaE;
    }
    if(++commands>300_000)throw new Error("Support G-code command budget exceeded");
  }
  return Object.fromEntries(Object.entries(roles).map(([name,r])=>[name,{
    deposited_xy_segments:r.segments,
    deposited_xy_length_mm:round(r.xyLength),
    positive_filament_e_mm:round(r.positiveE),
    filament_e_per_xy_mm:r.xyLength>0?round(r.positiveE/r.xyLength):null,
  }]));
}
export function auditSupportWidthEffect(baselineText,candidateText) {
  const baseline=scanSupportExtrusion(baselineText);
  const candidate=scanSupportExtrusion(candidateText);
  const a=baseline.body,b=candidate.body;
  const hasDeposition=a.deposited_xy_segments>0&&b.deposited_xy_segments>0;
  // Observe deposition E, not just a different G-code header or feedrate.
  // A changed support path length alone is not enough for this test.
  const deltaE=round(b.positive_filament_e_mm-a.positive_filament_e_mm);
  const materiallyChanged=hasDeposition &&
    Math.abs(deltaE)>Math.max(0.0001,a.positive_filament_e_mm*0.001);
  return {
    result:!hasDeposition?"inconclusive_no_tagged_support_body":
      materiallyChanged?"observed_support_body_filament_feed_difference":
      "support_body_present_but_filament_feed_unchanged",
    baseline,candidate,body_filament_e_delta_mm:deltaE,
    body_filament_e_changed:materiallyChanged,
    // E values are filament length; without diameter, flow multiplier and
    // matched native settings they are NOT volume, line-width or parity proof.
    native_desktop_parity:false,printer_safe:false,
  };
}
