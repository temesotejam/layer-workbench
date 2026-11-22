import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {preflight3mfZip,preflight3mfZipVerified} from './preflight-3mf-zip.mjs';

// A deterministic stored ZIP: tests ZIP integrity, not 3MF XML semantics.
// Deliberately use a bit-by-bit CRC implementation independent of the preflight.
function fixtureCrc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function fixture(members=[{name:'3D/3dmodel.model',data:'x'}], options={}) {
  const encoder=new TextEncoder();
  const localParts=[], directoryParts=[];
  let offset=0;
  for (const m of members) {
    const name=encoder.encode(m.name), raw=encoder.encode(m.data ?? 'x');
    const data=m.method===8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const crc=fixtureCrc32(raw);
    const localExtra=m.localExtra ?? new Uint8Array();
    const centralExtra=m.centralExtra ?? new Uint8Array();
    const descriptor = m.descriptor ? new Uint8Array(m.signedDescriptor ? 16 : 12) : new Uint8Array();
    if (m.descriptor) {
      const dv=new DataView(descriptor.buffer);
      const start=m.signedDescriptor ? 4 : 0;
      if (m.signedDescriptor) dv.setUint32(0,0x08074b50,true);
      dv.setUint32(start,crc,true);
      dv.setUint32(start+4,data.length,true);
      dv.setUint32(start+8,m.size??raw.length,true);
    }
    const local=new Uint8Array(30+name.length+localExtra.length+data.length+descriptor.length);
    const lv=new DataView(local.buffer);
    lv.setUint32(0,0x04034b50,true);
    lv.setUint16(4,20,true);
    lv.setUint16(6,m.flags??0,true);
    lv.setUint16(8,m.method??0,true);
    lv.setUint32(14,m.descriptor?0:crc,true);
    lv.setUint32(18,m.descriptor?0:data.length,true);
    lv.setUint32(22,m.descriptor?0:(m.size??raw.length),true);
    lv.setUint16(26,name.length,true);
    lv.setUint16(28,localExtra.length,true);
    local.set(name,30);
    local.set(localExtra,30+name.length);
    local.set(data,30+name.length+localExtra.length);
    local.set(descriptor,30+name.length+localExtra.length+data.length);
    localParts.push(local);
    const dir=new Uint8Array(46+name.length+centralExtra.length);
    const dv=new DataView(dir.buffer);
    dv.setUint32(0,0x02014b50,true);
    dv.setUint16(4,20,true); dv.setUint16(6,20,true);
    dv.setUint16(8,m.flags??0,true);
    dv.setUint16(10,m.method??0,true);
    dv.setUint32(16,crc,true);
    dv.setUint32(20,data.length,true);
    dv.setUint32(24,m.size??raw.length,true);
    dv.setUint16(28,name.length,true);
    dv.setUint16(30,centralExtra.length,true);
    dv.setUint32(38,m.external??0,true);
    dv.setUint32(42,offset,true);
    dir.set(name,46);
    dir.set(centralExtra,46+name.length);
    directoryParts.push(dir);
    offset+=local.length;
  }
  const dirBytes=directoryParts.reduce((a,b)=>a+b.length,0);
  const end=new Uint8Array(22), ev=new DataView(end.buffer);
  ev.setUint32(0,0x06054b50,true);
  ev.setUint16(8,members.length,true);
  ev.setUint16(10,members.length,true);
  ev.setUint32(12,dirBytes,true);
  ev.setUint32(16,offset,true);
  const all=[...localParts,...directoryParts,end];
  const output=new Uint8Array(all.reduce((a,b)=>a+b.length,0));
  let cursor=0;
  for(const part of all){output.set(part,cursor);cursor+=part.length;}
  if(options.trailingByte) return Uint8Array.from([...output,0]);
  return output;
}

const valid=fixture();
assert.deepEqual(preflight3mfZip(valid),{entries:1,expandedBytes:1});
assert.equal(fixtureCrc32(new TextEncoder().encode('123456789')),0xcbf43926,
  'independent CRC fixture must match the standard test vector');
// Changes to STORED file data must be rejected even when both ZIP headers
// and any data descriptor still contain perfectly matching (stale) CRCs.
const corruptedStored=valid.slice();
corruptedStored[30+new TextEncoder().encode('3D/3dmodel.model').length] ^= 1;
assert.throws(()=>preflight3mfZip(corruptedStored),/unsafe 3MF ZIP/);
const forgedStored=valid.slice();
const forgedView=new DataView(forgedStored.buffer);
const directoryOffset=forgedView.getUint32(forgedStored.length-22+16,true);
forgedView.setUint32(14,0,true);
forgedView.setUint32(directoryOffset+16,0,true);
assert.throws(()=>preflight3mfZip(forgedStored),/unsafe 3MF ZIP/);
assert.deepEqual(preflight3mfZip(fixture([{name:'empty.model',data:''}])),
  {entries:1,expandedBytes:0});
assert.deepEqual(preflight3mfZip(fixture([
  {name:'[Content_Types].xml',data:'hello'},
  {name:'3D/3dmodel.model',data:'abc'},
])),{entries:2,expandedBytes:8});
for(const candidate of [
  new Uint8Array([0x50,0x4b,0x03,0x04]),
  fixture([{name:'../escape.model'}]),
  fixture([{name:'/absolute.model'}]),
  fixture([{name:'C:/drive.model'}]),
  fixture([{name:'3D\\bad.model'}]),
  fixture([{name:'3D//double.model'}]),
  fixture([{name:'3D/./dot.model'}]),
  fixture([{name:'3D/../parent.model'}]),
  fixture([{name:'a.model'},{name:'A.model'}]),
  fixture([{name:'a.model',flags:1}]),
  fixture([{name:'a.model',method:12}]),
  fixture([{name:'a.model',size:128*1024*1024}]),
  fixture([{name:'a.model',external:0o120777<<16}]),
  fixture(undefined,{trailingByte:true}),
]) assert.throws(()=>preflight3mfZip(candidate),/unsafe 3MF ZIP/);
const invalidOffsets=valid.slice();
const d=new DataView(invalidOffsets.buffer);
d.setUint32(invalidOffsets.length-22+16,0xffffffff,true);
assert.throws(()=>preflight3mfZip(invalidOffsets),/unsafe 3MF ZIP/);
const invalidLocalName=valid.slice();
invalidLocalName[30]=0x61;
assert.throws(()=>preflight3mfZip(invalidLocalName),/unsafe 3MF ZIP/);
// A second parser must not be able to use different local/central lengths or
// overlapping record ranges to see a different archive structure.
for (const [headerOffset,value] of [[14,17],[18,2],[22,2]]) {
  const invalid=valid.slice();
  new DataView(invalid.buffer).setUint32(headerOffset,value,true);
  assert.throws(()=>preflight3mfZip(invalid),/unsafe 3MF ZIP/);
}
const overlap=fixture([{name:'a.model',data:'x'},{name:'b.model',data:'y'}]);
// This shifts the first payload one byte into the next local file header,
// without affecting the central directory's original offsets.
new DataView(overlap.buffer).setUint16(28,1,true);
assert.throws(()=>preflight3mfZip(overlap),/unsafe 3MF ZIP/);
// Both signed and unsigned standard streaming data descriptors are supported.
for (const signedDescriptor of [false,true]) {
  const member={name:'3D/3dmodel.model',data:'abc',flags:8,descriptor:true,signedDescriptor};
  const streamed=fixture([member]);
  assert.deepEqual(preflight3mfZip(streamed),{entries:1,expandedBytes:3});
  const invalid=streamed.slice();
  const crcOffset=30+new TextEncoder().encode(member.name).length+3+
    (signedDescriptor?4:0);
  new DataView(invalid.buffer).setUint32(crcOffset,7,true);
  assert.throws(()=>preflight3mfZip(invalid),/unsafe 3MF ZIP/);
}
// Setting the descriptor flag without an actual descriptor is unsafe.
assert.throws(()=>preflight3mfZip(fixture([{name:'x.model',data:'abc',flags:8}])),
  /unsafe 3MF ZIP/);
// Known metadata extras are still permitted when well-formed; the preflight
// intentionally rejects only fields that could override path/offset semantics.
const timestampExtra=Uint8Array.from([0x55,0x54,0x01,0x00,0x01]);
assert.deepEqual(preflight3mfZip(fixture([{
  name:'3D/3dmodel.model', data:'abc',
  localExtra:timestampExtra, centralExtra:timestampExtra,
}])),{entries:1,expandedBytes:3});
const unicodePath=Uint8Array.from([0x75,0x70,0x05,0x00,0x01,0,0,0,0]);
const zip64Extra=Uint8Array.from([0x01,0x00,0,0]);
const malformedExtra=Uint8Array.from([0x55,0x54,0x06,0x00,0]);
for(const extra of [unicodePath,zip64Extra,malformedExtra]) {
  for(const side of ['localExtra','centralExtra'])
    assert.throws(()=>preflight3mfZip(fixture([{
      name:'3D/3dmodel.model',data:'abc',[side]:extra,
    }])),/unsafe 3MF ZIP/);
}
// Unsupported general-purpose bits can alter decompression/header semantics.
// UTF-8 bit 11 remains accepted.
assert.deepEqual(preflight3mfZip(fixture([{name:'3D/3dmodel.model',flags:0x0800}]))
  ,{entries:1,expandedBytes:1});
for(const flags of [0x0010,0x0020,0x0040,0x2000,0x4000,0x8000,0x0002]) {
  assert.throws(()=>preflight3mfZip(fixture([{
    name:'3D/3dmodel.model',flags,
  }])),/unsafe 3MF ZIP/);
}
// Method 8 is raw DEFLATE. Structural validation alone must NOT approve
// corrupt compressed data or forged size/CRC fields before native import.
const compressedName='3D/3dmodel.model';
const compressed=fixture([{name:compressedName,data:'hello compressed model',method:8}]);
const expectedCompressed={entries:1,expandedBytes:'hello compressed model'.length};
assert.deepEqual(preflight3mfZip(compressed),expectedCompressed);
assert.deepEqual(await preflight3mfZipVerified(compressed),expectedCompressed);
assert.deepEqual(await preflight3mfZipVerified(valid),{entries:1,expandedBytes:1});
assert.deepEqual(await preflight3mfZipVerified(fixture([
  {name:'[Content_Types].xml',data:'type info',method:8},
  {name:'3D/3dmodel.model',data:'cube',method:0},
])),{entries:2,expandedBytes:13});
for(const signedDescriptor of [false,true]) {
  const streamed=fixture([{name:compressedName,data:'streamed deflate',method:8,
    flags:8,descriptor:true,signedDescriptor}]);
  assert.deepEqual(await preflight3mfZipVerified(streamed),
    {entries:1,expandedBytes:'streamed deflate'.length});
}
const corruptDeflate=compressed.slice();
corruptDeflate[30+new TextEncoder().encode(compressedName).length] ^= 1;
assert.deepEqual(preflight3mfZip(corruptDeflate),expectedCompressed,
  'The structural checker intentionally does not decompress method 8');
await assert.rejects(preflight3mfZipVerified(corruptDeflate),/unsafe 3MF ZIP/);
const forgedDeflateCrc=compressed.slice();
const forgedDeflateView=new DataView(forgedDeflateCrc.buffer);
const forgedDeflateDir=forgedDeflateView.getUint32(forgedDeflateCrc.length-22+16,true);
forgedDeflateView.setUint32(14,0,true);
forgedDeflateView.setUint32(forgedDeflateDir+16,0,true);
assert.deepEqual(preflight3mfZip(forgedDeflateCrc),expectedCompressed);
await assert.rejects(preflight3mfZipVerified(forgedDeflateCrc),/unsafe 3MF ZIP/);
const forgedDeflateSize=fixture([{name:compressedName,data:'longer than claimed',method:8,size:1}]);
assert.deepEqual(preflight3mfZip(forgedDeflateSize),{entries:1,expandedBytes:1});
await assert.rejects(preflight3mfZipVerified(forgedDeflateSize),/unsafe 3MF ZIP/);
const compressedBomb=fixture([{name:compressedName,data:'A'.repeat(512*1024),method:8,size:1}]);
await assert.rejects(preflight3mfZipVerified(compressedBomb),/unsafe 3MF ZIP/);
const originalDecompressionStream=globalThis.DecompressionStream;
try {
  globalThis.DecompressionStream=undefined;
  await assert.rejects(preflight3mfZipVerified(compressed),/unsafe 3MF ZIP/);
} finally {
  globalThis.DecompressionStream=originalDecompressionStream;
}
console.log('PASS: bounded 3MF ZIP preflight verifies STORED/DEFLATE CRC, declared expansion limits, local records, overlaps, descriptors, extras and flags');
