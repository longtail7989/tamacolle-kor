'use strict';
const toggle=document.getElementById('enabled'),toggleText=document.getElementById('enabled-text'),version=document.getElementById('version'),update=document.getElementById('update'),status=document.getElementById('status');
let currentState=null,changing=false,checking=false,closed=false;
function show(message,error=false){status.textContent=message;status.classList.toggle('error',error);}
function render(state){if(!state)return;currentState=state;toggle.checked=state.enabled;toggleText.textContent=state.enabled?'On':'Off';version.textContent=state.version||'—';toggle.disabled=changing;update.disabled=checking;}
async function request(message){const response=await chrome.runtime.sendMessage(message);if(!response?.ok)throw Error(response?.error||'확장에 연결하지 못했습니다.');return response;}
toggle.addEventListener('change',async()=>{
  const wanted=toggle.checked;changing=true;toggle.disabled=true;
  try{const response=await request({type:'SET_ENABLED',enabled:wanted});render(response.state);show(wanted?'현재 게임에 한글화를 적용했습니다.':'현재 게임을 원문으로 표시합니다.');}
  catch(error){if(currentState)render(currentState);show(error.message,true);}
  finally{changing=false;if(currentState)render(currentState);}
});
update.addEventListener('click',async()=>{
  if(checking)return;checking=true;update.disabled=true;show('새 한글 리소스를 확인하고 있습니다.');
  try{
    const response=await request({type:'CHECK_UPDATE'});render(response.state);
    const result=response.result;
    if(result.status==='updated')show(response.state.enabled?'새 한글 리소스를 현재 게임에 적용했습니다.':'새 한글 리소스를 저장했습니다. 한글화 On에서 적용됩니다.');
    else if(result.status==='current')show('최신 한글 리소스입니다.');
    else if(result.status==='unpublished')show('아직 공개된 업데이트가 없습니다. 기본 한글 리소스를 사용합니다.');
    else if(result.status==='requires-extension')show('새 리소스를 사용하려면 확장 업데이트가 필요합니다. GitHub Releases에서 새 확장을 설치해 주세요.');
    else throw Error('업데이트 상태를 확인하지 못했습니다.');
  }catch(error){show(error.message,true);}
  finally{checking=false;if(currentState)render(currentState);else update.disabled=false;}
});
let port=null,reconnectTimer=null;
function reconnect(){
  if(closed||reconnectTimer)return;
  toggle.disabled=true;update.disabled=true;
  show('연결을 다시 확인하고 있습니다.');
  reconnectTimer=setTimeout(()=>{reconnectTimer=null;connect();},1000);
}
function connect(){
  if(closed)return;
  try{
    const connection=chrome.runtime.connect({name:'tamacolle-kor-popup'});port=connection;
    connection.onMessage.addListener(message=>{
      if(closed||port!==connection)return;
      if(message.type==='STATE_CHANGED'){render(message.state);if(!checking&&message.state.error)show(message.state.error,true);}
      else if(message.type==='ERROR')show(message.error,true);
    });
    connection.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(!closed&&port===connection){port=null;reconnect();}});
    request({type:'GET_STATE'}).then(response=>{
      if(closed||port!==connection)return;
      render(response.state);
      if(!checking)show(response.state.error||(response.state.enabled?'한글화가 켜져 있습니다.':'원문으로 표시하고 있습니다.'),!!response.state.error);
    }).catch(error=>{if(!closed)show(error.message,true);});
  }catch(error){
    if(!chrome.runtime.id){show('확장이 갱신되었습니다. 팝업을 다시 열어 주세요.',true);return;}
    reconnect();
  }
}
window.addEventListener('pagehide',()=>{closed=true;clearTimeout(reconnectTimer);port?.disconnect();},{once:true});
connect();
