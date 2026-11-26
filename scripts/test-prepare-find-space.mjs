import test from "node:test";
import assert from "node:assert/strict";
import { findViewerSpace, arrangeViewerSpaces, findViewerSpaceWithQuarterTurn, arrangeViewerSpacesWithQuarterTurns, viewerProjectedHull, viewerHullsSeparated, findViewerHullSpace, arrangeViewerHullSpaces, findViewerHullSpaceWithQuarterTurn } from "./prepare-find-space.mjs";

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

// Every old sort order is identical for equal rectangles. Keeping the first
// footprint centered blocks both sides even though a corner-seeded pack fits.
test("corner-seeded fallback fits two equal tall rectangles", () => {
  const boxes = [[30,10,70,90],[30,10,70,90]];
  const original = structuredClone(boxes);
  assert.deepEqual(findViewerSpace(boxes[0],[],plate,gap),{dx:0,dy:0});
  assert.equal(findViewerSpace(boxes[1],[boxes[0]],plate,gap),null);
  const moves = arrangeViewerSpaces(boxes,plate,gap);
  assert.deepEqual(moves,[{dx:-25,dy:-5},{dx:20,dy:0}]);
  assertLayout(boxes,moves);
  assert.deepEqual(boxes,original);
  assert.deepEqual(arrangeViewerSpaces(boxes,plate,gap),moves);
});

test("corner seed also fits transposed rectangles on a translated bed", () => {
  const target = [-50,-50,50,50];
  const boxes = [[-40,-20,40,20],[-40,-20,40,20]];
  assert.equal(findViewerSpace(boxes[1],[boxes[0]],target,gap),null);
  const moves = arrangeViewerSpaces(boxes,target,gap);
  assert.deepEqual(moves,[{dx:-5,dy:-25},{dx:0,dy:20}]);
  assertLayout(boxes,moves,target);
  const placed = boxes.map((b,i)=>b.map((v,j)=>v+(j%2?moves[i].dy:moves[i].dx)));
  assert.deepEqual(arrangeViewerSpaces(placed,target,gap),[{dx:0,dy:0},{dx:0,dy:0}]);
});

test("oversized but valid footprints return null, including at coordinate cap", () => {
  const boxes = [[-1e7,-1,1e7,1],[40,40,60,60]];
  const original = structuredClone(boxes);
  assert.equal(arrangeViewerSpaces(boxes,plate,gap),null);
  assert.deepEqual(boxes,original);
});

test("remaining three corner seeds recover otherwise blocked arrangements", () => {
  const cases = [
    {boxes:[[10,75,70,85],[50,15,75,70],[40,25,60,60],[50,15,75,75]],
      expected:[{dx:0,dy:0},{dx:-10,dy:0},{dx:-25,dy:0},{dx:20,dy:-10}]},
    {boxes:[[20,45,75,95],[15,75,60,85],[25,15,50,90],[80,20,95,55]],
      expected:[{dx:15,dy:0},{dx:0,dy:-70},{dx:-20,dy:5},{dx:0,dy:-15}]},
    {boxes:[[5,60,15,95],[35,25,75,85],[30,60,95,85],[35,50,80,95]],
      expected:[{dx:0,dy:-50},{dx:20,dy:10},{dx:0,dy:-55},{dx:-30,dy:0}]},
  ];
  for (const {boxes,expected} of cases) {
    // Each fixture also exercises translated plate coordinates.
    for (const [tx,ty] of [[0,0],[-143,57]]) {
      const shift = b => b.map((v,j)=>v+(j%2?ty:tx));
      const input = boxes.map(shift), target = shift(plate);
      const original = structuredClone(input);
      const moves = arrangeViewerSpaces(input,target,gap);
      assert.deepEqual(moves,expected);
      assertLayout(input,moves,target);
      assert.deepEqual(input,original);
      const placed = input.map((b,i)=>b.map((v,j)=>v+(j%2?moves[i].dy:moves[i].dx)));
      assert.deepEqual(arrangeViewerSpaces(placed,target,gap),input.map(()=>({dx:0,dy:0})));
    }
  }
});

// A fixed full-height obstacle leaves a narrow vertical strip. The chosen
// mesh must rotate about its actual origin, not its bounding-box center.
test("explicit quarter-turn fallback fits a narrow strip", () => {
  const own=[20,30,80,50], obstacles=[[5,5,55,95]], pivot=[20,30];
  const input=structuredClone([own,obstacles,pivot]);
  assert.equal(findViewerSpace(own,obstacles,plate,gap),null);
  const result=findViewerSpaceWithQuarterTurn(own,obstacles,plate,pivot,gap);
  assert.deepEqual(result,{dx:60,dy:0,quarterTurn:true});
  assertLayout([[0,30,20,90],...obstacles],[result,{dx:0,dy:0}]);
  assert.deepEqual([own,obstacles,pivot],input);
});
test("quarter-turn fallback preserves feasible orientations and rejects blocked or invalid input", () => {
  const own=[20,30,80,50], pivot=[20,30];
  assert.deepEqual(findViewerSpaceWithQuarterTurn(own,[],plate,pivot,gap),
    {dx:0,dy:0,quarterTurn:false});
  assert.equal(findViewerSpaceWithQuarterTurn(own,[plate],plate,pivot,gap),null);
  assert.throws(()=>findViewerSpaceWithQuarterTurn(own,[],plate,[NaN,0],gap),RangeError);
});

test("batch quarter turns recover perpendicular footprints and preserve input", () => {
  const boxes=[[10,30,90,70],[30,10,70,90]], pivots=[[10,30],[30,10]];
  const original=structuredClone([boxes,pivots]);
  assert.equal(arrangeViewerSpaces(boxes,plate,gap),null);
  const moves=arrangeViewerSpacesWithQuarterTurns(boxes,plate,pivots,gap);
  assert.ok(moves);
  assert.deepEqual(moves.map(m=>m.quarterTurn),[true,false]);
  assertLayout([[-30,30,10,110],boxes[1]],moves);
  assert.deepEqual([boxes,pivots],original);
  assert.deepEqual(arrangeViewerSpacesWithQuarterTurns(boxes,plate,pivots,gap),moves);
});
test("batch rotation preserves ordinary plans and rejects blocked or invalid requests", () => {
  const boxes=[[30,10,70,90],[30,10,70,90]], pivots=[[30,10],[30,10]];
  const expected=arrangeViewerSpaces(boxes,plate,gap).map(m=>({...m,quarterTurn:false}));
  assert.deepEqual(arrangeViewerSpacesWithQuarterTurns(boxes,plate,pivots,gap),expected);
  const blocked=Array(3).fill([10,10,90,90]);
  assert.equal(arrangeViewerSpacesWithQuarterTurns(blocked,plate,Array(3).fill([50,50]),gap),null);
  assert.throws(()=>arrangeViewerSpacesWithQuarterTurns(boxes,plate,[[NaN,0],[0,0]]),RangeError);
  assert.throws(()=>arrangeViewerSpacesWithQuarterTurns(Array(7).fill(boxes[0]),plate,Array(7).fill(pivots[0])),RangeError);
});

test("projected hull separates overlapping AABBs without changing input", () => {
  const a=[[0,0],[4,0],[0,4],[1,1],[0,0]], b=[[4,4],[4,1],[1,4]];
  const original=structuredClone([a,b]);
  const ha=viewerProjectedHull(a), hb=viewerProjectedHull(b);
  assert.equal(ha.length,3);
  assert.equal(viewerHullsSeparated(ha,hb),true);
  assert.equal(viewerHullsSeparated(hb,ha),true);
  assert.deepEqual([a,b],original);
  const shift=p=>p.map(([x,y])=>[x-128,y+25]);
  assert.equal(viewerHullsSeparated(viewerProjectedHull(shift(a)),viewerProjectedHull(shift(b))),true);
});
test("projected hull keeps overlap, containment and contact as candidates", () => {
  const h=viewerProjectedHull([[0,0],[4,0],[0,4]]);
  for (const pts of [[[0,0],[1,0],[0,1]],[[1,1],[5,1],[1,5]],[[4,0],[5,0],[4,1]],[[4+1e-8,0],[5,0],[5,1]]])
    assert.equal(viewerHullsSeparated(h,viewerProjectedHull(pts)),false);
});
test("projected hull refuses degenerate, malformed and over-budget geometry", () => {
  for (const pts of [[[0,0],[1,1],[2,2]],[[0,0],[0,1],[NaN,2]],Array(50001).fill([0,0]),Array.from({length:257},(_,i)=>[Math.cos(i*2*Math.PI/257),Math.sin(i*2*Math.PI/257)])])
    assert.equal(viewerProjectedHull(pts),null);
  assert.equal(viewerHullsSeparated(null,viewerProjectedHull([[0,0],[1,0],[0,1]])),null);
});

test("hull fallback fits opposing triangles that cannot fit by AABB", () => {
  const target=[-128,-128,128,128], a=[[-100,-100],[100,-100],[-100,100]], b=[[100,100],[-100,100],[100,-100]];
  const before=structuredClone([a,b]);
  assert.equal(findViewerSpace([-100,-100,100,100],[[-100,-100,100,100]],target),null);
  const move=findViewerHullSpace(a,[b],target);
  assert.ok(move);
  assert.ok(-(move.dx+move.dy)/Math.sqrt(2)>5);
  assert.ok(a.every(([x,y])=>Math.abs(x+move.dx)<=123 && Math.abs(y+move.dy)<=123));
  const moved=a.map(([x,y])=>[x+move.dx,y+move.dy]);
  assert.deepEqual(findViewerHullSpace(moved,[b],target),{dx:0,dy:0});
  assert.deepEqual([a,b],before);
  assert.deepEqual(findViewerHullSpace(a,[b],target),move);
});
test("hull fallback refuses blocked, degenerate, over-budget or oversized inputs", () => {
  const a=[[0,0],[90,0],[90,90],[0,90]];
  assert.equal(findViewerHullSpace(a,[a],plate),null);
  assert.equal(findViewerHullSpace(a,[[[0,0],[0,0],[1,1]]],plate),null);
  assert.equal(findViewerHullSpace(a,Array(9).fill(a),plate),null);
  assert.equal(findViewerHullSpace(Array(33).fill([0,0]),[],plate),null);
  assert.equal(findViewerHullSpace(a,[],[0,0,50,50]),null);
});


test("batch convex hull fallback fits opposing triangles, preserves input and is idempotent", () => {
  const target=[-128,-128,128,128];
  const shapes=[[[-100,-100],[100,-100],[-100,100]],[[100,100],[-100,100],[100,-100]]];
  for (const [tx,ty] of [[0,0],[-70,42]]) {
    const input=shapes.map(h=>h.map(([x,y])=>[x+tx,y+ty]));
    const bed=target.map((v,j)=>v+(j%2?ty:tx));
    const original=structuredClone(input);
    assert.equal(arrangeViewerSpaces(Array(2).fill([-100+tx,-100+ty,100+tx,100+ty]),bed),null);
    const moves=arrangeViewerHullSpaces(input,bed);
    assert.ok(moves);
    assert.ok((moves[1].dx+moves[1].dy-moves[0].dx-moves[0].dy)/Math.sqrt(2)>5);
    const placed=input.map((h,i)=>h.map(([x,y])=>[x+moves[i].dx,y+moves[i].dy]));
    assert.ok(placed.flat().every(([x,y])=>x>=bed[0]+5-1e-8&&x<=bed[2]-5+1e-8&&y>=bed[1]+5-1e-8&&y<=bed[3]-5+1e-8));
    assert.deepEqual(arrangeViewerHullSpaces(placed,bed),[{dx:0,dy:0},{dx:0,dy:0}]);
    assert.deepEqual(arrangeViewerHullSpaces(input,bed),moves);
    assert.deepEqual(input,original);
  }
});
test("batch hull fallback refuses impossible and unsupported input without changes", () => {
  const a=[[5,5],[95,5],[95,95],[5,95]], input=[a,a];
  const before=structuredClone(input);
  assert.equal(arrangeViewerHullSpaces(input,plate),null);
  assert.deepEqual(input,before);
  assert.equal(arrangeViewerHullSpaces([a,null],plate),null);
  assert.equal(arrangeViewerHullSpaces(Array(7).fill(a),plate),null);
  assert.equal(arrangeViewerHullSpaces([a,[[0,0],[1,1],[2,2]]],plate),null);
});

test("selected hull quarter turn fits where AABB and translation fail, about a translated pivot", () => {
  for (const [px,py] of [[0,0],[31,-47]]) {
    const fixed=[[100,100],[-100,100],[100,-100]].map(([x,y])=>[x+px,y+py]);
    const own=[[-100,100],[-100,-100],[100,100]].map(([x,y])=>[x+px,y+py]);
    const bed=[-128+px,-128+py,128+px,128+py];
    const box=[-100+px,-100+py,100+px,100+py];
    const before=structuredClone([own,fixed]);
    assert.equal(findViewerSpaceWithQuarterTurn(box,[box],bed,[px,py]),null);
    assert.equal(findViewerHullSpace(own,[fixed],bed),null);
    const m=findViewerHullSpaceWithQuarterTurn(own,[fixed],bed,[px,py]);
    assert.equal(m?.quarterTurn,true);
    const placed=own.map(([x,y])=>[px-(y-py)+m.dx,py+(x-px)+m.dy]);
    assert.ok(placed.every(([x,y])=>x>=bed[0]+5-1e-8&&x<=bed[2]-5+1e-8&&y>=bed[1]+5-1e-8&&y<=bed[3]-5+1e-8));
    assert.ok(-(m.dx+m.dy)/Math.sqrt(2)>5);
    assert.deepEqual(findViewerHullSpaceWithQuarterTurn(placed,[fixed],bed,[px+m.dx,py+m.dy]),{dx:0,dy:0,quarterTurn:false});
    assert.deepEqual([own,fixed],before);
    assert.equal(findViewerHullSpaceWithQuarterTurn(own,[null],bed,[px,py]),null);
    assert.equal(findViewerHullSpaceWithQuarterTurn(own,[fixed],bed,[NaN,py]),null);
    assert.equal(findViewerHullSpaceWithQuarterTurn(own,[fixed],[0,0,50,50],[px,py]),null);
  }
});
