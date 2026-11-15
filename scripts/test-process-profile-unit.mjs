import assert from 'node:assert/strict';
import {parseTestProcessOverrides} from './test-process-profile.mjs';
assert.deepEqual(parseTestProcessOverrides({layer_height:0.3, wall_loops:"3"}),{layer_height:"0.3",wall_loops:"3"});
assert.throws(()=>parseTestProcessOverrides({nozzle_temperature:350}),/Unsupported/);
assert.throws(()=>parseTestProcessOverrides({layer_height:0.01}),/safe test range/);
assert.throws(()=>parseTestProcessOverrides({wall_loops:1.5}),/safe test range/);
assert.throws(()=>parseTestProcessOverrides({wall_loops:"1;rm"}),/Invalid numeric/);
assert.deepEqual(parseTestProcessOverrides({
  outer_wall_speed:'38',inner_wall_speed:70,travel_speed:130
}),{outer_wall_speed:'38',inner_wall_speed:'70',travel_speed:'130'});
for(const bad of [{outer_wall_speed:'50%'},{travel_speed:0},{inner_wall_speed:-1},
  {outer_wall_speed:801},{travel_speed:1501},{inner_wall_speed:['50','60']}]) {
  assert.throws(()=>parseTestProcessOverrides(bad),/Invalid|outside the safe test range/);
}
assert.deepEqual(parseTestProcessOverrides({
  initial_layer_print_height:'0.26',layer_height:'0.3'
}),{initial_layer_print_height:'0.26',layer_height:'0.3'});
for(const bad of ['60%',0,-1,0.51,['0.2','0.3'],null]){
  assert.throws(()=>parseTestProcessOverrides({initial_layer_print_height:bad}),
    /Invalid|outside the safe test range/);
}
// These keys were resolved by the pinned v2.5.0 profile reader but used to
// be rejected later by the separate WASM process-override allow-list.
const depositionSpeeds = {
  sparse_infill_speed: '50',
  internal_solid_infill_speed: '50',
  top_surface_speed: '30',
  gap_infill_speed: '30',
};
assert.deepEqual(parseTestProcessOverrides(depositionSpeeds), depositionSpeeds);
for (const key of Object.keys(depositionSpeeds)) {
  for (const bad of ['50%', '0', '801', ['50', '60'], null, 'fast']) {
    assert.throws(() => parseTestProcessOverrides({[key]:bad}),
      /Invalid|outside the safe test range/, key + ' must reject ' + String(bad));
  }
}
console.log('PASS: pinned process deposition speeds survive bounded override parsing; relative and multi-tool forms fail closed');
console.log('PASS: bounded initial-layer height (mm), no percentages or multi-nozzle vectors');
console.log('PASS: bounded absolute mm/s test process speeds; percentages and multi-nozzle values rejected');
console.log('PASS: bounded test process overrides and invalid preset rejection');

// Exact native v2.5.0 string enums must not be co-erced to numeric speed
// settings or interpreted as display labels.
assert.deepEqual(parseTestProcessOverrides({
  wall_generator:"classic",gap_fill_target:"everywhere"
}),{wall_generator:"classic",gap_fill_target:"everywhere"});
for(const [key,invalid] of [
  ["wall_generator",["Classic", "auto", "0", ["classic"], null, 0]],
  ["gap_fill_target",["top/bottom", "all", "", ["everywhere"], null, 1]],
]){
  for(const value of invalid)
    assert.throws(()=>parseTestProcessOverrides({[key]:value}),/native enum/,
      key+" should refuse "+String(value));
}
console.log("PASS: exact classic/arachne and everywhere/topbottom/nowhere native process enums; malformed values fail closed");
