/* MAIN world: no credentials/network. Timers measure discovery, not GPU rendering. */
(()=>{'use strict';
const APP=Symbol.for('tamacolle-kor.v1');if(window[APP])return;
const CHANNEL='tamacolle-kor/v1';
const namesPolicy=window[Symbol.for('tamacolle-kor-player-names.v1')];if(!namesPolicy)throw Error('Name policy unavailable');let playerNames=[];
const dialogue=globalThis[Symbol.for('tamacolle-kor-dialogue-text.v1')];if(!dialogue)throw Error('Dialogue policy unavailable');
const storyPolicy=window[Symbol.for('tamacolle-kor-story-policy.v1')];if(!storyPolicy)throw Error('Story policy unavailable');
let config={enabled:false,configured:false,cacheEnabled:true,cacheOnly:true,target:'한국어',translateLatin:true,fontFamily:'Malgun Gothic'},engine=null,sequence=0,busy=false,stopped=false,disposed=false,epoch=0,bridgeGeneration=-1,catalogVersion=null;
const records=new Map(),byRequest=new Map(),hooks=[],translations=new Map(),engineEvents=[];let translationBytes=0;
let heartbeat=null,lightTimer=null,burstTimer=null,burstUntil=0,lastScan=0,lastLight=0,attachAttempts=0;
function recalled(key){const text=translations.get(key);if(text!==undefined){translations.delete(key);translations.set(key,text);}return text;}
const memorySize=(key,value)=>(key.length+value.text.length+value.cacheSource.length)*2;
function remember(key,text,cacheSource=key){const old=translations.get(key);if(old!==undefined){translationBytes-=memorySize(key,old);translations.delete(key);}const value={text,cacheSource};translations.set(key,value);translationBytes+=memorySize(key,value);while(translations.size>5000||translationBytes>8*1024*1024){const first=translations.keys().next().value;translationBytes-=memorySize(first,translations.get(first));translations.delete(first);}}
function clearMemory(){translations.clear();translationBytes=0;}
const emit=(type,payload={})=>window.postMessage({channel:CHANNEL,from:'engine',type,version:catalogVersion,generation:bridgeGeneration,...payload},location.origin);
const game=window[Symbol.for('tamacolle-kor-game-adapter.v1')].create({getEngine:()=>engine,nativeText:label=>records.get(label)?.native??actual(label)});
const story=storyPolicy.create({getEngine:()=>engine,getRecords:()=>records,game});
const images=globalThis[Symbol.for('tamacolle-kor-image-policy.v1')].create({getEngine:()=>engine,getConfig:()=>config,emit});
const valid=x=>!!x&&(!window.cc?.isValid||window.cc.isValid(x));
const candidate=text=>typeof text==='string'&&text.trim()&&text.length<=8192&&(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text.replace(/<[^>]*>|\{[^{}]*\}/g,''))||(config.translateLatin&&/[A-Za-z]/.test(text.replace(/<[^>]*>|\{[^{}]*\}/g,''))));
function choices(raw){return namesPolicy.candidates(raw,playerNames);}
function boundSource(r,source){const candidates=[r.raw,...choices(r.raw).map(x=>x.source)];return candidates.includes(source)||(dialogue.isStory(r.context)&&candidates.some(x=>dialogue.equivalent(x,source)));}
function rendered(r,text,source){if(!text.includes('{USER}'))return text;const alternatives=choices(r.raw),name=alternatives.find(x=>x.source===source||(dialogue.isStory(r.context)&&dialogue.equivalent(x.source,source)))?.name||(source===r.raw?alternatives[0]?.name:null)||(r.raw.includes('{USER}')?playerNames[0]:null);return namesPolicy.render(text,name);}
function applyText(label,r,text,source=r.raw){if(!boundSource(r,source))return false;const value=rendered(r,text,source);if(value===null)return false;r.templateText=text;r.cacheSource=source;const exact=source===r.raw||choices(r.raw).some(x=>x.source===source),positional=r.context==='TamacolleDialogue'||r.context==='TamacolleChoice';r.fullDisplay=exact&&!positional?value:dialogue.display(r.raw,value,positional);const projected=story.reveal(label,r.native,r.fullDisplay);r.displayComplete=projected===r.fullDisplay;display(label,r,projected);return true;}
function readNames(){const names=game.names().filter(namesPolicy.usable);if(names.length===playerNames.length&&names.every((name,i)=>name===playerNames[i]))return;playerNames=names;epoch++;clearMemory();for(const [label,r]of records){reset(r);if(valid(label)&&actual(label)===r.display)display(label,r,r.native);}}
function active(label){return valid(label)&&label.node?.activeInHierarchy!==false&&!game.excluded(label);}
function safeType(label){return label instanceof engine.Label||label instanceof engine.RichText;}
function richChild(label){if(!(label instanceof engine.Label))return false;let n=label.node?.parent,depth=0;while(n&&depth++<40){if((n._components||[]).some(c=>c instanceof engine.RichText))return true;n=n.parent;}return false;}
function hook(label){return hooks.find(h=>h.proto.isPrototypeOf(label));}
function nativeSet(label,value){const h=hook(label);if(!h)throw Error('지원되지 않는 텍스트 접근자');h.before.set.call(label,value);}
function actual(label){const h=hook(label);return h?h.before.get.call(label):label.string;}
const styleKeys=['font','fontFamily','useSystemFont','fontSize','lineHeight','cacheMode','enableWrapText','overflow'];
function display(label,r,text){if(text.includes('{USER}'))text=rendered(r,text,r.cacheSource||r.raw)??r.native.replace(/\{USER\}/g,'');busy=true;try{
 if(config.enabled&&!disposed&&!stopped)text=game.bookNumber(label,r.native,config.target)??text;
 game.display(label,text!==r.native);
 if(text!==r.native&&!r.style){r.style={};for(const k of styleKeys)if(k in label)r.style[k]=label[k];}
 if(text!==r.native&&r.style){
  const desired={font:null,useSystemFont:true,fontFamily:config.fontFamily||'sans-serif',cacheMode:0};
  if('enableWrapText' in label&&'overflow' in label){
   if(r.context==='TamacolleDialogue'){desired.enableWrapText=true;desired.overflow=engine.Label.Overflow.SHRINK;}
   else if(r.context==='TamacolleChoice'){desired.enableWrapText=false;desired.overflow=engine.Label.Overflow.SHRINK;}
  }
  for(const [k,v]of Object.entries(desired))if(k in label&&label[k]!==v)label[k]=v;
 }
 if(text===r.native&&r.style){for(const [k,v]of Object.entries(r.style))if(label[k]!==v)label[k]=v;r.style=null;}
 if(actual(label)!==text)nativeSet(label,text);r.display=text;
 }finally{busy=false;}}
function reset(r){if(r.requestId)byRequest.delete(r.requestId);r.requested=null;r.requestId=null;r.resolved=false;r.templateText=null;r.cacheSource=null;r.fullDisplay=null;r.displayComplete=false;r.typingPlan=null;}
function context(label){const role=game.context(label);if(role)return role;const names=[];let n=label.node,depth=0;while(n&&depth++<5){for(const c of n._components||[]){const name=engine.js?.getClassName?.(c)||'';if(name&&name!=='cc.Label'&&name!=='cc.RichText')names.push(name.slice(0,55));}n=n.parent;}return [...new Set(names)].slice(0,5).join(' / ').slice(0,280);}
function ask(label,r){if(!config.enabled||!config.configured||stopped||!active(label)||game.pending(label)||richChild(label)||game.bookNumber(label,r.native,config.target)!==null||(!candidate(r.raw)&&r.raw!=='{USER}'&&!choices(r.raw).length)||r.requested===r.raw)return;
 const cached=recalled(r.raw);if(cached!==undefined&&applyText(label,r,cached.text,cached.cacheSource)){r.requested=r.raw;r.resolved=true;return;}
 const alternatives=choices(r.raw);r.requested=r.raw;r.resolved=false;r.requestId='e'+epoch+'r'+(++sequence);byRequest.set(r.requestId,{label,r});const id=r.requestId,item={id,source:r.raw,context:context(label),...(alternatives.length?{templates:alternatives.map(x=>x.source)}:{})};
 emit('CANDIDATE',{item});
}
function update(label,native,{preserve=false}={}){if(!safeType(label)||richChild(label))return nativeSet(label,native);if(game.excluded(label)){const old=records.get(label);if(old){display(label,old,old.native);reset(old);records.delete(label);}return nativeSet(label,native);}native=typeof native==='string'?native:String(native);let r=records.get(label);if(r&&r.resolved&&native===r.display&&r.display!==r.native&&story.source(label,r.native)===r.raw){native=r.native;preserve=true;}const raw=story.source(label,native);if(!r){r={raw,native,display:native,fullDisplay:null,displayComplete:false,typingPlan:null,requested:null,requestId:null,style:null,resolved:false,wasActive:active(label)};records.set(label,r);}else if(raw!==r.raw){reset(r);r.raw=raw;preserve=false;}
 r.context=context(label);
 r.native=native;
 const cached=config.enabled&&config.configured?recalled(raw):undefined;const currentOccurrence=config.enabled&&config.configured&&r.resolved&&r.requested===raw&&typeof r.templateText==='string';if(cached!==undefined&&boundSource(r,cached.cacheSource)&&applyText(label,r,cached.text,cached.cacheSource)){r.requested=raw;r.resolved=true;}else if(currentOccurrence)applyText(label,r,r.templateText,r.cacheSource);else if(!preserve||r.display===native)display(label,r,config.enabled?game.localizeManor(label,native,config.target)??game.localizeRecord(label,native,config.target)??native:native);ask(label,r);
}
function restoreAll(){for(const [label,r]of records)if(valid(label))display(label,r,r.native);images.restore();}
function status(){emit('STATUS',{status:{ready:!!engine,stopped,...images.status()}});}
function fail(message){if(stopped)return;stopped=true;try{restoreAll();}catch{}emit('ERROR',{error:message});status();}
function scheduleLight(){if(lightTimer||disposed||stopped||document.hidden||!config.enabled)return;lightTimer=setTimeout(()=>{lightTimer=null;lightCheck();},Math.max(0,64-(Date.now()-lastLight)));}
function attach(){const cc=window.cc;if(!cc?.Label||!cc.RichText||!cc.director?.getScene)return false;
 const candidates=[];for(const Type of [cc.RichText,cc.Label]){let proto=Type.prototype;while(proto&&!Object.getOwnPropertyDescriptor(proto,'string'))proto=Object.getPrototypeOf(proto);const before=proto&&Object.getOwnPropertyDescriptor(proto,'string');if(!before?.get||!before?.set||!before.configurable)throw Error('Cocos 텍스트 접근자가 호환되지 않습니다.');if(!candidates.some(x=>x.proto===proto))candidates.push({proto,before});}
 engine=cc;for(const h of candidates){h.set=function(value){if(busy||stopped||disposed)return h.before.set.call(this,value);try{return update(this,value);}catch(e){fail('텍스트 처리 호환 오류. 원문을 유지합니다.');return h.before.set.call(this,value);}};Object.defineProperty(h.proto,'string',{...h.before,set:h.set});hooks.push(h);}
 images.attach();
 // Subscribe only to supported optional director events. Never replace engine contracts.
 if(typeof cc.director.on==='function'&&typeof cc.director.off==='function'){const D=cc.Director||{};for(const event of new Set([D.EVENT_AFTER_UPDATE,D.EVENT_BEFORE_DRAW].filter(Boolean))){try{cc.director.on(event,scheduleLight);engineEvents.push([event,scheduleLight]);}catch{}}if(D.EVENT_AFTER_SCENE_LAUNCH){try{cc.director.on(D.EVENT_AFTER_SCENE_LAUNCH,inputBurst);engineEvents.push([D.EVENT_AFTER_SCENE_LAUNCH,inputBurst]);}catch{}}}return true;
}
function syncNames(){const before=epoch;readNames();if(before!==epoch&&config.enabled&&!stopped)for(const [label,r]of records)ask(label,r);}
function lightCheck(){if(disposed||document.hidden||stopped||!engine||!config.enabled||!config.configured)return;syncNames();lastLight=Date.now();try{let changed=false;for(const [label,r]of records){if(!valid(label)){reset(r);records.delete(label);changed=true;continue;}const on=active(label);if(!on){if(r.wasActive){reset(r);changed=true;}r.wasActive=false;continue;}const current=actual(label);if(!r.wasActive||current!==r.display){update(label,current===r.display?r.native:current,{preserve:current===r.display});changed=true;}r.wasActive=true;}if(changed)status();}catch{fail('게임 엔진 구조가 호환되지 않습니다. 원문을 유지합니다.');}}
function refresh(){if(disposed||document.hidden||stopped)return;try{if(!engine&&!attach()){status();return;}for(const h of hooks)if(Object.getOwnPropertyDescriptor(h.proto,'string')?.set!==h.set){fail('다른 확장이 텍스트 표시를 변경했습니다. 다른 번역 확장을 끄고 게임을 새로고침하세요.');return;}
 images.configure();if(!config.enabled){status();return;}syncNames();lastScan=Date.now();const scene=engine.director.getScene();if(!scene){status();return;}const seen=new Set(),stack=[scene];
 images.begin();
 while(stack.length){const n=stack.pop();if(!valid(n))continue;images.visit(n);for(const label of n._components||[])if(safeType(label)&&!richChild(label)){seen.add(label);const r=records.get(label),current=actual(label);update(label,r&&current===r.display?r.native:current,{preserve:!!r&&current===r.display});const updated=records.get(label);if(updated)updated.wasActive=active(label);}for(const child of n.children||[])stack.push(child);}
 for(const [label,r]of records)if(!seen.has(label)){if(valid(label))display(label,r,r.native);reset(r);records.delete(label);}images.end();status();
 }catch(e){fail('게임 엔진 구조가 호환되지 않습니다. 원문을 유지합니다.');}}
function inputBurst(){if(disposed||document.hidden||stopped||!config.enabled)return;burstUntil=Date.now()+480;if(burstTimer)return;const run=()=>{burstTimer=null;if(disposed||document.hidden||stopped||!config.enabled)return;refresh();if(Date.now()<burstUntil)burstTimer=setTimeout(run,160);};burstTimer=setTimeout(run,Math.max(16,120-(Date.now()-lastScan)));}
function tick(){heartbeat=null;if(disposed)return;if(!engine){attachAttempts++;refresh();}else if(config.enabled&&!document.hidden&&!stopped){lightCheck();if(Date.now()-lastScan>=650)refresh();}heartbeat=setTimeout(tick,engine?(config.enabled&&!document.hidden&&!stopped?64:750):(attachAttempts<30?100:1000));}
function invalidate(){epoch++;clearMemory();for(const r of records.values())reset(r);}
function onMessage(event){
 if(disposed||event.source!==window||event.origin!==location.origin)return;
 const m=event.data;if(!m||m.channel!==CHANNEL||m.from!=='bridge'||!Number.isSafeInteger(m.generation)||m.generation<bridgeGeneration)return;
 if(m.type==='RESOURCE_CATALOG'){
  if(typeof m.version!=='string'||!/^\d+\.\d+\.\d+$/.test(m.version)||!Array.isArray(m.catalog)||m.catalog.length>2000)return;
  // Stop rendering before replacing both indexes. CONFIG for this revision follows the catalog.
  config={...config,enabled:false,configured:false};restoreAll();invalidate();
  if(!images.setCatalog(m.catalog))return;
  bridgeGeneration=m.generation;catalogVersion=m.version;return;
 }
 if(m.type==='CONFIG'){
  const next=m.config;if(!next||m.version!==catalogVersion||next.cacheEpoch!==catalogVersion)return;
  const changed=m.generation!==bridgeGeneration||config.cacheEpoch!==catalogVersion||config.enabled!==(next.enabled===true);
  bridgeGeneration=m.generation;
  config={enabled:next.enabled===true,configured:next.configured===true,cacheEnabled:true,cacheOnly:true,target:'한국어',translateLatin:true,fontFamily:'Malgun Gothic',cacheEpoch:catalogVersion};
  if(changed){restoreAll();invalidate();}
  if(!config.enabled)restoreAll();
  refresh();if(config.enabled&&!document.hidden){clearTimeout(heartbeat);heartbeat=setTimeout(tick,64);}return;
 }
 if(m.generation!==bridgeGeneration||m.version!==catalogVersion)return;
 if(m.type==='IMAGE_PATCH_RESULT'){images.receive(m);return;}
 if(m.type!=='RESULT'||!config.enabled||stopped||!Array.isArray(m.results)||m.results.length>32)return;
 syncNames();
 for(const result of m.results){
  if(!result||typeof result.id!=='string')continue;
  const match=byRequest.get(result.id);if(!match)continue;const {label,r}=match;
  if(r.requestId!==result.id||r.requested!==r.raw)continue;
  if(valid(label)&&story.source(label,r.native)!==r.raw){const now=actual(label);update(label,now===r.display?r.native:now);continue;}
  if(result.missing===true){r.resolved=true;byRequest.delete(r.requestId);r.requestId=null;continue;}
  if(typeof result.text!=='string'||result.text.length>50000)continue;
  const cacheSource=typeof result.cacheSource==='string'?result.cacheSource:r.raw;
  if(!boundSource(r,cacheSource)||rendered(r,result.text,cacheSource)===null)continue;
  remember(r.raw,result.text,cacheSource);r.resolved=true;byRequest.delete(r.requestId);r.requestId=null;
  if(valid(label)){const now=actual(label);if(now===r.display||now===r.native)applyText(label,r,result.text,cacheSource);else update(label,now);}
 }
 status();
}
function visibility(){if(disposed)return;if(!document.hidden){refresh();clearTimeout(heartbeat);heartbeat=setTimeout(tick,64);}}
document.addEventListener?.('visibilitychange',visibility);
window.addEventListener('message',onMessage);for(const event of ['pointerup','touchend','keyup'])window.addEventListener(event,inputBurst,{passive:true});
window[APP]={refresh,dispose(){disposed=true;clearTimeout(heartbeat);clearTimeout(lightTimer);clearTimeout(burstTimer);restoreAll();images.dispose();game.dispose();for(const [event,fn]of engineEvents)try{engine.director.off(event,fn);}catch{}document.removeEventListener?.('visibilitychange',visibility);window.removeEventListener?.('message',onMessage);for(const event of ['pointerup','touchend','keyup'])window.removeEventListener?.(event,inputBurst);for(const h of hooks)if(Object.getOwnPropertyDescriptor(h.proto,'string')?.set===h.set)Object.defineProperty(h.proto,'string',h.before);records.clear();byRequest.clear();clearMemory();delete window[APP];}};
emit('HELLO');refresh();heartbeat=setTimeout(tick,engine?64:100);
})();
