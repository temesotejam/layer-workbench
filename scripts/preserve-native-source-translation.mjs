// CI/local diagnostic only: reconstruct the original CLI-authored package
// after one verified private WASM manifest translation. Never merge stale
// metadata from the original into a regenerated mesh/ID hierarchy.
// This is not the native session export API or a general 3MF editor.
import {unzipSync,zipSync} from '../node_modules/fflate/esm/browser.js';
import {preflight3mfZipVerified} from './preflight-3mf-zip.mjs';

const CORE='http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const MAIN='3D/3dmodel.model';
const reject=()=>{throw new Error('Unsupported source-preserving 3MF translation');};
const equalBytes=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);

export function translationDelta(before,after){
  for(const matrix of [before,after]){
    if(!Array.isArray(matrix)||matrix.length!==16||
       matrix.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e6)||
       matrix[12]!==0||matrix[13]!==0||matrix[14]!==0||matrix[15]!==1)reject();
  }
  if(before.some((v,i)=>![3,7,11].includes(i)&&v!==after[i]))reject();
  const delta=[3,7,11].map(i=>after[i]-before[i]);
  if(delta.every(v=>v===0)||delta.some(v=>Math.abs(v)>1000))reject();
  return delta;
}

// Deliberately narrow lexical edit for the pinned two-build CLI fixture.
// DOM validation checks the lexical match; do not serialize the document,
// as doing so would change opaque XML, namespace declarations and whitespace.
export function translateMainXml(xml,index,delta){
  if(typeof xml!=='string'||xml.length>2_000_000||
     /<!DOCTYPE|<!ENTITY|<!--|<!\[CDATA\[/i.test(xml)||
     ![0,1].includes(index)||!Array.isArray(delta)||delta.length!==3||
     delta.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1000)||
     delta.every(v=>v===0))reject();
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  const root=doc.documentElement;
  if(root.localName!=='model'||root.namespaceURI!==CORE||
     doc.getElementsByTagName('parsererror').length||
     (root.getAttribute('unit')||'millimeter')!=='millimeter')reject();
  const builds=[...root.children].filter(e=>e.namespaceURI===CORE&&e.localName==='build');
  const items=builds.length===1?[...builds[0].children]:[];
  if(items.length!==2||items.some(e=>e.namespaceURI!==CORE||e.localName!=='item'))reject();
  const blocks=[...xml.matchAll(/<build(?:\s[^<>]*)?>[\s\S]*?<\/build\s*>/g)];
  if(blocks.length!==1)reject();
  const block=blocks[0];
  const tags=[...block[0].matchAll(/<item\s[^<>]*\/>/g)];
  if(tags.length!==2)reject();
  for(let i=0;i<2;i++){
    const tag=tags[i][0];
    const ids=[...tag.matchAll(/\sobjectid\s*=\s*(["'])([0-9]+)\1/g)];
    const attrs=[...tag.matchAll(/\stransform\s*=\s*(["'])([0-9eE+.\-\s]+)\1/g)];
    if(ids.length!==1||ids[0][2]!==items[i].getAttribute('objectid')||
       attrs.length!==1||attrs[0][2]!==items[i].getAttribute('transform'))reject();
  }
  const tag=tags[index];
  const match=[...tag[0].matchAll(/\stransform\s*=\s*(["'])([0-9eE+.\-\s]+)\1/g)][0];
  const tokens=match[2].trim().split(/\s+/);
  if(tokens.length!==12||tokens.some(v=>!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(v)))reject();
  const numbers=tokens.map(Number);
  if(numbers.some(v=>!Number.isFinite(v)||Math.abs(v)>1e6))reject();
  const [a,b,c,d,e,f,g,h,i]=numbers;
  if(Math.abs(a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g))<1e-10)reject();
  for(let axis=0;axis<3;axis++)tokens[9+axis]=String(numbers[9+axis]+delta[axis]);
  const valueStart=block.index+tag.index+match.index+match[0].indexOf(match[1])+1;
  return xml.slice(0,valueStart)+tokens.join(' ')+xml.slice(valueStart+match[2].length);
}

export async function preserveNativeSourceTranslation(source,{index,before,after,optIn}={}){
  if(optIn!==true||globalThis.crossOriginIsolated!==true||
     !['localhost','127.0.0.1'].includes(globalThis.location?.hostname))reject();
  const delta=translationDelta(before,after);
  const summary=await preflight3mfZipVerified(source);
  if(summary.expandedBytes>8_000_000||summary.entries>32)reject();
  const members=unzipSync(source);
  const names=Object.keys(members);
  if(names.length!==summary.entries||!Object.hasOwn(members,MAIN)||
     !Object.hasOwn(members,'Metadata/project_settings.config')||
     !Object.hasOwn(members,'Metadata/model_settings.config')||
     !Object.hasOwn(members,'3D/_rels/3dmodel.model.rels')||
     names.filter(n=>n.startsWith('3D/')&&n.endsWith('.model')).length!==3)reject();
  const decode=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
  const encode=new TextEncoder();
  const original=decode.decode(members[MAIN]);
  if(!equalBytes(encode.encode(original),members[MAIN]))reject();
  members[MAIN]=encode.encode(translateMainXml(original,index,delta));
  const result=zipSync(members,{level:6});
  const checked=await preflight3mfZipVerified(result);
  if(checked.entries!==summary.entries)reject();
  return result;
}
