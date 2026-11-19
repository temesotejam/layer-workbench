// Development-only manifest transform adapter for one-slicer-api 0.7.0.
// This edits a project manifest, not a native 3MF file. Re-submitting it with
// setObjects replaces the session project and cannot retain imported opaque
// 3MF metadata. It must never be advertised as lossless project editing.
// A transform rewrite must not forward a structurally orphaned project as
// though it were a valid one-slicer-api 0.7.0 instance graph.
function validateAffineMatrix(matrix) {
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
}

function uniqueRecordIds(records, label) {
  if (!Array.isArray(records) || records.length < 1 || records.length > 64)
    throw new Error('Invalid or excessive project ' + label);
  const ids = new Set();
  for (const record of records) {
    const id = record?.id;
    if (typeof id !== 'string' || !id.trim() || id.length > 128 || ids.has(id))
      throw new Error('Malformed or duplicate project ' + label);
    ids.add(id);
  }
  return ids;
}

// The raw STL bytes are supplied separately to setObjects(). A manifest-only
// rewrite cannot prove the blob exists or decode it, but it can reject unsafe
// offsets/lengths before the edit is reported as a valid project. Passing the
// original blob length also checks that every explicit range fits that blob.
// Native readback may omit dataRange for an already-imported mesh; do not
// invent a range or silently pretend that such a mesh was validated.
function validateMeshRanges(meshes, blobByteLength) {
  if (blobByteLength !== undefined &&
      (!Number.isSafeInteger(blobByteLength) || blobByteLength < 1 ||
       blobByteLength > 80 * 1024 * 1024))
    throw new Error('Invalid or excessive project mesh blob length');
  for (const mesh of meshes) {
    if (!Object.hasOwn(mesh, 'dataRange')) continue;
    const range = mesh.dataRange;
    if (!range || !Number.isSafeInteger(range.offset) || range.offset < 0 ||
        !Number.isSafeInteger(range.length) || range.length < 1 ||
        !Number.isSafeInteger(range.offset + range.length))
      throw new Error('Malformed project mesh data range');
    if (blobByteLength !== undefined && range.offset + range.length > blobByteLength)
      throw new Error('Project mesh data range exceeds supplied blob');
  }
}

export function editManifestInstanceTransform(manifest, instanceId, matrix, meshBlobByteLength) {
  if (!manifest || manifest.schemaVersion !== '0.7.0')
    throw new Error('Invalid v0.7.0 project manifest');
  const meshIds = uniqueRecordIds(manifest.meshes, 'meshes');
  validateMeshRanges(manifest.meshes, meshBlobByteLength);
  const objectIds = uniqueRecordIds(manifest.objects, 'objects');
  const plateIds = uniqueRecordIds(manifest.plates, 'plates');
  const instanceIds = uniqueRecordIds(manifest.instances, 'instances');
  if (typeof instanceId !== 'string' || !instanceId || instanceId.length > 128)
    throw new Error('Invalid project instance ID');
  validateAffineMatrix(matrix);
  // Every object, including one with no current instance, must resolve to a
  // declared mesh. Otherwise setObjects may replace a valid project with an
  // incomplete native graph while this diagnostic edit reports success.
  for (const object of manifest.objects) {
    if (!meshIds.has(object.meshId))
      throw new Error('Orphaned project object mesh reference');
  }
  for (const instance of manifest.instances) {
    if (!objectIds.has(instance.objectId) || !plateIds.has(instance.plateId))
      throw new Error('Orphaned project instance object or plate reference');
    validateAffineMatrix(instance.transform?.matrix);
  }
  if (!instanceIds.has(instanceId)) throw new Error('Unknown project instance ID');
  // Preserve every sibling's object/plate association and its transform.
  // Editing an existing instance never invents a mesh, object or plate.
  const updated = structuredClone(manifest);
  const target = updated.instances.find(instance => instance.id === instanceId);
  target.transform.matrix = matrix.slice();
  return updated;
}
