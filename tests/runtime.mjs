import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {test} from 'node:test';
import vm from 'node:vm';
import battleFixture from './battle-fixture.js';

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
 const document={hidden:false,addEventListener:window.addEventListener,removeEventListener:window.removeEventListener};
 const context=vm.createContext({window,document,location,URL,Intl,console,crypto:webcrypto,setTimeout(fn){timers.set(++serial,fn);return serial;},clearTimeout(id){timers.delete(id);}});
 const receive=(from,type,payload={},overrides={})=>window.dispatch('message',{source:window,origin,data:{channel,from,type,...payload},...overrides});
 const flushTimers=()=>{const work=[...timers.values()];timers.clear();for(const fn of work)fn();};
 return {window,document,context,messages,timers,receive,flushTimers};
}
function engineFixture(){
 const h=host(),node=(name,parent)=>{const n={name,parent,children:[],_components:[],activeInHierarchy:true,opacity:255,width:100,height:40};parent?.children.push(n);return n;};
 const scene=node('game'),managers=node('Managers',scene),managerNode=node('GameManager',managers),scenarioNode=node('ScenarioManager',managers),canvas=node('Canvas',scene),dialogueNode=node('SerifWaku',canvas);
 class Label{constructor(n,text=''){this.node=n;n._components.push(this);this._string=text;Object.assign(this,{font:null,fontFamily:'JP',fontSize:20,lineHeight:22,useSystemFont:false,cacheMode:1,enableWrapText:false,overflow:0});}get string(){return this._string;}set string(value){this._string=String(value);}}
 Label.Overflow={NONE:0,SHRINK:2};class RichText extends Label{}
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
 for(const file of ['dialogue-text.js','name-policy.js','game-adapter.js','story-policy.js','image-policy.js','native-template-protocol.js','native-template-policy.js','main.js'])vm.runInContext(source(file),h.context,{filename:file});
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

test('terminal acquisition pages translate before typing ends without accepting unfinished fragments',()=>{
 const f=engineFixture();f.scenario.scenarioP=0;f.scenario.scenarioSplit=['delay 4.5&flow,text \n@伯耆\n報酬を期待するぜ。,end'];f.waku.last=false;f.waku.tmpserif='\n報酬を期待するぜ。';f.waku.count=3;f.serif.string=f.waku.tmpserif.slice(0,3);f.activate('1.0.0',1);
 const request=f.messages.findLast(m=>m.type==='CANDIDATE'&&m.item.context==='TamacolleDialogue').item;assert.equal(request.source,f.waku.tmpserif);
 f.result('1.0.0',1,request.id,'\n보수를 기대하겠어.',request.source);assert.ok(!/[報酬期]/.test(f.serif.string));
 f.waku.count=f.waku.tmpserif.length;f.serif.string=f.waku.tmpserif;assert.equal(f.serif.string,'\n보수를 기대하겠어.');
 f.scenario.scenarioSplit=['text \n途中,text 続き,end'];f.waku.tmpserif='\n途中';f.waku.count=3;
 const before=f.messages.filter(m=>m.type==='CANDIDATE'&&m.item.context==='TamacolleDialogue').length;f.serif.string=f.waku.tmpserif;
 assert.equal(f.messages.filter(m=>m.type==='CANDIDATE'&&m.item.context==='TamacolleDialogue').length,before);
 f.waku.tmpserif='\n途中続き';f.waku.count=5;f.serif.string=f.waku.tmpserif;
 assert.equal(f.messages.findLast(m=>m.type==='CANDIDATE'&&m.item.context==='TamacolleDialogue').item.source,f.waku.tmpserif);f.app.dispose();
});

test('result names use approved individual lookups atomically, preserve rows and reject old teams or Off replies',()=>{
 const f=engineFixture(),controller=f.node('BattleManager',f.scene),original='\n大和\n\n山城\n',label=new f.cc.Label(f.node('kunitamaName',f.canvas),original),other=new f.cc.Label(f.node('other',f.canvas),original);
 label.node.width=64;label.node.x=100;label.node.anchorX=0.5;label.fontSize=32;label.lineHeight=95;label.horizontalAlign=1;label.enableWrapText=true;label.node.activeInHierarchy=false;
 const result={kind:'ResultGamen',node:controller,finalKunitamaName:label};controller._components.push(result);f.manager.battle={result};f.manager.master={kunitama:['大和','山城','伯耆'].map(namae=>({namae}))};f.activate('1.0.0',1);
 const requests=f.messages.filter(m=>m.type==='CANDIDATE'&&m.item.context==='TamacolleResultName').map(m=>m.item),yamato=requests.find(x=>x.source==='大和'),yamashiro=requests.find(x=>x.source==='山城');
 f.result('1.0.0',1,yamashiro.id,'야마시로',yamashiro.source);assert.equal(label.string,original);
 label.string='\n伯耆\n\n山城\n';const hoki=f.messages.findLast(m=>m.type==='CANDIDATE'&&m.item.source==='伯耆').item;
 f.result('1.0.0',1,yamato.id,'야마토',yamato.source);assert.equal(label.string,'\n伯耆\n\n山城\n');
 f.result('1.0.0',1,hoki.id,'호키',hoki.source);label.node.activeInHierarchy=true;
 assert.equal(label.string,'\n호키\n\n야마시로\n');assert.equal(other.string,original);assert.equal(label.enableWrapText,false);assert.equal(label.lineHeight,95);assert.equal(label.fontSize,32);assert.equal(label.node.x,100);assert.equal(label.node.anchorX,0);assert.equal(label.horizontalAlign,0);assert.ok(label.node.x+label.fontSize*4<=256);
 for(let i=0;i<3;i++){label.string='\n伯耆\n\n山城\n';f.app.refresh();assert.equal(label.node.x,100);assert.equal(label.node.anchorX,0);assert.equal(label.string,'\n호키\n\n야마시로\n');}
 label.string='\n大和\n';const next=f.messages.findLast(m=>m.type==='CANDIDATE'&&m.item.source==='大和').item;f.config('1.0.0',2,false);
 f.result('1.0.0',1,next.id,'야마토',next.source);assert.equal(label.string,'\n大和\n');assert.equal(label.fontSize,32);assert.equal(label.lineHeight,95);assert.equal(label.enableWrapText,true);assert.equal(label.node.x,100);assert.equal(label.node.anchorX,0.5);assert.equal(label.horizontalAlign,1);f.app.dispose();
});

test('result-name composition rejects mismatched single-name replies and rebinds after a resource change',()=>{
 const f=engineFixture(),controller=f.node('BattleManager',f.scene),label=new f.cc.Label(f.node('kunitamaName',f.canvas),'\n大和\n');
 const result={kind:'ResultGamen',node:controller,finalKunitamaName:label};controller._components.push(result);f.manager.battle={result};f.manager.master={kunitama:[{namae:'大和'}]};f.activate('1.0.0',1);
 const first=f.messages.findLast(m=>m.type==='CANDIDATE'&&m.item.context==='TamacolleResultName').item;
 f.result('1.0.0',1,first.id,'야마시로','山城');assert.equal(label.string,'\n大和\n');
 f.activate('1.1.0',2);const next=f.messages.findLast(m=>m.type==='CANDIDATE'&&m.item.context==='TamacolleResultName').item;
 f.result('1.0.0',1,first.id,'야마토','大和');assert.equal(label.string,'\n大和\n');
 f.result('1.1.0',2,next.id,'야마토','大和');assert.equal(label.string,'\n야마토\n');f.app.dispose();
});

test('native title letter spacing is decoded only for verified title labels and Off restores it',()=>{
 const f=engineFixture(),title=new f.cc.Label(f.node('title',f.canvas),'大 和 と お 話'),subtitle=new f.cc.Label(f.node('subTitle',f.canvas),'絆'),other=new f.cc.Label(f.node('titleElsewhere',f.canvas),'大 和 と お 話');
 f.scenario.titleLabel=title;f.scenario.subTitleLabel=subtitle;f.activate('1.0.0',1);
 const request=f.messages.findLast(m=>m.type==='CANDIDATE'&&m.item.context==='TamacolleTitle'&&m.item.source==='大和とお話').item;
 f.result('1.0.0',1,request.id,'야마토와 대화',request.source);assert.equal(title.string,'야마토와 대화');assert.equal(title.enableWrapText,false);assert.equal(other.string,'大 和 と お 話');
 title.string='原 文   空 白';const spaced=f.messages.findLast(m=>m.type==='CANDIDATE'&&m.item.context==='TamacolleTitle'&&m.item.source==='原文 空白').item;
 f.result('1.0.0',1,spaced.id,'원문 공백',spaced.source);assert.equal(title.string,'원문 공백');
 f.config('1.0.0',2,false);assert.equal(title.string,'原 文   空 白');f.app.dispose();
});

test('subtitle keeps its native size across repeated empty resets and zero measured width',()=>{
 const f=engineFixture(),subtitle=new f.cc.Label(f.node('subTitle',f.canvas),'絆');subtitle.fontSize=50;subtitle.lineHeight=50;subtitle.node.width=0;f.scenario.subTitleLabel=subtitle;f.activate('1.0.0',1);
 const first=f.messages.findLast(m=>m.type==='CANDIDATE'&&m.item.context==='TamacolleTitle').item;f.result('1.0.0',1,first.id,'인연',first.source);
 for(let i=0;i<5;i++){subtitle.string='';subtitle.node.width=0;subtitle.string='絆';assert.equal(subtitle.string,'인연');assert.equal(subtitle.fontSize,50);assert.equal(subtitle.lineHeight,50);assert.equal(subtitle.overflow,f.cc.Label.Overflow.NONE);}
 f.config('1.0.0',2,false);assert.equal(subtitle.string,'絆');assert.equal(subtitle.fontSize,50);f.app.dispose();
});

test('manor notifications and expedition durations preserve quantities without touching unrelated labels',()=>{
 const f=engineFixture(),notice=new f.cc.Label(f.node('label',f.canvas),'魂玉 1 を取得しました'),time=new f.cc.Label(f.node('jouken_text',f.canvas),'部隊Lv.20～\n所要時間 2時間30分'),other=new f.cc.Label(f.node('unrelated',f.canvas),'魂玉 1 を取得しました');
 notice.node.activeInHierarchy=false;f.manager.infoTelop={infoTelopLabel:notice};f.manager.option={teamLvLabel:time};f.activate('1.0.0',1);
 assert.equal(notice.string,'혼옥 1개를 받았습니다');assert.equal(time.string,'부대 Lv.20 이상\n소요시간 2시간 30분');assert.equal(other.string,'魂玉 1 を取得しました');
 for(const amount of ['0','10500']){notice.string='魂玉 '+amount+' を取得しました';assert.equal(notice.string,'혼옥 '+amount+'개를 받았습니다');}
 notice.string='魂玉の所持上限を超えるため取得できませんでした';assert.equal(notice.string,'혼옥 보유 한도를 초과하여 받을 수 없었습니다');
 notice.string='魂玉の所持量が上限になりました';assert.equal(notice.string,'혼옥 보유량이 상한에 도달했습니다');
 for(const [duration,expected]of [['1時間','1시간'],['45分','45분'],['30秒','30초'],['1時間2分3秒','1시간 2분 3초'],['','']]){time.string='部隊Lv.5～\n所要時間 '+duration;assert.equal(time.string,'부대 Lv.5 이상\n소요시간 '+expected);}
 f.config('1.0.0',2,false);assert.equal(notice.string,'魂玉の所持量が上限になりました');assert.equal(time.string,'部隊Lv.5～\n所要時間 ');f.app.dispose();
});

test('expedition list durations localize only the bound StageBtn information label and preserve numbers',()=>{
 const f=engineFixture(),stageNode=f.node('stageBtn',f.canvas),time=new f.cc.Label(f.node('infoLabel',stageNode),'6時間'),other=new f.cc.Label(f.node('other',stageNode),'6時間');
 stageNode._components.push({kind:'StageBtn',node:stageNode,infoLabel:time});f.activate('1.0.0',1);
 for(const [source,expected]of [['6時間','6시간'],['8時間','8시간'],['12時間','12시간'],['20分','20분'],['30分','30분'],['0秒','0초'],['12時間5分30秒','12시간 5분 30초'],['6時間以内','6時間以内']]){time.string=source;assert.equal(time.string,expected);}
 assert.equal(other.string,'6時間');time.string='20分';f.config('1.0.0',2,false);assert.equal(time.string,'20分');f.app.dispose();
});

test('bound hidden notifications prefetch before display and reject superseded replies',()=>{
 const f=engineFixture(),source='所持上限を超えるアイテムは取得できませんでした',nextSource='中魂守  紫の所持量が上限になりました';
 const notice=new f.cc.Label(f.node('notice',f.canvas),source),other=new f.cc.Label(f.node('hiddenOther',f.canvas),source);
 notice.node.activeInHierarchy=false;other.node.activeInHierarchy=false;f.manager.infoTelop={infoTelopLabel:notice};f.activate('1.0.0',1);
 const first=f.messages.filter(m=>m.type==='CANDIDATE'&&m.item.source===source);assert.equal(first.length,1);
 notice.string=nextSource;const next=f.messages.findLast(m=>m.type==='CANDIDATE'&&m.item.source===nextSource);assert.ok(next);
 f.result('1.0.0',1,first[0].item.id,'이전 알림',source);assert.equal(notice.string,nextSource);
 f.result('1.0.0',1,next.item.id,'중형 타마모리  보라 보유량이 상한에 도달했습니다',nextSource);
 notice.node.activeInHierarchy=true;assert.equal(notice.string,'중형 타마모리  보라 보유량이 상한에 도달했습니다');assert.equal(other.string,source);
 f.config('1.0.0',2,false);assert.equal(notice.string,nextSource);f.app.dispose();
});

function bridgeFixture(){
 const h=host(),state=deferred(),catalogs=[],lookups=[],ports=[];
 h.context.chrome={runtime:{connect(){const port={onMessage:events(),onDisconnect:events(),messages:[],postMessage(message){this.messages.push(message);},disconnect(){}};ports.push(port);return port;},sendMessage(message){if(message.type==='GET_STATE')return state.promise;if(message.type==='GET_CATALOG'){const pending=deferred();catalogs.push(pending);return pending.promise;}if(message.type==='LOOKUP_TEXT'){const pending=deferred();lookups.push({message,...pending});return pending.promise;}throw Error('Unexpected request '+message.type);}}};
 vm.runInContext(source('native-template-protocol.js'),h.context,{filename:'native-template-protocol.js'});
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

test('same-source native replies retain original request provenance for live MAIN validation',async()=>{
 const f=bridgeFixture();f.state.resolve({ok:true,state:{enabled:true,version:'1.0.0'}});await turn();f.catalogs[0].resolve({ok:true,version:'1.0.0',catalog:[]});await turn();
 const revision=f.messages.at(-1),token='{TAMACOLLE_ACTOR_0}',candidate=name=>[{source:token+'、出発。',bindings:[{token,source:name}]}];
 const request=(id,name)=>f.receive('engine','CANDIDATE',{version:revision.version,generation:revision.generation,item:{id,source:'同じ表示',context:'TamacolleDialogue',nativeTemplates:candidate(name)}});
 request('e1r1','アキラ');f.flushTimers();request('e1r2','レオン');f.flushTimers();
 assert.equal(f.lookups.length,2);assert.equal(f.lookups[1].message.items[0].nativeTemplates[0].bindings[0].source,'レオン');
 f.lookups[0].resolve({ok:true,version:'1.0.0',results:[{id:'e1r1',text:'이전 이름',cacheSource:'同じ表示'}]});await turn();
 const earlier=f.messages.findLast(message=>message.type==='RESULT').results[0];assert.equal(earlier.id,'e1r1');assert.equal(earlier.nativeTemplates[0].bindings[0].source,'アキラ');
 f.lookups[1].resolve({ok:true,version:'1.0.0',results:[{id:'e1r2',text:'새 이름',cacheSource:'同じ表示'}]});await turn();
 const hit=f.messages.findLast(message=>message.type==='RESULT').results[0];assert.equal(hit.id,'e1r2');assert.equal(hit.text,'새 이름');assert.equal(hit.nativeTemplates[0].bindings[0].source,'レオン');
});

test('simultaneous generic UI and battle labels sharing a source do not strand either request',async()=>{
 const f=bridgeFixture();f.state.resolve({ok:true,state:{enabled:true,version:'1.0.0'}});await turn();f.catalogs[0].resolve({ok:true,version:'1.0.0',catalog:[]});await turn();
 const revision=f.messages.at(-1),token='{TAMACOLLE_ACTOR_0}',source='同じ表示',items=[
  {id:'e1r1',source,context:'Menu'},
  {id:'e1r2',source,context:'TamacolleDialogue / BattleEvent',nativeTemplates:[{source:token+'、出発。',bindings:[{token,source:'アキラ'}]}]}
 ];
 for(const item of items)f.receive('engine','CANDIDATE',{version:revision.version,generation:revision.generation,item});f.flushTimers();
 assert.equal(f.lookups[0].message.items.length,2);
 f.lookups[0].resolve({ok:true,version:'1.0.0',results:[{id:'e1r2',text:'아키라 출발하자.',cacheSource:source}]});await turn();
 const results=f.messages.findLast(message=>message.type==='RESULT').results;assert.deepEqual(Array.from(results,result=>result.id).sort(),['e1r1','e1r2']);assert.equal(results.find(result=>result.id==='e1r1').missing,true);assert.equal(results.find(result=>result.id==='e1r2').nativeTemplates[0].bindings[0].source,'アキラ');
});

test('native transport rejects malformed payloads and accounts binding strings in batches',async()=>{
 const f=bridgeFixture();f.state.resolve({ok:true,state:{enabled:true,version:'1.0.0'}});await turn();f.catalogs[0].resolve({ok:true,version:'1.0.0',catalog:[]});await turn();
 const revision=f.messages.at(-1),token=i=>`{TAMACOLLE_ACTOR_${i}}`,base={source:'表示',context:'TamacolleDialogue'};
 const send=item=>f.receive('engine','CANDIDATE',{version:revision.version,generation:revision.generation,item});
 send({...base,id:'e1r1',nativeTemplates:[{source:token(0),bindings:[{token:token(0),source:'名前',extra:true}]}]});f.flushTimers();assert.equal(f.lookups.length,0);
 const bindings=Array.from({length:32},(_,i)=>({token:token(i),source:'名'.repeat(512)})),candidate={source:bindings.map(binding=>binding.token).join('')+'話'.repeat(7000),bindings};
 for(let i=0;i<6;i++)send({...base,id:`e1r${i+2}`,nativeTemplates:[candidate,{...candidate,source:candidate.source+'。'}]});
 f.flushTimers();assert.equal(f.lookups[0].message.items.length,2,'native strings, not only the visible source, bound each batch');f.flushTimers();assert.equal(f.lookups[1].message.items.length,2);
});

test('new dialogue bypasses a saturated ordinary UI queue without losing request identity',async()=>{
 const f=bridgeFixture();f.state.resolve({ok:true,state:{enabled:true,version:'1.0.0'}});await turn();f.catalogs[0].resolve({ok:true,version:'1.0.0',catalog:[]});await turn();
 const revision=f.messages.at(-1),send=item=>f.receive('engine','CANDIDATE',{version:revision.version,generation:revision.generation,item});
 for(let i=1;i<=160;i++)send({id:'e1r'+i,source:'項目'+i,context:'Menu'});
 f.flushTimers();f.flushTimers();f.flushTimers();f.flushTimers();
 assert.equal(f.lookups.length,3,'ordinary UI leaves room for a new dialogue');
 send({id:'e1r161',source:'次の台詞',context:'TamacolleDialogue'});f.flushTimers();
 assert.equal(f.lookups.length,4);assert.equal(f.lookups[3].message.items[0].id,'e1r161');
 f.lookups[3].resolve({ok:true,version:'1.0.0',results:[{id:'e1r161',text:'다음 대사',cacheSource:'次の台詞'}]});await turn();
 assert.equal(f.messages.findLast(message=>message.type==='RESULT').results.find(r=>r.id==='e1r161').text,'다음 대사');
 f.window.dispatch('pagehide',{persisted:false});
});

test('native MAIN capture survives Off and rejects stale same-source combinations and resource replies',()=>{
 const f=engineFixture(),owner=f.scenario;
 owner.characters=[{chara:'A',name:'赤',body:'danji_1'},{chara:'B',name:'青',body:'danji_2'}];owner.scenarioSplit=['page'];owner.GV={play:f.manager.GV.play};
 const nativeStrMod=function(input){return input.replace(/\$([AB])/g,(_,tag)=>this.characters.find(actor=>actor.chara===tag).name);};
 const nativeTextStart=function(text,caption,first,last){text=this.StrMod(text);this.StrMod(caption);if(first)f.waku.tmpserif='';if(!f.waku.tmpserif)f.waku.tmpserif='\n';f.waku.tmpserif+=text;f.waku.last=last;f.waku.count=f.waku.tmpserif.length;f.serif.string=f.waku.tmpserif;};
 owner.StrMod=nativeStrMod;owner.TextStart=nativeTextStart;f.app.refresh();
 owner.TextStart('$A青','',true,true);f.activate('1.0.0',1);
 const first=f.messages.filter(message=>message.type==='CANDIDATE'&&message.item.source==='\n赤青').at(-1).item;
 assert.equal(first.nativeTemplates[0].source,'{TAMACOLLE_ACTOR_0}青');
 f.bridge('RESULT',{version:'1.0.0',generation:1,results:[{id:first.id,text:'첫 조합',cacheSource:first.source,nativeTemplates:first.nativeTemplates}]});assert.equal(f.serif.string,'\n첫 조합');
 f.config('1.0.0',2,false);owner.TextStart('赤$B','',true,true);f.config('1.0.0',3,true);
 const second=f.messages.filter(message=>message.type==='CANDIDATE'&&message.item.source==='\n赤青').at(-1).item;
 assert.equal(second.nativeTemplates[0].source,'赤{TAMACOLLE_ACTOR_0}');
 f.bridge('RESULT',{version:'1.0.0',generation:3,results:[{id:first.id,text:'오래된 조합',cacheSource:first.source,nativeTemplates:first.nativeTemplates}]});assert.equal(f.serif.string,'\n赤青');
 f.bridge('RESULT',{version:'1.0.0',generation:3,results:[{id:second.id,text:'새 조합',cacheSource:second.source,nativeTemplates:second.nativeTemplates}]});assert.equal(f.serif.string,'\n새 조합');
 f.activate('1.1.0',4);assert.equal(f.serif.string,'\n赤青','resource update discards derived display memory');
 f.bridge('RESULT',{version:'1.0.0',generation:3,results:[{id:second.id,text:'오래된 리소스',cacheSource:second.source,nativeTemplates:second.nativeTemplates}]});assert.equal(f.serif.string,'\n赤青');
 f.app.dispose();assert.equal(owner.StrMod,nativeStrMod);assert.equal(owner.TextStart,nativeTextStart);
});

test('verified BattleEvent labels retain exact LF and reject UI, old stage and resource bindings',()=>{
 const f=engineFixture(),battle=battleFixture(f);f.app.refresh();battle.event.Trap();battle.next();f.activate('1.0.0',1);
 const first=f.messages.filter(message=>message.type==='CANDIDATE'&&message.item.context==='TamacolleDialogue / BattleEvent').at(-1).item;
 assert.equal(first.source,'赤と青。\n赤が進む。');assert.equal(first.nativeTemplates[0].source,'{TAMACOLLE_ACTOR_0}と{TAMACOLLE_ACTOR_1}。\n{TAMACOLLE_ACTOR_2}が進む。');
 f.bridge('RESULT',{version:'1.0.0',generation:1,results:[{id:first.id,text:'빨강과 파랑.\n빨강이 나아간다.',cacheSource:first.source,nativeTemplates:first.nativeTemplates}]});assert.equal(battle.label.string,'빨강과 파랑.\n빨강이 나아간다.');
 const generic=new f.cc.Label(f.node('ordinaryMenu',f.canvas),first.source);f.app.refresh();const menu=f.messages.filter(message=>message.type==='CANDIDATE'&&message.item.source===first.source&&message.item.context!=='TamacolleDialogue / BattleEvent').at(-1).item;assert(!menu.nativeTemplates);assert.equal(generic.string,first.source);
 battle.next();const result=f.messages.filter(message=>message.type==='CANDIDATE'&&message.item.source==='赤が成功。').at(-1).item;assert.equal(result.nativeTemplates[0].source,'{TAMACOLLE_ACTOR_0}が成功。');
 f.config('1.0.0',2,false);battle.event.peer='誰か';battle.event.Spot();battle.next();f.config('1.0.0',3,true);
 const spot=f.messages.filter(message=>message.type==='CANDIDATE'&&message.item.source==='緑と誰かが歩く。').at(-1).item;assert.deepEqual(Array.from(spot.nativeTemplates[0].bindings,binding=>binding.source),['緑','誰か']);assert.equal(battle.randomCalls,3);
 battle.play.stageNo=1;battle.battle.stages[1]={boy:0,detail:0};battle.battle.traps[1]=[0,0,0,0,0,0,1];f.app.refresh();
 f.bridge('RESULT',{version:'1.0.0',generation:3,results:[{id:spot.id,text:'이전 장소',cacheSource:spot.source,nativeTemplates:spot.nativeTemplates}]});assert.equal(battle.label.string,spot.source);
 battle.event.Treasure();battle.next();const treasure=f.messages.filter(message=>message.type==='CANDIDATE'&&message.item.source==='赤の宝。').at(-1).item;
 f.bridge('RESULT',{version:'1.0.0',generation:3,results:[{id:treasure.id,text:'승인된 보물 문장',cacheSource:treasure.source,nativeTemplates:treasure.nativeTemplates}]});assert.equal(battle.label.string,'승인된 보물 문장');
 f.activate('1.1.0',4);assert.equal(battle.label.string,'赤の宝。');f.bridge('RESULT',{version:'1.0.0',generation:3,results:[{id:treasure.id,text:'오래된 리소스',cacheSource:treasure.source,nativeTemplates:treasure.nativeTemplates}]});assert.equal(battle.label.string,'赤の宝。');
 f.app.dispose();for(const [key,original]of battle.originals){const [owner,method]=key.split('.');assert.equal(battle[owner][method],original);}
});
