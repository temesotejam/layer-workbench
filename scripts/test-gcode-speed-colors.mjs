import assert from "node:assert/strict";
import {COMMANDED_SPEED_BANDS,commandedSpeedBand,commandedSpeedLegend} from "./gcode-speed-colors.mjs";
const cases=[
  [null,"unknown"],[undefined,"unknown"],[0,"unknown"],[-30,"unknown"],
  [NaN,"unknown"],[Infinity,"unknown"],["120","unknown"],
  [60,"slow"],[600,"slow"],[600.01,"medium"],[1500,"medium"],
  [1500.01,"fast"],[3000,"fast"],[3000.01,"very-fast"],
  [6000,"very-fast"],[6000.01,"highest"],[12000,"highest"],
];
for(const [rate,id] of cases)
  assert.equal(commandedSpeedBand(rate).id,id,String(rate));
assert.equal(new Set(COMMANDED_SPEED_BANDS.map(b=>b.id)).size,COMMANDED_SPEED_BANDS.length);
assert.ok(COMMANDED_SPEED_BANDS.every(b=>/^#[0-9a-f]{6}$/.test(b.color)));
assert.match(commandedSpeedLegend(),/not measured/);
console.log("PASS: bounded modal G-code F speed palette, missing F and exact bucket boundaries");
