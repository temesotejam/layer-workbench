// Pure Node regression for in-session import/edit/slice orchestration.
// Mock G-code is synthetic; ONLY the separate isolated Chrome job tests WASM.
import assert from 'node:assert/strict';
import {diagnoseImported3mfInSessionReslice}
  from './diagnose-in-session-3mf-reslice.mjs';

const makeGcode=(x,levels=[5,10,15])=>{
  let e=1;
  return ['G21','G90','M82','G1 X90 Y95 Z0.2','G1 X100 Y95 E1',
    ...levels.flatMap(z=>[
      'G0 X90 Y95 Z'+z,'G1 X100 Y95 E'+(++e),
      'G0 X'+x+' Y95','G1 X'+(x+10)+' Y95 E'+(++e),
    ]),'','; synthetic unit test, not machine instructions '.repeat(8)
  ].join('\n');
};
const cloned=x=>JSON.parse(JSON.stringify(x));
const matrix=x=>[1,0,0,x,0,1,0,90,0,0,1,0,0,0,0,1];
const source=new Uint8Array(400);source.set([0x50,0x4b]);
function mockedEngine({stale=false,badConfig=false,ignoreUndo=false}={}){
  const calls=[];
  let manifest={
    plates:[{id:'plate-0',index:0}],
    objects:[{id:'o0'},{id:'o1'}],
    instances:[
      {id:'i0',transform:{matrix:matrix(90)}},
      {id:'i1',transform:{matrix:matrix(150)}}
    ]
  };
  const heap=new Uint8Array(10000);
  let moved=false,disposed=false;
  const module={
    HEAPU8:heap,_malloc:()=>32,_free:()=>{},
    _orcawasm_project_edit_instance_transform:(handle,pointer,len)=>{
      assert.equal(handle,123);
      const obj=JSON.parse(new TextDecoder().decode(heap.slice(pointer,pointer+len)));
      assert.equal(obj.instanceId,'i1');
      assert.ok(obj.matrix[3]===180 || obj.matrix[3]===150);
      if(obj.matrix[3]===150 && ignoreUndo){
        calls.push('privateUndoIgnored');
        return 0; // deliberately broken native behavior
      }
      manifest.instances[1].transform.matrix=obj.matrix;
      moved=obj.matrix[3]===180;
      calls.push(moved?'privateEdit':'privateUndo');
      return 0;
    }
  };
  const session={
    binding:{module},live:()=>123,
    initProfile:async(format,bytes)=>{
      assert.equal(format,'project.3mf');
      assert.deepEqual(bytes,source);calls.push('initProfile');
    },
    getManifest:async()=>cloned(manifest),
    applyProfile:async(format,bytes)=>{
      assert.equal(format,'orca.native-json');
      const cfg=JSON.parse(new TextDecoder().decode(bytes));
      assert.equal(cfg.use_relative_e_distances,0);
      assert.equal(cfg.bed_size_x,256);
      calls.push('applyProfile');
      if(badConfig) throw Error('config refused');
    },
    slice:async request=>{
      assert.equal(request.plateSelection,'selected');
      assert.deepEqual(request.plateIds,['plate-0']);
      calls.push('slice');
      return {schemaVersion:'0.7.0',plateResults:[
        {plateId:'plate-0',assets:[{kind:'gcode',id:'test-gcode'}]}
      ]};
    },
    getAsset:async()=>{
      calls.push('getAsset');
      const x=stale?150:moved?180:150;
      return new TextEncoder().encode(makeGcode(x));
    },
    setObjects:()=>{throw Error('UNSAFE: setObjects called');},
    export:()=>{throw Error('UNSAFE: archive export called');},
    dispose:async()=>{calls.push('dispose');disposed=true;},
  };
  return {engine:{
    createSession:async()=>{calls.push('createSession');return session;},
    threeMfToStl:()=>{throw Error('UNSAFE: flatten called');},
  },calls,isDisposed:()=>disposed};
}
const happy=mockedEngine();
const report=await diagnoseImported3mfInSessionReslice(happy.engine,source);
assert.equal(report.status,'PASS');
assert.equal(report.imported3mfReslicedInSameSession,true);
assert.equal(report.editUndoReslicedInSameSession,true);
assert.deepEqual(report.restored.regions,report.before.regions);
assert.deepEqual(report.restored.regionLayers,report.before.regionLayers);
assert.equal(report.persistentNativeModelMutation,false);
assert.equal(report.nativeDesktopGcodeParity,false);
assert.deepEqual(happy.calls,[
  'createSession','initProfile','applyProfile','slice','getAsset',
  'privateEdit','slice','getAsset',
  'privateUndo','slice','getAsset','dispose'
]);
assert.equal(happy.isDisposed(),true);
const stale=mockedEngine({stale:true});
await assert.rejects(diagnoseImported3mfInSessionReslice(stale.engine,source),
  /did not relocate/);
assert.equal(stale.isDisposed(),true);
const staleUndo=mockedEngine({ignoreUndo:true});
await assert.rejects(diagnoseImported3mfInSessionReslice(staleUndo.engine,source),
  /Undo did not restore/);
assert.equal(staleUndo.isDisposed(),true);
const invalid=mockedEngine({badConfig:true});
await assert.rejects(diagnoseImported3mfInSessionReslice(invalid.engine,source),
  /config refused/);
assert.equal(invalid.isDisposed(),true);
await assert.rejects(diagnoseImported3mfInSessionReslice(happy.engine,new Uint8Array(0)),
  /Invalid bounded/);
console.log('PASS: in-session Core 3MF slice → edit → reslice → undo → reslice, strict multi-layer path and ignored-undo rejection');
