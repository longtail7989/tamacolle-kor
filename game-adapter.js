/* MAIN: verified Tamacolle display state and original log preservation; never credentials or game actions. */
(()=>{'use strict';
const KEY=Symbol.for('tamacolle-kor-game-adapter.v1');if(window[KEY])return;
const pageCommands=new Set('face talk say talkend showex show hideall hide move scale rotate quake shake panel color order orderline setline moveline bg cg minibg light shakebg bgm se voice telopreset telopoutline telopcolor telopscale telopsize telop telopseq ruby wait playeryes playerno place noskip title effect waku fadein fadeout fadecolor lightcolor flow textcolor textsize serif'.split(' '));
function create({getEngine,nativeText}){
 let scene=null,manager=null,scenario=null;const rubyOpacity=new Map(),logHooks=new Map();
 let terminalPage=null,preparedPage=null,currentDialogueScope=null,dialogueOccurrence=0;
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
  return label===manager?.infoTelop?.infoTelopLabel||label===manager?.gotItemLabel||label===scenario?.titleLabel||label===scenario?.subTitleLabel||(label===scenario?.serifWaku?.serif&&plannedFull(scenario,scenario.serifWaku)!==null)||(valid(result)&&component(result.node,'ResultGamen')===result&&label===result.finalKunitamaName);
 }
 function context(label){
  const {manager,scenario,waku}=bind();
  if(label===waku?.serif)return 'TamacolleDialogue';if(label===waku?.namae)return 'TamacolleSpeaker';if(label===waku?.selectLabel)return 'TamacolleChoice';
  if(label===scenario?.titleLabel||label===scenario?.subTitleLabel)return 'TamacolleTitle';if(label===scenario?.logLabel)return 'TamacolleBacklog';
  const duty=manager?.syouen?.touban;
  if(valid(duty)&&component(duty.node,'SyouenTouban')===duty&&(duty.kouka?.includes(label)||duty.koukaP?.includes(label)))return 'TamacolleDutyEffect';
  const result=manager?.battle?.result;if(valid(result)&&component(result.node,'ResultGamen')===result&&label===result.finalKunitamaName)return 'TamacolleResultNames';
  if(label===battleEvent()?.label)return 'TamacolleDialogue / BattleEvent';return null;
 }
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
 function dialogueScope(label){
  const {scenario:owner,waku}=bind();if(!waku||label!==waku.serif)return null;
  const split=owner?.scenarioSplit,page=owner?.scenarioP,script=split?.[page],profile=owner?.GV?.play??manager?.GV?.play,name=profile?.playerName,starter=owner?.GV?.stat?.firstDanjiID;
  const previous=currentDialogueScope;
  if(!previous||previous.owner!==owner||previous.waku!==waku||previous.split!==split||previous.page!==page||previous.script!==script||previous.profile!==profile||previous.name!==name||previous.starter!==starter||previous.occurrence!==dialogueOccurrence)currentDialogueScope={owner,waku,split,page,script,profile,name,starter,occurrence:dialogueOccurrence};
  return currentDialogueScope;
 }
 function prepareDialogue(owner,text,caption,first,last,resolve,isCurrent){
  const binding=bind();if(owner!==binding.scenario||!binding.waku||first!==true)return null;
  dialogueOccurrence++;currentDialogueScope=null;preparedPage=null;
  const scope=dialogueScope(binding.waku.serif);
  if(!Number.isSafeInteger(scope.page)||scope.page<0||typeof scope.script!=='string'||scope.script.length>65536||typeof text!=='string'||typeof caption!=='string')return null;
  try{
   let script=scope.script;
   if(script.includes('*P')){
    if(typeof scope.name!=='string'||/[,&\r\n]/.test(scope.name))return null;
    script=script.split('*P').join(scope.name);
   }
   if(script.includes('*MAIN')){
    const gm=owner.gm;
    if(!gm||typeof gm.GetName!=='function'||!Number.isSafeInteger(scope.starter))return null;
    const name=gm.GetName(1,scope.starter);
    if(typeof name!=='string'||!name||name.length>512||/[,&\r\n]/.test(name))return null;
    script=script.split('*MAIN').join(name);
   }
   const commands=script.split(','),chunks=[];
   for(let index=0;index<commands.length;index++){
    const command=commands[index],group=command.split('&');
    if(group.length>1){
     for(let part=0;part<group.length;part++){
      const head=group[part].split(' ')[0].toLowerCase();
      if(head==='delay'){
       if(part+1>=group.length||!Number.isFinite(Number(group[part].slice(6)))||Number(group[part].slice(6))<0)return null;
       continue;
      }
      // Native acquisition can end with delay & end; inspect, never run it.
      if(head==='end'){
       if(index!==commands.length-1||part!==group.length-1||group[part].toLowerCase()!=='end')return null;
       continue;
      }
      if(!pageCommands.has(head))return null;
     }
     continue;
    }
    if(command.startsWith('text ')){
     const lines=command.slice(5).split('\n');
     if(!chunks.length&&lines[0]==='')lines.shift();
     let name='';if(lines[0]?.startsWith('@'))name=lines.shift().slice(1);
     chunks.push({text:lines.join('\n'),caption:name,last:index===commands.length-1});
     if(chunks.length>128)return null;
    }else if(command){
     const head=command.split(' ')[0].toLowerCase();
     // AUTOTAP advances only after this page; it does not add following-page text.
     if(head==='end'||head==='autotap'){if(index!==commands.length-1||command.toLowerCase()!==head)return null;}
     else if(head==='delay'){const seconds=command.slice(6);if(!seconds||!Number.isFinite(Number(seconds))||Number(seconds)<0)return null;}
     else if(!pageCommands.has(head))return null;
    }
   }
   if(!chunks.length||chunks[0].text!==text||chunks[0].caption!==caption||chunks[0].last!==(last===true))return null;
   const parts=chunks.map(chunk=>chunk.text),value=resolve(parts);
   if(!value||typeof value.output!=='string'||!value.output.startsWith('\n')||value.output.length>8192||value.output.includes('?')||!isCurrent())return null;
   preparedPage={scope,full:value.output,isCurrent};
   return value;
  }catch{return null;}
 }
 function plannedFull(owner,waku){
  if(!preparedPage)return null;
  if(preparedPage.scope!==dialogueScope(waku?.serif)||preparedPage.scope.owner!==owner||!preparedPage.isCurrent()){preparedPage=null;return null;}
  // Native Init may clear the label before clearing the previous buffer.
  if(typeof waku?.tmpserif!=='string'||!preparedPage.full.startsWith(waku.tmpserif))return null;
  return preparedPage.full;
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
  const {scenario:owner,waku}=bind();if(!waku||label!==waku.serif||typeof native!=='string'||typeof waku.tmpserif!=='string')return null;
  const prepared=plannedFull(owner,waku);
  if(prepared===null&&!completePage(owner,waku))return null;
  const full=prepared??waku.tmpserif;
  // ShowAllText completes the current buffer, not text fragments still scheduled later.
  if(native===waku.tmpserif)return {full,length:full.length,shown:native.length};
  if(!Number.isFinite(waku.count)||waku.count<0)return null;
  const shown=Math.min(Math.trunc(waku.count),waku.tmpserif.length);
  return full.substring(0,shown)===native?{full,length:full.length,shown}:null;
 }
 function pending(label){const {scenario:owner,waku}=bind();return label===waku?.serif&&plannedFull(owner,waku)===null&&!completePage(owner,waku);}
 function names(){const name=bind().manager?.GV?.play?.playerName;return typeof name==='string'?[name]:[];}
 function restoreRuby(){for(const [node,opacity]of rubyOpacity)if(valid(node))node.opacity=opacity;rubyOpacity.clear();}
 function display(label,translated){
  const {waku}=bind();if(label!==waku?.serif)return;
  if(!translated){restoreRuby();return;}
  for(const ruby of waku.ruby||[]){const node=ruby?.node;if(!valid(node))continue;if(!rubyOpacity.has(node))rubyOpacity.set(node,node.opacity);node.opacity=0;}
 }
 function dispose(){preparedPage=null;currentDialogueScope=null;restoreRuby();for(const [owner,hook]of logHooks)for(const [key,wrapped,descriptor]of [['ShowSerif',hook.wrappedShow,hook.ownShow],['SetLog',hook.wrappedLog,hook.ownLog]])if(owner[key]===wrapped){if(descriptor)Object.defineProperty(owner,key,descriptor);else delete owner[key];}logHooks.clear();}
 return {bind,battleEvent,context,resultNames,excluded,allowInactive,titleSource,speakerSource,placeSource,localizeRecord,localizeDynamic,localizeManor,bookNumber,dialogueScope,prepareDialogue,frame,pending,names,display,dispose};
}
window[KEY]=Object.freeze({create});
})();
