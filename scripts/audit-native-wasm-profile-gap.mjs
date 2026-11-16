// Read-only, source-pinned full-vs-restricted preset coverage audit.
// This is an inventory of forwarded option keys, NOT validation of equivalent
// PrintConfig behavior, native/WASM G-code equality or printer readiness.
import {readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const FAMILIES=Object.freeze(["machine","process","filament"]);

export function auditProfileCoverage(full, restricted) {
  const families=Object.create(null);
  let fullCount=0, forwardedCount=0, missingCount=0, changedValueCount=0;
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
    const derived=wasmKeys.filter(k=>!nativeSet.has(k));
    const overlapping=wasmKeys.filter(k=>nativeSet.has(k));
    // Raw differences can be legitimate scalar/vector and percent conversions.
    // Such conversions require independent semantic verification.
    const transformed=overlapping.filter(k=>JSON.stringify(native[k])!==JSON.stringify(wasm[k]));
    families[kind]={native_option_count:nativeKeys.length,
      restricted_option_count:wasmKeys.length,
      overlapping_option_count:overlapping.length,
      not_forwarded_count:notForwarded.length,
      not_forwarded_keys:notForwarded,
      restricted_only_keys:derived,
      raw_value_differences_requiring_review:transformed};
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
    families,
    note:"Key overlap is not semantic execution proof. Missing options and normalized scalar/vector values block a full-profile parity claim."
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
      ", raw-value-review="+row.raw_value_differences_requiring_review.length);
  }
  console.log("PASS: pinned preset coverage gap recorded (NOT native/WASM parity): "+reportPath);
}

if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1]))
  main().catch(error=>{console.error(error);process.exitCode=1;});
