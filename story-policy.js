/* MAIN: observe verified Cocos story state; never invoke game input/advance APIs. */
(()=>{'use strict';
const KEY=Symbol.for('tamacolle-kor-story-policy.v1');if(window[KEY])return;
function create({getEngine,getRecords,game}){
  let segmenter=null;
  const valid=value=>!!value&&(!getEngine()?.isValid||getEngine().isValid(value));
  function progress(label,nativeFrame){try{return valid(label)?game.frame(label,nativeFrame):null;}catch{return null;}}
  function source(label,nativeFrame){return game.titleSource?.(label,nativeFrame)??game.placeSource?.(label,nativeFrame)??game.speakerSource?.(label,nativeFrame)??progress(label,nativeFrame)?.full??nativeFrame;}
  function typingPlan(text){
    segmenter??=new Intl.Segmenter(undefined,{granularity:'grapheme'});
    const units=[],stack=[],spans=[];
    let visible='',close='',offset=0;
    function append(start,end){
      if(start===end)return;
      spans.push({offset:visible.length,start,length:end-start,close});visible+=text.slice(start,end);
    }
    function flush(){
      let spanIndex=0;
      for(const part of segmenter.segment(visible)){
        const end=part.index+part.segment.length;
        while(end>spans[spanIndex].offset+spans[spanIndex].length)spanIndex++;
        const span=spans[spanIndex];units.push({end:span.start+end-span.offset,close:span.close});
      }
      visible='';spans.length=0;
    }
    for(const match of text.matchAll(/<(?:[^>"']|"[^"]*"|'[^']*')*>|\{[^{}]*\}/g)){
      append(offset,match.index);
      const token=match[0];offset=match.index+token.length;
      if(token[0]==='{'){flush();units.push({end:offset,close});continue;}
      if(token.startsWith('<!--'))continue;
      const end=token.match(/^<\s*\/\s*([A-Za-z][\w:-]*)\s*>$/);
      if(end){
        if(stack.at(-1)?.toLowerCase()!==end[1].toLowerCase())return null;
        stack.pop();
      }else{
        const start=token.match(/^<\s*([A-Za-z][\w:-]*)(?=[\s=/>])/);
        if(!start)return null;
        if(!/\/\s*>$/.test(token)&&!/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(start[1]))stack.push(start[1]);
      }
      close=stack.slice().reverse().map(name=>'</'+name+'>').join('');
    }
    append(offset,text.length);flush();
    return stack.length?null:{text,units,count:-1,display:''};
  }
  function reveal(label,nativeFrame,fullDisplayText){
    const record=getRecords().get(label),frame=progress(label,nativeFrame);
    if(!record||!frame||frame.shown>=frame.length){if(record)delete record.typingPlan;return fullDisplayText;}
    let plan=record.typingPlan;
    if(!plan||plan.text!==fullDisplayText){
      plan=typingPlan(fullDisplayText);
      if(!plan){delete record.typingPlan;return fullDisplayText;}
      record.typingPlan=plan;
    }
    if(frame.shown===0)return '';
    const count=Math.min(plan.units.length,Math.max(1,Math.floor(plan.units.length*frame.shown/frame.length)));
    if(plan.count!==count){
      const unit=plan.units[count-1];
      plan.display=count===plan.units.length?fullDisplayText:fullDisplayText.slice(0,unit.end)+unit.close;
      plan.count=count;
    }
    return plan.display;
  }
  return {source,reveal};
}
window[KEY]=Object.freeze({create});
})();
