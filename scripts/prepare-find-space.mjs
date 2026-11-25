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
