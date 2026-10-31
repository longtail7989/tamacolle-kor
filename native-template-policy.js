/* MAIN: exact native StrMod/BattleEvent observations; never advances or mutates game state. */
(()=>{'use strict';
const KEY=Symbol.for('tamacolle-kor-native-template-policy.v1');
const protocol=globalThis[Symbol.for('tamacolle-kor-native-template-protocol.v1')];
if(!protocol)throw Error('Native template protocol unavailable');
function create({getEngine,game,dialogue,namesPolicy,getNames}){
 const battleCapture=createBattleCapture({game,getNames});
 let disposed=false,owner=null,blocked=null,scene=null,engine=null,scenarioSplit=null,profile=null,identity='',hooks=[],frame=null,page=null,bytes=0;
 const aliases=new Map();
 const valid=value=>!!value&&(!getEngine()?.isValid||getEngine().isValid(value));
 const component=(node,name)=>(node?._components||[]).find(value=>getEngine()?.js?.getClassName?.(value)===name);
 const child=(node,name)=>node?.children?.find(value=>value.name===name);
 function current(){const cc=getEngine(),root=cc?.director?.getScene?.(),managers=child(root,'Managers'),node=child(managers,'ScenarioManager'),candidate=component(node,'PlayScenario'),value=candidate?.node===node?candidate:null;return {cc,root,value};}
 function names(){return [...new Set((getNames()||[]).filter(namesPolicy.usable))];}
 function signature(value){
  const actors=value?.characters;if(!Array.isArray(actors)||actors.length>256)return null;
  let size=0;const rows=[];
  for(const actor of actors){if(!actor||typeof actor.chara!=='string'||typeof actor.name!=='string'||typeof actor.body!=='string')return null;size+=actor.chara.length+actor.name.length+actor.body.length;if(size>65536)return null;rows.push([actor.chara,actor.name,actor.body]);}
  return JSON.stringify([rows,names()]);
 }
 function clear(){aliases.clear();bytes=0;page=null;}
 function restore(){for(const hook of hooks)if(owner?.[hook.key]===hook.wrapper){if(hook.descriptor)Object.defineProperty(owner,hook.key,hook.descriptor);else delete owner[hook.key];}hooks=[];frame=null;}
 function eligible(value){return valid(value)&&value.node?.activeInHierarchy===true&&value.enabledInHierarchy!==false;}
 function refresh(){battleCapture.refresh();try{refreshOwner();}catch{restore();clear();owner=null;identity='';}}
 function refreshOwner(){
  if(disposed)return;
  if(owner&&(owner.scenarioSplit!==scenarioSplit||owner.GV?.play!==profile)){clear();scenarioSplit=owner.scenarioSplit;profile=owner.GV?.play;}
  const now=current(),next=eligible(now.value)?now.value:null;
  if(now.cc!==engine||now.root!==scene||next!==owner){restore();clear();engine=now.cc;scene=now.root;owner=next;identity='';scenarioSplit=owner?.scenarioSplit;profile=owner?.GV?.play;if(owner!==blocked)blocked=null;}
  if(!owner||owner===blocked)return;
  if(hooks.some(hook=>owner[hook.key]!==hook.wrapper)){restore();blocked=owner;clear();return;}
  if(!hooks.length)attach();
  const nextIdentity=signature(owner);
  if(nextIdentity!==identity){clear();identity=nextIdentity;}
 }
 function install(key,make){const original=owner[key],descriptor=Object.getOwnPropertyDescriptor(owner,key);if(typeof original!=='function'||descriptor&&(!('value' in descriptor)||descriptor.writable===false))return false;const wrapper=make(original);try{Object.defineProperty(owner,key,{configurable:true,writable:true,enumerable:descriptor?.enumerable??false,value:wrapper});}catch{return false;}hooks.push({key,descriptor,wrapper});return true;}
 function attach(){
  if(typeof owner.StrMod!=='function'||typeof owner.TextStart!=='function')return;
  const target=owner;
  if(!install('StrMod',original=>function(input){
   // Native failures propagate unchanged; capture is strictly after the real call.
   const output=original.apply(this,arguments),call=frame;
   if(this===target)try{if(call?.owner===this){const index=call.calls++;if(index<2)observe(input,output,original,index,call);}else observe(input,output,original,1,null);}catch{page=null;}
   return output;
  }))return;
  if(!install('TextStart',original=>function(text,caption,first,last){
   refresh();const previous=frame;
   if(this!==owner||!identity)return original.apply(this,arguments);
   const call={owner:this,calls:0,first:!!first,last:!!last};frame=call;
   try{return original.apply(this,arguments);}finally{frame=previous;}
  })){restore();}
 }
 function capture(input,output,original){
  if(typeof input!=='string'||typeof output!=='string'||input.length>8192||output.length>8192||input.includes('{TAMACOLLE_ACTOR_'))return null;
  const parts=[],bindings=[];let offset=0,reconstructed='';
  for(const match of input.matchAll(/\$([A-Za-z])(?::([A-Za-z]))?/g)){
   const literal=input.slice(offset,match.index);if(literal.includes('$'))return null;
   const target=owner.characters.find(actor=>actor.chara===match[1]),caller=match[2]&&owner.characters.find(actor=>actor.chara===match[2]);
   if(!target||match[2]&&!caller||bindings.length>=32)return null;
   const value=original.call(owner,match[0]);if(typeof value!=='string'||!value||value.length>512||/[<>{}\r\n$?]/.test(value))return null;
   parts.push(literal);const token='{TAMACOLLE_ACTOR_'+bindings.length+'}';parts.push(token);bindings.push({token,source:value});reconstructed+=literal+value;offset=match.index+match[0].length;
  }
  const tail=input.slice(offset);if(tail.includes('$'))return null;parts.push(tail);reconstructed+=tail;
  if(reconstructed!==output)return null;
  return {source:parts.join(''),bindings,output};
 }
 function store(value){
  if(!value.bindings.length||value.output.length>8192||value.source.length>8192)return;
  const key=dialogue.key(value.output),entry={source:dialogue.key(value.source),bindings:value.bindings.map(binding=>({...binding}))};
  if(!key||!protocol.validate([entry]))return;
  const cost=key.length+protocol.size([entry]),previous=aliases.get(key);
  if(previous){bytes-=previous.cost;aliases.delete(key);}
  aliases.set(key,{entry,cost});bytes+=cost;
  while(aliases.size>128||bytes>524288){const oldest=aliases.keys().next().value;bytes-=aliases.get(oldest).cost;aliases.delete(oldest);}
 }
 function observe(input,output,original,index,call){
  const now=current();if(now.value!==owner||now.root!==scene||!eligible(owner)||signature(owner)!==identity){clear();return;}
  const value=capture(input,output,original);
  if(index===1){if(value)store(value);return;}
  if(!value){page=null;return;}
  // TextStart selects the second '?' field, not a trimmed remainder.
  if(output.includes('?')){
   page=null;if(value.bindings.some(binding=>binding.source.includes('?')))return;
   const source=value.source.split('?')[1],shown=output.split('?')[1];if(source===undefined)return;
   const selected=value.bindings.filter(binding=>source.includes(binding.token)),bindings=selected.map((binding,i)=>({token:'{TAMACOLLE_ACTOR_'+i+'}',source:binding.source}));
   let canonical=source;selected.forEach((binding,i)=>{canonical=canonical.replace(binding.token,()=>bindings[i].token);});store({source:canonical,output:shown,bindings});return;
  }
  // SerifWaku.ShowSerif inserts exactly one LF only when its native buffer is empty.
  if(call.first)page={source:'\n',output:'\n',bindings:[]};
  if(!page)return;
  const base=page.bindings.length;if(base+value.bindings.length>32){page=null;return;}
  let source=value.source;
  source=source.replace(/\{TAMACOLLE_ACTOR_(\d+)\}/g,(_,number)=>'{TAMACOLLE_ACTOR_'+(base+Number(number))+'}');
  page.source+=source;page.output+=output;page.bindings.push(...value.bindings.map((binding,i)=>({token:'{TAMACOLLE_ACTOR_'+(base+i)+'}',source:binding.source})));
  if(page.source.length>8192||page.output.length>8192){page=null;return;}
  if(call.last)store(page);
 }
 function candidates(source,context,label){
  if(context==='TamacolleDialogue / BattleEvent')return battleCapture.candidates(source,label);
  if(!dialogue.isStory(context)||typeof source!=='string'||source.length>8192)return [];
  refresh();if(disposed||!owner||owner===blocked||!identity)return [];
  const value=aliases.get(dialogue.key(source));if(!value)return [];
  // Supported native actor registrations never originate from *P. Equal spelling is not player provenance.
  const entry={source:namesPolicy.replaceNames(value.entry.source,names()),bindings:value.entry.bindings.map(binding=>({...binding}))};
  return protocol.validate([entry])?[entry]:[];
 }
 return {candidates,refresh,reset(){clear();battleCapture.reset();identity=owner?signature(owner):'';},dispose(){disposed=true;battleCapture.dispose();restore();clear();owner=null;}};
}
function createBattleCapture({game,getNames}){
 const receivers=['TrapAnimation','TrapSuccess','TrapFailure','SpotAnimation','TreasureAnimation'];
 let state=null,hooks=[],blocked=null,session=null,starting=null,pending=[],shown=null,disposed=false;
 const actorName=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[<>{}\r\n$^]/.test(value);
 function clear(){session=null;starting=null;pending=[];shown=null;}
 function restore(){for(const hook of hooks)if(hook.owner[hook.key]===hook.wrapper){if(hook.descriptor)Object.defineProperty(hook.owner,hook.key,hook.descriptor);else delete hook.owner[hook.key];}hooks=[];}
 function stamp(value){
  const profile=value.event.GV?.play,teamNo=profile?.selectedTeamNo,team=profile?.team?.[teamNo],stageNo=value.play.stageNo,stage=value.battle.stages?.[stageNo];
  if(!Number.isSafeInteger(teamNo)||!Array.isArray(team)||team.length>32||!team.every(Number.isSafeInteger)||!Number.isSafeInteger(stageNo)||!stage||profile!==value.manager.GV?.play)return null;
  return {profile,key:JSON.stringify([teamNo,team,stageNo,stage.boy,stage.detail,value.battle.spotNo,getNames()])};
 }
 function refresh(){
  if(disposed)return;
  try{
   const next=game?.battleEvent?.()||null,identity=next&&stamp(next);
   if(!next||!identity){restore();clear();state=null;return;}
   if(!state||['scene','manager','battle','play','event','anime','label'].some(key=>next[key]!==state[key])){
    restore();clear();state={...next,...identity};if(blocked!==next.event)blocked=null;
   }else if(identity.profile!==state.profile||identity.key!==state.key){clear();state={...next,...identity};}
   if(state.event===blocked)return;
   if(hooks.some(hook=>hook.owner[hook.key]!==hook.wrapper)){restore();clear();blocked=state.event;return;}
   if(!hooks.length&&!attach()){restore();clear();blocked=state.event;}
  }catch{restore();clear();state=null;}
 }
 function install(owner,key,make){
  const original=owner[key],descriptor=Object.getOwnPropertyDescriptor(owner,key);
  if(typeof original!=='function'||descriptor&&(!('value'in descriptor)||descriptor.writable===false))return false;
  const wrapper=make(original);
  try{Object.defineProperty(owner,key,{configurable:true,writable:true,enumerable:descriptor?.enumerable??false,value:wrapper});}catch{return false;}
  hooks.push({owner,key,descriptor,wrapper});return true;
 }
 function publicName(index){
  if(!Number.isSafeInteger(index)||index<0)return null;
  const profile=state.profile,master=state.event.master,id=profile.team[profile.selectedTeamNo][index],position=master?.tamaPos?.[id]?.master,value=master?.kunitama?.[position]?.namae;
  return actorName(value)?value:null;
 }
 function begin(kind){
  clear();if(!state||state.event===blocked)return null;
  const master=state.event.master,stage=state.battle.stages[state.play.stageNo],table=kind==='Spot'?'spot':kind==='Trap'?'trap':'treasure',id=kind==='Spot'?state.battle.spotNo:stage.detail,row=master?.[table]?.[master?.[table+'Pos']?.[id]];
  if(!row||typeof row.odaiText!=='string'||row.odaiText.length>65536)return null;
  const odai=row.odaiText.split('_');if(odai.length>64||odai.some(text=>text.length>8192))return null;
  const result=kind==='Trap'?(state.battle.traps?.[state.play.stageNo]?.[6]===0?'badText':'goodText'):null;
  if(result&&(typeof row[result]!=='string'||row[result].length>65536))return null;
  session={kind,row,odai,result,resultText:result?row[result]:null,key:state.key,profile:state.profile,actorA:kind==='Spot'?null:publicName(stage.boy),actorB:null,outer:[],count:0};
  return session;
 }
 function attach(){
  const target=state.event,animation=state.anime;
  for(const kind of ['Trap','Spot','Treasure'])if(!install(target,kind,original=>function(){
   refresh();const previous=starting;let call=null;
   try{if(this===state?.event)call=begin(kind);}catch{clear();}
   starting=call;try{return original.apply(this,arguments);}finally{starting=previous;}
  }))return false;
  if(!install(target,'AliveBoys',original=>function(){
   const value=original.apply(this,arguments);
   if(this===state?.event&&starting?.kind==='Spot'&&starting===session&&starting.actorA===null&&Array.isArray(value))try{starting.actorA=publicName(value[0]);}catch{clear();}
   return value;
  }))return false;
  if(!install(target,'Aite',original=>function(){
   const value=original.apply(this,arguments);
   if(this===state?.event&&starting&&starting===session)starting.actorB=actorName(value)?value:null;
   return value;
  }))return false;
  if(!install(target,'SelectRandomText',original=>function(input){
   const value=original.apply(this,arguments);
   if(this===state?.event)try{observeRandom(input,value);}catch{clear();}
   return value;
  }))return false;
  for(const method of receivers)if(!install(animation,method,original=>function(text){
   refresh();shown=null;
   if(this===state?.anime&&session){const index=pending.findIndex(item=>item.method===method&&item.text===text&&item.session===session);if(index!==-1){const item=pending.splice(index,1)[0];shown={label:state.label,text,entries:item.entries};}}
   return original.apply(this,arguments);
  }))return false;
  return true;
 }
 function resolve(raw,call){
  let value=raw;
  if(value.includes('$A')){if(!actorName(call.actorA))return null;value=value.split('$A').join(call.actorA);}
  if(value.includes('$B')){if(!actorName(call.actorB))return null;value=value.split('$B').join(call.actorB);}
  return value.includes('$')?null:value;
 }
 function variants(raw){
  const pieces=raw.split('[=');let result=[pieces[0]];
  for(let i=1;i<pieces.length;i++){
   const fields=pieces[i].split(']');if(fields.length<2)return [];
   const options=fields[0].split(' ').slice(1);if(!options.length||options.length*result.length>512)return [];
   const suffix=fields.slice(1).join(']'),next=[];
   for(const prefix of result)for(const option of options){const value=prefix+option+suffix;if(value.length>8192)return [];next.push(value);}
   result=next;
  }
  return result;
 }
 function canonical(raw,call){
  const bindings=[];let offset=0,source='',output='';
  for(const match of raw.matchAll(/\$[AB]/g)){
   const literal=raw.slice(offset,match.index);if(literal.includes('$')||bindings.length>=32)return null;
   const value=match[0]==='$A'?call.actorA:call.actorB;if(!actorName(value))return null;
   const token='{TAMACOLLE_ACTOR_'+bindings.length+'}';bindings.push({token,source:value});source+=literal+token;output+=literal+value;offset=match.index+2;
  }
  const tail=raw.slice(offset);if(tail.includes('$'))return null;
  const entry={source:(source+tail).split('^').join('\n'),bindings},text=(output+tail).split('^').join('\n');
  return protocol.validate([entry])&&bindings.length?{entry,text}:null;
 }
 function observeRandom(input,output){
  refresh();const call=session;if(!call||call.key!==state?.key||call.profile!==state.profile||typeof input!=='string'||typeof output!=='string'||input.length>8192||output.length>8192)return;
  const index=call.count++;let rows,method;
  if(index===0){rows=call.odai.map((raw,outer)=>({raw,outer}));method=call.kind+'Animation';}
  else if(index===1&&call.kind==='Trap'){
   const groups=call.resultText.split('_');rows=[];
   for(const outer of call.outer){const text=groups[outer];if(typeof text!=='string')continue;const options=text.split('|');if(rows.length+options.length>128)return;for(const raw of options)rows.push({raw,outer});}
   method=call.result==='goodText'?'TrapSuccess':'TrapFailure';
  }else return;
  const entries=[],seen=new Set();let cost=0;
  for(const {raw,outer}of rows){
   if(raw.length>8192||resolve(raw,call)!==input)continue;
   if(index===0&&!call.outer.includes(outer))call.outer.push(outer);
   for(const variant of variants(raw)){
    const value=canonical(variant,call);if(!value||value.text!==output.split('^').join('\n'))continue;
    const key=JSON.stringify(value.entry);if(seen.has(key))continue;seen.add(key);entries.push(value.entry);cost+=protocol.size([value.entry]);
    if(entries.length>2||cost>65536)return;
   }
  }
  if(entries.length&&protocol.validate(entries)){pending.push({method,text:output.split('^').join('\n'),entries,session:call});if(pending.length>4)pending.shift();}
 }
 function candidates(source,label){
  refresh();if(!shown||!state||state.event===blocked||shown.label!==label||state.label!==label||shown.text!==source)return [];
  return shown.entries.map(entry=>({source:entry.source,bindings:entry.bindings.map(binding=>({...binding}))}));
 }
 return {refresh,candidates,reset:clear,dispose(){disposed=true;restore();clear();state=null;}};
}
globalThis[KEY]=Object.freeze({create});
})();
