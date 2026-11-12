// Coordinate adapter between Three.js and one-slicer-api 0.7.0.
// Three.js stores matrices column-major; native manifest expects row-major.
// The browser plate is centered on (0,0), native plate is (bedX/2,bedY/2).
// Input is the original STL (not a re-exported/modified mesh).
const DEFAULT_BED = Object.freeze([256, 256]);

export function viewerMatrixToNative(elements, bed = DEFAULT_BED) {
  if (!Array.isArray(elements) && !(elements instanceof Float32Array) && !(elements instanceof Float64Array))
    throw new TypeError("Expected 16 Three.js column-major matrix elements");
  if (elements.length !== 16 || !Array.from(elements).every(Number.isFinite))
    throw new Error("Invalid model transformation matrix");
  if (!Array.isArray(bed) || bed.length !== 2 || !bed.every(v => Number.isFinite(v) && v > 0))
    throw new Error("Invalid build plate dimensions");
  // Transpose storage; do not transpose the geometric transform.
  const matrix = Array.from({length:16},(_,index) => elements[(index%4)*4 + Math.floor(index/4)]);
  // Native origin is lower-left corner; browser origin is plate center.
  matrix[3] += bed[0] / 2;
  matrix[7] += bed[1] / 2;
  // Affine-only guard. Avoid silently passing perspective/projective matrices.
  if (Math.abs(matrix[12]) > 1e-8 || Math.abs(matrix[13]) > 1e-8 ||
      Math.abs(matrix[14]) > 1e-8 || Math.abs(matrix[15] - 1) > 1e-8)
    throw new Error("Only affine model transforms are supported");
  // Degenerate models cannot be sliced accurately.
  const a=matrix;
  const det = a[0]*(a[5]*a[10]-a[6]*a[9]) -
              a[1]*(a[4]*a[10]-a[6]*a[8]) +
              a[2]*(a[4]*a[9]-a[5]*a[8]);
  if (!Number.isFinite(det) || Math.abs(det)<1e-8)
    throw new Error("Model transform is singular or nearly singular");
  return matrix;
}

export function nativePoint(matrix, point) {
  const [x,y,z]=point;
  return [
    matrix[0]*x+matrix[1]*y+matrix[2]*z+matrix[3],
    matrix[4]*x+matrix[5]*y+matrix[6]*z+matrix[7],
    matrix[8]*x+matrix[9]*y+matrix[10]*z+matrix[11],
  ];
}
