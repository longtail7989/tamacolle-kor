import {validatePack,createTextIndex,lookupText,compareVersions} from './resource-pack.mjs';
import {createResourceStore} from './resource-store.mjs';
import {createGitHubUpdater} from './github-release.mjs';
import {createExtensionUpdater} from './extension-release.mjs';
import './native-template-protocol.js';
const nativeTemplates=globalThis[Symbol.for('tamacolle-kor-native-template-protocol.v1')];

const extensionVersion=chrome.runtime.getManifest().version;
const store=createResourceStore();
const ports=new Set();
let active,index,enabled=true,lastChecked=0,updateError='',updateTask=null;
let resourceLatest='',resourceKnown=false,resourceError='';
let extensionChecked=0,extensionLatest='',extensionUrl='',extensionCrxUrl='',extensionError='',extensionRequired='',extensionKnown=false;
const versionText=value=>typeof value==='string'&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
function savedExtensionUrl(value,kind){
  if(typeof value!=='string')return '';
  const match=/^https:\/\/github\.com\/longtail7989\/tamacolle-kor\/releases\/download\/resource-v([^/]+)\/tamacolle-kor-([^/]+)-extension\.(zip|crx)$/.exec(value);
  return match&&versionText(match[1])&&versionText(match[2])&&match[2]===extensionLatest&&match[3]===kind?value:'';
}
function extensionNotice(){
  const required=versionText(extensionRequired)&&compareVersions(extensionRequired,extensionVersion)>0?extensionRequired:'';
  const latest=extensionKnown&&versionText(extensionLatest)?extensionLatest:'';
  const target=required&&(!latest||compareVersions(required,latest)>0)?required:latest;
  const available=!!target&&compareVersions(target,extensionVersion)>0;
  const url=available&&latest===target&&extensionUrl?extensionUrl:'https://github.com/longtail7989/tamacolle-kor/releases';
  const crxUrl=available&&latest===target&&extensionCrxUrl?extensionCrxUrl:null;
  return {checked:extensionChecked,latest,known:extensionKnown,target,required,available,url,crxUrl,error:extensionError};
}
const state=()=>({enabled,version:active?.version||'',extensionVersion,lastChecked,error:updateError,resource:{latest:resourceLatest,known:resourceKnown,checked:lastChecked,error:resourceError},extension:extensionNotice()});
function updateExtensionBadge(){
  const notice=extensionNotice();
  void chrome.action.setBadgeText({text:notice.available?'!':''});
  void chrome.action.setTitle({title:notice.available?`타마코레 한글화 — 확장 ${notice.target} 업데이트`:'타마코레 한글화'});
}
const ready=initialize();
const updater=createGitHubUpdater({getCurrent:()=>active,apply:activateResources,extensionVersion});
const extensionUpdater=createExtensionUpdater({currentVersion:extensionVersion});

async function initialize(){
  const settings=await chrome.storage.local.get({enabled:true,lastChecked:0,updateError:'',resourceLatest:'',resourceKnown:false,resourceError:'',extensionChecked:0,extensionLatest:'',extensionUrl:'',extensionCrxUrl:'',extensionError:'',extensionRequired:'',extensionKnown:false});
  enabled=settings.enabled!==false;
  lastChecked=Number.isSafeInteger(settings.lastChecked)?settings.lastChecked:0;
  updateError=typeof settings.updateError==='string'?settings.updateError.slice(0,500):'';
  resourceLatest=versionText(settings.resourceLatest)?settings.resourceLatest:'';
  resourceKnown=settings.resourceKnown===true&&(settings.resourceLatest===''||versionText(settings.resourceLatest));
  resourceError=typeof settings.resourceError==='string'?settings.resourceError.slice(0,500):'';
  extensionChecked=Number.isSafeInteger(settings.extensionChecked)?settings.extensionChecked:0;
  extensionLatest=versionText(settings.extensionLatest)?settings.extensionLatest:'';
  extensionUrl=savedExtensionUrl(settings.extensionUrl,'zip');
  extensionCrxUrl=savedExtensionUrl(settings.extensionCrxUrl,'crx');
  extensionError=typeof settings.extensionError==='string'?settings.extensionError.slice(0,500):'';
  extensionRequired=versionText(settings.extensionRequired)?settings.extensionRequired:'';
  extensionKnown=settings.extensionKnown===true&&(settings.extensionLatest===''||versionText(settings.extensionLatest));
  const response=await fetch(chrome.runtime.getURL('resources/ko.json'));
  if(!response.ok)throw Error('기본 한글 리소스를 읽지 못했습니다.');
  const bundled=await validatePack(await response.arrayBuffer(),{extensionVersion});
  active=bundled;
  try{
    const saved=await store.load();
    if(saved){
      const validated=await validatePack(saved,{extensionVersion});
      if(compareVersions(validated.version,bundled.version)>=0)active=validated;
    }
  }catch{
    updateError='저장된 리소스를 읽지 못해 기본 한글 리소스를 사용합니다.';
  }
  index=createTextIndex(active);
  updateExtensionBadge();
}
function broadcast(){
  updateExtensionBadge();
  const message={type:'STATE_CHANGED',state:state()};
  for(const port of ports){try{port.postMessage(message);}catch{ports.delete(port);}}
}
// Commit the complete validated pack before switching lookups and notifying live game frames.
async function activateResources(candidate){
  await ready;
  const pack=await validatePack(candidate,{extensionVersion});
  if(compareVersions(pack.version,active.version)<=0)throw Error('현재보다 새로운 리소스 버전이 필요합니다.');
  const nextIndex=createTextIndex(pack);
  await store.save(pack);
  active=pack;
  index=nextIndex;
  broadcast();
  return state();
}
async function checkUpdates(){
  if(updateTask)return updateTask;
  updateTask=(async()=>{
    await ready;
    let result,failure;
    try{
      result=await updater.checkAndUpdate();updateError='';
      extensionRequired=result.status==='requires-extension'?result.minimumExtensionVersion:'';
    }
    catch(error){failure=error;updateError=publicError(error);}
    const latest=updater.latestVersion;
    if(latest!==undefined){resourceLatest=latest;resourceKnown=true;resourceError='';}
    else if(failure)resourceError=updateError;
    lastChecked=Date.now();
    try{await chrome.storage.local.set({lastChecked,updateError,extensionRequired,resourceLatest,resourceKnown,resourceError});}
    catch(error){if(!failure){failure=error;updateError='업데이트 확인 상태를 저장하지 못했습니다.';}}
    broadcast();
    if(failure)throw failure;
    return result;
  })().finally(()=>{updateTask=null;});
  return updateTask;
}
function checkIfDue(){
  ready.then(()=>{if(!resourceKnown||Date.now()-lastChecked>=24*60*60*1000)return checkUpdates();}).catch(()=>{});
}
let extensionTask=null;
async function checkExtension(){
  if(extensionTask)return extensionTask;
  extensionTask=(async()=>{
    await ready;
    let result,failure;
    try{result=await extensionUpdater.check();extensionError='';}
    catch(error){failure=error;extensionError=publicError(error);}
    extensionChecked=Date.now();
    if(result){
      extensionLatest=result.latest;
      extensionUrl=result.url||'';
      extensionCrxUrl=result.crxUrl||'';
      extensionKnown=true;
    }
    try{await chrome.storage.local.set({extensionChecked,extensionLatest,extensionUrl,extensionCrxUrl,extensionError,extensionKnown});}
    catch(error){if(!failure){failure=error;extensionError='확장 업데이트 확인 상태를 저장하지 못했습니다.';}}
    broadcast();
    if(failure)throw failure;
    return result;
  })().finally(()=>{extensionTask=null;});
  return extensionTask;
}
function extensionIfDue(){
  ready.then(()=>{if(!extensionKnown||Date.now()-extensionChecked>=12*60*60*1000)return checkExtension();}).catch(()=>{});
}
const publicError=error=>typeof error?.message==='string'?error.message.slice(0,500):'작업을 완료하지 못했습니다.';
function popupSender(sender){return sender?.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('popup.html');}
function gameSender(sender){
  if(sender?.id!==chrome.runtime.id||!Number.isInteger(sender.tab?.id))return false;
  try{const url=new URL(sender.url);return url.origin==='https://nijitama.app'&&/^\/games\/tamacolle\/index[^/]*\.html$/.test(url.pathname);}catch{return false;}
}
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value);
function validItems(items){
  if(!Array.isArray(items)||items.length>60)return false;
  const ids=new Set();let chars=0;
  for(const item of items){
    if(!item||!validId(item.id)||ids.has(item.id)||typeof item.source!=='string'||!item.source.trim()||item.source.length>8192||typeof item.context!=='string'||item.context.length>300)return false;
    ids.add(item.id);chars+=item.id.length+item.source.length+item.context.length;
    if(item.templates!==undefined){
      if(!Array.isArray(item.templates)||item.templates.length>8||item.templates.some(s=>typeof s!=='string'||!s.trim()||s.length>8192))return false;
      chars+=item.templates.reduce((sum,s)=>sum+s.length,0);
    }
    if(!nativeTemplates.validate(item.nativeTemplates))return false;
    chars+=nativeTemplates.size(item.nativeTemplates);
    if(chars>512*1024)return false;
  }
  return true;
}
async function handle(message,sender){
  const popup=popupSender(sender),game=gameSender(sender);
  if(!popup&&!game)throw Error('허용되지 않은 요청입니다.');
  await ready;
  if(message.type==='GET_STATE'){checkIfDue();extensionIfDue();return {ok:true,state:state()};}
  if(message.type==='SET_ENABLED'&&popup){
    if(typeof message.enabled!=='boolean')throw Error('한글화 상태가 올바르지 않습니다.');
    await chrome.storage.local.set({enabled:message.enabled});
    enabled=message.enabled;broadcast();return {ok:true,state:state()};
  }
  if(message.type==='CHECK_UPDATE'&&popup)return {ok:true,result:await checkUpdates(),state:state()};
  if(message.type==='CHECK_EXTENSION'&&popup)return {ok:true,result:await checkExtension(),state:state()};
  if(message.type==='GET_CATALOG'&&game)return {ok:true,version:active.version,catalog:active.images.map(({dataUrl,pngHash,...entry})=>entry)};
  if(message.type==='LOOKUP_TEXT'&&game){
    if(message.version!==active.version)return {ok:false,stale:true,state:state()};
    if(!validItems(message.items))throw Error('문구 요청이 올바르지 않습니다.');
    const results=[];
    if(enabled)for(const item of message.items){const found=lookupText(index,item);if(found)results.push(found);}
    return {ok:true,version:active.version,results};
  }
  if(message.type==='GET_IMAGES'&&game){
    if(message.version!==active.version)return {ok:false,stale:true,state:state()};
    if(!Array.isArray(message.keys)||message.keys.length>24||message.keys.some(k=>typeof k!=='string'||!/^[-a-zA-Z0-9_]{1,96}$/.test(k))||new Set(message.keys).size!==message.keys.length)throw Error('이미지 요청이 올바르지 않습니다.');
    const wanted=new Set(message.keys),images=enabled?active.images.filter(image=>wanted.has(image.key)).map(({key,dataUrl})=>({key,dataUrl})):[];
    if(images.reduce((n,image)=>n+image.dataUrl.length,0)>4*1024*1024)throw Error('이미지 요청이 너무 큽니다.');
    return {ok:true,version:active.version,images};
  }
  throw Error('지원하지 않는 요청입니다.');
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!message||typeof message.type!=='string')return false;
  handle(message,sender).then(reply,error=>reply({ok:false,error:publicError(error)}));
  return true;
});
chrome.runtime.onConnect.addListener(port=>{
  if(!(port.name==='tamacolle-kor-game'&&gameSender(port.sender))&&!(port.name==='tamacolle-kor-popup'&&popupSender(port.sender))){port.disconnect();return;}
  ports.add(port);port.onDisconnect.addListener(()=>ports.delete(port));
  port.onMessage.addListener(message=>{if(message?.type==='KEEP_ALIVE')port.postMessage({type:'ALIVE'});});
  ready.then(()=>{if(ports.has(port))port.postMessage({type:'STATE_CHANGED',state:state()});}).catch(error=>{if(ports.has(port))port.postMessage({type:'ERROR',error:publicError(error)});});
  checkIfDue();
  extensionIfDue();
});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='resource-update'){checkIfDue();extensionIfDue();}});
function scheduleChecks(){chrome.alarms.create('resource-update',{delayInMinutes:1,periodInMinutes:1440});}
chrome.runtime.onInstalled.addListener(()=>{scheduleChecks();checkIfDue();extensionIfDue();});
chrome.runtime.onStartup.addListener(()=>{scheduleChecks();checkIfDue();extensionIfDue();});
