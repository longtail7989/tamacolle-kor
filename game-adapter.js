/* MAIN: verified Tamacolle display state and original log preservation; never credentials or game actions. */
(()=>{'use strict';
const KEY=Symbol.for('tamacolle-kor-game-adapter.v1');if(window[KEY])return;
function create({getEngine,nativeText}){
 let scene=null,manager=null,scenario=null;const rubyOpacity=new Map(),logHooks=new Map();
 let terminalPage=null;
 const valid=value=>!!value&&(!getEngine()?.isValid||getEngine().isValid(value));
 const child=(node,name)=>node?.children?.find(value=>value.name===name);
 const component=(node,name)=>(node?._components||[]).find(value=>getEngine()?.js?.getClassName?.(value)===name);
 function protectLog(owner){
  if(typeof nativeText!=='function'||!owner||logHooks.has(owner)||typeof owner.ShowSerif!=='function'||typeof owner.SetLog!=='function')return;
  const show=owner.ShowSerif,log=owner.SetLog,ownShow=Object.getOwnPropertyDescriptor(owner,'ShowSerif'),ownLog=Object.getOwnPropertyDescriptor(owner,'SetLog'),stack=[];
  const wrappedShow=function(...args){stack.push({owner:this,chunk:args[0]});try{return show.apply(this,args);}finally{stack.pop();}};
  const wrappedLog=function(...args){const call=stack.at(-1),waku=this.serifWaku;if(call?.owner===this&&typeof call.chunk==='string'&&waku?.serif&&waku?.namae){args[0]=nativeText(waku.namae);args[1]=nativeText(waku.serif)+call.chunk;}return log.apply(this,args);};
  owner.ShowSerif=wrappedShow;owner.SetLog=wrappedLog;logHooks.set(owner,{ownShow,ownLog,wrappedShow,wrappedLog});
 }
 function bind(){
  const current=getEngine()?.director?.getScene?.();
  if(current!==scene||!valid(manager)||!valid(scenario)){
   scene=current;const managers=child(scene,'Managers');
   manager=component(child(managers,'GameManager'),'GameManager')||null;
   scenario=component(child(managers,'ScenarioManager'),'PlayScenario')||null;
  }
  protectLog(scenario);
  return {scene,manager,scenario,waku:valid(scenario?.serifWaku)?scenario.serifWaku:null};
 }
 function battleEvent(){
  const cc=getEngine(),root=cc?.director?.getScene?.(),managers=child(root,'Managers'),gm=component(child(managers,'GameManager'),'GameManager'),battle=gm?.battle,node=battle?.node;
  if(!valid(gm)||!valid(battle)||!node||node.activeInHierarchy!==true||gm.battleNode!==node||component(node,'BattleGamen')!==battle||battle.gm!==gm)return null;
  const play=component(node,'BattlePlay'),event=component(node,'BattleEvent'),anime=component(node,'BattleAnimation'),label=anime?.label?.[0];
  if(![play,event,anime,label].every(valid)||[play,event,anime].some(value=>value.node!==node||value.enabledInHierarchy===false)||battle.battlePlay!==play||play.battle!==battle||play.bEvent!==event||play.anime!==anime||event.play!==play||event.battle!==battle||anime.battle!==battle||event.GV?.play!==gm.GV?.play)return null;
  if(!(label instanceof cc.Label)&&!(cc.RichText&&label instanceof cc.RichText))return null;
  return {scene:root,manager:gm,battle,play,event,anime,label};
 }
 function under(node,parent){if(!parent)return false;for(let depth=0;node&&depth<80;depth++,node=node.parent)if(node===parent)return true;return false;}
 function excluded(label){
  const cc=getEngine(),{manager,scenario,waku}=bind();
  if(label.node?.name==='namae'&&label.node===child(child(manager?.changeGamen?.bookUI,'Detail'),'namae'))return true;
  if(label===scenario?.placeLabel)return true;
  if(under(label.node,manager?.loginFormParent)||waku?.ruby?.includes(label))return true;
  for(let node=label.node,depth=0;node&&depth<80;depth++,node=node.parent){
   // The login form uses ordinary Labels for the email/password, not EditBox children.
   if(node.name==='login'||node.name==='mailAddressLabel'||node.name==='passwordLabel')return true;
   if((node._components||[]).some(c=>(cc?.EditBox&&c instanceof cc.EditBox)||['cc.EditBox','Console'].includes(cc?.js?.getClassName?.(c))))return true;
  }
  return false;
 }
 function allowInactive(label){
  if(!valid(label))return false;const {manager,scenario}=bind();
  const result=manager?.battle?.result;
  return label===manager?.infoTelop?.infoTelopLabel||label===manager?.gotItemLabel||label===scenario?.titleLabel||label===scenario?.subTitleLabel||(valid(result)&&component(result.node,'ResultGamen')===result&&label===result.finalKunitamaName);
 }
 function context(label){const {manager,scenario,waku}=bind();if(label===waku?.serif)return 'TamacolleDialogue';if(label===waku?.namae)return 'TamacolleSpeaker';if(label===waku?.selectLabel)return 'TamacolleChoice';if(label===scenario?.titleLabel||label===scenario?.subTitleLabel)return 'TamacolleTitle';if(label===scenario?.logLabel)return 'TamacolleBacklog';const result=manager?.battle?.result;if(valid(result)&&component(result.node,'ResultGamen')===result&&label===result.finalKunitamaName)return 'TamacolleResultNames';if(label===battleEvent()?.label)return 'TamacolleDialogue / BattleEvent';return null;}
 function resultNames(label,native){
  if(typeof native!=='string'||native.length>8192)return null;
  const {manager}=bind(),result=manager?.battle?.result,master=manager?.master?.kunitama;
  if(!valid(result)||component(result.node,'ResultGamen')!==result||label!==result.finalKunitamaName||!Array.isArray(master))return null;
  const rows=native.split('\n'),bindings=[];
  if(rows.length<2||rows.length>8)return null;
  for(let i=0;i<rows.length;i++){
   const source=rows[i];if(!source)continue;
   if(bindings.length>=6||source.length>512||/[<>{}\r]/.test(source)||!master.some(row=>row?.namae===source))return null;
   const token='{TAMACOLLE_ACTOR_'+bindings.length+'}';bindings.push({token,source});rows[i]=token;
  }
  return bindings.length?{source:rows.join('\n'),bindings}:null;
 }
 function titleSource(label,native){
  const {scenario}=bind();if((label!==scenario?.titleLabel&&label!==scenario?.subTitleLabel)||typeof native!=='string')return null;
  for(let i=1;i<native.length;i+=2)if(native[i]!==' ')return native;
  let source='';for(let i=0;i<native.length;i+=2)source+=native[i];
  return source.replace(/(.)(?=.)/g,'$1 ')===native?source:native;
 }
 function speakerSource(label,native){
  const {scenario:owner,waku}=bind();
  if(label!==waku?.namae)return null;
  if(typeof native!=='string'||!native||!Number.isSafeInteger(owner?.scenarioP))return native;
  const actors=owner.characters,old=actors?.[owner.talker],script=owner.scenarioSplit?.[owner.scenarioP];
  if(!Array.isArray(actors)||old?.name!==native||old.tachieNo!==-1||typeof script!=='string'||/(?:^|[,&])(?:talk|say|talkend)\b|\btext\s+@/.test(script))return native;
  let shown=-1;
  for(const match of script.matchAll(/(?:^|[,&])show (\d+)(?=[,&]|$)/g)){if(shown!==-1)return native;shown=Number(match[1]);}
  const next=actors[shown];
  if(!next||next.obj||!Number.isSafeInteger(next.tachieNo)||next.tachieNo<0||owner.tachie?.[next.tachieNo]?.charaNo!==shown||typeof next.name!=='string'||!next.name)return native;
  for(let i=0;i<actors.length;i++)if(i!==shown&&!actors[i].obj&&actors[i].tachieNo>=0)return native;
  return next.name;
 }
 function placeSource(label,native){
  const {scenario:owner}=bind();
  if(label!==owner?.placeYomiLabel||typeof native!=='string'||native.trim())return null;
  const place=owner.placeLabel;
  return valid(place)&&typeof place.string==='string'&&place.string.trim()?place.string:null;
 }
 function localizeRecord(label,native,target){
  if(typeof target!=='string'||!/^(?:한국어|ko(?:-kr)?|korean)$/i.test(target.trim()))return null;
  const record=bind().manager?.changeGamen?.recordUI;if(!record||label.node?.parent!==record)return null;
  if(label.node.name==='dateLabel'&&/^\d{4}年\d{1,2}月\d{1,2}日$/.test(native))return native.replace('年','년 ').replace('月','월 ').replace('日','일');
  if(label.node.name==='pastLabel'&&/^経過 \d+日$/.test(native))return native.replace('経過 ','경과 ').replace('日','일');
  if(label.node.name==='winLabel'&&/^\d+勝$/.test(native))return native.replace('勝','승');
  return null;
 }
 function localizeDynamic(label,native,target){
  if(typeof native!=='string'||typeof target!=='string'||!/^(?:한국어|ko(?:-kr)?|korean)$/i.test(target.trim()))return null;
  const {manager}=bind();
  if(label===manager?.infoTelop?.infoTelopLabel){
   const amount=native.match(/^魂玉 (\d+) を取得しました$/);
   if(amount)return '혼옥 '+amount[1]+'개를 받았습니다';
   if(native==='魂玉の所持上限を超えるため取得できませんでした')return '혼옥 보유 한도를 초과하여 받을 수 없었습니다';
   if(native==='魂玉の所持量が上限になりました')return '혼옥 보유량이 상한에 도달했습니다';
  }
  if(label===manager?.option?.teamLvLabel){
   const duration=native.match(/^部隊Lv\.(\d+)～\n所要時間 ((?:\d+時間)?(?:\d+分)?(?:\d+秒)?)$/);
   if(duration)return '부대 Lv.'+duration[1]+' 이상\n소요시간 '+duration[2].replace(/時間|分|秒/g,unit=>({'時間':'시간 ','分':'분 ','秒':'초 '})[unit]).trimEnd();
  }
  const stage=component(label.node?.parent,'StageBtn');
  if(valid(stage)&&stage.infoLabel===label&&/^(?=\d)(?:\d+時間)?(?:\d+分)?(?:\d+秒)?$/.test(native))return native.replace(/時間|分|秒/g,unit=>({'時間':'시간 ','分':'분 ','秒':'초 '})[unit]).trimEnd();
  return null;
 }
 function localizeManor(label,native,target){
  const name=label.node?.name;if(name!=='lv'&&name!=='info'&&name!=='honbun')return null;
  if(typeof native!=='string'||typeof target!=='string'||!/^(?:한국어|ko(?:-kr)?|korean)$/i.test(target.trim()))return null;
  const {scene,manager}=bind(),manor=manager?.syouen;if(!manor?.buildMode)return null;
  if(manor.buildBtnLv?.includes(label)){
   if(/^施設Lv\.\d+$/.test(native))return native.replace('施設','시설 ');
   if(native==='未開放')return '미개방';
  }
  if(manor.buildBtnInfo?.includes(label)&&/^魂玉生成 \d+\/h \n魂玉保有量 \d+$/.test(native))return native.replace('魂玉生成','혼옥 생성').replace('魂玉保有量','혼옥 보유량');
  if(label.node!==child(child(child(scene,'Canvas'),'Info'),'honbun'))return null;
  if(/^これ以上強化できません\n?$/.test(native))return native.replace('これ以上強化できません','더 이상 강화할 수 없습니다');
  if(/^次の施設の強化には\n合計 \d+ の絆を結ぶ必要があります\n（現在の合計 \d+ ）$/.test(native))return native.replace('次の施設の強化には','다음 시설을 강화하려면').replace('合計 ','합계 ').replace(' の絆を結ぶ必要があります',' 의 인연을 맺어야 합니다').replace('現在の合計','현재 합계');
  return null;
 }
 function bookNumber(label,native,target){
  if(label.node?.name!=='title'||label.node.activeInHierarchy===false||typeof target!=='string'||!/^(?:한국어|ko(?:-kr)?|korean)$/i.test(target.trim())||typeof native!=='string'||!/^[零〇一二三四五六七八九十百]+番$/.test(native))return null;
  if(label.node!==child(child(bind().manager?.changeGamen?.bookUI,'Detail'),'title'))return null;
  let number=0,digit=0;
  for(const value of native.slice(0,-1)){const n=value==='〇'?0:'零一二三四五六七八九'.indexOf(value);if(n>=0)digit=n;else{number+=(digit||1)*(value==='十'?10:100);digit=0;}}
  return 'No. '+(number+digit);
 }
 function completePage(owner,waku){
  if(waku.last===true)return true;
  const split=owner?.scenarioSplit,page=owner?.scenarioP,script=split?.[page],name=owner?.GV?.play?.playerName??manager?.GV?.play?.playerName;
  if(typeof script!=='string')return false;
  if(!terminalPage||terminalPage.split!==split||terminalPage.page!==page||terminalPage.script!==script||terminalPage.name!==name){
   const commands=script.split(',');let full='\n',found=false,valid=commands.at(-1)?.trim().toUpperCase()==='END';
   for(const command of commands){
    if(/^text /i.test(command)){
     let text=command.slice(5);if(text.includes('*P')){if(typeof name!=='string'){valid=false;break;}text=text.split('*P').join(name);}
     const lines=text.split('\n');if(!found&&lines[0]==='')lines.shift();if(lines[0]?.startsWith('@'))lines.shift();
     full+=lines.join('\n');found=true;
    }else if(command.split('&').some(part=>/^text /i.test(part)))valid=false;
   }
   terminalPage={split,page,script,name,full:valid&&found?full:null};
  }
  return terminalPage.full!==null&&terminalPage.full===waku.tmpserif;
 }
 function frame(label,native){
  const {scenario:owner,waku}=bind();if(!waku||label!==waku.serif||typeof native!=='string'||typeof waku.tmpserif!=='string'||!completePage(owner,waku))return null;
  const full=waku.tmpserif;
  // ShowAllText deliberately does not advance count; the exact full native write is authoritative.
  if(native===full)return {full,length:full.length,shown:full.length};
  if(!Number.isFinite(waku.count)||waku.count<0)return null;
  const shown=Math.min(Math.trunc(waku.count),full.length);
  return full.substring(0,shown)===native?{full,length:full.length,shown}:null;
 }
 function pending(label){const {scenario:owner,waku}=bind();return label===waku?.serif&&!completePage(owner,waku);}
 function names(){const name=bind().manager?.GV?.play?.playerName;return typeof name==='string'?[name]:[];}
 function restoreRuby(){for(const [node,opacity]of rubyOpacity)if(valid(node))node.opacity=opacity;rubyOpacity.clear();}
 function display(label,translated){
  const {waku}=bind();if(label!==waku?.serif)return;
  if(!translated){restoreRuby();return;}
  for(const ruby of waku.ruby||[]){const node=ruby?.node;if(!valid(node))continue;if(!rubyOpacity.has(node))rubyOpacity.set(node,node.opacity);node.opacity=0;}
 }
 function dispose(){restoreRuby();for(const [owner,hook]of logHooks)for(const [key,wrapped,descriptor]of [['ShowSerif',hook.wrappedShow,hook.ownShow],['SetLog',hook.wrappedLog,hook.ownLog]])if(owner[key]===wrapped){if(descriptor)Object.defineProperty(owner,key,descriptor);else delete owner[key];}logHooks.clear();}
 return {bind,battleEvent,context,resultNames,excluded,allowInactive,titleSource,speakerSource,placeSource,localizeRecord,localizeDynamic,localizeManor,bookNumber,frame,pending,names,display,dispose};
}
window[KEY]=Object.freeze({create});
})();
