import assert from 'node:assert/strict';
import {parseTestProcessOverrides} from './test-process-profile.mjs';
assert.deepEqual(parseTestProcessOverrides({layer_height:0.3, wall_loops:"3"}),{layer_height:"0.3",wall_loops:"3"});
assert.throws(()=>parseTestProcessOverrides({nozzle_temperature:350}),/Unsupported/);
// Parsed JSON can carry prototype property names as *own* keys. Before the
// own-property guard, LIMITS[key] inherited e.g. Object.prototype.constructor
// and accepted these values with undefined numeric bounds. Reject them all.
for (const key of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
  const untrusted = JSON.parse(`{"layer_height":0.2,"${key}":"12"}`);
  assert.throws(() => parseTestProcessOverrides(untrusted),
    /Unsupported process setting/, key + ' bypassed the explicit allow-list');
}
assert.deepEqual(parseTestProcessOverrides(JSON.parse('{"layer_height":0.2}')),
  {layer_height:"0.2"});
console.log('PASS: JSON prototype-key names cannot bypass the local process override allow-list');
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
  bridge_speed: '50',
};
assert.deepEqual(parseTestProcessOverrides(depositionSpeeds), depositionSpeeds);
for (const key of Object.keys(depositionSpeeds)) {
  for (const bad of ['50%', '0', '801', ['50', '60'], null, 'fast']) {
    assert.throws(() => parseTestProcessOverrides({[key]:bad}),
      /Invalid|outside the safe test range/, key + ' must reject ' + String(bad));
  }
}
console.log('PASS: pinned process deposition speeds survive bounded override parsing; relative and multi-tool forms fail closed');
assert.deepEqual(parseTestProcessOverrides({line_width:"0.42"}),{line_width:"0.42"});
for(const bad of ["105%",0,2.01,["0.42"],"auto",null,-0.1]){
  assert.throws(()=>parseTestProcessOverrides({line_width:bad}),
    /Invalid|outside the safe test range/);
}
console.log("PASS: absolute 0.42 mm source-pinned line_width; relative/invalid widths fail closed");
// Preserve an independently selected outer-wall width, not a replacement for
// the general line width. Reject percentages and multi-tool vectors.
assert.deepEqual(parseTestProcessOverrides({line_width:"0.5",outer_wall_line_width:"0.42"}),
  {line_width:"0.5",outer_wall_line_width:"0.42"});
for(const bad of ["105%",0,2.01,["0.42"],"auto",null,-0.1]){
  assert.throws(()=>parseTestProcessOverrides({outer_wall_line_width:bad}),
    /Invalid|outside the safe test range/);
}
console.log("PASS: bounded native outer_wall_line_width is independent and rejects ambiguous formats");
// The official CR-10 0.20mm preset carries an independent 0.45 mm inner-wall width.
// The localhost adapter must not alias it to common or outer-wall widths.
assert.deepEqual(parseTestProcessOverrides({
  line_width:"0.42",outer_wall_line_width:"0.4",inner_wall_line_width:"0.45"
}),{line_width:"0.42",outer_wall_line_width:"0.4",inner_wall_line_width:"0.45"});
for (const bad of ["105%",0,2.01,["0.45"],["0.45","0.5"],"auto",null,-0.1]) {
  assert.throws(()=>parseTestProcessOverrides({inner_wall_line_width:bad}),
    /Invalid|outside the safe test range/);
}
console.log("PASS: bounded native inner_wall_line_width is independent and rejects relative/vector forms");
// Sparse infill is a separate native extrusion-width setting, not an alias
// for wall or general width. Keep the localhost bridge fail-closed.
assert.deepEqual(parseTestProcessOverrides({
  line_width:"0.42",outer_wall_line_width:"0.42",
  inner_wall_line_width:"0.45",sparse_infill_line_width:"0.45"
}),{
  line_width:"0.42",outer_wall_line_width:"0.42",
  inner_wall_line_width:"0.45",sparse_infill_line_width:"0.45"
});
for(const bad of ["105%",0,2.01,["0.45"],["0.45","0.5"],"auto",null,-0.1]){
  assert.throws(()=>parseTestProcessOverrides({sparse_infill_line_width:bad}),
    /Invalid|outside the safe test range/);
}
console.log("PASS: sparse infill width is independently bounded and rejects relative/vector forms");
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
assert.deepEqual(parseTestProcessOverrides({sparse_infill_pattern:"grid"}),{sparse_infill_pattern:"grid"});
assert.deepEqual(parseTestProcessOverrides({sparse_infill_pattern:"crosshatch"}),{sparse_infill_pattern:"crosshatch"});
for(const bad of ["Grid","gyroid","rectilinear","",["grid"],null,1,"__proto__"]){
  assert.throws(()=>parseTestProcessOverrides({sparse_infill_pattern:bad}),/native enum/,
    "Unverified or malformed sparse infill pattern must fail closed: "+String(bad));
}
console.log("PASS: exact pinned grid/crosshatch infill tokens accepted; unverified pattern values refused");
console.log("PASS: exact classic/arachne and everywhere/topbottom/nowhere native process enums; malformed values fail closed");

assert.deepEqual(parseTestProcessOverrides({line_width:"0.5",top_surface_line_width:"0.42"}),
  {line_width:"0.5",top_surface_line_width:"0.42"});
for(const bad of ["105%",0,2.01,["0.42"],["0.42","0.5"],"auto",null,-0.1]){
  assert.throws(()=>parseTestProcessOverrides({top_surface_line_width:bad}),
    /Invalid|outside the safe test range/);
}
console.log("PASS: independent absolute top_surface_line_width and fail-closed malformed values");

// Internal solid infill width is a separate native setting; do not map it to
// sparse infill or to generic line_width, even when the values happen to match.
assert.deepEqual(parseTestProcessOverrides({
  line_width:"0.42",sparse_infill_line_width:"0.4",
  top_surface_line_width:"0.42",internal_solid_infill_line_width:"0.45"
}),{
  line_width:"0.42",sparse_infill_line_width:"0.4",
  top_surface_line_width:"0.42",internal_solid_infill_line_width:"0.45"
});
for(const bad of ["105%",0,2.01,["0.45"],["0.45","0.5"],"auto",null,-0.1]){
  assert.throws(()=>parseTestProcessOverrides({internal_solid_infill_line_width:bad}),
    /Invalid|outside the safe test range/);
}
console.log("PASS: internal solid infill width remains independent and rejects relative/vector formats");

// First layer has a separate native extrusion width. Never silently alias
// it to the generic line width or to the first-layer height.
assert.deepEqual(parseTestProcessOverrides({
  line_width:"0.42",initial_layer_print_height:"0.2",initial_layer_line_width:"0.5"
}),{line_width:"0.42",initial_layer_print_height:"0.2",initial_layer_line_width:"0.5"});
for(const bad of ["110%",0,2.01,["0.5"],["0.5","0.6"],"auto",null,-0.1]){
  assert.throws(()=>parseTestProcessOverrides({initial_layer_line_width:bad}),
    /Invalid|outside the safe test range/);
}
console.log("PASS: independent initial-layer line width is bounded and fails closed");

// v2.5.0 CR-10 first-layer print speed is a distinct native absolute
// mm/s field, not a percentage or alias for initial-layer infill speed.
assert.deepEqual(parseTestProcessOverrides({initial_layer_speed:'15',outer_wall_speed:'25'}),
  {initial_layer_speed:'15',outer_wall_speed:'25'});
for(const bad of ['50%',0,801,['15'],['15','20'],'auto',null,-1]){
  assert.throws(()=>parseTestProcessOverrides({initial_layer_speed:bad}),
    /Invalid|outside the safe test range/);
}
console.log('PASS: independent source-pinned first-layer speed is bounded and rejects relative/vector formats');

// First-layer infill speed must be independent of first-layer perimeters.
assert.deepEqual(parseTestProcessOverrides({initial_layer_speed:'15',initial_layer_infill_speed:'20'}),
  {initial_layer_speed:'15',initial_layer_infill_speed:'20'});
for(const bad of ['50%',0,801,['20'],['20','30'],'auto',null,-1]){
  assert.throws(()=>parseTestProcessOverrides({initial_layer_infill_speed:bad}),
    /Invalid|outside the safe test range/);
}
console.log('PASS: bounded independent first-layer infill speed refuses relative and vector inputs');

// Source-pinned support settings are independent absolute parameters;
// a localhost process override cannot silently enable support generation.
assert.deepEqual(parseTestProcessOverrides({
  support_line_width:'0.42',support_speed:'30',support_interface_speed:'25',
}),{support_line_width:'0.42',support_speed:'30',support_interface_speed:'25'});
for(const key of ['support_line_width','support_speed','support_interface_speed']) {
  for(const bad of ['50%',0,key==='support_line_width'?2.01:801,
    ['0.42'],['0.42','0.5'],null,'auto']) {
    assert.throws(()=>parseTestProcessOverrides({[key]:bad}),
      /Invalid|outside the safe test range/,key+': '+JSON.stringify(bad));
  }
}
// In an explicit localhost-only engine lab, a native v2.5.0 support toggle
// may be submitted deliberately. Do not coerce JS booleans, percentages, numeric
// 1/0 or an inherited profile's arbitrary value into a generation request.
assert.deepEqual(parseTestProcessOverrides({enable_support:'0'}),{enable_support:'0'});
assert.deepEqual(parseTestProcessOverrides({enable_support:'1'}),{enable_support:'1'});
for (const bad of [0,1,true,false,'true','false','2','1%',null,['1'],['0','1']]) {
  assert.throws(()=>parseTestProcessOverrides({enable_support:bad}),/native enum/,
    'Unsafe support toggle should fail closed: '+JSON.stringify(bad));
}
console.log('PASS: explicit single native support bool is opt-in; ambiguous toggle values fail closed');
console.log('PASS: absolute support width and independent body/interface speeds bounded; activation excluded');


// A pinned v2.5.0 integer skirt count is distinct from speed and width.
assert.deepEqual(parseTestProcessOverrides({skirt_loops:"0"}),{skirt_loops:"0"});
assert.deepEqual(parseTestProcessOverrides({skirt_loops:"2"}),{skirt_loops:"2"});
assert.deepEqual(parseTestProcessOverrides({skirt_loops:"10"}),{skirt_loops:"10"});
for(const bad of ["2%","2.5",-1,11,"auto",["2"],null]) {
  assert.throws(()=>parseTestProcessOverrides({skirt_loops:bad}),
    /Invalid|outside the safe test range/,String(bad));
}
console.log("PASS: isolated WASM process skirt_loops accepts only integer 0..10");

// Official v2.5.0 skirt_distance: absolute millimetres, float 0..60 inclusive.
for(const value of ["0","2","2.5","60"]) {
  assert.deepEqual(parseTestProcessOverrides({skirt_distance:value}),{skirt_distance:value});
}
for(const bad of ["-1","60.1","2%","auto",["2"],null,NaN,Infinity]) {
  assert.throws(()=>parseTestProcessOverrides({skirt_distance:bad}),
    /Invalid|outside the safe test range/,String(bad));
}
console.log("PASS: source-pinned skirt_distance float 0..60 mm rejects percentages and vectors");

// Native skirt height is an independent positive integer count of layers.
for (const value of ['1','2','3','20'])
  assert.deepEqual(parseTestProcessOverrides({skirt_height:value}),{skirt_height:value});
for (const bad of ['0','21','2.5','2%','auto',['2'],null,-1])
  assert.throws(()=>parseTestProcessOverrides({skirt_height:bad}),
    /Invalid|outside the safe test range/,'Malformed skirt_height '+String(bad));
console.log('PASS: native skirt_height 1..20 integer layers and invalid inputs fail closed');
