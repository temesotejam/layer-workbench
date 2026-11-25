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
      if (obstacles.some(b => x + w + gap > b[0] + EPS &&
          x < b[2] + gap - EPS && y + h + gap > b[1] + EPS &&
          y < b[3] + gap - EPS)) continue;
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
// original order. This greedy pass is not a complete packing search.
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
  const area = b => (b[2]-b[0])*(b[3]-b[1]);
  const order = boxes.map((_, i) => i).sort((a,b) => area(boxes[b])-area(boxes[a]) || a-b);
  const placed = [], moves = Array(boxes.length);
  for (const i of order) {
    const box = boxes[i];
    const move = findViewerSpace(box, placed, plate, gap);
    if (!move) return null;
    moves[i] = move;
    placed.push(box.map((v,j) => v + (j%2 ? move.dy : move.dx)));
  }
  return moves;
}
