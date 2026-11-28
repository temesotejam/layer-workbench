import {parseTestProcessOverrides} from "./test-process-profile.mjs";
import {makeMultiStlProject} from "./multi-stl.mjs";
import {viewerMatrixToNative} from "./transform-matrix.mjs";
// Experimental end-to-end bridge for an isolated browser host.
// Uses the vendored one-slicer-api 0.7.0 interface, not display-only meshes.
const encode = value => new TextEncoder().encode(JSON.stringify(value));

export const GENERIC_PLA_TEST_CONFIG = Object.freeze({
  bed_size_x: 256,
  bed_size_y: 256,
  printable_height: 250,
  nozzle_diameter: 0.4,
  layer_height: 0.2,
  initial_layer_print_height: 0.2,
  wall_loops: 2,
  top_shell_layers: 3,
  bottom_shell_layers: 3,
  sparse_infill_density: 15,
  sparse_infill_pattern: "grid",
  filament_type: "PLA",
  nozzle_temperature: 220,
  bed_temperature: 55,
});

export function makeSingleStlManifest(stlBytes, viewerElements = null) {
  if (!(stlBytes instanceof Uint8Array) || stlBytes.byteLength < 134)
    throw new Error("Input must be non-empty STL bytes");
  return {
    schemaVersion: "0.7.0",
    plates: [{ id: "plate-0", index: 0 }],
    meshes: [{ id: "mesh-0", format: "stl", dataRange: {offset: 0, length: stlBytes.byteLength} }],
    objects: [{ id: "object-0", meshId: "mesh-0" }],
    instances: [{
      id: "instance-0",
      objectId: "object-0",
      plateId: "plate-0",
      transform: { matrix: viewerElements
        ? viewerMatrixToNative(viewerElements)
        : [1,0,0,128, 0,1,0,128, 0,0,1,0, 0,0,0,1] },
    }],
    modifierVolumes: [],
  };
}

export async function sliceStlWithEngine(engine, stlBytes, onProgress, viewerElements = null) {
  return sliceMultiStlWithEngine(engine, [{bytes:stlBytes,viewerElements}], onProgress);
}

// The profile reader resolves the process branch separately from machine
// and filament. Never silently drop it when a caller supplies a collection
// without repeating its process settings as an explicit override.
// This is a restricted localhost test adapter, NOT a full native PrintConfig.
export function resolveRestrictedProcessSettings(processOverrides = null, profileCollection = null) {
  let fromCollection = null;
  if (profileCollection !== null) {
    const source = profileCollection?.process?.settings;
    if (!source || typeof source !== "object" || Array.isArray(source) ||
        Object.keys(source).length === 0)
      throw new Error("Selected Orca process profile has no supported settings.");
    fromCollection = parseTestProcessOverrides(source);
  }
  const manual = processOverrides === null ? null
    : parseTestProcessOverrides(processOverrides);
  // Explicit user overrides take precedence, retaining the remaining inherited
  // process fields. Each source is independently allow-listed and bounded.
  return fromCollection && manual ? {...fromCollection, ...manual}
    : fromCollection ?? manual;
}

// Guard the session.init side of the restricted local bridge as strictly as
// process applyProfile. Even a direct caller must not smuggle native printer
// G-code, extra settings, or multi-extruder vectors into a supposedly vetted
// single-tool diagnostic collection. These limits do NOT certify printability.
const MACHINE_INIT_BOUNDS=Object.freeze({
  nozzle_diameter:[0.2,1.2], printable_height:[10,1000],
});
// Same bounded localhost-only retraction vector contract as the resolver.
// Zero length disables retraction; zero deretraction speed uses native fallback.
const MACHINE_INIT_VECTORS=Object.freeze({
  retraction_length:[0,10],retraction_speed:[1,100],deretraction_speed:[0,100],
  // Pinned coFloats in mm; zero is an explicit threshold, not absence.
  retraction_minimum_travel:[0,100],
  z_hop:[0,5],travel_slope:[1,90],
  // Absolute Z in mm, locally bounded; zero below means no upper limit.
  retract_lift_above:[0,1000],retract_lift_below:[0,1000],
  // Local diagnostic bound, not an upstream maximum.
  wipe_distance:[0,20],
});
const MACHINE_Z_HOP_TYPES=new Set(['Auto Lift','Normal Lift','Slope Lift','Spiral Lift']);
const FILAMENT_INIT_SCALARS=Object.freeze({
  nozzle_temperature:[160,290], bed_temperature:[0,120],
});
const FILAMENT_INIT_VECTORS=Object.freeze({
  nozzle_temperature_initial_layer:[160,290],
  filament_flow_ratio:[0.5,1.5],
  filament_diameter:[1,3],
  filament_max_volumetric_speed:[0.1,200],
});
const PLATE_INIT_FIELDS=Object.freeze({
  "High Temp Plate":"hot_plate_temp",
  "Cool Plate":"cool_plate_temp",
  "Engineering Plate":"eng_plate_temp",
  "Textured PEI Plate":"textured_plate_temp",
  "Textured Cool Plate":"textured_cool_plate_temp",
  "Supertack Plate":"supertack_plate_temp",
});
const PLATE_TEMPERATURE_BOUNDS=[0,120];

function isFlatRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
     Object.getPrototypeOf(value) === null);
}
function boundedNativeNumber(value,key,bounds,vector=false) {
  if (vector) {
    if (!Array.isArray(value) || value.length !== 1 || !(0 in value))
      throw new Error("Expected single-tool native vector for " + key);
    value=value[0];
  } else if (Array.isArray(value))
    throw new Error("Unexpected vector for " + key);
  if ((typeof value !== "string" && typeof value !== "number") ||
      !/^\d+(?:\.\d+)?$/.test(String(value).trim()))
    throw new Error("Invalid restricted native number for " + key);
  const number=Number(value);
  if (!Number.isFinite(number) || number<bounds[0] || number>bounds[1])
    throw new Error("Restricted native init value outside diagnostic bounds: " + key);
  const normalized=String(number);
  return vector?[normalized]:normalized;
}

export function makeRestrictedInitConfig(profileCollection=null) {
  if (profileCollection === null) return GENERIC_PLA_TEST_CONFIG;
  if (!isFlatRecord(profileCollection) ||
      !isFlatRecord(profileCollection.machine?.settings) ||
      !isFlatRecord(profileCollection.filament?.settings))
    throw new Error("Expected resolved restricted machine and filament settings.");
  const machine=Object.create(null), filament=Object.create(null);
  for (const [key,value] of Object.entries(profileCollection.machine.settings)) {
    if (Object.hasOwn(MACHINE_INIT_BOUNDS,key))
      machine[key]=boundedNativeNumber(value,key,MACHINE_INIT_BOUNDS[key]);
    else if (Object.hasOwn(MACHINE_INIT_VECTORS,key))
      machine[key]=boundedNativeNumber(value,key,MACHINE_INIT_VECTORS[key],true);
    else if (key==="wipe") {
      if(!Array.isArray(value)||value.length!==1||(value[0]!=="0"&&value[0]!=="1"))
        throw new Error("Invalid single-tool native wipe toggle vector");
      machine[key]=[value[0]];
    } else if (key==="retract_before_wipe") {
      const token=Array.isArray(value)&&value.length===1?value[0]:null;
      if(typeof token!=="string"||!/^\d+(?:\.\d+)?%$/.test(token)||Number(token.slice(0,-1))>100)
        throw new Error("Invalid single-tool native retract-before-wipe percent vector");
      machine[key]=[String(Number(token.slice(0,-1)))+"%"];
    } else if (key==="z_hop_types") {
      if(!Array.isArray(value)||value.length!==1||!MACHINE_Z_HOP_TYPES.has(value[0]))
        throw new Error("Invalid single-tool native Z-hop type vector");
      machine[key]=[value[0]];
    } else throw new Error("Unsupported restricted machine init key: " + key);
  }
  if (!Object.hasOwn(machine,"nozzle_diameter") ||
      !Object.hasOwn(machine,"printable_height"))
    throw new Error("Restricted machine requires nozzle diameter and printable height.");

  const plateFields=new Set(Object.values(PLATE_INIT_FIELDS));
  for (const [key,value] of Object.entries(profileCollection.filament.settings)) {
    if (key==="filament_type") {
      // Do not silently apply the generic PLA baseline to PETG/ABS/etc.
      // The current tested one-slicer-api session.init wire value is scalar.
      if (value!=="PLA")
        throw new Error("Only PLA filament_type is verified for restricted WASM init");
      filament.filament_type=value;
    } else if (Object.hasOwn(FILAMENT_INIT_SCALARS,key))
      filament[key]=boundedNativeNumber(value,key,FILAMENT_INIT_SCALARS[key]);
    else if (Object.hasOwn(FILAMENT_INIT_VECTORS,key))
      filament[key]=boundedNativeNumber(value,key,FILAMENT_INIT_VECTORS[key],true);
    else if (key==="curr_bed_type") {
      if (typeof value!=="string" || !Object.hasOwn(PLATE_INIT_FIELDS,value))
        throw new Error("Unsupported restricted native bed type");
      filament[key]=value;
    } else if (plateFields.has(key) ||
               (key.endsWith("_initial_layer") &&
                plateFields.has(key.slice(0,-"_initial_layer".length))))
      filament[key]=boundedNativeNumber(value,key,PLATE_TEMPERATURE_BOUNDS,true);
    else throw new Error("Unsupported restricted filament init key: " + key);
  }
  if (!Object.hasOwn(filament,"nozzle_temperature"))
    throw new Error("Restricted filament requires a nozzle temperature.");
  const plate=filament.curr_bed_type;
  const selectedPlateKey=plate===undefined?null:PLATE_INIT_FIELDS[plate];
  const allPlateKeys=Object.keys(filament).filter(key=>plateFields.has(key) ||
    (key.endsWith("_initial_layer") &&
      plateFields.has(key.slice(0,-"_initial_layer".length))));
  if (selectedPlateKey===null) {
    // Upstream may carry a legacy scalar bed_temperature without selecting
    // a native plate enum. Preserve that bounded fallback, but never infer
    // or forward any plate-specific vectors without an explicit choice.
    if (allPlateKeys.length)
      throw new Error("Native plate vectors require an explicit plate choice.");
  } else {
    if (!Object.hasOwn(filament,selectedPlateKey) ||
        !Object.hasOwn(filament,"bed_temperature") ||
        allPlateKeys.some(key=>key!==selectedPlateKey &&
          key!==selectedPlateKey+"_initial_layer") ||
        Number(filament.bed_temperature)!==Number(filament[selectedPlateKey][0]))
      throw new Error("Native plate and selected temperature vector disagree.");
  }
  return {...GENERIC_PLA_TEST_CONFIG,...machine,...filament};
}

export async function sliceMultiStlWithEngine(engine, items, onProgress, processOverrides = null, profileCollection = null) {
  if (!engine || typeof engine.createSession !== "function")
    throw new Error("Verified OrcaSlicer engine must be loaded before slicing.");
  // Validate before creating the native WASM session (fail closed).
  const effectiveProcess = resolveRestrictedProcessSettings(processOverrides, profileCollection);
  const base = makeRestrictedInitConfig(profileCollection);
  // Pinned OrcaSlicer v2.5.0 PrintConfig.cpp and PrintConfig.hpp register
  // `enable_support` (not `support_enable`). The pinned OrcaWasm smoke
  // fixture used the latter spelling, but its bridge silently skips unknown
  // keys in init and native-json. Keep the exact validated native key on
  // BOTH paths. This remains an explicit isolated-localhost opt-in only.
  const hasSupportToggle = effectiveProcess !== null &&
    Object.hasOwn(effectiveProcess,"enable_support");
  // Source-pinned OrcaSlicer v2.5.0 says supports are generated for
  // overhang slopes BELOW this threshold. A previous 10-degree experiment
  // selected almost no sphere surfaces. Use a conservative diagnostic 70
  // degrees in BOTH sessions (not a machine/profile recommendation).
  // enable_support remains the sole A/B difference.
  const initConfig = hasSupportToggle
    ? {...base,enable_support:effectiveProcess.enable_support,
        support_type:"normal(auto)",support_threshold_angle:70} : base;
  const appliedProcess = effectiveProcess===null ? null : {...effectiveProcess};
  if (hasSupportToggle) {
    // Preserve validated enable_support:"0"|"1" in native-json. Set exactly
    // the same strategy and threshold in both OFF and ON test sessions.
    appliedProcess.support_type="normal(auto)";
    appliedProcess.support_threshold_angle=70;
  }
  const session = await engine.createSession();
  try {
    await session.init(encode(initConfig));
    if (appliedProcess !== null && Object.keys(appliedProcess).length>0) {
      // The support toggle is session-init only. All other bounded process
      // keys still reach native-json once, before objects and slicing.
      await session.applyProfile("orca.native-json", encode(appliedProcess));
    }
    const project = makeMultiStlProject(items);
    await session.setObjects(project.blob, project.manifest);
    const response = await session.slice({
      schemaVersion: "0.7.0",
      plateSelection: "selected",
      plateIds: ["plate-0"],
      includeGcode: true,
      includeStatistics: true,
    }, {onProgress});
    const result = response?.plateResults?.find(plate => plate.plateId === "plate-0");
    const asset = result?.assets?.find(item => item.kind === "gcode");
    if (response?.schemaVersion !== "0.7.0" || !asset?.id)
      throw new Error("Engine did not return a plate-0 G-code asset.");
    const gcode = await session.getAsset(asset.id);
    if (!(gcode instanceof Uint8Array) || gcode.byteLength < 200)
      throw new Error("Engine returned empty or suspiciously short G-code.");
    const gcodeText = new TextDecoder().decode(gcode);
    if (!/(?:^|\n)G1\s/m.test(gcodeText))
      throw new Error("Generated G-code has no G1 motion commands.");
    return {gcode, statistics: result?.statistics ?? null, response};
  } finally {
    await session.dispose();
  }
}
