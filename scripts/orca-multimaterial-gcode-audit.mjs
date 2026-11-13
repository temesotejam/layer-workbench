// Read-only Orca multi-material G-code audit. Not a firmware interpreter.
const MAX_BYTES=20000000, MAX_LINES=1000000;
function csv(value,key) {
  if(value===undefined||value==="") return null;
  const a=value.split(",").map(x=>x.trim());
  if(a.some(x=>!x||!Number.isFinite(Number(x)))) throw new Error("Invalid numeric vector: "+key);
  return a.map(Number);
}
function ints(value,key) {
  const a=csv(value,key);
  if(a===null)return null;
  if(a.some(x=>!Number.isSafeInteger(x)))throw new Error("Invalid integer vector: "+key);
  return a;
}
export function auditMultiMaterialGcode(source) {
  if(typeof source!=="string"||source.length>MAX_BYTES)throw new Error("Invalid or oversized G-code");
  const lines=source.split(/\r?\n/);
  if(lines.length>MAX_LINES)throw new Error("Too many G-code lines");
  let inConfig=false; const config={}; const commands={tool:[],unloadSentinel:0,ams:{M620:0,M621:0,"M620.1":0},primeTower:{M624:0,M625:0}};
  for(const raw of lines) {
    const line=raw.trim();
    if(line==="; CONFIG_BLOCK_START"){inConfig=true;continue;}
    if(line==="; CONFIG_BLOCK_END"){inConfig=false;continue;}
    if(inConfig&&line.startsWith("; ")) {
      const m=/^;\s*([^=]+?)\s*=\s*(.*)$/.exec(line);
      if(m)config[m[1].trim()]=m[2].trim();
    }
    const code=line.split(";")[0].trim().toUpperCase();
    let m=/^T(\d+)\b/.exec(code);
    if(m){
      const id=Number(m[1]);
      if(id===255)commands.unloadSentinel++; // X1E unload command, not a normal filament selector
      else if(Number.isSafeInteger(id)&&id>=0&&id<255)commands.tool.push(id);
      continue;
    }
    m=/^(M620(?:\.1)?|M621|M624|M625)(?:\s|$)/.exec(code);
    if(m) {
      if(m[1]==="M620"||m[1]==="M621"||m[1]==="M620.1")commands.ams[m[1]]++;
      else commands.primeTower[m[1]]++;
    }
  }
  const filamentMap=ints(config.filament_map,"filament_map");
  const nozzleDiameter=csv(config.nozzle_diameter,"nozzle_diameter");
  const flow=csv(config.filament_flow_ratio,"filament_flow_ratio");
  const temp=ints(config.nozzle_temperature,"nozzle_temperature");
  const maxVol=csv(config.filament_max_volumetric_speed,"filament_max_volumetric_speed");
  const matrix=csv(config.flush_volumes_matrix,"flush_volumes_matrix");
  if(filamentMap&&(!nozzleDiameter||filamentMap.some(x=>x<1||x>nozzleDiameter.length)))
    throw new Error("filament_map references a missing physical extruder");
  if(matrix) {
    const n=Math.sqrt(matrix.length);
    if(!Number.isInteger(n)||n>64)throw new Error("flush_volumes_matrix must be square");
  }
  const distinctTools=[...new Set(commands.tool)].sort((a,b)=>a-b);
  return {
    config:{filamentMap,physicalNozzleCount:nozzleDiameter?.length??null,
      filamentSlotCount:filamentMap?.length??null,filamentFlowRatio:flow,
      nozzleTemperature:temp,maxVolumetricSpeed:maxVol,
      flushMatrixSize:matrix?Math.sqrt(matrix.length):null,
      flushMatrix:matrix,primeTowerEnabled:config.enable_prime_tower==="1",
      primeTowerWidth:config.prime_tower_width===undefined?null:Number(config.prime_tower_width),
      nozzleVolumeType:config.nozzle_volume_type??null},
    commands:{toolCommandCount:commands.tool.length,distinctToolIds:distinctTools,
      unloadToolSentinelCount:commands.unloadSentinel,
      ams:commands.ams,primeTower:commands.primeTower},
    classification:filamentMap&&nozzleDiameter?(
      nozzleDiameter.length===1&&filamentMap.length>1&&filamentMap.every(x=>x===1)
        ?"multiple-filament-slots-single-physical-extruder"
        :nozzleDiameter.length>1?"multiple-physical-extruders":"single-extruder"
    ):"insufficient-config-data",
    warnings:["G-code command counting is syntactic; M620/M621 and T commands may be vendor-specific.",
      "T255 is reported separately as a vendor unload sentinel; tools are not proven physical extruders.",
      "This audit does not resolve filament variant semantics, execute scripts, or certify print safety."]
  };
}
