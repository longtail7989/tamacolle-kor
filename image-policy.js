/* MAIN: known fixed UI frames only. Images come from the isolated extension cache, never game data. */
(()=>{'use strict';
const KEY=Symbol.for('tamacolle-kor-image-policy.v1');if(globalThis[KEY])return;
function create({getEngine,getConfig,emit}){
 let bySource=new Map(),byKey=new Map();
 const records=new Map(),ready=new Map(),requests=new Map(),requested=new Set(),queue=new Set(),decoded=new Map(),resources=new Set(),nativeFrames=new WeakMap(),loading=new Set();
 let hook=null,busy=false,disposed=false,blocked=false,generation=0,sequence=0,signature='',seen=null,warning='';
 let sourceChecks=new WeakMap();
 const valid=value=>!!value&&(!getEngine()?.isValid||getEngine().isValid(value));
 const korean=target=>typeof target==='string'&&/^(?:한국어|ko(?:-kr)?|korean)$/i.test(target.trim());
 const enabled=()=>!disposed&&!blocked&&getConfig().enabled&&korean(getConfig().target);
 const actual=sprite=>hook.before.get.call(sprite);
 function identify(frame,sprite){
  if(!frame||typeof frame.getRect!=='function'||frame.isRotated?.())return null;
  const original=frame._original,texture=original?._texture||frame.getTexture?.(),src=texture?._image?.src||texture?.url;
  if(typeof src!=='string'||!src)return null;
  let url;try{url=new URL(src,location.href);}catch{return null;}
  const entries=bySource.get(url.origin+url.pathname);if(!entries)return null;
  const rect=frame.getRect(),x=original?original._x:rect.x,y=original?original._y:rect.y;
  const entry=entries.find(value=>value.rect[0]===x&&value.rect[1]===y&&value.width===rect.width&&value.height===rect.height);if(!entry)return null;
  if(!entry.sourcePixelHash)return url.origin===location.origin?entry:null;
  if(!/^[a-f0-9]{64}$/.test(entry.sourcePixelHash))return null;
  const image=texture._image,previous=sourceChecks.get(frame);
  if(previous&&previous.image===image&&previous.source===url.href&&previous.x===x&&previous.y===y&&previous.entry===entry){if(sprite)previous.waiting?.add(sprite);return previous.verified?entry:null;}
  const check={image,source:url.href,x,y,entry,verified:false,waiting:new Set(sprite?[sprite]:[])},token=generation;sourceChecks.set(frame,check);
  try{
   const canvas=document.createElement('canvas');canvas.width=rect.width;canvas.height=rect.height;
   const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,x,y,rect.width,rect.height,0,0,rect.width,rect.height);
   const pixels=context.getImageData(0,0,rect.width,rect.height).data;
   crypto.subtle.digest('SHA-256',pixels).then(digest=>{if(disposed||token!==generation)return;const hash=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');check.verified=hash===entry.sourcePixelHash;if(!check.verified)warning='IMAGE_SOURCE_CHANGED';else if(enabled()&&hook){for(const candidate of check.waiting)if(valid(candidate)&&candidate.node?.activeInHierarchy!==false&&actual(candidate)===frame)update(candidate,frame);flush();}check.waiting=null;}).catch(()=>{check.waiting=null;if(!disposed&&token===generation)warning='IMAGE_SOURCE_UNVERIFIED';});
  }catch{check.waiting=null;warning='IMAGE_SOURCE_UNVERIFIED';}
  return null;
 }
 function nativeSet(sprite,frame,preserveSize=true){
  if(preserveSize&&actual(sprite)===frame)return;
  const node=preserveSize?sprite.node:null,width=node?.width,height=node?.height;
  busy=true;try{
   hook.before.set.call(sprite,frame);
   if(node&&Number.isFinite(width)&&Number.isFinite(height)&&(node.width!==width||node.height!==height)){
    if(typeof node.setContentSize==='function')node.setContentSize(width,height);else{node.width=width;node.height=height;}
   }
  }finally{busy=false;}
 }
 function restore(){if(!hook)return;for(const [sprite,record]of records)if(valid(sprite)&&actual(sprite)===record.display)nativeSet(sprite,record.native);records.clear();}
 function release(){for(const image of loading){image.onload=null;image.onerror=null;image.src='';}loading.clear();for(const resource of resources)try{resource.destroy();}catch{}resources.clear();ready.clear();decoded.clear();}
 function reset(){generation++;restore();release();requests.clear();requested.clear();queue.clear();sourceChecks=new WeakMap();warning='';}
 function setCatalog(catalog){
  if(!Array.isArray(catalog)||catalog.length>2000)return false;
  const nextSource=new Map(),nextKey=new Map();
  for(const entry of catalog){
   if(!entry||typeof entry.key!=='string'||nextKey.has(entry.key)||typeof entry.sourcePath!=='string'||!entry.sourcePath.startsWith('/')||!Array.isArray(entry.rect)||entry.rect.length!==4||!entry.rect.every(Number.isFinite)||!Number.isSafeInteger(entry.width)||entry.width<1||!Number.isSafeInteger(entry.height)||entry.height<1)return false;
   const origin=entry.sourceOrigin||location.origin;
   if(typeof origin!=='string')return false;
   const source=origin+entry.sourcePath;let entries=nextSource.get(source);if(!entries)nextSource.set(source,entries=[]);entries.push(entry);nextKey.set(entry.key,entry);
  }
  // Cancel decodes and source digests before exposing the replacement indexes.
  reset();bySource=nextSource;byKey=nextKey;return true;
 }
 function frameFor(original,entry,texture){
  let frame=decoded.get(original);if(frame)return frame;
  const cc=getEngine();frame=new cc.SpriteFrame(texture,cc.rect(0,0,entry.width,entry.height),false,original.getOffset(),original.getOriginalSize());
  for(const key of ['insetTop','insetBottom','insetLeft','insetRight'])if(typeof original[key]==='number')frame[key]=original[key];
  nativeFrames.set(frame,original);decoded.set(original,frame);resources.add(frame);return frame;
 }
 function apply(sprite,record){
  const texture=ready.get(record.key);if(!texture||!enabled()||!valid(sprite)||sprite.node?.activeInHierarchy===false)return;
  const current=actual(sprite);if(current!==record.native&&current!==record.display)return;
  if(identify(record.native)?.key!==record.key)return;
  const frame=frameFor(record.native,byKey.get(record.key),texture);record.display=frame;if(current!==frame)nativeSet(sprite,frame);
 }
 function update(sprite,value){
  const original=nativeFrames.get(value)||value;
  if(!enabled()||!valid(sprite)||sprite.node?.activeInHierarchy===false){records.delete(sprite);return nativeSet(sprite,original);}
  const entry=identify(original,sprite);if(!entry){records.delete(sprite);return nativeSet(sprite,original);}
  let record=records.get(sprite);if(!record||record.native!==original){record={native:original,display:original,key:entry.key};records.set(sprite,record);}
  if(ready.has(entry.key)){const frame=frameFor(original,entry,ready.get(entry.key));record.display=frame;return nativeSet(sprite,frame);}
  nativeSet(sprite,original);if(!requested.has(entry.key))queue.add(entry.key);
 }
 function attach(){
  if(hook||disposed)return !!hook;const cc=getEngine();if(!cc?.Sprite||!cc.Texture2D||!cc.SpriteFrame)return false;
  let proto=cc.Sprite.prototype;while(proto&&!Object.getOwnPropertyDescriptor(proto,'spriteFrame'))proto=Object.getPrototypeOf(proto);
  const before=proto&&Object.getOwnPropertyDescriptor(proto,'spriteFrame');if(!before?.get||!before?.set||!before.configurable){warning='IMAGE_ENGINE_UNSUPPORTED';return false;}
  const setter=function(value){
   if(busy||disposed)return before.set.call(this,value);
   const original=nativeFrames.get(value)||value;
   nativeSet(this,original,false);
   try{return update(this,original);}catch{warning='IMAGE_ENGINE_UNSUPPORTED';return nativeSet(this,original);}
  };
  hook={proto,before,setter};Object.defineProperty(proto,'spriteFrame',{...before,set:setter});return true;
 }
 function configure(){const config=getConfig(),next=JSON.stringify([!!config.enabled,config.target,config.cacheEpoch,config.cacheEnabled!==false,config.cacheOnly===true]);if(next!==signature){signature=next;reset();}}
 function begin(){seen=new Set();if(hook&&Object.getOwnPropertyDescriptor(hook.proto,'spriteFrame')?.set!==hook.setter){warning='IMAGE_HOOK_CONFLICT';blocked=true;restore();release();}if(!hook&&!blocked)attach();}
 function visit(node){if(!hook||!enabled()||node.activeInHierarchy===false)return;const cc=getEngine();for(const sprite of node._components||[])if(sprite instanceof cc.Sprite){seen?.add(sprite);const current=actual(sprite),record=records.get(sprite);if(record&&current===record.display){apply(sprite,record);continue;}update(sprite,current);}}
 function flush(){
  if(!enabled()){queue.clear();return;}
  while(queue.size&&requests.size<4){const batch=[];for(const key of queue){queue.delete(key);if(!requested.has(key))batch.push(key);if(batch.length===4)break;}if(!batch.length)break;const requestId='i'+(++sequence);for(const key of batch)requested.add(key);requests.set(requestId,{keys:new Set(batch),generation});emit('IMAGE_PATCH_REQUEST',{requestId,keys:batch});}
 }
 function end(){
  if(!hook)return;
  for(const [sprite,record]of records)if(!valid(sprite)||!seen?.has(sprite)){if(valid(sprite)&&actual(sprite)===record.display)nativeSet(sprite,record.native);records.delete(sprite);}
  flush();
 }
 function receive(message){
  if(message?.type!=='IMAGE_PATCH_RESULT'||!enabled()||!Array.isArray(message.images)||message.images.length>24)return;
  const request=requests.get(message.requestId);if(!request||request.generation!==generation)return;requests.delete(message.requestId);
  if(typeof message.warning==='string')warning=/^[A-Z_]{1,80}$/.test(message.warning)?message.warning:'IMAGE_PATCH_UNAVAILABLE';
  let bytes=0;const used=new Set();
  for(const item of message.images){
   if(!item||!request.keys.has(item.key)||used.has(item.key)||typeof item.dataUrl!=='string'||item.dataUrl.length>700000||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(item.dataUrl))continue;
   bytes+=item.dataUrl.length;if(bytes>4*1024*1024){warning='IMAGE_PATCH_LIMIT';break;}used.add(item.key);
   const token=generation,image=new Image(),entry=byKey.get(item.key);loading.add(image);
   image.onload=()=>{loading.delete(image);image.onload=null;image.onerror=null;if(disposed||token!==generation||!enabled())return;if(image.naturalWidth!==entry.width||image.naturalHeight!==entry.height){warning='IMAGE_PATCH_DIMENSIONS';return;}try{const texture=new (getEngine().Texture2D)();texture.initWithElement(image);texture.handleLoadedTexture();resources.add(texture);ready.set(item.key,texture);for(const [sprite,record]of records)if(record.key===item.key)apply(sprite,record);}catch{warning='IMAGE_ENGINE_UNSUPPORTED';}};
   image.onerror=()=>{loading.delete(image);if(!disposed&&token===generation)warning='IMAGE_PATCH_DECODE';image.onload=null;image.onerror=null;};image.src=item.dataUrl;
  }
  flush();
 }
 function status(){let translatedImages=0;for(const [sprite,record]of records)if(valid(sprite)&&sprite.node?.activeInHierarchy!==false&&record.display!==record.native&&actual(sprite)===record.display)translatedImages++;return {translatedImages,imageWarning:warning};}
 function dispose(){if(disposed)return;reset();disposed=true;if(hook&&Object.getOwnPropertyDescriptor(hook.proto,'spriteFrame')?.set===hook.setter)Object.defineProperty(hook.proto,'spriteFrame',hook.before);hook=null;}
 return {attach,setCatalog,configure,begin,visit,end,receive,restore,dispose,status};
}
globalThis[KEY]=Object.freeze({create});
})();
