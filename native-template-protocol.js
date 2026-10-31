/* Shared bounded wire validation and cache-only actor binding; safe in workers. */
(()=>{'use strict';
const key=Symbol.for('tamacolle-kor-native-template-protocol.v1');if(globalThis[key])return;
const actor=/\{TAMACOLLE_ACTOR_(?:0|[1-9]\d*)\}/g;
const protectedPattern=/<[^>]*>|\{[^{}]*\}|\r\n|\r|\n|[+＋\-－]?[0-9０-９]+(?:[,，][0-9０-９]{3})*(?:[.．][0-9０-９]+)?(?:[%％])?/g;
const fields=(value,names)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
function validate(value){
 if(value===undefined)return true;
 if(!Array.isArray(value)||value.length>2)return false;
 for(const candidate of value){
  if(!fields(candidate,['source','bindings'])||typeof candidate.source!=='string'||!candidate.source.trim()||candidate.source.length>8192||!Array.isArray(candidate.bindings)||!candidate.bindings.length||candidate.bindings.length>32)return false;
  const tokens=candidate.source.match(actor)||[];
  if(tokens.length!==candidate.bindings.length||candidate.source.replace(actor,'').includes('TAMACOLLE_ACTOR_'))return false;
  for(let i=0;i<tokens.length;i++){
   const binding=candidate.bindings[i],token=`{TAMACOLLE_ACTOR_${i}}`;
   if(tokens[i]!==token||!fields(binding,['token','source'])||binding.token!==token||typeof binding.source!=='string'||!binding.source.trim()||binding.source.length>512||binding.source.includes('TAMACOLLE_ACTOR_'))return false;
  }
 }
 return true;
}
function size(value){let total=0;for(const candidate of value||[]){total+=candidate.source.length;for(const binding of candidate.bindings)total+=binding.token.length+binding.source.length;}return total;}
const ordinary=text=>(text.match(protectedPattern)||[]).filter(token=>token!=='{USER}'&&!/^\{TAMACOLLE_ACTOR_(?:0|[1-9]\d*)\}$/.test(token));
const users=text=>(text.match(/\{USER\}/g)||[]).length;
function bind(templateText,candidate,translatedNames){
 if(!validate([candidate])||typeof templateText!=='string'||!templateText.trim()||templateText.length>50000||!translatedNames||typeof translatedNames.get!=='function')return null;
 const tokens=templateText.match(actor)||[];
 if(tokens.length!==candidate.bindings.length||new Set(tokens).size!==tokens.length||templateText.replace(actor,'').includes('TAMACOLLE_ACTOR_')||tokens.some(token=>!candidate.bindings.some(binding=>binding.token===token)))return null;
 if(users(templateText)!==users(candidate.source)||JSON.stringify(ordinary(templateText))!==JSON.stringify(ordinary(candidate.source))||/⟦[A-Za-z0-9]+_\d+⟧/.test(templateText))return null;
 const replacements=new Map();let expectedUsers=users(templateText);
 for(const binding of candidate.bindings){
  const text=binding.source==='{USER}'?'{USER}':translatedNames.get(binding.source);
  if(typeof text!=='string'||!text.trim()||text.length>50000||text.includes('TAMACOLLE_ACTOR_')||(binding.source!=='{USER}'&&text.includes('{USER}')))return null;
  if(binding.source==='{USER}')expectedUsers++;
  replacements.set(binding.token,text);
 }
 const result=templateText.replace(actor,token=>replacements.get(token));
 return result.length<=50000&&!result.includes('TAMACOLLE_ACTOR_')&&users(result)===expectedUsers?result:null;
}
globalThis[key]=Object.freeze({validate,size,bind});
})();
