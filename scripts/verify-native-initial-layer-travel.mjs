// Native v2.5.0 first-layer travel F witness; source-pinned CI only.
// This measures commanded G-code feedrates, not desktop/WASM parity or printer safety.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseGcodeToolpaths} from './gcode-preview-parser.mjs';
import {compareFirstLayerTravelFeedrates} from './initial-layer-travel-diagnostic.mjs';

export function verifyNativeFirstLayerTravel(baselineGcode, alteredGcode) {
  for(const code of [baselineGcode,alteredGcode]){
    if(typeof code!=='string'||code.length<20||Buffer.byteLength(code)>20_000_000)
      throw Error('Missing or oversized native diagnostic G-code');
  }
  const evidence=compareFirstLayerTravelFeedrates(
    parseGcodeToolpaths(baselineGcode),parseGcodeToolpaths(alteredGcode));
  if(!evidence.same_deposition_geometry||evidence.positive_e_strokes_50<2)
    throw Error('Native first-layer deposited geometry changed or is insufficient');
  // The shared A/B helper allows partial matching for exploratory reports.
  // Here the controlled one-option native experiment must match EVERY
  // planar travel in both runs; a common subset cannot masquerade as proof.
  if(evidence.matched_travels<2||
     evidence.matched_travels!==evidence.planar_travels_50||
     evidence.matched_travels!==evidence.planar_travels_100)
    throw Error('Native first-layer planar travel geometry/count does not match');
  if(evidence.changed_travels<1||evidence.faster_at_100_percent<1||
     evidence.near_double_f_strokes<1)
    throw Error('Native 50% -> 100% did not increase a paired modal travel F about twofold');
  return {
    ...evidence,
    baseline_setting:'initial_layer_travel_speed=50%',
    altered_setting:'initial_layer_travel_speed=100%',
    provenance:'same official v2.5.0 native executable, Core 3MF, machine/filament and full process except one speed field',
    native_wasm_parity:false,physical_speed_verified:false,printer_ready:false,
  };
}

async function main(args) {
  const flags={};
  for(let i=0;i<args.length;i+=2){
    if(!['--baseline','--altered','--report'].includes(args[i])||!args[i+1]||flags[args[i]])
      throw Error('Usage: --baseline FILE --altered FILE --report JSON');
    flags[args[i]]=args[i+1];
  }
  if(args.length!==6||!flags['--baseline']||!flags['--altered']||!flags['--report'])
    throw Error('Usage: --baseline FILE --altered FILE --report JSON');
  const [base,alt]=await Promise.all([
    readFile(flags['--baseline'],'utf8'),readFile(flags['--altered'],'utf8'),
  ]);
  const report=verifyNativeFirstLayerTravel(base,alt);
  await mkdir(dirname(resolve(flags['--report'])),{recursive:true});
  await writeFile(flags['--report'],JSON.stringify(report,null,2)+'\n');
  console.log('PASS: native first-layer 50% -> 100% changed paired modal travel F (not native/WASM parity)',JSON.stringify({
    matched_travels:report.matched_travels,changed_travels:report.changed_travels,
    near_double_f_strokes:report.near_double_f_strokes
  }));
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main(process.argv.slice(2)).catch(error=>{console.error(error);process.exitCode=1;});
}
