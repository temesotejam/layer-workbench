// Read-only diagnostic for a locally selected 3MF in the isolated Prepare lab.
// It does not change the imported browser model, the native project, or the ZIP.
// Native manifest counts are NOT proof of desktop 3MF compatibility or parity.
import {auditNative3mfRelations} from './audit-native-3mf-relations.mjs';
import {auditNative3mfAnchorSpacing} from './audit-native-3mf-anchor-spacing.mjs';
export const MAX_INSPECT_3MF_BYTES = 8 * 1024 * 1024;

export async function inspectNative3mf(engine, file, {viewerAnchors=null}={}) {
  if (!engine || typeof engine.createSession !== 'function')
    throw new Error('A compatible local WASM engine is required.');
  if (!file || !/\.3mf$/i.test(file.name ?? '') || !Number.isSafeInteger(file.size) ||
      file.size < 4 || file.size > MAX_INSPECT_3MF_BYTES)
    throw new Error('Choose one 3MF archive of at most 8 MiB for native inspection.');

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || bytes[0] !== 0x50 || bytes[1] !== 0x4b ||
      bytes[2] !== 0x03 || bytes[3] !== 0x04)
    throw new Error('Selected 3MF has an invalid ZIP signature or byte length.');

  const session = await engine.createSession();
  if (!session || typeof session.initProfile !== 'function' ||
      typeof session.getManifest !== 'function' || typeof session.dispose !== 'function')
    throw new Error('The engine does not expose the required native project API.');
  try {
    await session.initProfile('project.3mf', bytes);
    const manifest = await session.getManifest();
    if (manifest?.schemaVersion !== '0.7.0')
      throw new Error('Unsupported native manifest schema.');
    const limits = {plates:64, meshes:256, objects:256, instances:256};
    const counts = {};
    for (const [name, limit] of Object.entries(limits)) {
      const items = manifest[name];
      if (!Array.isArray(items) || items.length > limit ||
          (name !== 'plates' && items.length === 0))
        throw new Error('Native ' + name + ' manifest is empty, malformed, or exceeds the diagnostic limit.');
      counts[name] = items.length;
    }
    // Do not return arbitrary manifest metadata, paths, profiles, or user IDs.
    return Object.freeze({...counts, archiveBytes: bytes.byteLength, schemaVersion:'0.7.0',
      relations:auditNative3mfRelations(manifest),
      placement:auditNative3mfAnchorSpacing(manifest.instances,viewerAnchors)});
  } finally {
    await session.dispose();
  }
}
