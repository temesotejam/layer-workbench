import assert from "node:assert/strict";
import {findOrcaVariantIndex,resolveOrcaFilamentVariantSlot} from "./orca-variant-slot-resolver.mjs";
const variants=["Direct Drive Standard","Direct Drive High Flow","Direct Drive Standard","Direct Drive High Flow"];
const ids=[1,1,2,2];
assert.equal(findOrcaVariantIndex("Direct Drive Standard",1,variants,ids),0);
assert.equal(findOrcaVariantIndex("Direct Drive High Flow",1,variants,ids),1);
assert.equal(findOrcaVariantIndex("Direct Drive Standard",2,variants,ids),2);
assert.equal(findOrcaVariantIndex("Direct Drive High Flow",2,variants,ids),3);
assert.equal(findOrcaVariantIndex("Bowden Standard",1,variants,ids),0);
assert.equal(findOrcaVariantIndex("Bowden Standard",2,variants,ids),2);
assert.equal(findOrcaVariantIndex("Direct Drive Standard",3,variants,ids),0);
assert.equal(findOrcaVariantIndex("Direct Drive Standard",1,[],[]),0);
const mixed=["Direct Drive Standard","Direct Drive High Flow","Direct Drive Standard"];
const mixedIds=[1,1,2];
assert.equal(findOrcaVariantIndex("Direct Drive High Flow",1,mixed,mixedIds),1);
assert.equal(findOrcaVariantIndex("Direct Drive High Flow",2,mixed,mixedIds),2);
const slot=resolveOrcaFilamentVariantSlot({extruderId:2,extruderType:"Direct Drive",
  nozzleVolumeType:"High Flow",filamentVariants:variants,filamentVariantIds:ids});
assert.deepEqual({variant:slot.variant,index:slot.index,extruderId:slot.extruderId},
  {variant:"Direct Drive High Flow",index:3,extruderId:2});
assert.equal(slot.usableForPrinting,false);
assert.throws(()=>resolveOrcaFilamentVariantSlot({extruderId:1,extruderType:"Direct Drive",
  nozzleVolumeType:"Hybrid",filamentVariants:variants,filamentVariantIds:ids}),/Hybrid/);
assert.throws(()=>findOrcaVariantIndex("x",0,variants,ids),/1-based/);
assert.throws(()=>findOrcaVariantIndex("x",1,["x"],[0]),/variant ID/);
assert.throws(()=>findOrcaVariantIndex("x",1,Array(1),[1]),/variant entry/);
console.log("PASS: native variant slot cases from pinned Orca v2.5.0 C++ tests");
