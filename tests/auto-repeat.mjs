import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../auto-repeat.js',import.meta.url),'utf8');
const key=Symbol.for('tamacolle-kor-auto-repeat.v1');
const names={toggle:'tamacolle-kor-repeat-toggle',prepare:'tamacolle-kor-repeat-prepare',middle:'tamacolle-kor-repeat-intermediate',stop:'tamacolle-kor-repeat-stop',reason:'tamacolle-kor-repeat-reason'};
const enumeration=names=>Object.fromEntries(names.flatMap((name,index)=>[[name,index],[index,name]]));
const Enums={
 Gamen:enumeration('Invalid GAMESTART TOP HOME SYOUEN TEAM TEAM_CHAPTER FRIENDSHIP BONDS BONDS_RESULT BONDS_ROOM_MARRIAGE ALTAR BATH BATH_DLC SHOP CHAPTER CHAPTER_END ENSEI_RESULT BATTLE QUEST RECORD BOOK_KUNITAMA BOOK_AYAKASHI BOOK_NPC BOOK_GENCHI BOOK_TAMAMORI BOOK_CLOTH BOOK_ITEM BOOK_DETAIL BOOK_VIEW GIFT SETTING GACHA GACHA_CHARA GACHA_RESULT SELECT OPENING FIRSTDANJI OPENING_EVENT SHELF_SETTING ROOM_SETTING'.split(' ')),
 Chapter:enumeration('Invalid JUNREKI TOUBATSU ENSEI ROKUHARA SPECIAL1 SPECIAL2 MON TUE WED THU FRI SAT SUN CATEGORY STORY BATTLE ENSEISTAGE BOSSBATTLE'.split(' ')),
 ChapterState:enumeration(['Never','Show','Clear']),Rank:enumeration(['S','A','B','C','D']),
 StageType:enumeration('START BATTLE TREASURE TRAP BOSS WAVE CONTINUOUS CHANGE BRANCH WAVING WAVEND'.split(' '))
};
const MISSION=52,NEXT=53,GROUP=11,PARTY=[101,102,-1,104,105,106,201,-1,203,204,-1,206];

// Transitions are deliberately completed by the fixture, never by DirectSet itself.
// Native actions run on the same deterministic clock as heartbeat and departure delays.
function fixture({seed=true,enabled=true}={}){
 let clock=1000,serial=0,controller,scene;
 const work=new Map(),windowEvents=new Map(),documentEvents=new Map();
 const calls={direct:[],prepare:[],depart:[],starts:[],approval:[],alerts:[],stoppedActions:[],home:0,next:0,unrelated:0,save:0,sharedStopAll:0};
 const add=(map,type,fn)=>{let set=map.get(type);if(!set)map.set(type,set=new Set());set.add(fn);};
 const dispatch=(map,type,event={})=>{for(const fn of [...map.get(type)||[]])fn(event);};
 const schedule=(fn,delay=0,owner=null)=>{const id=++serial;work.set(id,{at:clock+delay,fn,owner});return id;};
 function runUntil(target){
  for(;;){let first;for(const [id,item]of work)if(item.at<=target&&(!first||item.at<first[1].at||item.at===first[1].at&&id<first[0]))first=[id,item];
   if(!first)break;clock=first[1].at;work.delete(first[0]);first[1].fn();
  }clock=target;
 }
 function advance(ms=0){const end=clock+ms;do{runUntil(Math.min(end,clock+50));controller?.tick();}while(clock<end);}
 class Node{
  constructor(name=''){Object.assign(this,{name,children:[],_components:[],parent:null,active:true,opacity:255,x:0,y:0,width:100,height:40,anchorX:0.5,anchorY:0.5,scaleX:1,scaleY:1,destroyed:false});this.listeners=new Map();this.actions=new Set();}
  get activeInHierarchy(){return !this.destroyed&&this.active&&(!this.parent||this.parent.activeInHierarchy);}
  addChild(node){node.removeFromParent();node.parent=this;this.children.push(node);}
  removeFromParent(){if(this.parent){const index=this.parent.children.indexOf(this);if(index>=0)this.parent.children.splice(index,1);this.parent=null;}}
  getChildByName(name){return this.children.find(node=>node.name===name)||null;}
  addComponent(Type){const value=new Type();value.node=this;value.enabled=true;this._components.push(value);return value;}
  getComponent(Type){return this._components.find(value=>typeof Type==='string'?value.kind===Type||value.constructor.name===Type:value instanceof Type)||null;}
  getComponents(Type){return this._components.filter(value=>!Type||value instanceof Type);}
  on(type,fn,target){let entries=this.listeners.get(type);if(!entries)this.listeners.set(type,entries=[]);entries.push({fn,target});}
  off(type,fn,target){this.listeners.set(type,(this.listeners.get(type)||[]).filter(entry=>entry.fn!==fn||target&&entry.target!==target));}
  emit(type,...args){for(const {fn,target}of [...this.listeners.get(type)||[]])fn.apply(target,args);}
  setPosition(x,y){if(typeof x==='object')({x,y}=x);this.x=x;this.y=y;}
  getPosition(){return {x:this.x,y:this.y};}
  setContentSize(width,height){if(typeof width==='object')({width,height}=width);this.width=width;this.height=height;}
  getContentSize(){return {width:this.width,height:this.height};}
  setAnchorPoint(x,y){this.anchorX=x;this.anchorY=y;}
  setScale(x,y=x){if(typeof x==='object')({x,y}=x);this.scaleX=x;this.scaleY=y;}
  convertToWorldSpaceAR(point){let x=point.x,y=point.y;for(let node=this;node;node=node.parent){x+=node.x;y+=node.y;}return {x,y};}
  convertToNodeSpaceAR(point){const origin=this.convertToWorldSpaceAR({x:0,y:0});return {x:point.x-origin.x,y:point.y-origin.y};}
  runAction(action){this.actions.add(action);let offset=0;const visit=item=>{if(item.type==='sequence'){for(const child of item.items)visit(child);}else if(item.type==='call')schedule(()=>{if(this.actions.has(action))item.fn.call(item.target);},offset,this);else offset+=item.duration||0;};visit(action);schedule(()=>this.actions.delete(action),offset,this);return action;}
  stopAction(action){calls.stoppedActions.push({node:this.name,seconds:action.getDuration()});this.actions.delete(action);}
  stopAllActions(){if(this.name==='GMaddComponents')calls.sharedStopAll++;this.actions.clear();}
  destroy(){this.destroyed=true;this.actions.clear();this.listeners.clear();for(const child of [...this.children])child.destroy();this.removeFromParent();}
 }
 Node.EventType={TOUCH_END:'touchend',TOUCH_START:'touchstart'};
 class Label{constructor(){this.string='';this.fontSize=20;this.lineHeight=24;}}
 Label.HorizontalAlign={LEFT:0,CENTER:1,RIGHT:2};Label.VerticalAlign={TOP:0,CENTER:1,BOTTOM:2};Label.Overflow={NONE:0,CLAMP:1,SHRINK:2,RESIZE_HEIGHT:3};
 class Button{constructor(){this.interactable=true;this.clickEvents=[];}}
 Button.EventType={CLICK:'click'};Button.Transition={NONE:0,COLOR:1,SPRITE:2,SCALE:3};
 class Toggle extends Button{constructor(){super();this.isChecked=false;this.checkEvents=[];}}
 Toggle.EventType={TOGGLE:'toggle'};
 class Graphics{clear(){}rect(){}roundRect(){}moveTo(){}lineTo(){}stroke(){}fill(){}circle(){}}
 class Color{constructor(r=255,g=255,b=255,a=255){Object.assign(this,{r,g,b,a});}}
 Color.WHITE=new Color();Color.BLACK=new Color(0,0,0);
 const action=(type,duration=0,extra={})=>({type,duration:duration*1000,...extra,easing(){return this;},getDuration(){return this.type==='sequence'?this.items.reduce((sum,item)=>sum+item.getDuration(),0):this.duration/1000;}});
 const cc={Node,Label,Button,Toggle,Graphics,Color,Vec2:class{constructor(x=0,y=0){Object.assign(this,{x,y});}},v2:(x,y)=>({x,y}),color:(...args)=>new Color(...args),size:(width,height)=>({width,height}),
  isValid:value=>!!value&&!value.destroyed,director:{getScene:()=>scene},js:{getClassName:value=>value.kind||value.constructor.name},
  sequence:(...items)=>action('sequence',0,{items}),delayTime:duration=>action('delay',duration),callFunc:(fn,target)=>action('call',0,{fn,target}),
  fadeIn:duration=>action('fade',duration),fadeOut:duration=>action('fade',duration),scaleTo:duration=>action('scale',duration),easeInOut:()=>({})};
 const node=(name,parent,geometry={})=>{const value=new Node(name);parent?.addChild(value);Object.assign(value,geometry);return value;};
 scene=node('game');const managers=node('Managers',scene),managerNode=node('GameManager',managers),endNode=node('GMaddComponents',managers),battleNode=node('BattleManager',managers),canvas=node('Canvas',scene,{width:1024,height:576});
 const component=(kind,owner,properties={})=>{const value={kind,node:owner,enabled:true,enabledInHierarchy:true,...properties};value.getComponent=name=>owner.getComponent(name);owner._components.push(value);return value;};
 const stat={gamenName:Enums.Gamen.TEAM_CHAPTER,startDate:1700000000,totalSec:0,lastChapterID:MISSION};
 for(const flag of 'isServerAccess isChanging isFade isAnimation isEvent isLoading isSelect isOption isConfirm isInfo isMainMenu isNews isTutorial isEquip isEventLoading isQuick isAutoEvent isSaving'.split(' '))stat[flag]=false;
 const play={selectedTeamNo:1,playingChapterID:MISSION,team:[Array(12).fill(-1),[...PARTY]],ensei:[{id:-1},{id:-1}],chapter:{[MISSION]:Enums.ChapterState.Clear,[NEXT]:Enums.ChapterState.Never}};
 const GV={stat,play};
 const chapter=[MISSION,NEXT].map((id,index)=>({id,group:GROUP,type:Enums.Chapter.BATTLE,next:-1,map:7+index,file:'',scenarioNo:-1,endDate:-1,clearType:3}));
 const master={chapter,chaPos:{[MISSION]:{master:0},[NEXT]:{master:1}},map:[{id:7},{id:8}],mapPos:{7:{master:0},8:{master:1}}};
 const gm=component('GameManager',managerNode,{GV,master,battleNode,CanvasNode:canvas});stat.GM=gm;
 const info=component('InfoGamen',managerNode,{GV,gm,Alert(text){calls.alerts.push(text);stat.isInfo=true;},Error(text){calls.alerts.push(text);stat.isInfo=true;}});
 const change=component('ChangeGamen',managerNode,{GV,gm,Change(mode){stat.motoGamen=stat.gamenName;stat.gamenName=mode;}});
 const team=component('TeamGamen',managerNode,{GV,gm,guard:'',CheckSyutsujinStatus(){return this.guard;}});
 const battlePlay=component('BattlePlay',battleNode,{GV,gm,stageNo:1,evacuate:false,showDecision:false});
 const battle=component('BattleGamen',battleNode,{GV,gm,battlePlay,mapNo:7,clearData:{missionClear:true,targetRouteNo:1},resultDetail:[['5_0']],BattleStart(){stat.isServerAccess=true;}});
 const stage=component('StageSelectGamen',managerNode,{GV,gm,master,changeGamen:change,selectedChapterGroupID:GROUP,pushedChapterID:MISSION,battleChapter:true,enseiChapter:false,syutsujin:false,chapterList:[],scrollViewAnimation:false,topAnimation:false,
  DirectSet(group,id=-1){calls.direct.push({group,id});this.directGroupID=group;this.directChapterID=id;this.chapterList=[];stat.isChanging=true;change.Change(Enums.Gamen.CHAPTER);},
  ChapterBtnPushPrepare(index){calls.prepare.push(index);const entry=this.chapterList[index];assert.ok(entry,'native chapter selection takes a list INDEX, not a chapter ID');const row=chapter[master.chaPos[entry.id].master];if(row.endDate!==-1&&row.endDate<stat.startDate+stat.totalSec){info.Alert('任務の期限が過ぎています\n');return;}this.ChapterBtnPush(entry.id);},
  ChapterBtnPush(id){this.pushedChapterID=id;this.battleChapter=true;this.enseiChapter=false;stat.isChanging=true;change.Change(Enums.Gamen.TEAM_CHAPTER);},
  SyutsujinBtnPush(){calls.depart.push({mode:stat.gamenName,id:this.pushedChapterID});if(this.syutsujin)return;if(play.ensei[play.selectedTeamNo].id!==-1){info.Alert('遠征中の部隊は出陣できません');return;}const reason=team.CheckSyutsujinStatus();if(reason){info.Alert('出陣の条件が整っていません\n'+reason);return;}this.syutsujin=true;this.StartChapter();},
  StartChapter(){calls.starts.push({id:this.pushedChapterID,group:this.selectedChapterGroupID,teamNo:play.selectedTeamNo,slots:[...play.team[play.selectedTeamNo]]});this.lastPlayedChapterID=this.pushedChapterID;play.playingChapterID=this.pushedChapterID;stat.lastChapterID=this.pushedChapterID;calls.save++;battle.mapNo=chapter[master.chaPos[this.pushedChapterID].master].map;result.finalResultServerData='';result.finalResult.active=false;result.homeBtn.active=false;result.mission=false;battle.BattleStart();}
 });
 const decision=node('decision',canvas,{x:-225,y:20,width:0,height:0,active:false});
 const home=node('homeBtn',decision,{x:11,y:-30,width:358,height:250});
 const next=node('stageBtn',decision,{x:446,y:-30,width:358,height:210});
 const barParent=node('decisionBarParent',decision,{x:10,y:-180,width:794,height:10,active:false}),bar=node('decisionBar',barParent);
 const end=component('ChapterEnd',endNode,{GV,gm,chapterID:MISSION,showDecision:false,decision,homeBtn:home,stageBtn:next,decisionBar:bar,decisionBarParent:barParent,
  CheckMissionClear(){return battle.clearData.missionClear&&!battlePlay.evacuate;},
  Reset(){result.mission=false;result.sRank=false;},
  CheckChapterClear(id,battleChapter){if(battleChapter)result.mission=this.CheckMissionClear();return 0;},
  ChapterEndCheck(id,battleChapter=false){this.Reset();this.chapterID=id;this.CheckChapterClear(id,battleChapter);},
  ChapterEndStart(){result.finalResult.active=false;change.Change(Enums.Gamen.CHAPTER_END);this.Finish();},
  Finish(){this.Reset();this.ShowDecision();this.node.runAction(cc.sequence(cc.delayTime(15),cc.callFunc(()=>{if(this.showDecision)this.HideDecision(true);})));},
  ShowDecision(){decision.active=true;decision.opacity=255;home.setScale(1);next.setScale(1);this.showDecision=true;barParent.active=true;bar.runAction(cc.scaleTo(15,1,1));},
  HideDecision(goHome=true){this.showDecision=false;bar.stopAllActions();decision.runAction(cc.sequence(cc.delayTime(0.1),cc.fadeOut(0.2),cc.callFunc(()=>{goHome?this.GoHome():this.GoStage();barParent.active=false;decision.active=false;})));},
  TouchHomeBtn(){if(this.showDecision)this.HideDecision(true);},TouchStageBtn(){if(this.showDecision)this.HideDecision(false);},
  GoHome(){calls.home++;change.Change(Enums.Gamen.HOME);},GoStage(){calls.next++;stage.DirectSet(stage.selectedChapterGroupID,NEXT);}
 });
 const middle=node('decision',canvas,{x:50,y:-180,width:0,height:0,active:false});
 node('base',middle,{x:225,y:0,width:476,height:220});
 node('back',middle,{x:111,y:-8,width:210,height:149});node('go',middle,{x:346,y:-8,width:210,height:149});
 const result=component('ResultGamen',battleNode,{GV,gm,battle,battlePlay,master,mission:false,enseiChapter:false,senkaKunitamaNum:5,finalResultServerData:'',finalResultServerWaiting:false,
  decision:middle,
  finalResult:node('finalResult',canvas,{active:false}),homeBtn:node('reportApproval',canvas,{active:false}),
  BattleResultSuccess(data){this.finalResultServerData=data;},
  ShowFinalResultMain(){this.finalResult.active=true;end.ChapterEndCheck(play.playingChapterID,true);},
  ShowBackBtn(){this.homeBtn.active=true;},SetResultState(){const [survivors,enemies]=battle.resultDetail[battlePlay.stageNo-1][0].split('_');this.senkaKunitamaNum=parseInt(survivors);this.senkaEnemyNum=parseInt(enemies);},
  TouchHomeBtn(){this.Approval();},
  Approval(){calls.approval.push(play.playingChapterID);this.node.runAction(cc.sequence(cc.delayTime(0.1),cc.callFunc(()=>{this.homeBtn.active=false;}),cc.delayTime(2.3),cc.callFunc(()=>this.FinalResultEnd())));},
  FinalResultEnd(){end.ChapterEndStart();}
 });
 Object.assign(gm,{stageSelectGamen:stage,chapterEnd:end,infoGamen:info,changeGamen:change,teamGamen:team,battle,result,serverFunctions:{responseWaiting:false},save:{serverSaveWait:false,changeGamenWaiting:false,CheckAndSave(){calls.save++;}}});battle.result=result;
 const document={hidden:false,addEventListener:(type,fn)=>add(documentEvents,type,fn),removeEventListener:(type,fn)=>documentEvents.get(type)?.delete(fn)};
 const sandbox={cc,document,console,Date,setTimeout:(fn,delay)=>schedule(fn,delay),clearTimeout:id=>work.delete(id),addEventListener:(type,fn)=>add(windowEvents,type,fn),removeEventListener:(type,fn)=>windowEvents.get(type)?.delete(fn),__require:name=>{if(name==='Enums')return Enums;throw Error('Unexpected native module '+name);}};
 sandbox.window=sandbox;const context=vm.createContext(sandbox);
 const load=()=>{vm.runInContext(source,context,{filename:'auto-repeat.js'});controller=sandbox[key].create({getEngine:()=>cc,now:()=>clock});controller.configure(enabled);controller.tick();return controller;};
 load();
 function enterBattle(){stat.isServerAccess=false;stat.isChanging=false;stat.isAnimation=false;change.Change(Enums.Gamen.BATTLE);stage.syutsujin=false;}
 function readyReport({mission=true,ready=true,server=true,ensei=false}={}){battle.clearData.missionClear=mission;result.enseiChapter=ensei;if(server)result.BattleResultSuccess(JSON.stringify({chapterID:play.playingChapterID,mission}));result.ShowFinalResultMain(result.finalResultServerData);if(ready)result.ShowBackBtn();}
 function listReady({missing=false}={}){stage.selectedChapterGroupID=stage.directGroupID;stage.chapterList=missing?[{id:NEXT}]:[{id:NEXT},{id:MISSION}];stat.isChanging=false;}
 function teamReady(){stat.isChanging=false;}
 const find=(name,root=scene)=>{if(root.name===name&&!root.destroyed)return root;for(const child of root.children){const found=find(name,child);if(found)return found;}return null;};
 function click(name){const target=find(name);assert.ok(target,`owned native control ${name} exists`);assert.equal(target.activeInHierarchy,true,`owned native control ${name} is visible`);const button=target.getComponent(Toggle)||target.getComponent(Button);if(button instanceof Toggle){button.isChecked=!button.isChecked;target.emit('toggle',button);}else target.emit('click',button||{target});}
 function clearCalls(){for(const name of Object.keys(calls))Array.isArray(calls[name])?calls[name].length=0:calls[name]=0;}
 const f={cc,context,sandbox,document,scene,canvas,managerNode,endNode,battleNode,gm,stage,team,end,result,battle,battlePlay,stat,play,master,calls,advance,find,click,listReady,teamReady,enterBattle,readyReport,load,
  get controller(){return controller;},dispatchWindow:(type,event)=>dispatch(windowEvents,type,event),dispatchDocument:(type,event)=>dispatch(documentEvents,type,event),
  arm(){click(names.toggle);assert.equal(controller.status().checked,true,'only the owned checkbox arms repetition');},
  depart(){advance(1500);assert.equal(calls.direct.length,1);listReady();advance(100);assert.deepEqual(calls.prepare,[1]);teamReady();advance(100);assert.equal(calls.starts.length,1);},
  dispose(){controller.dispose();}
 };
 if(seed){stage.SyutsujinBtnPush();enterBattle();readyReport();result.TouchHomeBtn();advance(2500);clearCalls();assert.equal(stat.gamenName,Enums.Gamen.CHAPTER_END);}
 return f;
}

function assertStopped(f){assert.equal(f.controller.status().checked,false);assert.ok(f.controller.status().reason,'a stopped loop explains why');}
function assertNoDeparture(f){assert.equal(f.calls.starts.length,0);assert.equal(f.calls.depart.length,0);}

test('repeat is default Off, native menu buttons still mean manor or NEXT, and old incomplete fixtures are inert',()=>{
 const f=fixture();assert.equal(f.controller.status().checked,false);assert.ok(f.find(names.toggle));f.advance(5000);assertNoDeparture(f);assert.equal(f.calls.direct.length,0);
 f.end.TouchHomeBtn();f.advance(350);assert.equal(f.calls.home,1);assert.equal(f.stat.gamenName,Enums.Gamen.HOME);f.dispose();
 const g=fixture();g.end.TouchStageBtn();g.advance(350);assert.equal(g.calls.next,1);assert.deepEqual(g.calls.direct,[{group:GROUP,id:NEXT}]);assertNoDeparture(g);g.dispose();
 const context=vm.createContext({window:{},document:{hidden:false},console});vm.runInContext(source,context);const controller=context[key].create({getEngine:()=>({director:{getScene:()=>({children:[]})}})});controller.configure(true);controller.tick();assert.equal(controller.status().checked,false);controller.dispose();
});

test('the prebattle option waits for manual departure, survives a double tap, then repeats the same complete mission',()=>{
 const f=fixture({seed:false});assert.equal(f.find(names.prepare).activeInHierarchy,true);assert.equal(f.controller.status().checked,false);
 f.click(names.prepare);f.advance(15000);f.controller.configure(true);assert.equal(f.controller.status().checked,true);assertNoDeparture(f);assert.equal(f.calls.direct.length,0);
 f.stage.SyutsujinBtnPush();f.stage.SyutsujinBtnPush();assert.equal(f.calls.starts.length,1);assert.equal(f.controller.status().checked,true);
 f.enterBattle();f.readyReport();f.advance(2600);assert.equal(f.calls.approval.length,1);assert.equal(f.controller.status().completed,1);
 f.advance(1200);assert.deepEqual(f.calls.direct,[{group:GROUP,id:MISSION}]);f.listReady();f.advance(100);f.teamReady();f.advance(100);
 assert.equal(f.calls.starts.length,2);assert.deepEqual(f.calls.starts[1],f.calls.starts[0]);f.enterBattle();f.click(names.stop);f.advance(3000);
 assertStopped(f);assert.equal(f.calls.starts.length,2);f.dispose();
});

test('prebattle unchecking, changed party, and leaving preparation cancel without automatically starting',()=>{
 for(const change of ['checkbox','party','navigation']){
  const f=fixture({seed:false});f.click(names.prepare);
  if(change==='checkbox')f.click(names.prepare);
  if(change==='party')f.play.team[1][11]=999;
  if(change==='navigation')f.gm.changeGamen.Change(Enums.Gamen.HOME);
  f.advance(15000);assertStopped(f);assertNoDeparture(f);assert.equal(f.calls.direct.length,0);f.dispose();
 }
 const f=fixture({seed:false});f.master.chapter[0].file='scenario';f.advance();assert.equal(f.find(names.prepare).activeInHierarchy,false);assertNoDeparture(f);f.dispose();
});

test('stopping shows only a transient notice and catalog configuration cannot resurrect it',()=>{
 const f=fixture();f.arm();f.click(names.stop);assert.equal(f.find(names.reason).activeInHierarchy,true);
 f.advance(3100);assert.equal(f.find(names.reason).activeInHierarchy,false);assertStopped(f);
 f.controller.configure(true);f.advance(500);assert.equal(f.find(names.reason).activeInHierarchy,false);assertNoDeparture(f);f.dispose();
});

test('an intermediate return/continue checkbox arms the current whole mission, not its internal encounter',()=>{
 const f=fixture({seed:false});f.stage.SyutsujinBtnPush();f.enterBattle();f.battlePlay.stageNo=3;
 f.result.decision.active=true;f.advance();assert.equal(f.find(names.middle).activeInHierarchy,true);
 f.click(names.middle);f.advance(2000);assert.equal(f.controller.status().checked,true);assert.equal(f.calls.starts.length,1);assert.equal(f.calls.direct.length,0);assert.equal(f.calls.approval.length,0);
 f.result.decision.active=false;f.readyReport();f.advance(2600);assert.equal(f.controller.status().completed,1);f.advance(1200);
 assert.deepEqual(f.calls.direct,[{group:GROUP,id:MISSION}]);f.listReady();f.advance(100);f.teamReady();f.advance(100);
 assert.equal(f.calls.starts.length,2);assert.deepEqual(f.calls.starts[1],f.calls.starts[0]);f.dispose();
});

test('a hot-loaded mid-mission checkbox recovers only coherent native identity and Off cancels the next repeat',()=>{
 const f=fixture({seed:false});f.stage.SyutsujinBtnPush();f.enterBattle();f.dispose();f.load();f.result.decision.active=true;f.advance();
 f.click(names.middle);assert.equal(f.controller.status().checked,true);f.click(names.middle);assertStopped(f);
 f.result.decision.active=false;f.readyReport();f.advance(5000);assert.equal(f.calls.starts.length,1);assert.equal(f.calls.approval.length,0);assert.equal(f.calls.direct.length,0);f.dispose();
 const g=fixture({seed:false});g.stage.SyutsujinBtnPush();g.enterBattle();g.result.decision.active=true;g.stage.lastPlayedChapterID=NEXT;g.advance();g.click(names.middle);
 assertStopped(g);g.advance(2000);assert.equal(g.calls.starts.length,1);assert.equal(g.calls.approval.length,0);g.dispose();
});

test('loading at the final report still exposes the later completed-mission checkbox without arming it',()=>{
 const f=fixture({seed:false});f.stage.SyutsujinBtnPush();f.enterBattle();f.readyReport();f.dispose();f.load();
 f.result.TouchHomeBtn();f.advance(2500);assert.equal(f.find(names.toggle).activeInHierarchy,true);assert.equal(f.controller.status().checked,false);assert.equal(f.calls.direct.length,0);
 f.arm();f.advance(1500);assert.deepEqual(f.calls.direct,[{group:GROUP,id:MISSION}]);assert.equal(f.calls.starts.length,1);f.dispose();
});

test('two whole-mission cycles use the same mission, group and all party slots, with one normal native start each',()=>{
 const f=fixture();f.arm();
 for(let cycle=1;cycle<=2;cycle++){
  f.advance(1500);assert.equal(f.calls.direct.length,cycle);assert.deepEqual(f.calls.direct.at(-1),{group:GROUP,id:MISSION});
  f.advance(400);assert.equal(f.calls.prepare.length,cycle-1,'DirectSet only opens the list');assert.equal(f.calls.starts.length,cycle-1);
  f.listReady();f.advance(100);assert.equal(f.calls.prepare.at(-1),1,'use the matching list index, not mission ID or next row');assert.equal(f.calls.starts.length,cycle-1,'team transition must finish first');
  f.teamReady();f.advance(100);assert.equal(f.calls.starts.length,cycle);assert.equal(f.calls.depart.length,cycle);assert.deepEqual(f.calls.starts.at(-1),{id:MISSION,group:GROUP,teamNo:1,slots:PARTY});
  f.enterBattle();f.advance(200);f.readyReport({ready:false});f.advance(300);assert.equal(f.calls.approval.length,cycle-1,'the final report must expose Approval before automation');
  f.result.ShowBackBtn();f.advance(1500);assert.equal(f.calls.approval.length,cycle);f.advance(1500);assert.equal(f.calls.approval.length,cycle,'Approval may animate with its home button still visible');
  assert.equal(f.stat.gamenName,Enums.Gamen.CHAPTER_END);assert.equal(f.controller.status().checked,true);assert.equal(f.controller.status().completed,cycle);
 }
 assert.equal(f.calls.next,0);assert.equal(f.calls.home,0);f.click(names.stop);f.advance(2000);assert.equal(f.calls.starts.length,2);assertStopped(f);f.dispose();
});

test('manual report Approval is observed once while native animation is pending',()=>{
 const f=fixture();f.arm();f.depart();f.enterBattle();f.readyReport();f.result.TouchHomeBtn();f.result.TouchHomeBtn();assert.equal(f.calls.approval.length,1);f.advance(2000);assert.equal(f.calls.approval.length,1);f.advance(500);assert.equal(f.stat.gamenName,Enums.Gamen.CHAPTER_END);assert.equal(f.controller.status().checked,true);f.dispose();
});

test('repeated accepted enabled CONFIG/resource revisions neither disarm nor duplicate pending departures or Approval',()=>{
 const f=fixture();f.arm();f.advance(500);for(let i=0;i<5;i++)f.controller.configure(true);assert.equal(f.controller.status().checked,true);f.advance(1000);assert.equal(f.calls.direct.length,1);
 for(let i=0;i<5;i++){f.controller.configure(true);f.advance(100);}assert.equal(f.calls.direct.length,1);assertNoDeparture(f);
 f.listReady();f.advance(100);for(let i=0;i<5;i++)f.controller.configure(true);f.teamReady();f.advance(100);assert.equal(f.calls.starts.length,1);f.enterBattle();f.readyReport();f.advance(1500);
 for(let i=0;i<5;i++){f.controller.configure(true);f.advance(100);}assert.equal(f.calls.approval.length,1);assert.equal(f.calls.starts.length,1);f.dispose();
});

for(const condition of ['expired','injured','expedition','party-slot','party-number','different-mission','different-group','missing-mission'])test(`native preparation safely refuses ${condition} without restoring old party or bypassing guards`,()=>{
 const f=fixture();f.arm();f.advance(1500);
 if(condition==='expired')f.master.chapter[0].endDate=f.stat.startDate-1;
 if(condition==='injured')f.team.guard='負傷中';
 if(condition==='expedition')f.play.ensei[1].id=99;
 if(condition==='party-slot')f.play.team[1][11]=999;
 if(condition==='party-number')f.play.selectedTeamNo=0;
 f.listReady({missing:condition==='missing-mission'});f.advance(100);
 if(condition==='different-mission')f.stage.pushedChapterID=NEXT;
 if(condition==='different-group')f.stage.selectedChapterGroupID=GROUP+1;
 f.teamReady();f.advance(65000);assert.equal(f.calls.starts.length,0);assertStopped(f);
 if(condition==='expired')assert.equal(f.calls.prepare.length,1,'native expiry selection check must run');
 if(condition==='injured'){assert.equal(f.calls.depart.length,1,'normal native departure guard must run');assert.equal(f.calls.alerts.length,1);}
 if(condition==='party-slot')assert.equal(f.play.team[1][11],999,'never overwrite the user party');f.dispose();
});

for(const failure of ['modal','alert','error','defeat','retreat','story','server-failed','navigation'])test(`armed loop stops for ${failure} and never retries or dismisses native UI`,()=>{
 const f=fixture();f.arm();
 if(failure==='modal')f.stat.isConfirm=true;
 if(failure==='alert')f.gm.infoGamen.Alert('native alert');
 if(failure==='error')f.gm.infoGamen.Error('native error');
 if(['defeat','retreat','story','server-failed'].includes(failure)){
  f.depart();f.enterBattle();
  if(failure==='defeat')f.readyReport({mission:false});
  if(failure==='retreat'){f.battlePlay.evacuate=true;f.readyReport();}
  if(failure==='story')f.stat.isEvent=true;
  if(failure==='server-failed'){f.stat.isServerAccess=true;f.gm.infoGamen.Error('save/server failure');}
 }
 if(failure==='navigation')f.gm.changeGamen.Change(Enums.Gamen.HOME);
 const starts=f.calls.starts.length;f.advance(65000);assertStopped(f);assert.equal(f.calls.starts.length,starts);assert.equal(f.calls.approval.length,0);if(failure==='modal')assert.equal(f.stat.isConfirm,true);f.dispose();
});

for(const boundary of ['countdown','chapter-list','team-transition','departure','battle','report-server','report-button','approval','next-menu'])test(`owned Stop or prebattle Off cancels future actions at ${boundary} without undoing native work`,()=>{
 const f=fixture();f.arm();
 if(boundary!=='countdown')f.advance(1500);
 if(!['countdown','chapter-list'].includes(boundary)){f.listReady();f.advance(100);}
 if(!['countdown','chapter-list','team-transition'].includes(boundary)){f.teamReady();f.advance(100);}
 if(['battle','report-server','report-button','approval','next-menu'].includes(boundary)){f.enterBattle();f.advance(100);}
 if(boundary==='report-server')f.readyReport({server:false});
 if(boundary==='report-button')f.readyReport({ready:false});
 if(['approval','next-menu'].includes(boundary)){f.readyReport();f.advance(1500);assert.equal(f.calls.approval.length,1);}
 if(boundary==='next-menu')f.advance(1000);
 const starts=f.calls.starts.length,acks=f.calls.approval.length;f.click(boundary==='team-transition'?names.prepare:names.stop);assertStopped(f);
 f.listReady();f.teamReady();if(boundary==='report-server')f.result.BattleResultSuccess('{}');if(boundary==='report-button')f.result.ShowBackBtn();f.advance(20000);
 assert.equal(f.calls.starts.length,starts);assert.equal(f.calls.approval.length,acks);assert.equal(f.calls.next,0);f.dispose();
});

test('unchecking, explicit translation Off, page exit, and manual manor/continue cancel an armed countdown',()=>{
 for(const stop of ['checkbox','off','pagehide','home','continue']){
  const f=fixture();f.arm();
  if(stop==='checkbox')f.click(names.toggle);
  if(stop==='off')f.controller.configure(false);
  if(stop==='pagehide')f.dispatchWindow('pagehide');
  if(stop==='home')f.end.TouchHomeBtn();
  if(stop==='continue')f.end.TouchStageBtn();
  f.advance(2000);assertStopped(f);assertNoDeparture(f);
  if(stop==='home')assert.equal(f.calls.home,1);
  if(stop==='continue'){assert.equal(f.calls.next,1);assert.equal(f.calls.direct[0].id,NEXT);}
  if(stop==='off'){f.controller.configure(true);f.advance(2000);assertNoDeparture(f);assert.equal(f.controller.status().checked,false);}
  f.dispose();
 }
});

test('a hidden tab pauses departure and its deadline, then resumes with time to cancel',()=>{
 const f=fixture();f.arm();f.advance(500);f.document.hidden=true;f.dispatchDocument('visibilitychange');f.advance(65000);
 assert.equal(f.controller.status().checked,true);assert.equal(f.calls.direct.length,0);assertNoDeparture(f);assert.equal(f.calls.home,0);
 f.document.hidden=false;f.dispatchDocument('visibilitychange');f.advance(400);assert.equal(f.calls.direct.length,0);
 f.advance(200);assert.equal(f.calls.direct.length,1);f.listReady();f.advance(100);f.teamReady();f.advance(100);
 assert.equal(f.calls.starts.length,1);f.dispose();
});

test('captured 15-second ChapterEnd home timer cannot escape armed state or kill unrelated shared-node actions',()=>{
 const f=fixture();f.endNode.runAction(f.cc.sequence(f.cc.delayTime(15),f.cc.callFunc(()=>f.calls.unrelated++)));f.arm();f.advance(1500);assert.equal(f.calls.direct.length,1);f.advance(15000);
 assert.equal(f.calls.home,0);assert.equal(f.calls.next,0);assert.equal(f.calls.unrelated,1);assert.equal(f.calls.sharedStopAll,0);assert.deepEqual(f.calls.stoppedActions.filter(item=>item.node==='GMaddComponents'),[{node:'GMaddComponents',seconds:15}]);assertNoDeparture(f);f.dispose();
});

test('dispose cancels every pending boundary, removes only owned UI, and restores native method descriptors',()=>{
 for(const boundary of ['countdown','list','team','battle','report']){
  const f=fixture();f.dispose();
  const watched=[[f.stage,'StartChapter'],[f.stage,'SyutsujinBtnPush'],[f.stage,'DirectSet'],[f.stage,'ChapterBtnPushPrepare'],[f.endNode,'runAction'],[f.end,'CheckChapterClear'],[f.end,'Finish'],[f.end,'ShowDecision'],[f.end,'HideDecision'],[f.end,'TouchHomeBtn'],[f.end,'TouchStageBtn'],[f.result,'Approval'],[f.result,'TouchHomeBtn'],[f.result,'BattleResultSuccess'],[f.result,'ShowBackBtn'],[f.gm.infoGamen,'Alert'],[f.gm.infoGamen,'Error']];
  const descriptors=watched.map(([owner,name])=>Object.getOwnPropertyDescriptor(owner,name));f.result.mission=true;f.load();f.end.ShowDecision();f.advance();f.arm();
  if(boundary!=='countdown')f.advance(1500);
  if(['team','battle','report'].includes(boundary)){f.listReady();f.advance(100);}
  if(['battle','report'].includes(boundary)){f.teamReady();f.advance(100);f.enterBattle();}
  if(boundary==='report')f.readyReport({ready:false});
  const starts=f.calls.starts.length,acks=f.calls.approval.length;f.dispose();
  assert.equal(f.find(names.toggle),null);assert.equal(f.find(names.stop),null);assert.ok(f.end.decision&&!f.end.decision.destroyed);assert.ok(f.end.homeBtn&&!f.end.homeBtn.destroyed);
  watched.forEach(([owner,name],index)=>assert.deepEqual(Object.getOwnPropertyDescriptor(owner,name),descriptors[index],`restore native descriptor ${name}`));
  f.listReady();f.teamReady();f.result.ShowBackBtn();f.advance(2500);assert.equal(f.calls.starts.length,starts);assert.equal(f.calls.approval.length,acks);assert.equal(f.calls.next,0);
 }
});

test('a later owner replacement survives dispose, and reloaded controller never remembers checked state',()=>{
 const f=fixture();f.arm();const replacement=function(){f.calls.alerts.push('replacement');};f.gm.infoGamen.Alert=replacement;f.dispose();assert.equal(f.gm.infoGamen.Alert,replacement);
 const previous=f.controller;assert.equal(f.result.mission,false,'native Finish.Reset erased its result flag');f.load();previous.tick();f.end.ShowDecision();f.advance(2000);assert.equal(f.controller.status().checked,false);assertNoDeparture(f);assert.equal(f.calls.direct.length,0);assert.equal(f.find(names.toggle)?.activeInHierarchy,true);f.dispose();
});

test('mismatched native component identity or enum shape remains inert instead of binding unrelated game objects',()=>{
 for(const mismatch of ['component','reference','enums']){
  const f=fixture({seed:false});
  if(mismatch==='component')f.managerNode._components.splice(f.managerNode._components.indexOf(f.stage),1);
  if(mismatch==='reference')f.stage.gm={GV:f.gm.GV};
  if(mismatch==='enums')f.sandbox.__require=()=>({Gamen:{HOME:2,TEAM_CHAPTER:7,CHAPTER:16,CHAPTER_END:17,BATTLE:19}});
  f.controller.tick();f.end.ShowDecision();f.advance(2000);assert.equal(f.controller.status().checked,false);assertNoDeparture(f);assert.equal(f.calls.direct.length,0);f.dispose();
 }
});

test('native busy/save flags defer list and team operations without duplicate departure when they clear',()=>{
 const f=fixture();f.arm();f.stat.isServerAccess=true;f.advance(2000);assert.equal(f.calls.direct.length,0);
 f.stat.isServerAccess=false;f.advance(100);assert.equal(f.calls.direct.length,1);f.listReady();f.stat.isAnimation=true;f.advance(1000);assert.equal(f.calls.prepare.length,0);
 f.stat.isAnimation=false;f.advance(100);assert.deepEqual(f.calls.prepare,[1]);f.teamReady();
 for(const [owner,key]of [[f.gm.serverFunctions,'responseWaiting'],[f.gm.save,'serverSaveWait'],[f.gm.save,'changeGamenWaiting']]){
  owner[key]=true;f.advance(1000);assertNoDeparture(f);owner[key]=false;
 }
 f.advance(100);assert.equal(f.calls.starts.length,1);f.advance(1000);assert.equal(f.calls.starts.length,1);f.dispose();
});

test('stale report visuals cannot approve before fresh server success and a fresh ready button',()=>{
 const f=fixture();f.arm();f.depart();f.enterBattle();f.readyReport({server:false});f.advance(2000);assert.equal(f.calls.approval.length,0);
 f.result.BattleResultSuccess('{}');f.advance(2000);assert.equal(f.calls.approval.length,0,'old ShowBackBtn readiness does not belong to the new server result');
 f.result.ShowBackBtn();f.advance(100);assert.equal(f.calls.approval.length,1);f.advance(500);assert.equal(f.calls.approval.length,1);f.dispose();
});

test('a native defeat before the final report disarms without acknowledging or departing again',()=>{
 const f=fixture();f.arm();f.depart();f.enterBattle();f.battle.resultDetail[0][0]='0_5';f.result.SetResultState();assert.equal(f.result.senkaKunitamaNum,0);assertStopped(f);f.readyReport({mission:false});f.advance(5000);assert.equal(f.calls.starts.length,1);assert.equal(f.calls.approval.length,0);f.dispose();
});
