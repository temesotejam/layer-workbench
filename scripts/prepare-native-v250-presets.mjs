// Produce source-pinned, inheritance-flattened official v2.5.0 native CLI
// settings exclusively in an ephemeral CI directory. NOT an approved print preset.
import assert from "node:assert/strict";
import {readFileSync, mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {extractVendorProfileRecords} from "./orca-vendor-index.mjs";
import {resolveFullOrcaProfileFamily, inspectOrcaNozzleVector} from "./orca-full-profile.mjs";

export const PIN="40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19";
const NAMES=Object.freeze({
  machine:"Creality CR-10 0.4 nozzle",
  process:"0.20mm Standard @Creality CR-10 0.4 nozzle",
  filament:"Generic PLA @System",
});
function digest(bytes) {return createHash("sha256").update(bytes).digest("hex");}
export function buildNativeSettings(creality, library) {
  assert.equal(creality?.upstream_commit,PIN,"untrusted Creality commit");
  assert.equal(library?.upstream_commit,PIN,"untrusted filament commit");
  assert.equal(creality.vendor_index.name,"Creality");
  assert.equal(library.vendor_index.name,"OrcaFilamentLibrary");
  const crealityRecords=extractVendorProfileRecords(creality.vendor_index,creality.files).records;
  const libraryRecords=extractVendorProfileRecords(library.vendor_index,library.files).records;
  const records=[...crealityRecords,...libraryRecords];
  const output=Object.create(null);
  const chains=Object.create(null);
  const counts=Object.create(null);
  for(const kind of ["machine","process","filament"]){
    const full=resolveFullOrcaProfileFamily(records,kind,NAMES[kind]);
    output[kind]={type:kind,name:NAMES[kind],...full.settings};
    chains[kind]=full.chain;
    counts[kind]=Object.keys(full.settings).length;
  }
  assert.deepEqual(chains.machine,[
    "fdm_machine_common","fdm_creality_common",NAMES.machine]);
  assert.deepEqual(chains.process,[
    "fdm_process_common","fdm_process_creality_common",NAMES.process]);
  assert.deepEqual(chains.filament,[
    "fdm_filament_common","fdm_filament_pla",NAMES.filament]);
  assert.deepEqual(inspectOrcaNozzleVector(
    resolveFullOrcaProfileFamily(records,"machine",NAMES.machine)).nozzleDiametersMm,[0.4]);
  assert.equal(String(output.process.layer_height),"0.2");
  assert.equal(String(output.process.wall_loops),"2");
  assert.ok(counts.machine>30 && counts.process>40 && counts.filament>20,
    "unexpectedly incomplete official profile");
  // Preserve full settings, including G-code strings, vector-valued options
  // and unknown native keys. A separate CI gate MUST establish CLI acceptance.
  return {output,chains,counts};
}
function main() {
  const [,,machinePath,filamentPath,outputDir]=process.argv;
  if(!machinePath||!filamentPath||!outputDir)throw new Error(
    "Usage: node scripts/prepare-native-v250-presets.mjs creality-fixture.json filament-fixture.json output-dir");
  const creality=JSON.parse(readFileSync(machinePath,"utf8"));
  const library=JSON.parse(readFileSync(filamentPath,"utf8"));
  const {output,chains,counts}=buildNativeSettings(creality,library);
  mkdirSync(outputDir,{recursive:true});
  const hashes=Object.create(null);
  for(const kind of ["machine","process","filament"]){
    const bytes=JSON.stringify(output[kind],null,2)+"\n";
    writeFileSync(join(outputDir,kind+".json"),bytes,{mode:0o600,flag:"wx"});
    hashes[kind]=digest(bytes);
    console.log("Prepared pinned",kind,"keys",counts[kind],"SHA256",hashes[kind]);
  }
  const report={upstream_commit:PIN,profile_names:NAMES,chains,option_counts:counts,
    hashes,provenance:"resolved official full JSON, experimental native CLI only",
    wasm_parity:false,usable_for_printing:false};
  writeFileSync(join(outputDir,"manifest.json"),JSON.stringify(report,null,2)+"\n",
    {mode:0o600,flag:"wx"});
  console.log("PASS: offline full official profile inheritance materialized for native CLI test");
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1])main();
