// Development-only manifest transform adapter for one-slicer-api 0.7.0.
// This edits a project manifest, not a native 3MF file. Re-submitting it with
// setObjects replaces the session project and cannot retain imported opaque
// 3MF metadata. It must never be advertised as lossless project editing.
export function editManifestInstanceTransform(manifest, instanceId, matrix) {
  if (!manifest || manifest.schemaVersion !== '0.7.0' ||
      !Array.isArray(manifest.instances) ||
      manifest.instances.length < 1 || manifest.instances.length > 64)
    throw new Error('Invalid or excessive v0.7.0 project instances');
  if (typeof instanceId !== 'string' || !instanceId || instanceId.length > 128)
    throw new Error('Invalid project instance ID');
  if (!Array.isArray(matrix) || matrix.length !== 16 ||
      !matrix.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000))
    throw new Error('Invalid or excessive affine instance matrix');
  if (Math.max(Math.abs(matrix[12]), Math.abs(matrix[13]),
      Math.abs(matrix[14]), Math.abs(matrix[15] - 1)) > 1e-8)
    throw new Error('Non-affine project transform is unsupported');
  const determinant = matrix[0] * (matrix[5] * matrix[10] - matrix[6] * matrix[9]) -
    matrix[1] * (matrix[4] * matrix[10] - matrix[6] * matrix[8]) +
    matrix[2] * (matrix[4] * matrix[9] - matrix[5] * matrix[8]);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8)
    throw new Error('Singular project transform is unsupported');
  const ids = new Set();
  for (const instance of manifest.instances) {
    if (!instance || typeof instance.id !== 'string' || !instance.id ||
        ids.has(instance.id) || !Array.isArray(instance.transform?.matrix))
      throw new Error('Malformed or duplicate project instance');
    ids.add(instance.id);
  }
  if (!ids.has(instanceId)) throw new Error('Unknown project instance ID');
  // Preserve every sibling's object/plate association and its transform.
  const updated = structuredClone(manifest);
  const target = updated.instances.find(instance => instance.id === instanceId);
  target.transform.matrix = matrix.slice();
  return updated;
}
