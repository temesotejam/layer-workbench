import test from "node:test";
import assert from "node:assert/strict";
import { findViewerSpace, arrangeViewerSpaces } from "./prepare-find-space.mjs";

const plate = [0, 0, 100, 100];
const gap = 5;
function assertLayout(boxes, moves, target=plate) {
  assert.equal(moves.length, boxes.length);
  const placed = boxes.map((box,i) => box.map((v,j) => v + (j%2 ? moves[i].dy : moves[i].dx)));
  for (let i=0;i<placed.length;i++) {
    const a=placed[i];
    assert.ok(a[0]>=target[0]+gap-1e-8 && a[1]>=target[1]+gap-1e-8 &&
              a[2]<=target[2]-gap+1e-8 && a[3]<=target[3]-gap+1e-8);
    for (const b of placed.slice(0,i))
      assert.ok(a[2]+gap<=b[0]+1e-8 || b[2]+gap<=a[0]+1e-8 ||
                a[3]+gap<=b[1]+1e-8 || b[3]+gap<=a[1]+1e-8);
  }
}

test("width-first fallback recovers a layout that area-first cannot pack", () => {
  const boxes = [[40,32.5,60,67.5],[37.5,10,62.5,90],[35,27.5,65,72.5]];
  const original = structuredClone(boxes);
  // Reproduce the area-first failure with the same primitive.
  assert.deepEqual(findViewerSpace(boxes[1],[],plate,gap),{dx:0,dy:0});
  // The tall, centered first rectangle leaves neither side wide enough
  // for the second rectangle; the first attempt fails before item three.
  assert.equal(findViewerSpace(boxes[2],[boxes[1]],plate,gap),null);
  const moves=arrangeViewerSpaces(boxes,plate,gap);
  assert.deepEqual(moves,[{dx:30,dy:0},{dx:-32.5,dy:0},{dx:0,dy:0}]);
  assertLayout(boxes,moves);
  assert.deepEqual(boxes,original);
  assert.deepEqual(arrangeViewerSpaces(boxes,plate,gap),moves);
});

test("transposed fixture exercises the height-first fallback", () => {
  const boxes = [[40,32.5,60,67.5],[37.5,10,62.5,90],[35,27.5,65,72.5]]
    .map(([x,y,X,Y])=>[y,x,Y,X]);
  assert.deepEqual(findViewerSpace(boxes[1],[],plate,gap),{dx:0,dy:0});
  assert.equal(findViewerSpace(boxes[2],[boxes[1]],plate,gap),null);
  const moves=arrangeViewerSpaces(boxes,plate,gap);
  assert.deepEqual(moves,[{dx:0,dy:30},{dx:0,dy:-32.5},{dx:0,dy:0}]);
  assertLayout(boxes,moves);
  assert.deepEqual(arrangeViewerSpaces(boxes,plate,gap),moves);
});

test("area-first remains preferred and clear layouts remain unchanged", () => {
  const boxes=[[40,40,60,60],[40,40,60,60]];
  const moves=arrangeViewerSpaces(boxes,plate,gap);
  assert.deepEqual(moves,[{dx:0,dy:0},{dx:-25,dy:0}]);
  assertLayout(boxes,moves);
  const clear=boxes.map((b,i)=>b.map((v,j)=>v+(j%2?moves[i].dy:moves[i].dx)));
  assert.deepEqual(arrangeViewerSpaces(clear,plate,gap),[{dx:0,dy:0},{dx:0,dy:0}]);
});

test("64 clear objects preserve exact gap and zero moves", () => {
  const boxes=Array.from({length:64},(_,i)=>{
    const x=5+(i%8)*10, y=5+Math.floor(i/8)*10;
    return [x,y,x+5,y+5];
  });
  const moves=arrangeViewerSpaces(boxes,plate,gap);
  assert.deepEqual(moves,boxes.map(()=>({dx:0,dy:0})));
  assertLayout(boxes,moves);
});

test("impossible and invalid plans fail without mutating inputs", () => {
  const boxes=[[5,5,85,85],[5,5,85,85]];
  const original=structuredClone(boxes);
  assert.equal(arrangeViewerSpaces(boxes,plate,gap),null);
  assert.deepEqual(boxes,original);
  assert.throws(()=>arrangeViewerSpaces([[0,0,0,1]],plate,gap),RangeError);
  assert.throws(()=>arrangeViewerSpaces(Array(65).fill([0,0,1,1]),plate,gap),RangeError);
});
