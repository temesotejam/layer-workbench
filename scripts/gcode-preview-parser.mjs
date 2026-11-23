// Bounded read-only preview parser for G-code from the isolated WASM lab.
// Linear G0/G1 and bounded G17/G18/G19 planar/helical G2/G3 arcs (I/J/K center or R radius) are visualized.
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
    if(seen.has(key)||!"XYZEIJKRFSP".includes(key))return null;
    const value=Number(match[2]);
    if(!Number.isFinite(value))return null;
    seen.add(key);
    if("XYZEIJKRF".includes(key))words[key]=value*units;
    else words[key]=value; // Retain uninterpreted S/P for command-specific rejection.
    offset=pattern.lastIndex;
  }
  return words;
}
// The 2D layer picker must not flatten a sloped or vertical-plane path
// into a fictitious horizontal deposition. The shared parser groups arcs by
// commanded destination Z for bounded 3D display, not for planar clipping.
// Legacy external 3D records may omit z1/z2 and are treated as layer-Z.
export function isPlanarLayerSegment(segment, layerZ) {
  const z1=segment.z1??layerZ;
  const z2=segment.z2??layerZ;
  return Number.isFinite(layerZ)&&Number.isFinite(z1)&&Number.isFinite(z2)
    && Math.abs(z1-z2)<=1e-7 && Math.abs(z1-layerZ)<=0.0005001;
}
export function parseGcodeToolpaths(source, options={}) {
  if(typeof source!=="string" || source.length>(options.maxChars??20_000_000))
    throw new Error("Invalid or oversized G-code preview input");
  const maxSegments=options.maxSegments??200_000;
  if(!Number.isSafeInteger(maxSegments)||maxSegments<0||maxSegments>1_000_000)
    throw new Error("Invalid preview segment budget");
  const byZ=new Map();
  const state={x:0,y:0,z:0,e:0,absoluteXYZ:true,absoluteE:true,units:1,plane:"G17",absoluteArcCenters:false,feedrateMmMin:null};
  // Homing does not establish a portable XYZ coordinate: firmware-specific
  // home offsets are unknown to this renderer. Re-anchor only through G92
  // or a subsequent absolute command that names the affected axis.
  const knownXYZ={x:true,y:true,z:true};
  // An unsupported machine-space move can also change E; do not infer
  // extrusion until G92 E or the first absolute-E command re-anchors it.
  let knownE=true;
  // G0/G1 are modal. Some valid slicer output omits the G word on
  // subsequent movement lines ("X20 E1"). Support ONLY these linear modes;
  // after unknown motion modes/coordinate discontinuities, require an
  // explicit G0/G1 before interpreting a bare axis line again.
  let modalLinear=null;
  // Tool selectors in G-code label paths, NOT physical extruder IDs or filament colors.
  // Reserved/vendor tool commands (e.g. T1000) do not set a label.
  // Bambu X1E emits T255 while unloading AMS filament: clear the label.
  let activeTool=null;
  // T255 clears the display label, not the last known real T selector.
  let lastExplicitTool=null;
  const selectedTools=new Set();
  const extrusionsByTool=new Map(),extrusionsByFeature=new Map();
  // Feature attribution uses only explicit slicer comment tags, never free-text
  // mentions such as configuration headers containing 'gap infill'.
  let activeFeature=null;
  let count=0,deposited=0,travels=0,skippedArcs=0,renderedArcs=0,skippedMalformedMotion=0,skippedUnlocatedMotions=0,skippedWorkspaceCommands=0;
  function append(x1,y1,x2,y2,z1,z2,extrusion,groupZ=z2,commandedPositiveEMm=null,sourceMotion="G1"){
    if(![x1,y1,x2,y2,z1,z2].every(Number.isFinite) ||
       Math.max(Math.abs(x1),Math.abs(y1),Math.abs(x2),Math.abs(y2),Math.abs(z1),Math.abs(z2))>100_000)
      throw new Error("Toolpath coordinate exceeds preview limits");
    if(++count>maxSegments)throw new Error("Toolpath too complex for this preview");
    // 2D layers are grouped by destination Z, but 3D must retain both
    // endpoints. Pure Z travel and sloped moves are not horizontal lines.
    const layerZ=Math.round(groupZ*1000)/1000;
    const key=String(layerZ);
    if(!byZ.has(key))byZ.set(key,{z:layerZ,segments:[]});
    byZ.get(key).segments.push({x1,y1,x2,y2,z1,z2,extrusion,toolId:activeTool,
      feedrateMmMin:state.feedrateMmMin,feature:activeFeature,
      // Retain the original command before tessellating a G2/G3 arc.
      sourceMotion,
      // Positive commanded filament-axis E for this LINEAR stroke only.
      // Not melted volume, extrusion width, or physical deposition; arcs
      // deliberately remain null (no invented per-tessellation E split).
      commandedPositiveEMm});
    if(extrusion){
      deposited++;
      extrusionsByTool.set(activeTool,(extrusionsByTool.get(activeTool)??0)+1);
      extrusionsByFeature.set(activeFeature,(extrusionsByFeature.get(activeFeature)??0)+1);
    }else travels++;
  }
  for(const input of source.split(/\r?\n/)){
    // Slicer feature annotations are comment-only lines: ;TYPE:... or
    // ; FEATURE:... . Never classify an inline or arbitrary comment as a
    // confirmed feature. A feature label alone is not proof of extrusion.
    const comment=input.trim();
    // A malformed explicit feature directive is not an ordinary comment.
    // Fail closed by clearing the previous classification: otherwise an
    // overlong, empty or semicolon-suffixed TYPE/FEATURE line can incorrectly
    // carry a previous "gap infill" label into unrelated deposited paths.
    if(/^;\s*(?:TYPE|FEATURE)\s*:/i.test(comment)){
      const tag=/^;\s*(?:TYPE|FEATURE)\s*:\s*([^;\r\n]{1,80})\s*$/i.exec(comment);
      activeFeature=tag?.[1]?.trim().toLowerCase().replace(/\s+/g," ") || null;
      continue;
    }
    const line=input.split(";")[0].replace(/\([^)]*\)/g,"").trim().toUpperCase();
    if(!line)continue;
    const toolMatch=/^(?:N\d+\s+)?T(\d+)(?=\s|$)/.exec(line);
    if(toolMatch){
      const id=Number(toolMatch[1]);
      if(id===255)activeTool=null; // vendor unload sentinel, not a material path
      else if(Number.isSafeInteger(id)&&id>=0&&id<255){
        // An actual tool change may restore/reset the firmware's E register.
        // Never compare absolute E across different explicit T selectors.
        // A repeated T or reserved vendor selector does not invalidate it.
        if(lastExplicitTool!==null && lastExplicitTool!==id)knownE=false;
        activeTool=id;
        lastExplicitTool=id;
        selectedTools.add(id);
      }
      continue;
    }
    const m=/^(?:N\d+\s*)?(G\d+(?:\.\d+)?|M\d+)(?=[A-Z\s]|$)/.exec(line);
    // A parameter-only line inherits the last unambiguous G0/G1 motion,
    // including optional N line numbers and compact "X20E1" notation.
    // Never guess a modal arc, firmware macro, or unsupported coordinate form.
    const implicitWords=m?null:line.replace(/^N\d+\s*/,"");
    if(!m && (!modalLinear || !/^[XYZEF]/.test(implicitWords)))continue;
    let cmd=m?m[1]:modalLinear;
    const movementArgs=m?line.slice(m[0].length):implicitWords;
    // Accept leading-zero G-codes, e.g. G02/G03, without rewriting G90.1.
    if(/^G\d+$/.test(cmd))cmd="G"+String(Number(cmd.slice(1)));
    if(cmd==="G28"){
      modalLinear=null;
      // G28 can home one or all axes. Do not invent a home coordinate or
      // draw a fictitious move from the pre-home position. Common "G28 X Y"
      // and "G28 X0 Y0" forms are recognized; unfamiliar flags (e.g. W)
      // conservatively invalidate all XYZ axes.
      const args=line.slice(m[0].length).replace(/\s+/g,"");
      const axes=args.match(/[XYZ]/g);
      const simple=args==="" || /^(?:[XYZ](?:0(?:\.0*)?)?)+$/.test(args);
      const affected=!simple || !axes?.length ? ["x","y","z"] :
        [...new Set(axes.map(axis=>axis.toLowerCase()))];
      for(const axis of affected)knownXYZ[axis]=false;
      continue;
    }
    if(cmd==="G53" || /^G(?:5[4-9]|59\.[123])$/.test(cmd)){
      modalLinear=null;
      // Machine (G53) and work coordinate systems (G54..G59.3) may have
      // firmware-defined offsets. A G53 G0/G1 machine-space move must never
      // be silently ignored while the next workspace path bridges its old
      // position. Treat both the move and a workspace switch as an unknown
      // XYZ discontinuity, not as printable/simulated machine motion.
      if(cmd==="G53"){
        const tail=line.slice(m[0].length);
        const machineMove=/^\s*G0?[01](?=[A-Z\s]|$)/.exec(tail);
        if(tail.trim()){
          const machineWords=machineMove
            ?parseMovementWords(tail.slice(machineMove[0].length),state.units)
            :null;
          // Rare machine-space moves can include an E change. Do not
          // accidentally label the next absolute E as deposition.
          if(machineWords===null || "E" in machineWords)knownE=false;
        }
      }
      for(const axis of ["x","y","z"])knownXYZ[axis]=false;
      skippedWorkspaceCommands++;
      continue;
    }
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
    if(!isArc && !["G0","G1","G92"].includes(cmd)){
      if(cmd.startsWith("G")){
        modalLinear=null;
        // An unsupported G command with coordinate words may itself move the
        // tool. Discard the previous XYZ origin instead of drawing a phantom
        // connecting stroke when a later explicit G0/G1 resumes. Common
        // probing/gantry operations also move without explicit XYZ words.
        // G4 dwell and other non-motion G commands without XYZ are unaffected.
        if(/[XYZ]/.test(movementArgs) || /^G(?:5|29|30|32|34|35|38(?:\.\d+)?)$/.test(cmd)){
          knownXYZ.x=false;knownXYZ.y=false;knownXYZ.z=false;
        }
        // Opaque E changes cannot safely be classified as deposited material
        // until the next absolute E word or G92 E re-anchors the register.
        if(/E/.test(movementArgs))knownE=false;
      }
      continue;
    }
    if(isArc)modalLinear=null;
    else if(cmd==="G0"||cmd==="G1")modalLinear=cmd;
    const words=parseMovementWords(movementArgs,state.units);
    if(words===null){modalLinear=null;skippedMalformedMotion++;continue;}
    // Reject nonpositive or implausibly large F instead of displaying a
    // misleading commanded speed. Never mutate modal state on rejection.
    if("F" in words && (words.F<=0 || words.F>10_000_000)){
      modalLinear=null;skippedMalformedMotion++;continue;
    }
    // Never render a motion with auxiliary words that this read-only parser
    // does not interpret. In particular G2/G3 P can request extra arc turns;
    // silently ignoring P would display a plausible but wrong trajectory.
    // Arc endpoints still advance below, even when their path is omitted.
    const allowedWords=cmd==="G92"?"XYZE":isArc?"XYZEIJKRF":"XYZEF";
    const unhandledWords=Object.keys(words).some(key=>!allowedWords.includes(key));
    if(unhandledWords && !isArc){modalLinear=null;skippedMalformedMotion++;continue;}
    if(cmd==="G92"){
      for(const axis of ["X","Y","Z","E"])if(axis in words){
        state[axis.toLowerCase()]=words[axis];
        if(axis==="E")knownE=true;
        else knownXYZ[axis.toLowerCase()]=true;
      }
      continue;
    }
    if("F" in words)state.feedrateMmMin=words.F;
    const start={...state};
    const wasLocated=knownXYZ.x&&knownXYZ.y&&knownXYZ.z;
    const wasEKnown=knownE;
    for(const axis of ["X","Y","Z","E"]){
      if(!(axis in words))continue;
      const lower=axis.toLowerCase();
      const absolute=axis==="E"?state.absoluteE:state.absoluteXYZ;
      state[lower]=absolute?words[axis]:state[lower]+words[axis];
      if(axis==="E" && absolute)knownE=true;
      if(axis!=="E" && absolute)knownXYZ[lower]=true;
    }
    if(![state.x,state.y,state.z,state.e].every(Number.isFinite) ||
       Math.max(Math.abs(state.x),Math.abs(state.y),Math.abs(state.z))>100_000)
      throw new Error("Toolpath coordinate exceeds preview limits");
    // A relative-E word has its own signed commanded delta even if an
    // earlier tool change made the absolute E origin unknowable.
    const extrusion=("E" in words) && (state.absoluteE
      ? wasEKnown && state.e>start.e+1e-7 : words.E>1e-7);
    // After homing, even a numerically finite prior coordinate is stale.
    // The first absolute re-anchor has an unknown starting point: do not
    // invent travel/deposition geometry across that discontinuity.
    if(!wasLocated || !knownXYZ.x || !knownXYZ.y || !knownXYZ.z){
      if(isArc)skippedArcs++;
      else if(["X","Y","Z"].some(axis=>axis in words))skippedUnlocatedMotions++;
      continue;
    }
    // The first absolute-E command after an opaque machine-space extrusion
    // re-establishes the value, but its signed delta is unknowable. Do not
    // misclassify that stroke as travel or extrusion.
    if("E" in words && !wasEKnown && state.absoluteE){
      skippedUnlocatedMotions++;
      continue;
    }
    // Plane axes follow a right-handed basis: XY (+Z), ZX (+Y), YZ (+X).
    // This preserves G2/G3 handedness when looking along each plane normal.
    // Unrelated center words fail closed rather than producing a false arc.
    const plane=state.plane==="G18"
      ? {u:"z",v:"x",w:"y",offsetU:"K",offsetV:"I"}
      : state.plane==="G19"
      ? {u:"y",v:"z",w:"x",offsetU:"J",offsetV:"K"}
      : {u:"x",v:"y",w:"z",offsetU:"I",offsetV:"J"};
    const unexpectedCenter=["I","J","K"].some(key=>
      key in words && key!==plane.offsetU && key!==plane.offsetV);
    if(isArc && (unhandledWords||unexpectedCenter)){skippedArcs++;continue;}
    if(!isArc){
      if(Math.abs(state.x-start.x)>EPS||Math.abs(state.y-start.y)>EPS||Math.abs(state.z-start.z)>EPS)
        append(start.x,start.y,state.x,state.y,start.z,state.z,extrusion,
          state.z,extrusion?state.e-start.e:0,cmd);
      continue;
    }
    // R is signed: positive selects the minor arc, negative the major arc.
    // A centered full circle is valid; a radius-only full circle is ambiguous.
    const {u,v,w,offsetU,offsetV}=plane;
    const u0=start[u],v0=start[v],u1=state[u],v1=state[v];
    const hasRadius="R" in words;
    const hasCenter=offsetU in words||offsetV in words;
    if(hasRadius===hasCenter){skippedArcs++;continue;}
    let cu,cv;
    if(hasRadius){
      const du=u1-u0,dv=v1-v0;
      const chord=Math.hypot(du,dv),radius=Math.abs(words.R);
      if(!Number.isFinite(radius)||radius<EPS||chord<EPS||chord>2*radius+1e-7){
        skippedArcs++;continue;
      }
      const h2=radius*radius-chord*chord/4;
      if(h2< -1e-7){skippedArcs++;continue;}
      const h=Math.sqrt(Math.max(0,h2));
      const mu=(u0+u1)/2,mv=(v0+v1)/2;
      const ou=-dv*h/chord,ov=du*h/chord;
      const candidates=[[mu+ou,mv+ov],[mu-ou,mv-ov]].map(([a,b])=>{
        const from=Math.atan2(v0-b,u0-a),to=Math.atan2(v1-b,u1-a);
        const sweep=cmd==="G3"?((to-from)%TAU+TAU)%TAU:
          -((from-to)%TAU+TAU)%TAU;
        return {a,b,sweep};
      });
      const selected=candidates.find(c=>words.R<0
        ? Math.abs(c.sweep)>Math.PI+1e-7
        : Math.abs(c.sweep)>EPS&&Math.abs(c.sweep)<=Math.PI+1e-7);
      if(!selected){skippedArcs++;continue;}
      cu=selected.a;cv=selected.b;
    }else{
      cu=state.absoluteArcCenters?(words[offsetU]??u0):u0+(words[offsetU]??0);
      cv=state.absoluteArcCenters?(words[offsetV]??v0):v0+(words[offsetV]??0);
    }
    const r0=Math.hypot(u0-cu,v0-cv),r1=Math.hypot(u1-cu,v1-cv);
    if(!Number.isFinite(r0)||!Number.isFinite(r1)||r0<EPS||
       Math.abs(r0-r1)>Math.max(0.05,r0*0.001)){
      skippedArcs++;continue;
    }
    const a0=Math.atan2(v0-cv,u0-cu),a1=Math.atan2(v1-cv,u1-cu);
    let sweep=cmd==="G3"?((a1-a0)%TAU+TAU)%TAU:-((a0-a1)%TAU+TAU)%TAU;
    const fullCircle=Math.hypot(u1-u0,v1-v0)<1e-7;
    if(Math.abs(sweep)<1e-9 && fullCircle)sweep=cmd==="G3"?TAU:-TAU;
    if(Math.abs(sweep)<1e-9){skippedArcs++;continue;}
    // Bound segment count and retain true 3D coordinates, including the
    // third-axis interpolation of vertical-plane helices.
    const steps=Math.ceil(Math.max(Math.abs(sweep)*r0,Math.abs(sweep)/(Math.PI/18)));
    if(steps>4096){skippedArcs++;continue;}
    let previous={x:start.x,y:start.y,z:start.z};
    for(let i=1;i<=steps;i++){
      const a=a0+sweep*i/steps;
      const point={x:start.x,y:start.y,z:start.z};
      point[u]=i===steps?u1:cu+r0*Math.cos(a);
      point[v]=i===steps?v1:cv+r0*Math.sin(a);
      point[w]=i===steps?state[w]:start[w]+(state[w]-start[w])*i/steps;
      // Keep existing 2D layer-picker semantics (group by destination Z).
      append(previous.x,previous.y,point.x,point.y,previous.z,point.z,extrusion,state.z,null,cmd);
      previous=point;
    }
    renderedArcs++;
  }
  const layers=[...byZ.values()].sort((a,b)=>a.z-b.z);
  return {layers,segments:count,extrusions:deposited,travels,renderedArcs,skippedArcs,skippedMalformedMotion,skippedUnlocatedMotions,skippedWorkspaceCommands,
    selectedToolIds:[...selectedTools].sort((a,b)=>a-b),
    extrusionSegmentsByTool:Object.fromEntries([...extrusionsByTool].map(([id,n])=>[id===null?"unselected":String(id),n])),
    extrusionSegmentsByFeature:Object.fromEntries([...extrusionsByFeature].map(([name,n])=>[name===null?"unclassified":name,n]))};
}
