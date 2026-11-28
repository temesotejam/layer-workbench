// Read-only, source-pinned full-vs-restricted preset coverage audit.
// This is an inventory of forwarded option keys, NOT validation of equivalent
// PrintConfig behavior, native/WASM G-code equality or printer readiness.
import {readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const FAMILIES=Object.freeze(["machine","process","filament"]);

// Pinned v2.5.0 ConfigBase::load_from_json (Config.cpp) handles these
// exact record fields before the PrintConfig deserialization branch.
// Classification is informational: metadata can affect preset identity,
// selection and generated headers; it must not be silently discarded.
const RECORD_METADATA=new Set(["version","from","setting_id","filament_id",
  "instantiation","description"]);
const PRINTER_SELECTION=new Set(["compatible_printers","compatible_printers_condition"]);
// Pinned Preset.cpp machine/filament option lists and PrintConfig.cpp
// declarations. Exact names and families only; never classify arbitrary *_gcode.
const CUSTOM_GCODE_HOOKS={
  machine:new Set(["file_start_gcode","machine_start_gcode","machine_end_gcode",
    "before_layer_change_gcode","printing_by_object_gcode","layer_change_gcode",
    "time_lapse_gcode","wrapping_detection_gcode","change_filament_gcode",
    "change_extrusion_role_gcode"]),
  process:new Set(),
  filament:new Set(["filament_start_gcode","filament_end_gcode","filament_change_extrusion_role_gcode"])
};
function customGcodePresence(kind,value) {
  // Only the source-declared shapes are recognized. Nonempty includes comments
  // and placeholders; this is not proof that a hook executes or emits motion.
  const slots=kind==="machine" && typeof value==="string" ? [value] :
    kind==="filament" && Array.isArray(value) && value.length>0 &&
      value.every(v=>typeof v==="string") ? value : null;
  if(!slots)return "unrecognized-shape";
  return slots.some(v=>v.trim().length>0) ? "nonempty" : "blank";
}
function missingKeyRole(kind,key) {
  if(RECORD_METADATA.has(key)) return "preset-record-metadata";
  // Preset.cpp is_compatible_with_printer evaluates these fields for
  // process/filament selection; they remain important compatibility gates.
  if(kind!=="machine" && PRINTER_SELECTION.has(key)) return "printer-compatibility";
  if(CUSTOM_GCODE_HOOKS[kind].has(key)) return "custom-gcode-hook";
  return "unclassified";
}
function partitionMissingKeys(kind,keys) {
  const groups={"preset-record-metadata":[],"printer-compatibility":[],"custom-gcode-hook":[],"unclassified":[]};
  for(const key of keys) groups[missingKeyRole(kind,key)].push(key);
  return groups;
}

// These hints identify *syntax* transformations only, not equivalent effective
// PrintConfig values or evidence that the WASM engine applied either option.
// Never infer that an arbitrary one-element array or a percent speed is safe
// to collapse: these two conversions are explicitly made by the local bridge.
function rawRepresentationHint(kind,key,native,restricted) {
  const numeric = value => (typeof value === "string" &&
    /^\d+(?:\.\d+)?$/.test(value.trim())) ||
    (typeof value === "number" && Number.isFinite(value));
  if(kind === "machine" && key === "nozzle_diameter" &&
      Array.isArray(native) && native.length === 1 && numeric(native[0]) &&
      numeric(restricted) && Number(native[0]) === Number(restricted))
    return "single-nozzle-vector-to-scalar";
  // Explicitly supported single-tool machine coFloats, not a general
  // scalar-to-vector equivalence rule. Keep raw differences in the audit.
  const machineVectors={retraction_length:[0,10],retraction_speed:[1,100],
    deretraction_speed:[0,100],retraction_minimum_travel:[0,100],z_hop:[0,5],
    travel_slope:[1,90],retract_lift_above:[0,1000],retract_lift_below:[0,1000],wipe_distance:[0,20]};
  if(kind==="machine" && Object.hasOwn(machineVectors,key) &&
      numeric(native) && Number(native)>=machineVectors[key][0] &&
      Number(native)<=machineVectors[key][1] && Array.isArray(restricted) &&
      restricted.length===1 && restricted[0]===String(Number(native)))
    return "single-machine-retraction-scalar-to-vector";
  // Pinned coBools and coPercents: only exact serialized tokens and the
  // explicit local one-slot conversion; do not infer combined clamp semantics.
  if(kind==="machine" && Array.isArray(restricted) && restricted.length===1){
    if(key==="wipe" && (native==="0"||native==="1") && restricted[0]===native)
      return "single-machine-wipe-bool-scalar-to-vector";
    if((key==="retract_before_wipe"||key==="retract_after_wipe") &&
        typeof native==="string" && /^\d+(?:\.\d+)?%$/.test(native) &&
        Number(native.slice(0,-1))<=100 &&
        restricted[0]===String(Number(native.slice(0,-1)))+"%")
      return "single-machine-wipe-percent-scalar-to-vector";
  }
  // Pinned coEnum machine lift mode; only exact, single-slot native tokens.
  if(kind==="machine" && key==="z_hop_types" &&
      ["Auto Lift","Normal Lift","Slope Lift","Spiral Lift"].includes(native) &&
      Array.isArray(restricted) && restricted.length===1 && restricted[0]===native)
    return "single-machine-lift-enum-scalar-to-vector";
  // Pinned PrintConfig.cpp handle_legacy (9889–9894). Do not classify
  // native numeric/boolean values, whitespace, or changed canonical enums.
  if(kind==="process" && key==="enable_arc_fitting" && typeof native==="string"){
    const old=native.toLowerCase();
    const normalized=old==="0"||old==="false"?"disabled":old==="1"||old==="true"?"enabled":null;
    if(normalized!==null && restricted===normalized)
      return "legacy-arc-fitting-string-to-enum";
  }
  // The restricted one-filament PLA bridge accepts these explicit single-slot
  // native arrays, but only these exact fields and this verified PLA material.
  if(kind === "filament" && key === "filament_type" &&
      Array.isArray(native) && native.length === 1 &&
      native[0] === "PLA" && restricted === "PLA")
    return "single-PLA-vector-to-scalar";
  if(kind === "filament" && key === "nozzle_temperature" &&
      Array.isArray(native) && native.length === 1 && numeric(native[0]) &&
      numeric(restricted) && Number(native[0]) === Number(restricted) &&
      Number(restricted) >= 160 && Number(restricted) <= 290)
    return "single-nozzle-temperature-vector-to-scalar";
  if(kind === "process" && key === "sparse_infill_density" &&
      typeof native === "string" && /^\d+(?:\.\d+)?%$/.test(native.trim()) &&
      numeric(restricted) && Number(native.trim().slice(0,-1)) === Number(restricted))
    return "density-percent-token-to-numeric";
  // Pinned top surface flow is a nullable coFloats option, serialized as
  // one scalar token in the CR-10 preset. The restricted parser emits a
  // one-slot string array; only the explicit positive local range is covered.
  // This is not a general scalar-to-vector rule or a nullable/default rule.
  if(kind === "process" && key === "top_solid_infill_flow_ratio" &&
      numeric(native) && Array.isArray(restricted) && restricted.length === 1 &&
      typeof restricted[0] === "string" && numeric(restricted[0]) &&
      Number(native) >= 0.1 && Number(native) <= 2 &&
      restricted[0] === String(Number(native)))
    return "single-top-flow-scalar-to-nozzle-vector";
  return null;
}
function valueShape(value) {
  if(Array.isArray(value)) return "array(" + value.length + ")";
  if(value === null) return "null";
  return typeof value;
}

export function auditProfileCoverage(full, restricted) {
  const families=Object.create(null);
  let fullCount=0, forwardedCount=0, missingCount=0, changedValueCount=0;
  let recognizedSyntaxCount=0, unexplainedCount=0;
  for(const kind of FAMILIES) {
    const native=full?.[kind];
    const wasm=restricted?.[kind]?.settings;
    if(!native || typeof native!=="object" || Array.isArray(native) ||
       !wasm || typeof wasm!=="object" || Array.isArray(wasm))
      throw new Error("Missing resolved native or restricted "+kind+" profile");
    const nativeKeys=Object.keys(native).filter(k=>k!=="type" && k!=="name").sort();
    const wasmKeys=Object.keys(wasm).sort();
    if(!nativeKeys.length || !wasmKeys.length)
      throw new Error("Empty native or restricted "+kind+" settings");
    const nativeSet=new Set(nativeKeys), wasmSet=new Set(wasmKeys);
    const notForwarded=nativeKeys.filter(k=>!wasmSet.has(k));
    const missingRoles=partitionMissingKeys(kind,notForwarded);
    const missingHooks=missingRoles["custom-gcode-hook"].map(key=>({key,
      presence:customGcodePresence(kind,native[key])}));
    const derived=wasmKeys.filter(k=>!nativeSet.has(k));
    const overlapping=wasmKeys.filter(k=>nativeSet.has(k));
    // Raw differences can be legitimate scalar/vector and percent conversions.
    // Such conversions require independent semantic verification.
    const transformed=overlapping.filter(k=>JSON.stringify(native[k])!==JSON.stringify(wasm[k]));
    const differences=transformed.map(key=>{
      const hint=rawRepresentationHint(kind,key,native[key],wasm[key]);
      return {key,native_shape:valueShape(native[key]),restricted_shape:valueShape(wasm[key]),
        syntax_only_hint:hint??"unexplained"};
    });
    recognizedSyntaxCount+=differences.filter(item=>item.syntax_only_hint!=="unexplained").length;
    unexplainedCount+=differences.filter(item=>item.syntax_only_hint==="unexplained").length;
    families[kind]={native_option_count:nativeKeys.length,
      restricted_option_count:wasmKeys.length,
      overlapping_option_count:overlapping.length,
      not_forwarded_count:notForwarded.length,
      not_forwarded_keys:notForwarded,
      not_forwarded_keys_by_role:missingRoles,
      not_forwarded_custom_gcode_hooks:missingHooks,
      restricted_only_keys:derived,
      raw_value_differences_requiring_review:transformed,
      raw_value_difference_shapes:differences,
      recognized_syntax_only_count:differences.filter(item=>item.syntax_only_hint!=="unexplained").length,
      unexplained_raw_value_difference_count:differences.filter(item=>item.syntax_only_hint==="unexplained").length};
    fullCount+=nativeKeys.length;
    forwardedCount+=overlapping.length;
    missingCount+=notForwarded.length;
    changedValueCount+=transformed.length;
  }
  return {
    scope:"source-pinned full native preset vs restricted localhost WASM option bridge",
    native_vs_wasm_gcode_compared:false,
    full_profile_parity_established:false,
    print_ready:false,
    total_native_option_count:fullCount,
    overlapping_option_count:forwardedCount,
    total_not_forwarded_count:missingCount,
    overlapping_raw_value_differences:changedValueCount,
    recognized_syntax_only_count:recognizedSyntaxCount,
    unexplained_raw_value_difference_count:unexplainedCount,
    families,
    note:"Key overlap and recognized syntax-only conversions do not prove semantic option equivalence or WASM application. Missing options and value discrepancies block a full-profile parity claim. Missing-key roles are informational; unclassified keys require review and metadata/compatibility are not presumed behaviorally irrelevant."
  };
}

async function main() {
  const [,,crealityPath,filamentPath,reportPath]=process.argv;
  if(!crealityPath||!filamentPath||!reportPath) throw new Error(
    "Usage: node scripts/audit-native-wasm-profile-gap.mjs creality-fixture.json filament-fixture.json report.json");
  const {buildNativeSettings,PIN}=await import("./prepare-native-v250-presets.mjs");
  const {extractVendorProfileRecords}=await import("./orca-vendor-index.mjs");
  const {resolveOrcaProfileCollection}=await import("./orca-profile-collection.mjs");
  const creality=JSON.parse(readFileSync(crealityPath,"utf8"));
  const library=JSON.parse(readFileSync(filamentPath,"utf8"));
  const native=buildNativeSettings(creality,library);
  const selected={
    machine:"Creality CR-10 0.4 nozzle",
    process:"0.20mm Standard @Creality CR-10 0.4 nozzle",
    filament:"Generic PLA @System"
  };
  const records=[...extractVendorProfileRecords(creality.vendor_index,creality.files).records,
    ...extractVendorProfileRecords(library.vendor_index,library.files).records];
  const restricted=resolveOrcaProfileCollection(records,selected);
  const report={upstream_commit:PIN,selected_profiles:selected,
    ...auditProfileCoverage(native.output,restricted)};
  for(const kind of FAMILIES) {
    if(report.families[kind].native_option_count<30 ||
       report.families[kind].overlapping_option_count<1 ||
       report.families[kind].not_forwarded_count<1)
      throw new Error("Pinned "+kind+" fixture lacks expected nontrivial coverage gap");
  }
  writeFileSync(reportPath,JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
  for(const kind of FAMILIES) {
    const row=report.families[kind];
    console.log(kind+": native="+row.native_option_count+
      ", key-overlap="+row.overlapping_option_count+
      ", not-forwarded="+row.not_forwarded_count+
      ", raw-value-review="+row.raw_value_differences_requiring_review.length+
      ", syntax-only-hints="+row.recognized_syntax_only_count+
      ", unexplained="+row.unexplained_raw_value_difference_count);
    console.log(kind+" missing-key roles: "+JSON.stringify(Object.fromEntries(
      Object.entries(row.not_forwarded_keys_by_role).map(([role,keys])=>[role,keys.length]))));
    if(row.not_forwarded_custom_gcode_hooks.length)console.log(kind+" missing custom G-code hook presence: "+JSON.stringify(row.not_forwarded_custom_gcode_hooks));
    // Name and shape only; never emit original profile values or executable G-code.
    const unexplained=row.raw_value_difference_shapes.filter(item=>item.syntax_only_hint==="unexplained")
      .map(item=>({key:item.key,native_shape:item.native_shape,
        restricted_shape:item.restricted_shape}));
    if(unexplained.length)console.log(kind+" unexplained raw-value keys: "+JSON.stringify(unexplained));
  }
  console.log("PASS: pinned preset coverage gap recorded (NOT native/WASM parity): "+reportPath);
}

if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1]))
  main().catch(error=>{console.error(error);process.exitCode=1;});
