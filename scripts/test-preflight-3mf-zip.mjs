import assert from 'node:assert/strict';
import {preflight3mfZip} from './preflight-3mf-zip.mjs';

// A deterministic stored ZIP: tests envelope parsing, not 3MF XML semantics.
function fixture(members=[{name:'3D/3dmodel.model',data:'x'}], options={}) {
  const encoder=new TextEncoder();
  const localParts=[], directoryParts=[];
  let offset=0;
  for (const m of members) {
    const name=encoder.encode(m.name), data=encoder.encode(m.data ?? 'x');
    const descriptor = m.descriptor ? new Uint8Array(m.signedDescriptor ? 16 : 12) : new Uint8Array();
    if (m.descriptor) {
      const dv=new DataView(descriptor.buffer);
      const start=m.signedDescriptor ? 4 : 0;
      if (m.signedDescriptor) dv.setUint32(0,0x08074b50,true);
      dv.setUint32(start+4,data.length,true);
      dv.setUint32(start+8,m.size??data.length,true);
    }
    const local=new Uint8Array(30+name.length+data.length+descriptor.length);
    const lv=new DataView(local.buffer);
    lv.setUint32(0,0x04034b50,true);
    lv.setUint16(4,20,true);
    lv.setUint16(6,m.flags??0,true);
    lv.setUint16(8,m.method??0,true);
    lv.setUint32(18,m.descriptor?0:data.length,true);
    lv.setUint32(22,m.descriptor?0:(m.size??data.length),true);
    lv.setUint16(26,name.length,true);
    local.set(name,30); local.set(data,30+name.length);
    local.set(descriptor,30+name.length+data.length);
    localParts.push(local);
    const dir=new Uint8Array(46+name.length);
    const dv=new DataView(dir.buffer);
    dv.setUint32(0,0x02014b50,true);
    dv.setUint16(4,20,true); dv.setUint16(6,20,true);
    dv.setUint16(8,m.flags??0,true);
    dv.setUint16(10,m.method??0,true);
    dv.setUint32(20,data.length,true);
    dv.setUint32(24,m.size??data.length,true);
    dv.setUint16(28,name.length,true);
    dv.setUint32(38,m.external??0,true);
    dv.setUint32(42,offset,true);
    dir.set(name,46);
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
console.log('PASS: bounded 3MF ZIP preflight rejects unsafe local headers, overlaps and descriptors');
