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
console.log('PASS: bounded absolute mm/s test process speeds; percentages and multi-nozzle values rejected');
console.log('PASS: bounded test process overrides and invalid preset rejection');
