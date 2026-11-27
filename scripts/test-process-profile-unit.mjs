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
// Bridge flow is a dimensionless ratio, independent of bridge_speed in mm/s.
assert.deepEqual(parseTestProcessOverrides({bridge_speed:'50',bridge_flow:'0.95'}),
  {bridge_speed:'50',bridge_flow:'0.95'});
for(const value of ['0.1','0.55','0.95','1','2'])
  assert.equal(parseTestProcessOverrides({bridge_flow:value}).bridge_flow,value);
for(const bad of ['0','2.01','95%','auto',['0.95'],['0.95','1'],null,Infinity,NaN,-1])
  assert.throws(()=>parseTestProcessOverrides({bridge_flow:bad}),
    /Invalid|outside the safe test range/,String(bad));
// Internal bridges use their own native extrusion multiplier. The source-pinned
// CR-10 child has internal_bridge_flow=1 even though bridge_flow=0.95.
// Retain both independently and reject ambiguous values rather than aliasing.
assert.deepEqual(parseTestProcessOverrides({
  bridge_flow:'0.95',internal_bridge_flow:'1'
}),{bridge_flow:'0.95',internal_bridge_flow:'1'});
for(const value of ['0.1','0.55','1','2'])
  assert.equal(parseTestProcessOverrides({internal_bridge_flow:value}).internal_bridge_flow,value);
for(const bad of ['0','2.01','95%','auto',['1'],['1','0.95'],null,Infinity,NaN,-1])
  assert.throws(()=>parseTestProcessOverrides({internal_bridge_flow:bad}),
    /Invalid|outside the safe test range/,String(bad));
assert.equal(parseTestProcessOverrides({bridge_flow:'0.95'}).internal_bridge_flow,undefined);
assert.equal(parseTestProcessOverrides({internal_bridge_flow:'1'}).bridge_flow,undefined);
console.log('PASS: internal bridge flow is bounded and independent of external bridge flow');
console.log('PASS: bounded source-pinned bridge flow ratio rejects percentage, vector and malformed input');
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
assert.deepEqual(parseTestProcessOverrides({
  sparse_infill_pattern:"grid",internal_solid_infill_pattern:"monotonic"
}),{sparse_infill_pattern:"grid",internal_solid_infill_pattern:"monotonic"});
assert.deepEqual(parseTestProcessOverrides({
  sparse_infill_pattern:"grid",internal_solid_infill_pattern:"rectilinear"
}),{sparse_infill_pattern:"grid",internal_solid_infill_pattern:"rectilinear"});
for(const bad of ["Monotonic","grid","zig-zag","",["monotonic"],null,0,"__proto__"]) {
  assert.throws(()=>parseTestProcessOverrides({internal_solid_infill_pattern:bad}),
    /native enum/,"Unverified internal solid infill pattern must fail closed: "+String(bad));
}
console.log("PASS: source-pinned internal solid monotonic/rectilinear are independent of sparse fill");
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

// CR-10 v2.5.0 child has skirt_speed=20 mm/s, independently of the
// 0..10 loop count, millimetre distance and integer height.
assert.deepEqual(parseTestProcessOverrides({
  skirt_speed:'20',skirt_loops:'2',skirt_distance:'2',skirt_height:'2'
}),{skirt_speed:'20',skirt_loops:'2',skirt_distance:'2',skirt_height:'2'});
for(const value of ['0','3','20','300'])
  assert.equal(parseTestProcessOverrides({skirt_speed:value}).skirt_speed,value);
for(const bad of ['-1','301','20%','auto',['20'],null,Infinity,NaN])
  assert.throws(()=>parseTestProcessOverrides({skirt_speed:bad}),
    /Invalid|outside the safe test range/,'Rejected skirt_speed: '+String(bad));
console.log('PASS: native skirt_speed absolute 0..300 mm/s; relative, vector and nonfinite rejected');

// A native infill angle must remain independent of density and other speeds.
assert.deepEqual(parseTestProcessOverrides({infill_direction:'45',sparse_infill_density:'35'}),
  {infill_direction:'45',sparse_infill_density:'35'});
for(const value of ['0','30','45.5','360'])
  assert.equal(parseTestProcessOverrides({infill_direction:value}).infill_direction,value);
for(const bad of [-1,360.01,'45%','auto',['45'],['45','90'],null,NaN,Infinity])
  assert.throws(()=>parseTestProcessOverrides({infill_direction:bad}),
    /Invalid|outside the safe test range/,String(bad));
console.log('PASS: independent native infill direction 0..360 degrees rejects relative/vector inputs');

// Source-pinned v2.5.0 shell thickness is a FLOAT in millimetres, not an
// inferred shell-layer count. Zero explicitly disables the thickness floor.
assert.deepEqual(parseTestProcessOverrides({
  top_shell_layers: '5',top_shell_thickness: '0.8',
  bottom_shell_layers: '4',bottom_shell_thickness: '0'
}),{top_shell_layers:'5',top_shell_thickness:'0.8',
  bottom_shell_layers:'4',bottom_shell_thickness:'0'});
for(const key of ['top_shell_thickness','bottom_shell_thickness']) {
  for(const value of ['0','0.8','1.25','5'])
    assert.equal(parseTestProcessOverrides({[key]:value})[key],value);
  for(const bad of ['-1','5.01','0.8%','auto',['0.8'],['0.8','0.6'],
    null,true,NaN,Infinity])
    assert.throws(()=>parseTestProcessOverrides({[key]:bad}),
      /Invalid|outside the safe test range/,'Rejected native thickness '+key);
}
// Native v2.5.0 maps vertical shell protection to FOUR enum wire tokens.
for(const value of ['none','ensure_critical_only','ensure_moderate','ensure_all']) {
  assert.deepEqual(parseTestProcessOverrides({ensure_vertical_shell_thickness:value}),
    {ensure_vertical_shell_thickness:value});
}
assert.deepEqual(parseTestProcessOverrides({
  ensure_vertical_shell_thickness:'ensure_all',top_shell_layers:'5',bottom_shell_layers:'4'
}),{ensure_vertical_shell_thickness:'ensure_all',top_shell_layers:'5',bottom_shell_layers:'4'});
for(const bad of ['All','critical only','1','0','', ['ensure_all'],
  null,0,true,{},'__proto__']) {
  assert.throws(()=>parseTestProcessOverrides({ensure_vertical_shell_thickness:bad}),
    /native enum/,'Native vertical-shell protection must reject '+String(bad));
}
console.log('PASS: pinned ensure_vertical_shell_thickness enum tokens and fail-closed invalid modes');
console.log('PASS: independent top/bottom native shell-thickness mm floats and fail-closed inputs');

// Pinned v2.5.0 CR-10 surface skins are distinct from internal solid infill.
assert.deepEqual(parseTestProcessOverrides({
  top_surface_pattern:"monotonic",bottom_surface_pattern:"monotonicline",
  internal_solid_infill_pattern:"rectilinear"
}),{top_surface_pattern:"monotonic",bottom_surface_pattern:"monotonicline",
  internal_solid_infill_pattern:"rectilinear"});
for(const key of ["top_surface_pattern","bottom_surface_pattern"]){
  for(const good of ["monotonic","monotonicline","rectilinear"])
    assert.equal(parseTestProcessOverrides({[key]:good})[key],good);
  for(const bad of ["Monotonic","concentric","",["monotonic"],null,0,"__proto__"])
    assert.throws(()=>parseTestProcessOverrides({[key]:bad}),/native enum/,key+" rejects "+String(bad));
}
assert.equal(parseTestProcessOverrides({top_surface_pattern:"monotonic"}).bottom_surface_pattern,undefined);
console.log("PASS: independent source-pinned top/bottom surface patterns reject unverified tokens");

// Source-pinned CR-10 v2.5.0 uses relative first-layer travel: 50% of
// travel_speed. Never coerce percentage input to a 50 mm/s absolute speed.
assert.deepEqual(parseTestProcessOverrides({travel_speed:'200',initial_layer_travel_speed:'50%'}),
  {travel_speed:'200',initial_layer_travel_speed:'50%'});
assert.equal(parseTestProcessOverrides({initial_layer_travel_speed:' 75.0% '}).initial_layer_travel_speed,'75%');
assert.equal(parseTestProcessOverrides({initial_layer_travel_speed:'120'}).initial_layer_travel_speed,'120');
for (const bad of ['0%','201%','-20%','50%%','50% G28','auto',[],['50%'],null,0,1501,Infinity])
  assert.throws(()=>parseTestProcessOverrides({initial_layer_travel_speed:bad}),
    /Invalid|outside the safe test range/,String(bad));
console.log('PASS: relative first-layer travel percent is preserved, bounded and independent of absolute speed');

 // Pinned OrcaSlicer v2.5.0 coPercent relative to inner_wall_line_width.
for(const [input,expected] of [["0%","0%"],["30%","30%"],[" 12.50% ","12.5%"],["100%","100%"]])
  assert.deepEqual(parseTestProcessOverrides({infill_wall_overlap:input}),
    {infill_wall_overlap:expected});
for(const bad of [30,"30",["30%"],null,true,"-1%","100.01%","30%%","30% G28","Infinity%"])
  assert.throws(()=>parseTestProcessOverrides({infill_wall_overlap:bad}),/Invalid|safe test range/);
console.log("PASS: explicit bounded infill/wall overlap percent; no scalar or vector substitution");

 // Native coFloat absolute square-millimetre threshold; no inferred default.
for(const [input,expected] of [[0,"0"],["10","10"],[" 0.25 ","0.25"],[10000,"10000"]])
  assert.deepEqual(parseTestProcessOverrides({minimum_sparse_infill_area:input}),
    {minimum_sparse_infill_area:expected});
for(const bad of [-1,10000.01,"10%","10 mm2",["10"],null,true,NaN,Infinity,""])
  assert.throws(()=>parseTestProcessOverrides({minimum_sparse_infill_area:bad}),/Invalid|safe test range/);
console.log("PASS: absolute sparse-infill area threshold validation");

 // Both native anchor lengths are independent mm-or-percent scalars.
for(const key of ["infill_anchor","infill_anchor_max"]){
  for(const [input,expected] of [[0,"0"],["0%","0%"],["400%","400%"],[" 12.50% ","12.5%"],["20","20"],[1000,"1000"],["1000%","1000%"]])
    assert.deepEqual(parseTestProcessOverrides({[key]:input}),{[key]:expected});
  for(const bad of [-1,1000.01,"1000.01%","-1%","20mm","20%%","20% G28",["20"],null,true,NaN,Infinity,""])
    assert.throws(()=>parseTestProcessOverrides({[key]:bad}),/Invalid|safe test range/);
}
assert.deepEqual(parseTestProcessOverrides({infill_anchor:"400%",infill_anchor_max:"20",sparse_infill_line_width:"0.45"}),
  {infill_anchor:"400%",infill_anchor_max:"20",sparse_infill_line_width:"0.45"});
console.log("PASS: independent anchor length scalars preserve absolute mm and relative percent");

 // Native infill combination is a serialized bool, not a layer count.
for(const v of ["0","1"])
  assert.deepEqual(parseTestProcessOverrides({infill_combination:v}),{infill_combination:v});
for(const bad of [0,1,true,false,"true","false","2","1%"," 1 ",["1"],null,"1 G28"])
  assert.throws(()=>parseTestProcessOverrides({infill_combination:bad}),/Unsupported native enum/);
console.log("PASS: exact native sparse infill combination bool validation");

const combinationCapKey="infill_combination_max_layer_height";
for(const [input,expected] of [[0,"0"],["0%","0%"],["100%","100%"],[" 50.0% ","50%"],["0.20","0.2"],[2,"2"]])
  assert.deepEqual(parseTestProcessOverrides({[combinationCapKey]:input}),{[combinationCapKey]:expected});
for(const bad of [-1,2.01,"100.01%","-1%","0.2mm","50% G28",["50%"],null,true,NaN,Infinity,""])
  assert.throws(()=>parseTestProcessOverrides({[combinationCapKey]:bad}),/Invalid|safe test range/);
console.log("PASS: bounded native sparse combination cap preserves mm, percent and zero sentinel");

const bottomFlowKey="bottom_solid_infill_flow_ratio";
for(const [input,expected] of [[1,"1"],["0.75","0.75"],[0.1,"0.1"],[2,"2"]])
  assert.deepEqual(parseTestProcessOverrides({[bottomFlowKey]:input}),{[bottomFlowKey]:expected});
for(const bad of [0,-1,2.01,"75%",["1"],null,true,NaN,Infinity,"1 G28"])
  assert.throws(()=>parseTestProcessOverrides({[bottomFlowKey]:bad}),/Invalid|safe test range/);
console.log("PASS: independent bounded scalar bottom surface flow");
const topFlowKey="top_solid_infill_flow_ratio";
for(const [input,expected] of [["1","1"],[["0.75"],"0.75"],[0.1,"0.1"],[[2],"2"]])
  assert.deepEqual(parseTestProcessOverrides({[topFlowKey]:input}),{[topFlowKey]:[expected]});
for(const bad of [0,-1,2.01,"75%","nil",null,true,[],["1","0.75"],[null],["nil"],[["1"]],Array(1),"1,0.75","1 G28"])
  assert.throws(()=>parseTestProcessOverrides({[topFlowKey]:bad}),/Invalid|safe test range/);
assert.deepEqual(parseTestProcessOverrides({[topFlowKey]:["0.75"],[bottomFlowKey]:"1"}),
  {[topFlowKey]:["0.75"],[bottomFlowKey]:"1"});
console.log("PASS: explicit single-slot top surface vector, distinct from bottom scalar");

// Native classic thin-wall switch is a serialized bool, never a count.
for (const value of ["0","1"]) {
  assert.deepEqual(parseTestProcessOverrides({detect_thin_wall:value}),{detect_thin_wall:value});
}
for (const bad of [0,1,true,false,"true","2","1%",["1"],null]) {
  assert.throws(()=>parseTestProcessOverrides({detect_thin_wall:bad}),/native enum/);
}
console.log("PASS: explicit serialized thin-wall toggle only");

const wallOrders=["inner wall/outer wall","outer wall/inner wall","inner-outer-inner wall"];
for(const value of wallOrders)
  assert.deepEqual(parseTestProcessOverrides({wall_sequence:value}),{wall_sequence:value});
for(const bad of ["Inner/Outer","inner wall/outer wall/infill","outer wall/inner wall ","",0,true,null,["inner wall/outer wall"]])
  assert.throws(()=>parseTestProcessOverrides({wall_sequence:bad}),/native enum/);
console.log("PASS: exact pinned wall-order enum tokens only");

for(const key of ["only_one_wall_top","only_one_wall_first_layer"]){
  for(const value of ["0","1"])
    assert.deepEqual(parseTestProcessOverrides({[key]:value}),{[key]:value});
  for(const bad of [0,1,true,false,"true","2","1%",["1"],null])
    assert.throws(()=>parseTestProcessOverrides({[key]:bad}),/native enum/);
}
assert.deepEqual(parseTestProcessOverrides({only_one_wall_top:"1",only_one_wall_first_layer:"0"}),
  {only_one_wall_top:"1",only_one_wall_first_layer:"0"});
console.log("PASS: independent serialized single-wall surface toggles");

for(const seam of ["nearest","aligned","aligned_back","back","random"])
  assert.deepEqual(parseTestProcessOverrides({seam_position:seam}),{seam_position:seam});
for(const bad of ["Aligned","aligned back","back ","",0,true,null,["aligned"]])
  assert.throws(()=>parseTestProcessOverrides({seam_position:bad}),/native enum/);
console.log("PASS: exact pinned seam-position enum tokens only");
