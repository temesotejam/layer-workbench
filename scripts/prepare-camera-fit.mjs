// Independent browser camera directions in the Z-up build-plate frame.
// The 3D offset is not unit length.
export function prepareViewOrientation(mode) {
  switch (mode) {
    case "3d": return {offset:[0.78,-1,0.72], up:[0,0,1]};
    case "top": return {offset:[0,0,1], up:[0,1,0]};
    case "front": return {offset:[0,-1,0], up:[0,0,1]};
    case "rear": return {offset:[0,1,0], up:[0,0,1]};
    case "left": return {offset:[-1,0,0], up:[0,0,1]};
    case "right": return {offset:[1,0,0], up:[0,0,1]};
    default: throw new RangeError("Unknown view");
  }
}
export function perspectiveFitDistance(size, mode, fovDegrees, aspect) {
  const {x, y, z} = size;
  if (![x,y,z].every(v => Number.isFinite(v) && v >= 0) ||
      !Number.isFinite(aspect) || aspect <= 0 ||
      !Number.isFinite(fovDegrees) || fovDegrees <= 0 || fovDegrees >= 180)
    throw new RangeError("Invalid camera fit bounds or projection");
  const tanY = Math.tan(fovDegrees * Math.PI / 360);
  const tanX = tanY * aspect;
  const margin = 1.25;
  if (mode === "3d") {
    // The enclosing sphere fits in either frustum axis.
    const radius = Math.hypot(x,y,z) / 2;
    const halfAngle = Math.atan(Math.min(tanX,tanY));
    return Math.max(260, Math.max(x,y,z,1)*2.35,
      margin * radius / Math.sin(halfAngle) / Math.hypot(0.78,1,0.72));
  }
  prepareViewOrientation(mode); // Reject unknown directions.
  const side = mode === "left" || mode === "right";
  const width = side ? y : x;
  const height = mode === "top" ? y : z;
  const depth = mode === "top" ? z : side ? x : y;
  // Closest face, not the center, limits a perspective fit.
  return Math.max(120, depth / 2 + Math.max(1,
    margin * width / (2*tanX), margin * height / (2*tanY)));
}
