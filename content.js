/* ISOLATED: version-bound relay only; no game controls, DOM overlay, or external requests. */
(()=>{'use strict';
const CHANNEL='tamacolle-kor/v1',KEY=Symbol.for('tamacolle-kor-relay.v1');
if(window[KEY])return;window[KEY]=true;
const validVersion=value=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value);
let desired=null,catalog=null,catalogVersion=null,generation=0,stateRevision=0,enabled=false,disposed=false,port=null,reconnectTimer=null,lookupTimer=null,lookupFlights=0;
const pending=new Map(),inflight=new Set();
function send(type,payload={}){window.postMessage({channel:CHANNEL,from:'bridge',type,version:catalogVersion,generation,...payload},location.origin);}
function configure(on){send('CONFIG',{config:{enabled:on,configured:true,target:'한국어',translateLatin:true,fontFamily:'Malgun Gothic',cacheEnabled:true,cacheOnly:true,cacheEpoch:catalogVersion}});}
async function runtime(message){const answer=await chrome.runtime.sendMessage(message);if(!answer||answer.ok!==true)throw Error(answer?.error||'확장 프로그램 응답이 없습니다.');return answer;}
function current(token,version){return !disposed&&enabled&&generation===token&&catalogVersion===version&&desired?.version===version;}
function cancelLookups(){clearTimeout(lookupTimer);lookupTimer=null;pending.clear();inflight.clear();lookupFlights=0;}
function replay(){if(!catalog||!desired||catalogVersion!==desired.version)return;send('RESOURCE_CATALOG',{version:catalogVersion,catalog});configure(enabled);}
async function acceptState(state){
 if(disposed||!state||typeof state.enabled!=='boolean'||!validVersion(state.version))return;
 stateRevision++;
 if(desired?.version===state.version&&desired.enabled===state.enabled)return;
 desired={enabled:state.enabled,version:state.version};
 const token=++generation;enabled=false;cancelLookups();
 // Off is synchronous, including when a replacement catalog is still in flight.
 if(catalogVersion!==null)configure(false);
 try{
  let next=catalog;
  if(catalogVersion!==state.version){
   const answer=await runtime({type:'GET_CATALOG'});
   if(disposed||token!==generation)return;
   if(answer.version!==state.version||!Array.isArray(answer.catalog)||answer.catalog.length>2000){await synchronize();return;}
   next=answer.catalog;
  }
  if(disposed||token!==generation)return;
  catalog=next;catalogVersion=state.version;enabled=state.enabled;
  // The MAIN-world image indexes must be replaced before text requests can resume.
  replay();
 }catch{if(token===generation){enabled=false;if(catalogVersion!==null)configure(false);}}
}
async function synchronize(){const before=stateRevision;try{const answer=await runtime({type:'GET_STATE'});if(!disposed&&before===stateRevision)await acceptState(answer.state);}catch{}}
function connect(){
 if(disposed)return;
 try{
  const connection=chrome.runtime.connect({name:'tamacolle-kor-game'});port=connection;
  connection.onMessage.addListener(message=>{if(port===connection&&message?.type==='STATE_CHANGED')void acceptState(message.state);});
  connection.onDisconnect.addListener(()=>{
   // Reading lastError prevents Chromium from reporting a handled disconnect as an unchecked error.
   void chrome.runtime.lastError;if(port!==connection||disposed)return;port=null;
   reconnectTimer=setTimeout(()=>{reconnectTimer=null;connect();void synchronize();},1000);
  });
 }catch{}
}
function validItem(item){return !!item&&typeof item.id==='string'&&/^e\d+r\d+$/.test(item.id)&&item.id.length<=80&&typeof item.source==='string'&&!!item.source.trim()&&item.source.length<=8192&&typeof item.context==='string'&&item.context.length<=300&&(item.templates===undefined||(Array.isArray(item.templates)&&item.templates.length<=8&&item.templates.every(value=>typeof value==='string'&&!!value.trim()&&value.length<=8192&&value.includes('{USER}'))&&new Set(item.templates).size===item.templates.length));}
function scheduleLookup(){if(lookupTimer||!enabled||!pending.size||lookupFlights>=4)return;lookupTimer=setTimeout(()=>{lookupTimer=null;void flushLookup();},8);}
async function flushLookup(){
 if(disposed||!enabled||!pending.size||lookupFlights>=4)return;
 const token=generation,version=catalogVersion,items=[];let chars=0;
 for(const [id,item]of pending){if(items.length>=32||(items.length&&chars+item.source.length>131072))break;pending.delete(id);inflight.add(id);items.push(item);chars+=item.source.length;}
 lookupFlights++;scheduleLookup();
 try{
  const answer=await runtime({type:'LOOKUP_TEXT',version,items});
  if(!current(token,version)||answer.version!==version||!Array.isArray(answer.results)||answer.results.length>32)return;
  const found=new Map();
  for(const result of answer.results){if(!result||typeof result.id!=='string'||found.has(result.id))continue;found.set(result.id,result);}
  const results=items.map(item=>{
   const hit=found.get(item.id);
   return typeof hit?.text==='string'&&hit.text.length<=50000&&typeof hit.cacheSource==='string'&&hit.cacheSource.length<=8192?{id:item.id,text:hit.text,cacheSource:hit.cacheSource}:{id:item.id,missing:true};
  });
  send('RESULT',{results});
 }catch{}
 finally{if(token===generation){lookupFlights--;for(const item of items)inflight.delete(item.id);scheduleLookup();}}
}
async function requestImages(message){
 const keys=message.keys;
 if(typeof message.requestId!=='string'||!/^i\d+$/.test(message.requestId)||message.requestId.length>80||!Array.isArray(keys)||keys.length<1||keys.length>24||keys.some(key=>typeof key!=='string'||key.length<1||key.length>200)||new Set(keys).size!==keys.length)return;
 const token=generation,version=catalogVersion;
 try{
  const answer=await runtime({type:'GET_IMAGES',version,keys});
  if(!current(token,version)||answer.version!==version||!Array.isArray(answer.images)||answer.images.length>keys.length)return;
  const requested=new Set(keys),seen=new Set(),images=[];let bytes=0;
  for(const image of answer.images){
   if(!image||!requested.has(image.key)||seen.has(image.key)||typeof image.dataUrl!=='string'||image.dataUrl.length>700000||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(image.dataUrl))return;
   bytes+=image.dataUrl.length;if(bytes>4*1024*1024)return;
   seen.add(image.key);images.push({key:image.key,dataUrl:image.dataUrl});
  }
  send('IMAGE_PATCH_RESULT',{requestId:message.requestId,images});
 }catch{}
}
function receive(event){
 if(disposed||event.source!==window||event.origin!==location.origin)return;
 const message=event.data;if(!message||message.channel!==CHANNEL||message.from!=='engine')return;
 if(message.type==='HELLO'){replay();return;}
 if(!enabled||message.version!==catalogVersion||message.generation!==generation)return;
 if(message.type==='IMAGE_PATCH_REQUEST'){void requestImages(message);return;}
 if(message.type!=='CANDIDATE'&&message.type!=='TEXT')return;
 const item=message.item;if(!validItem(item)||pending.has(item.id)||inflight.has(item.id)||pending.size>=5000)return;
 pending.set(item.id,{id:item.id,source:item.source,context:item.context,...(item.templates?{templates:item.templates}:{})});scheduleLookup();
}
window.addEventListener('message',receive);
window.addEventListener('pagehide',event=>{if(event.persisted)return;disposed=true;cancelLookups();clearTimeout(reconnectTimer);window.removeEventListener('message',receive);try{port?.disconnect();}catch{}});
// Subscribe before the first GET_STATE: a newer port state always wins over its late reply.
connect();void synchronize();
})();
