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
