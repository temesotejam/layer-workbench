import assert from "node:assert/strict";
import {resolveProcessPreset} from "./process-preset-inheritance.mjs";
const bundle={presets:[
  {name:"Generic base",type:"process",settings:{layer_height:"0.2",wall_loops:2,sparse_infill_density:15}},
  {name:"Quality",type:"process",inherits:"Generic base",settings:{layer_height:0.16}},
  {name:"Strong",type:"process",inherits:"Quality",settings:{wall_loops:4,top_shell_layers:5}},
]};
assert.deepEqual(resolveProcessPreset(bundle,"Strong"),{
  name:"Strong",chain:["Generic base","Quality","Strong"],
  settings:{layer_height:"0.16",wall_loops:"4",sparse_infill_density:"15",top_shell_layers:"5"}
});
assert.deepEqual(resolveProcessPreset(bundle,"Quality").chain,["Generic base","Quality"]);
assert.throws(()=>resolveProcessPreset({presets:[{name:"A",inherits:"B",settings:{layer_height:0.2}}]},"A"),/Missing/);
assert.throws(()=>resolveProcessPreset({presets:[
  {name:"A",inherits:"B",settings:{wall_loops:2}},
  {name:"B",inherits:"A",settings:{layer_height:0.2}}]},"A"),/cycle/);
assert.throws(()=>resolveProcessPreset({presets:[
  {name:"A",settings:{layer_height:0.2}},
  {name:"A",settings:{layer_height:0.3}}]},"A"),/Duplicate/);
assert.throws(()=>resolveProcessPreset({presets:[{name:"A",settings:{nozzle_temperature:220}}]},"A"),/Unsupported/);
assert.throws(()=>resolveProcessPreset({presets:[{name:"__proto__",settings:{wall_loops:2}}]},"__proto__"),/Invalid/);
console.log("PASS: process inheritance merges oldest-first, detects cycles, missing parents and unsafe fields");
