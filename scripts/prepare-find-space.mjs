// Independent viewer-only XY AABB placement; not native Orca arrangement.
const EPS = 1e-8;
const valid = b => Array.isArray(b) && b.length === 4 &&
  b.every(v => Number.isFinite(v) && Math.abs(v) <= 1e7) &&
  b[2] > b[0] && b[3] > b[1];

// Search the boundary coordinates of the free configuration space. A closest
// feasible translation must be at the current coordinate or on such a boundary.
// All obstacles stay fixed, and neither rotation nor Z is changed.
export function findViewerSpace(own, obstacles, plate, gap = 5) {
  if (!valid(own) || !valid(plate) || !Array.isArray(obstacles) ||
      obstacles.length > 63 || !obstacles.every(valid) ||
      !Number.isFinite(gap) || gap < 0 || gap > 1000) {
    throw new RangeError("Invalid viewer placement bounds");
  }
  const w = own[2] - own[0], h = own[3] - own[1];
  const xmin = plate[0] + gap, xmax = plate[2] - gap - w;
  const ymin = plate[1] + gap, ymax = plate[3] - gap - h;
  if (xmin > xmax || ymin > ymax) return null;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const clear = (x, y) => !obstacles.some(b => x + w + gap > b[0] + EPS &&
      x < b[2] + gap - EPS && y + h + gap > b[1] + EPS &&
      y < b[3] + gap - EPS);
  // Zero displacement is globally optimal. Avoid the candidate grid entirely
  // for already-clear layouts (especially the all-object preflight).
  if (own[0] >= xmin && own[0] <= xmax && own[1] >= ymin && own[1] <= ymax &&
      clear(own[0], own[1])) return {dx: 0, dy: 0};
  const xs = new Set([xmin, xmax, clamp(own[0], xmin, xmax)]);
  const ys = new Set([ymin, ymax, clamp(own[1], ymin, ymax)]);
  for (const b of obstacles) {
    xs.add(clamp(b[0] - gap - w, xmin, xmax));
    xs.add(clamp(b[2] + gap, xmin, xmax));
    ys.add(clamp(b[1] - gap - h, ymin, ymax));
    ys.add(clamp(b[3] + gap, ymin, ymax));
  }
  let best = null, bestDistance = Infinity;
  for (const x of [...xs].sort((a,b) => a-b)) {
    for (const y of [...ys].sort((a,b) => a-b)) {
      if (!clear(x, y)) continue;
      const dx = x - own[0], dy = y - own[1];
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        best = {dx, dy};
        bestDistance = distance;
      }
    }
  }
  return best;
}

// Plan all moves without mutating inputs. Larger footprints first; ties use
// original order, with bounded alternative orders on failure. Not a complete packing search.
export function arrangeViewerSpaces(boxes, plate, gap = 5) {
  if (!Array.isArray(boxes) || boxes.length < 1 || boxes.length > 64 ||
      !boxes.every(valid) || !valid(plate) ||
      !Number.isFinite(gap) || gap < 0 || gap > 1000)
    throw new RangeError("Invalid viewer arrangement bounds");
  // An already-clear layout should never be unnecessarily rearranged.
  if (boxes.every((box, i) => {
    const move = findViewerSpace(box, boxes.filter((_, j) => i !== j), plate, gap);
    return move && Math.abs(move.dx) < EPS && Math.abs(move.dy) < EPS;
  })) return boxes.map(() => ({dx:0,dy:0}));
  const width = b => b[2]-b[0], height = b => b[3]-b[1];
  const area = b => width(b)*height(b);
  const indices = boxes.map((_, i) => i);
  const orders = [
    (a,b) => area(boxes[b])-area(boxes[a]) || a-b,
    (a,b) => width(boxes[b])-width(boxes[a]) || height(boxes[b])-height(boxes[a]) || a-b,
    (a,b) => height(boxes[b])-height(boxes[a]) || width(boxes[b])-width(boxes[a]) || a-b,
  ];
  const tried = new Set();
  // Preserve all previous attempts in order (unseeded, then lower-left).
  // Only after these fail, try the other three usable plate corners.
  // At most fifteen distinct attempts, each with fresh temporary placement.
  // Corner bits: bit 0 = right, bit 1 = upper; null = no seed.
  for (const seedCorner of [null, 0, 1, 2, 3]) {
    for (const compare of orders) {
      const order = [...indices].sort(compare);
      const key = String(seedCorner) + ":" + order.join(",");
      if (tried.has(key)) continue;
      tried.add(key);
      const placed = [], moves = Array(boxes.length);
      let failed = false;
      for (const i of order) {
        const box = boxes[i];
        let move;
        if (seedCorner !== null && placed.length === 0) {
          // Check fit using original bounds before translating; otherwise an
          // oversized valid input can overflow the validator's coordinate cap.
          if (plate[0] + gap > plate[2] - gap - width(box) ||
              plate[1] + gap > plate[3] - gap - height(box)) {
            failed = true; break;
          }
          const x = seedCorner & 1 ? plate[2] - gap - width(box) : plate[0] + gap;
          const y = seedCorner & 2 ? plate[3] - gap - height(box) : plate[1] + gap;
          move = {dx: x - box[0], dy: y - box[1]};
        } else {
          move = findViewerSpace(box, placed, plate, gap);
        }
        if (!move) { failed = true; break; }
        moves[i] = move;
        placed.push(box.map((v,j) => v + (j%2 ? move.dy : move.dx)));
      }
      if (!failed) return moves;
    }
  }
  return null;
}

// Explicit selected-object fallback only. A +90-degree world-Z rotation
// around the object's pivot maps the actual world AABB exactly (axis swap).
// Preserve the original orientation whenever a translation alone fits.
export function findViewerSpaceWithQuarterTurn(own, obstacles, plate, pivot, gap = 5) {
  const direct = findViewerSpace(own, obstacles, plate, gap);
  if (!Array.isArray(pivot) || pivot.length !== 2 ||
      !pivot.every(v => Number.isFinite(v) && Math.abs(v) <= 1e7))
    throw new RangeError("Invalid viewer rotation pivot");
  if (direct) return {...direct, quarterTurn: false};
  const [px, py] = pivot;
  const rotated = [px - (own[3] - py), py + (own[0] - px),
                   px - (own[1] - py), py + (own[2] - px)];
  if (!valid(rotated)) return null;
  const move = findViewerSpace(rotated, obstacles, plate, gap);
  return move ? {...move, quarterTurn: true} : null;
}

// Bounded independent AABB fallback: for at most six loose meshes, try each
// subset of +90-degree world-Z turns, preferring fewer rotated objects.
// Each orientation uses the existing greedy planner, so failure is not a proof
// of impossible packing. No input changes; offsets are relative to the rotated
// bounds and must be applied after rotating about the supplied world pivot.
export function arrangeViewerSpacesWithQuarterTurns(boxes, plate, pivots, gap = 5) {
  if (!Array.isArray(boxes) || boxes.length < 2 || boxes.length > 6 ||
      !Array.isArray(pivots) || pivots.length !== boxes.length ||
      !pivots.every(p => Array.isArray(p) && p.length === 2 &&
        p.every(v => Number.isFinite(v) && Math.abs(v) <= 1e7)))
    throw new RangeError("Invalid bounded viewer rotation arrangement");
  const direct = arrangeViewerSpaces(boxes, plate, gap);
  if (direct) return direct.map(move => ({...move, quarterTurn:false}));
  const rotated = boxes.map((box,i) => {
    const [px,py] = pivots[i];
    return [px-(box[3]-py),py+(box[0]-px),px-(box[1]-py),py+(box[2]-px)];
  });
  const count = mask => mask.toString(2).replace(/0/g,"").length;
  const masks = Array.from({length:(1<<boxes.length)-1},(_,i)=>i+1)
    .sort((a,b)=>count(a)-count(b)||a-b);
  for (const mask of masks) {
    const variant = boxes.map((box,i) => mask & (1<<i) ? rotated[i] : box);
    if (!variant.every(valid)) continue;
    const moves = arrangeViewerSpaces(variant, plate, gap);
    if (moves) return moves.map((move,i)=>({...move,quarterTurn:!!(mask & (1<<i))}));
  }
  return null;
}

// Bounded diagnostic only: the convex hull of world-XY vertices encloses the
// mesh projection. A separated pair of hulls rules out overlap in that plane;
// intersecting hulls do not prove mesh collision (concavities, holes, Z).
export function viewerProjectedHull(points) {
  if (!Array.isArray(points) || points.length < 3 || points.length > 50000 ||
      !points.every(p => Array.isArray(p) && p.length === 2 &&
        p.every(v => Number.isFinite(v) && Math.abs(v) <= 1e7))) return null;
  const sorted = [...points].sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
  const unique = sorted.filter((p,i)=>!i || p[0]!==sorted[i-1][0] || p[1]!==sorted[i-1][1]);
  const cross = (a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half = list => {
    const out=[];
    for (const p of list) {
      while (out.length>=2 && cross(out[out.length-2],out[out.length-1],p)<=0) out.pop();
      out.push(p);
    }
    return out;
  };
  const lower=half(unique), upper=half([...unique].reverse());
  const hull=lower.slice(0,-1).concat(upper.slice(0,-1));
  return hull.length>=3 && hull.length<=256 ? hull : null;
}

// Separating-axis test with normalized normals and conservative contact
// tolerance. Only use validated convex hulls returned by the above helper.
export function viewerHullsSeparated(a,b) {
  if (!a || !b) return null;
  const project = (h,nx,ny) => {
    let lo=Infinity, hi=-Infinity;
    for (const p of h) {
      const v=p[0]*nx+p[1]*ny;
      lo=Math.min(lo,v); hi=Math.max(hi,v);
    }
    return [lo,hi];
  };
  for (const h of [a,b]) {
    for (let i=0;i<h.length;i++) {
      const p=h[i], q=h[(i+1)%h.length];
      const dx=q[0]-p[0], dy=q[1]-p[1], len=Math.hypot(dx,dy);
      if (!(len>0)) return null;
      const nx=-dy/len, ny=dx/len;
      const [alo,ahi]=project(a,nx,ny), [blo,bhi]=project(b,nx,ny);
      if (blo-ahi>1e-6 || alo-bhi>1e-6) return true;
    }
  }
  return false;
}

// Selected-mesh fallback only: bounded grid of translations, with a
// conservative >= gap separating projection against every convex obstacle.
// A failed search is not proof that no polygon packing exists.
export function findViewerHullSpace(own, obstacles, plate, gap = 5) {
  if (!valid(plate) || !Number.isFinite(gap) || gap < 0 || gap > 1000 ||
      !Array.isArray(obstacles) || obstacles.length > 8) return null;
  const checked = [own,...obstacles].map(h => Array.isArray(h) && h.length <= 32 ? viewerProjectedHull(h) : null);
  if (checked.some(h=>!h)) return null;
  const [a,...others] = checked;
  const xs = a.map(p=>p[0]), ys = a.map(p=>p[1]);
  const loX=plate[0]+gap-Math.min(...xs), hiX=plate[2]-gap-Math.max(...xs);
  const loY=plate[1]+gap-Math.min(...ys), hiY=plate[3]-gap-Math.max(...ys);
  if (loX>hiX || loY>hiY) return null;
  const project = (h,nx,ny) => {
    const values=h.map(p=>p[0]*nx+p[1]*ny);
    return [Math.min(...values),Math.max(...values)];
  };
  const pairs = others.map(b => [a,b].flatMap(h=>h.map((p,i)=>{
    const q=h[(i+1)%h.length], len=Math.hypot(q[0]-p[0],q[1]-p[1]);
    const nx=(p[1]-q[1])/len, ny=(q[0]-p[0])/len;
    const [alo,ahi]=project(a,nx,ny), [blo,bhi]=project(b,nx,ny);
    return {nx,ny,left:blo-ahi,right:alo-bhi};
  })));
  // Precompute projections; only evaluate translation offsets in the grid.
  const clear = (dx,dy) => pairs.every(axes=>axes.some(({nx,ny,left,right})=>{
    const shift=dx*nx+dy*ny;
    return left-shift>gap+1e-6 || right+shift>gap+1e-6;
  }));
  const candidates=(lo,hi)=>[...new Set([Math.min(hi,Math.max(lo,0)),
    ...Array.from({length:9},(_,i)=>lo+(hi-lo)*i/8)])].sort((a,b)=>a-b);
  let best=null, distance=Infinity;
  for (const dx of candidates(loX,hiX)) for (const dy of candidates(loY,hiY)) {
    const d=dx*dx+dy*dy;
    if (d<distance && clear(dx,dy)) {best={dx,dy};distance=d;}
  }
  return best;
}
