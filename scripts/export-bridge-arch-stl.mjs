// Diagnostic-only bridge arch binary STL from the exact localhost WASM OBJ fixture.
// This shares mesh triangles, NOT a native project transform, profiles or G-code.
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {makeBridgeArchObj} from './bridge-arch-fixture.mjs';
import {objToBinaryStl} from './obj-to-stl.mjs';

export function makeBridgeArchStl() {
  return objToBinaryStl(makeBridgeArchObj());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const output=process.argv[2];
  if (!output || process.argv.length!==3) throw new Error('Usage: node scripts/export-bridge-arch-stl.mjs output.stl');
  const bytes=makeBridgeArchStl();
  writeFileSync(output,bytes,{flag:'wx',mode:0o600});
  console.log('Diagnostic bridge arch STL',output,'triangles',new DataView(bytes.buffer).getUint32(80,true),
    'SHA256',createHash('sha256').update(bytes).digest('hex'));
}
