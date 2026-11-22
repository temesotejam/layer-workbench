// Bounded ZIP envelope preflight for untrusted 3MF inspection on isolated localhost.
// Checks central/local directory coherence before passing a compressed file to
// native WASM. This does NOT decompress, verify CRCs, validate 3MF XML, or
// guarantee that a compliant archive cannot trigger a native parser defect.
// Deliberately reject ZIP64, split archives, encryption and exotic methods.
export const MAX_3MF_ZIP_MEMBERS = 512;
export const MAX_3MF_ZIP_EXPANDED_BYTES = 128 * 1024 * 1024;
const MAX_MEMBER = 64 * 1024 * 1024;
const fail = () => { throw new Error('Unsupported or unsafe 3MF ZIP envelope.'); };

export function preflight3mfZip(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 22 || bytes.length > 8 * 1024 * 1024) fail();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = offset => v.getUint16(offset, true);
  const u32 = offset => v.getUint32(offset, true);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.length) {
      end = i;
      break;
    }
  }
  if (end < 0 || u16(end + 4) !== 0 || u16(end + 6) !== 0 ||
      u16(end + 8) !== u16(end + 10)) fail();
  const count = u16(end + 10);
  const directorySize = u32(end + 12);
  const directoryStart = u32(end + 16);
  if (!count || count > MAX_3MF_ZIP_MEMBERS || directorySize === 0xffffffff ||
      directoryStart === 0xffffffff || directoryStart + directorySize !== end) fail();
  const decoder = new TextDecoder('utf-8', {fatal:true});
  // Unicode Path (0x7075) can change the effective filename in ZIP readers.
  // ZIP64 (0x0001) can change size/offset interpretation. Fail closed rather
  // than disagreeing with the native parser about an archive member.
  const inspectExtra = (start, size) => {
    const limit = start + size;
    if (limit > bytes.length) fail();
    for (let pos = start; pos < limit;) {
      if (pos + 4 > limit) fail();
      const type = u16(pos), length = u16(pos + 2);
      pos += 4;
      if (pos + length > limit || type === 0x7075 || type === 0x0001) fail();
      pos += length;
    }
  };
  const seen = new Set();
  const localRanges = [];
  let offset = directoryStart;
  let expanded = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || u32(offset) !== 0x02014b50) fail();
    const flags = u16(offset + 8);
    const method = u16(offset + 10);
    const crc = u32(offset + 16);
    const compressed = u32(offset + 20);
    const uncompressed = u32(offset + 24);
    const nameSize = u16(offset + 28);
    const extraSize = u16(offset + 30);
    const commentSize = u16(offset + 32);
    const externalAttributes = u32(offset + 38);
    const local = u32(offset + 42);
    const length = 46 + nameSize + extraSize + commentSize;
    if (offset + length > end || !nameSize || u16(offset + 34) !== 0 ||
        compressed === 0xffffffff || uncompressed === 0xffffffff ||
        local === 0xffffffff || (flags & ~(method === 8 ? 0x080e : 0x0808)) !== 0 ||
        (method !== 0 && method !== 8) || compressed > bytes.length ||
        uncompressed > MAX_MEMBER || (uncompressed && !compressed) ||
        (method === 0 && compressed !== uncompressed) ||
        ((externalAttributes >>> 16) & 0o170000) === 0o120000) fail();
    inspectExtra(offset + 46 + nameSize, extraSize);
    let name;
    try { name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameSize)); }
    catch { fail(); }
    // Reject traversal, drive/absolute paths, backslashes, NUL, duplicates and
    // noncanonical separators; never expose member names in diagnostics.
    if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0') ||
        name.includes(':') || name.split('/').some(part => part === '.' || part === '..') ||
        name.includes('//') || seen.has(name.toLowerCase())) fail();
    seen.add(name.toLowerCase());
    if (local + 30 > directoryStart || u32(local) !== 0x04034b50 ||
        u16(local + 6) !== flags || u16(local + 8) !== method) fail();
    const localNameSize = u16(local + 26);
    const localExtraSize = u16(local + 28);
    const dataStart = local + 30 + localNameSize + localExtraSize;
    if (localNameSize !== nameSize || dataStart + compressed > directoryStart) fail();
    inspectExtra(local + 30 + localNameSize, localExtraSize);
    for (let j = 0; j < nameSize; j++) {
      if (bytes[local + 30 + j] !== bytes[offset + 46 + j]) fail();
    }
    const dataEnd = dataStart + compressed;
    const usesDescriptor = (flags & 0x0008) !== 0;
    const localCrc = u32(local + 14);
    const localCompressed = u32(local + 18);
    const localUncompressed = u32(local + 22);
    // Without a descriptor, local and central headers must agree on CRC and
    // lengths. Otherwise two ZIP readers can interpret different boundaries.
    if (!usesDescriptor && (localCrc !== crc || localCompressed !== compressed ||
        localUncompressed !== uncompressed)) fail();
    // Streaming ZIP writers may use zero placeholders with flag bit 3, but
    // populated local values must still agree with the central directory.
    if (usesDescriptor && ((localCrc !== 0 && localCrc !== crc) ||
        (localCompressed !== 0 && localCompressed !== compressed) ||
        (localUncompressed !== 0 && localUncompressed !== uncompressed))) fail();
    let recordEnd = dataEnd;
    if (usesDescriptor) {
      // Support both permitted 32-bit forms (12 bytes or signed 16 bytes).
      // ZIP64 is rejected earlier. CRC bytes are compared, not recomputed.
      const signed = dataEnd + 4 <= directoryStart && u32(dataEnd) === 0x08074b50;
      const payloadStart = dataEnd + (signed ? 4 : 0);
      if (payloadStart + 12 > directoryStart || u32(payloadStart) !== crc ||
          u32(payloadStart + 4) !== compressed ||
          u32(payloadStart + 8) !== uncompressed) fail();
      recordEnd = payloadStart + 12;
    }
    localRanges.push([local, recordEnd]);
    expanded += uncompressed;
    if (expanded > MAX_3MF_ZIP_EXPANDED_BYTES) fail();
    offset += length;
  }
  if (offset !== end) fail();
  // Reject overlapping local headers, data and optional descriptors. The
  // central directory alone must not alias records or point into payloads.
  localRanges.sort((a,b) => a[0] - b[0]);
  for (let i = 1; i < localRanges.length; i++) {
    if (localRanges[i][0] < localRanges[i - 1][1]) fail();
  }
  return Object.freeze({entries:count, expandedBytes:expanded});
}
