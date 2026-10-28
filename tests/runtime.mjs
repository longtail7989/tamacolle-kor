import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {test} from 'node:test';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const source=file=>readFileSync(new URL(file,root),'utf8');
const channel='tamacolle-kor/v1',origin='https://nijitama.app';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function events(){const listeners=new Set();return {addListener(fn){listeners.add(fn);},fire(value){for(const fn of listeners)fn(value);}};}
function host(){
 const listeners=new Map(),messages=[],timers=new Map();let serial=0;
 const window={addEventListener(type,fn){let set=listeners.get(type);if(!set)listeners.set(type,set=new Set());set.add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);},postMessage(message){messages.push(message);},dispatch(type,event){for(const fn of listeners.get(type)||[])fn(event);}};
 const location={origin,href:origin+'/games/tamacolle/index.html'};
 const context=vm.createContext({window,location,URL,Intl,console,crypto:webcrypto,setTimeout(fn){timers.set(++serial,fn);return serial;},clearTimeout(id){timers.delete(id);}});
 const receive=(from,type,payload={},overrides={})=>window.dispatch('message',{source:window,origin,data:{channel,from,type,...payload},...overrides});
 const flushTimers=()=>{const work=[...timers.values()];timers.clear();for(const fn of work)fn();};
 return {window,context,messages,timers,receive,flushTimers};
}
function engineFixture(){
 const h=host(),node=(name,parent)=>{const n={name,parent,children:[],_components:[],activeInHierarchy:true,opacity:255,width:100,height:40};parent?.children.push(n);return n;};
 const scene=node('game'),managers=node('Managers',scene),managerNode=node('GameManager',managers),scenarioNode=node('ScenarioManager',managers),canvas=node('Canvas',scene),dialogueNode=node('SerifWaku',canvas);
 class Label{constructor(n,text=''){this.node=n;n._components.push(this);this._string=text;Object.assign(this,{font:null,fontFamily:'JP',fontSize:20,lineHeight:22,useSystemFont:false,cacheMode:1,enableWrapText:false,overflow:0});}get string(){return this._string;}set string(value){this._string=String(value);}}
 Label.Overflow={SHRINK:2};class RichText extends Label{}
 class Sprite{constructor(n,frame){this.node=n;n._components.push(this);this._spriteFrame=frame;}get spriteFrame(){return this._spriteFrame;}set spriteFrame(frame){this._spriteFrame=frame;}}
 class Texture2D{initWithElement(image){this.image=image;}handleLoadedTexture(){}destroy(){this.destroyed=true;}}
 class SpriteFrame{constructor(texture,rect){this.texture=texture;this.rect=rect;}getTexture(){return this.texture;}getRect(){return this.rect;}getOffset(){return {x:0,y:0};}getOriginalSize(){return {width:20,height:10};}isRotated(){return false;}destroy(){this.destroyed=true;}}
 const images=[];class Image{constructor(){images.push(this);this.naturalWidth=20;this.naturalHeight=10;}}
 const serif=new Label(node('Serif',dialogueNode),'\n出発しよう。'),speaker=new Label(node('Namae',dialogueNode),'ミナト');
 const waku={serif,namae:speaker,ruby:[],tmpserif:serif.string,count:serif.string.length,last:true};
 const scenario={kind:'PlayScenario',node:scenarioNode,serifWaku:waku};scenarioNode._components.push(scenario);
 const manager={kind:'GameManager',node:managerNode,GV:{play:{playerName:'ミナト'}}};managerNode._components.push(manager);
 const cc={Label,RichText,Sprite,Texture2D,SpriteFrame,rect:(x,y,width,height)=>({x,y,width,height}),isValid:value=>!!value&&!value.destroyed,director:{getScene:()=>scene},js:{getClassName:value=>value.kind||''}};
 h.window.cc=cc;Object.assign(h.context,{Image,document:{hidden:false,addEventListener(){},removeEventListener(){}}});
 for(const file of ['dialogue-text.js','name-policy.js','game-adapter.js','story-policy.js','image-policy.js','main.js'])vm.runInContext(source(file),h.context,{filename:file});
 const app=h.window[Symbol.for('tamacolle-kor.v1')];
 const bridge=(type,payload={})=>h.receive('bridge',type,payload);
 const config=(version,generation,enabled=true)=>bridge('CONFIG',{version,generation,config:{enabled,configured:true,cacheEpoch:version}});
 const activate=(version,generation,catalog=[])=>{bridge('RESOURCE_CATALOG',{version,generation,catalog});config(version,generation);};
 const result=(version,generation,id,text,cacheSource)=>bridge('RESULT',{version,generation,results:[{id,text,cacheSource}]});
 const frame=path=>new SpriteFrame({_image:{src:origin+path}},{x:0,y:0,width:20,height:10});
 return {...h,node,scene,canvas,cc,serif,speaker,waku,manager,scenario,images,app,bridge,config,activate,result,frame};
}

test('live version changes repaint current text, reject stale replies, and Off restores native style',()=>{
 const f=engineFixture();f.activate('1.0.0',1);
 const request=f.messages.findLast(message=>message.type==='CANDIDATE'&&message.item.source==='\n出発しよう。');
 f.result('1.0.0',1,request.item.id,'출발하자.','\n出発しよう。');
 assert.equal(f.serif.string,'\n출발하자.');assert.equal(f.serif.enableWrapText,true);assert.equal(f.serif.overflow,2);
 f.activate('1.1.0',2);
 const next=f.messages.findLast(message=>message.type==='CANDIDATE'&&message.item.source==='\n出発しよう。');
 f.result('1.0.0',1,request.item.id,'오래된 번역','\n出発しよう。');assert.equal(f.serif.string,'\n出発しよう。');
 f.result('1.1.0',2,next.item.id,'함께 출발하자.','\n出発しよう。');assert.equal(f.serif.string,'\n함께 출발하자.');
 f.config('1.1.0',3,false);assert.equal(f.serif.string,'\n出発しよう。');assert.equal(f.serif.fontFamily,'JP');assert.equal(f.serif.enableWrapText,false);
 f.bridge('RESOURCE_CATALOG',{version:'1.2.0',generation:4,catalog:[]});f.config('1.2.0',4,false);
 const before=f.messages.filter(message=>message.type==='CANDIDATE').length;f.app.refresh();assert.equal(f.messages.filter(message=>message.type==='CANDIDATE').length,before);assert.equal(f.serif.string,'\n出発しよう。');
 f.app.dispose();
});

test('image catalog replacement discovers new source paths and cancels old asynchronous decodes',()=>{
 const f=engineFixture(),first=f.frame('/old.png'),second=f.frame('/new.png'),a=new f.cc.Sprite(f.node('old',f.canvas),first),b=new f.cc.Sprite(f.node('new',f.canvas),second);
 const entry=(key,sourcePath)=>({key,sourcePath,sourceOrigin:origin,rect:[0,0,20,10],width:20,height:10});
 f.activate('1.0.0',1,[entry('old','/old.png')]);
 const old=f.messages.findLast(message=>message.type==='IMAGE_PATCH_REQUEST');
 f.bridge('IMAGE_PATCH_RESULT',{version:'1.0.0',generation:1,requestId:old.requestId,images:[{key:'old',dataUrl:'data:image/png;base64,AAAA'}]});
 const delayed=f.images.at(-1),staleLoad=delayed.onload;
 f.activate('1.1.0',2,[entry('new','/new.png')]);
 staleLoad();assert.equal(a.spriteFrame,first);assert.equal(b.spriteFrame,second);
 const fresh=f.messages.findLast(message=>message.type==='IMAGE_PATCH_REQUEST');assert.deepEqual(Array.from(fresh.keys),['new']);
 f.bridge('IMAGE_PATCH_RESULT',{version:'1.1.0',generation:2,requestId:fresh.requestId,images:[{key:'new',dataUrl:'data:image/png;base64,AAAA'}]});
 f.images.at(-1).onload();assert.notEqual(b.spriteFrame,second);assert.equal(a.spriteFrame,first);
 f.config('1.1.0',3,false);assert.equal(b.spriteFrame,second);
 f.app.dispose();
});

test('typewriter retains complete graphemes and balanced rich text, names are profile-bound',()=>{
 const f=engineFixture();f.waku.tmpserif='\nミナト、出発しよう。';f.waku.count=4;f.serif.string=f.waku.tmpserif.slice(0,4);f.activate('1.0.0',1);
 const request=f.messages.findLast(message=>message.type==='CANDIDATE'&&message.item.context==='TamacolleDialogue');
 assert.ok(request.item.templates.includes('\n{USER}、出発しよう。'));
 f.result('1.0.0',1,request.item.id,'<color=#fff>{USER} 👨‍👩‍👧‍👦 가자.</color>','\n{USER}、出発しよう。');
 assert.ok(f.serif.string.startsWith('\n<color=#fff>'));assert.ok(f.serif.string.endsWith('</color>'));assert.ok(!f.serif.string.includes('{USER}'));
 const partial=f.serif.string.replace(/<[^>]+>/g,'');assert.ok(!partial.includes('👨')||partial.includes('👨‍👩‍👧‍👦'));
 f.waku.count=f.waku.tmpserif.length;f.serif.string=f.waku.tmpserif;assert.equal(f.serif.string,'\n<color=#fff>ミナト 👨‍👩‍👧‍👦 가자.</color>');f.app.dispose();
});

function bridgeFixture(){
 const h=host(),state=deferred(),catalogs=[],lookups=[],ports=[];
 h.context.chrome={runtime:{connect(){const port={onMessage:events(),onDisconnect:events(),disconnect(){}};ports.push(port);return port;},sendMessage(message){if(message.type==='GET_STATE')return state.promise;if(message.type==='GET_CATALOG'){const pending=deferred();catalogs.push(pending);return pending.promise;}if(message.type==='LOOKUP_TEXT'){const pending=deferred();lookups.push({message,...pending});return pending.promise;}throw Error('Unexpected request '+message.type);}}};
 vm.runInContext(source('content.js'),h.context,{filename:'content.js'});
 return {...h,state,catalogs,lookups,ports};
}
test('new port state wins over late initialization and late catalogs, including Off',async()=>{
 const f=bridgeFixture();
 f.ports[0].onMessage.fire({type:'STATE_CHANGED',state:{enabled:true,version:'1.0.0'}});
 f.ports[0].onMessage.fire({type:'STATE_CHANGED',state:{enabled:false,version:'1.1.0'}});
 f.state.resolve({ok:true,state:{enabled:true,version:'0.9.0'}});f.catalogs[0].resolve({ok:true,version:'1.0.0',catalog:[{key:'stale'}]});await turn();
 assert.equal(f.messages.length,0);
 f.catalogs[1].resolve({ok:true,version:'1.1.0',catalog:[]});await turn();
 assert.deepEqual(f.messages.map(message=>message.type),['RESOURCE_CATALOG','CONFIG']);assert.equal(f.messages[1].config.enabled,false);assert.equal(f.messages[0].version,'1.1.0');
});
test('Off immediately cancels in-flight lookups; sender, origin, role and revision are checked',async()=>{
 const f=bridgeFixture();f.state.resolve({ok:true,state:{enabled:true,version:'1.0.0'}});await turn();f.catalogs[0].resolve({ok:true,version:'1.0.0',catalog:[]});await turn();
 const revision=f.messages.at(-1),item={id:'e1r1',source:'出発',context:'TamacolleDialogue'},payload={item,version:revision.version,generation:revision.generation};
 f.receive('engine','CANDIDATE',payload,{origin:'https://other.example'});f.receive('engine','CANDIDATE',payload,{source:{}});f.receive('bridge','CANDIDATE',payload);f.receive('engine','CANDIDATE',{...payload,generation:0});f.flushTimers();assert.equal(f.lookups.length,0);
 f.receive('engine','CANDIDATE',payload);f.flushTimers();assert.equal(f.lookups.length,1);
 f.ports[0].onMessage.fire({type:'STATE_CHANGED',state:{enabled:false,version:'1.0.0'}});assert.equal(f.messages.at(-1).config.enabled,false);
 f.lookups[0].resolve({ok:true,version:'1.0.0',results:[{id:item.id,text:'출발',cacheSource:item.source}]});await turn();assert.equal(f.messages.filter(message=>message.type==='RESULT').length,0);
});
