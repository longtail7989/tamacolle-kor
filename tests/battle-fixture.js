'use strict';
module.exports=function battleFixture(h){
 const Label=h.Label||h.cc.Label,profile=h.profile||h.manager.GV.play,node=h.node('Battle',h.scene),label=new Label(h.node('eventText',node),'');
 const master={kunitama:[{namae:'赤'},{namae:'青'},{namae:'緑'}],tamaPos:{1:{master:0},2:{master:1},3:{master:2}},trap:[{odaiText:'$Aと$B。^$Aが進む。',goodText:'$Aが成功。',badText:'$Bが失敗。'}],trapPos:{0:0},spot:[{odaiText:'$Aと$Bが[= 歩く 走る]。'}],spotPos:{0:0},treasure:[{odaiText:'$Aの宝。'}],treasurePos:{0:0}};
 profile.team=[[1,2,3]];profile.selectedTeamNo=0;
 const battle={kind:'BattleGamen',node,gm:h.manager,stages:[{boy:0,detail:0}],traps:[[0,0,0,0,0,0,1]],spotNo:0},play={kind:'BattlePlay',node,battle,stageNo:0},anime={kind:'BattleAnimation',node,battle,label:[label]},callbacks=[];
 let randomCalls=0;
 const actor=index=>master.kunitama[master.tamaPos[profile.team[profile.selectedTeamNo][index]].master].namae;
 const event={kind:'BattleEvent',node,battle,play,master,GV:{play:profile},peer:'青',spotActor:2,AliveBoys(excluded){return [excluded===-1?this.spotActor:1];},Aite(index){this.AliveBoys(index,1);return this.peer;},SelectRandomText(input){randomCalls++;const parts=input.split('[=');for(let i=1;i<parts.length;i++){const fields=parts[i].split(']'),options=fields[0].split(' ');fields[1]=options[1]+fields[1];fields.shift();parts[i]=fields.join(']');}return parts.join('');}};
 for(const method of ['TrapAnimation','TrapSuccess','TrapFailure','SpotAnimation','TreasureAnimation'])anime[method]=function(text){this.label[0].string=text;return method;};
 function begin(kind){
  const table=kind==='Trap'?'trap':kind==='Spot'?'spot':'treasure',row=master[table][0],index=kind==='Spot'?event.AliveBoys(-1,1)[0]:battle.stages[play.stageNo].boy,a=actor(index),b=kind==='Treasure'&&!row.odaiText.includes('$B')?null:event.Aite(index),resolve=raw=>raw.split('$A').join(a).split('$B').join(b);
  const input=resolve(row.odaiText.split('_')[0]),show=()=>anime[kind+'Animation'](event.SelectRandomText(input).split('^').join('\n'));
  if(kind==='Spot'){const output=event.SelectRandomText(input).split('^').join('\n');callbacks.push(()=>anime.SpotAnimation(output));}else callbacks.push(show);
  if(kind==='Trap'){const good=battle.traps[play.stageNo][6]!==0,raw=row[good?'goodText':'badText'].split('_')[0].split('|')[0],result=resolve(raw);callbacks.push(()=>anime[good?'TrapSuccess':'TrapFailure'](event.SelectRandomText(result).split('^').join('\n')));}
  return kind;
 }
 for(const method of ['Trap','Spot','Treasure'])event[method]=function(){return begin(method);};
 Object.assign(play,{bEvent:event,anime});battle.battlePlay=play;Object.assign(h.manager,{battle,battleNode:node});node._components.push(battle,play,event,anime);
 const originals=new Map([...['Trap','Spot','Treasure','AliveBoys','Aite','SelectRandomText'].map(key=>[event,key]),...['TrapAnimation','TrapSuccess','TrapFailure','SpotAnimation','TreasureAnimation'].map(key=>[anime,key])].map(([owner,key])=>[owner===event?'event.'+key:'anime.'+key,owner[key]]));
 return {node,label,event,anime,battle,play,master,callbacks,originals,get randomCalls(){return randomCalls;},next(){return callbacks.shift()?.();},clear(){callbacks.length=0;}};
};
