// Keys live only in the password input and active request closures, never storage.
const aiState={busy:false,task:null,configured:false,model:null};
const aiModel=createReviewModel(APP_DATA);
const OPENAI_ORIGIN='https://api.openai.com';
const directFetchOptions={credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'};
function aiMode(){return $('ai-mode').value;}
function directConnection(){
 const key=$('ai-api-key').value.trim(),model=$('ai-model').value;
 if(!key)throw Error('OpenAI API 키를 입력하세요. 키는 현재 탭에서만 사용합니다.');
 if(!/^sk-[A-Za-z0-9_-]+$/.test(key)||key.length>1024)throw Error('API 키 형식을 확인하세요. OpenAI에서 발급한 sk-로 시작하는 키 전체를 입력하세요.');
 if(!['gpt-4.1','gpt-4.1-mini'].includes(model))throw Error('지원하는 분석 모델을 선택하세요.');
 return {mode:'direct',origin:OPENAI_ORIGIN,model,headers:{Authorization:'Bearer '+key}};
}
function serviceOrigin(){
 const value=$('ai-service-url').value.trim()||location.origin;
 let url;try{url=new URL(value);}catch{throw Error('AI 서비스의 웹 주소를 입력하세요.');}
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(url.protocol!=='https:'&&!(local&&url.protocol==='http:'))throw Error('AI 서비스는 HTTPS 웹 주소로 연결하세요.');
 if(url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw Error('AI 서비스 주소에는 도메인만 입력하세요. 경로·암호·쿼리는 제외하세요.');
 return url.origin;
}
function accessHeaders(){
 const token=$('ai-access').value.trim();
 if(/^sk-/i.test(token))throw Error('이 칸에는 앱 접속 암호만 입력하세요. AI API 키는 서버 환경 변수에 등록하세요.');
 return token?{Authorization:'Bearer '+token}:{};
}
async function readApi(response){
 let body;try{body=await response.json();}catch{throw Error('AI API 서버를 찾지 못했습니다. AI 서비스 주소를 연결하세요. GitHub Pages에는 AI 서버가 없습니다.');}
 if(!response.ok){const error=Error(typeof body.error==='string'?body.error:'AI 요청을 처리하지 못했습니다.');error.status=response.status;error.code=body.code;throw error;}
 return body;
}
async function readOpenAI(response){
 if(!response.ok){
  // Never display raw provider errors: they can echo request credentials.
  if(response.status===429){
   let body;try{body=await response.json();}catch{}
   const info=aiModel.limitError(body),error=Error(info.message);error.status=429;error.code=info.code;throw error;
  }
  const messages={401:'API 키가 올바르지 않거나 만료되었습니다. 새 키를 입력하세요.',403:'이 API 키의 모델 접근 권한을 확인하세요.',404:'선택한 모델을 사용할 수 없습니다. 모델 접근 권한을 확인하세요.',400:'OpenAI가 요청 형식을 처리하지 못했습니다. 원고 길이·모델 접근 권한을 확인하고 다시 실행하세요.'};
  const error=Error(messages[response.status]||'OpenAI 서비스가 요청을 처리하지 못했습니다. 잠시 뒤 실패한 범위만 다시 실행하세요.');error.status=response.status;throw error;
 }
 try{return await response.json();}catch{throw Error('OpenAI 응답을 읽지 못했습니다. 다시 실행하세요.');}
}
async function checkAiConnection(quiet=false,signal){
 try{
  const mode=aiMode(),connection=mode==='direct'?directConnection():{mode,origin:serviceOrigin(),headers:accessHeaders()};
  if(!quiet)status($('ai-connection-status'),mode==='direct'?'API 키와 모델 접근 권한을 확인하고 있습니다…':'AI 서비스 연결을 확인하고 있습니다…');
  const deadline=AbortSignal.timeout(12000);
  const abort=signal?AbortSignal.any([signal,deadline]):deadline;
  if(mode==='direct'){
   const response=await fetch(OPENAI_ORIGIN+'/v1/models/'+encodeURIComponent(connection.model),{...directFetchOptions,headers:connection.headers,signal:abort});
   const data=await readOpenAI(response);
   if(data.id!==connection.model)throw Error('선택한 모델의 접근 권한을 확인하지 못했습니다.');
  }else{
   const response=await fetch(connection.origin+'/api/status',{headers:connection.headers,signal:abort}),data=await readApi(response);
   if(!data.configured)throw Error('AI 서비스의 API 키 또는 앱 접속 암호가 아직 설정되지 않았습니다. 서버 설정을 완료하세요.');
   if(!data.authorized)throw Error('앱 접속 암호를 입력한 뒤 연결을 확인하세요.');
   connection.model=data.model;
  }
  if(abort.aborted||!sameConnection(connection))throw Error('연결 설정이 변경되었거나 연결 확인이 취소되었습니다. 다시 확인하세요.');
  aiState.configured=true;aiState.model=connection.model;
  $('ai-connection-state').textContent='연결됨 · '+connection.model;$('ai-connection-state').className='badge strength';
  status($('ai-connection-status'),'키와 모델 접근 권한을 확인했습니다. 원고는 보내지 않았으며 API 크레딧·생성 요청 한도는 이 확인으로 알 수 없습니다.');
  return connection;
 }catch(error){
  resetAiConnection();
  const message=aiErrorMessage(error);
  status($('ai-connection-status'),message,'error');$('ai-help').hidden=false;throw error;
 }
}
function aiErrorMessage(error){
 if(error.name==='AbortError')return 'AI 요청을 취소했습니다.';
 if(error.name==='TimeoutError')return '응답 시간이 초과되었습니다. 원고 범위를 줄여 다시 실행하세요.';
 if(error instanceof TypeError)return aiMode()==='direct'?'OpenAI에 연결하지 못했습니다. 인터넷 연결·브라우저 확장 기능·기관의 API 접속 제한을 확인하세요.':'AI 서비스에 연결하지 못했습니다. 서비스 주소·공개 접근·허용 웹 주소 설정을 확인하세요.';
 return error.message;
}
function sameConnection(connection){
 try{
  if(connection.mode!==aiMode())return false;
  const current=aiMode()==='direct'?directConnection():{origin:serviceOrigin(),headers:accessHeaders()};
  return current.origin===connection.origin&&JSON.stringify(current.headers)===JSON.stringify(connection.headers)&&(connection.mode!=='direct'||current.model===connection.model);
 }catch{return false;}
}
function resetAiConnection(){
 aiState.configured=false;aiState.model=null;
 $('ai-connection-state').textContent=aiMode()==='direct'?'API 키 입력 필요':'서비스 연결 필요';$('ai-connection-state').className='badge insufficient_evidence';
}
function updateAiMode(){
 const direct=aiMode()==='direct';$('ai-direct-fields').hidden=!direct;$('ai-server-fields').hidden=direct;
 $('ai-privacy-note').textContent=direct?'‘분석 시작’을 누르면 추출한 논문 본문·연구 설정·평가 기준을 OpenAI에 보냅니다. PDF 원본은 전송하지 않습니다. 요청은 store: false를 사용하며 제공자의 별도 데이터 보관 정책이 적용됩니다.':'추출한 논문 본문·연구 설정·평가 기준이 연결한 서버와 OpenAI로 전송됩니다. PDF 원본은 전송하지 않습니다. 서버는 원고를 파일에 저장하지 않으며 모델 요청은 store: false를 사용합니다.';
}
async function requestScope(connection,data,signal){
 if(connection.mode==='direct'){
  const response=await fetch(OPENAI_ORIGIN+'/v1/responses',{...directFetchOptions,method:'POST',headers:{'Content-Type':'application/json',...connection.headers},body:JSON.stringify(aiModel.modelPayload(data,connection.model)),signal});
  return aiModel.parseModelResponse(await readOpenAI(response),data,connection.model);
 }
 const response=await fetch(connection.origin+'/api/review',{method:'POST',headers:{'Content-Type':'application/json',...connection.headers},body:JSON.stringify(data),signal});
 return readApi(response);
}
function refreshAiInfo(){const scopes=selectedScopes();$('ai-run-info').textContent=`${scopes.length}개 범위 · AI 요청 ${scopes.length}회 · 본문 ${$('manuscript').value.trim().length.toLocaleString()}자`;}
function busyAi(value){
 aiState.busy=value;for(const id of ['run-ai','ai-start','check-ai','retry-ai'])$(id).disabled=value;
 $('cancel-ai').hidden=!value;
}
function progressAi(task){
 $('ai-progress').innerHTML=task.snapshot.selected.map(id=>{
  const done=task.results.has(id),skipped=task.skipped.has(id),failed=task.failures.has(id)&&!skipped,cancelled=task.cancelled&&task.failures.get(id)==='사용자가 분석을 취소했습니다.',running=task.current===id&&!done&&!failed&&!skipped;
  return `<div style="display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid var(--line);font-size:13px"><span>${esc(SCOPES[id].name)}</span><span class="badge ${done?'strength':failed&&!cancelled?'needs_revision':'insufficient_evidence'}">${done?'완료':cancelled?'취소':skipped?'미실행':failed?'실패':running?'심사 중…':'대기'}</span></div>`;
 }).join('');
}
function aggregateAi(task){
 const values=[...task.results.entries()];
 return {source_id:task.source_id,summary:values.map(([id,item])=>SCOPES[id].name+'\n'+item.review.summary).join('\n\n'),scopes:values.flatMap(([,item])=>item.review.scopes),comments:values.flatMap(([,item])=>item.review.comments??[]),metrics:values.filter(([id])=>id==='results').flatMap(([,item])=>item.review.metrics??[]),questions:[...new Set(values.flatMap(([,item])=>item.review.questions??[]))],limitations:[...new Set(values.flatMap(([,item])=>item.review.limitations??[]))]};
}
function cancelAiForChange(){
 if(aiState.busy&&aiState.task){aiState.task.changed=true;aiState.task.controller.abort();status($('ai-run-status'),'원고·설정이 변경되어 진행 중인 리뷰를 취소했습니다. 현재 원고로 다시 실행하세요.','warn');}
 if(!aiState.busy){aiState.task=null;$('retry-ai').hidden=true;$('ai-progress').replaceChildren();$('ai-run-status').hidden=true;$('ai-help').hidden=true;}
 refreshAiInfo();
}
async function runAi(retry=false){
 if(aiState.busy)return;
 let s,task,connection;
 try{
  s=snapshot();show('connect');refreshAiInfo();busyAi(true);$('ai-help').hidden=true;
  if(retry&&aiState.task&&aiState.task.source_id===sourceId(s)){
   task=aiState.task;task.controller=new AbortController();task.changed=false;task.cancelled=false;
  }else{
   task={snapshot:s,source_id:sourceId(s),controller:new AbortController(),results:new Map(),failures:new Map(),skipped:new Set(),current:null,changed:false,cancelled:false};
  }
  aiState.task=task;$('retry-ai').hidden=true;
  connection=await checkAiConnection(true,task.controller.signal);
  if(task.controller.signal.aborted||sourceId(snapshot())!==sourceId(s))throw Error('연결 확인 중 원고·설정이 바뀌었거나 취소되었습니다. 현재 원고로 다시 실행하세요.');
  if(!sameConnection(connection))throw Error('AI 서비스 연결 설정이 바뀌었습니다. 다시 실행하세요.');
  if(!retry){state.report=null;state.done.clear();renderReport();}
  const pending=s.selected.filter(id=>!task.results.has(id));for(const id of pending){task.failures.delete(id);task.skipped.delete(id);}
  progressAi(task);
  for(let index=0;index<pending.length;index++){
   const id=pending[index];if(task.controller.signal.aborted)break;
   task.current=id;progressAi(task);status($('ai-run-status'),`${SCOPES[id].name} 리뷰어가 원고를 읽고 있습니다… (${task.results.size}/${s.selected.length} 완료)`);
   try{
    const item=await requestScope(connection,{source_id:task.source_id,manuscript:s.text,selected:s.selected,scope:id,profile:s.profile,coverage:s.coverage},AbortSignal.any([task.controller.signal,AbortSignal.timeout(170000)]));
    if(!item.review||typeof item.model!=='string')throw Error('AI 응답의 형식이 올바르지 않습니다.');
    // Validate against this request's scope before allowing it into the aggregate.
    if(!Array.isArray(item.review.scopes)||item.review.scopes.length!==1||item.review.scopes[0].id!==id)throw Error('AI 응답이 요청한 심사 범위와 맞지 않습니다.');
    parseReview(JSON.stringify(item.review),s);
    task.results.set(id,item);
   }catch(error){
    if(task.controller.signal.aborted)break;
    task.failures.set(id,aiErrorMessage(error));
    if([400,401,403,404,429,503].includes(error.status)||error instanceof TypeError){
     for(const rest of pending.slice(index+1)){task.skipped.add(rest);task.failures.set(rest,'앞선 요청이 제한되어 실행하지 않았습니다.');}break;
    }
   }
   progressAi(task);
  }
  task.current=null;progressAi(task);
  if(task.changed||sourceId(snapshot())!==task.source_id)return;
  if(task.results.size){
   const combined=aggregateAi(task),raw=JSON.stringify(combined),report=parseReview(raw,s);
   report.mode='api';report.model=[...new Set([...task.results.values()].map(item=>item.model))].join(', ');
   report.warnings.push(...[...task.failures].map(([id,error])=>SCOPES[id].name+': '+error));
   state.report=report;$('review-response').value=raw;state.scope='all';state.filter='all';state.tab='criteria';
   if(!task.failures.size&&!task.cancelled)show('report');else renderReport();
  }
  $('retry-ai').hidden=!task.failures.size||task.changed;
  const remaining=s.selected.filter(id=>!task.results.has(id));
  if(task.cancelled){for(const id of remaining)task.failures.set(id,'사용자가 분석을 취소했습니다.');progressAi(task);$('retry-ai').hidden=!remaining.length;status($('ai-run-status'),task.results.size?`분석을 취소했습니다. 완료된 ${task.results.size}개 범위는 보고서에 보존했습니다.`:'분석을 취소했습니다. 생성된 리뷰 보고서는 없습니다.','warn');}
  else if(task.failures.size){$('ai-help').hidden=false;status($('ai-run-status'),`${task.results.size}/${s.selected.length}개 범위 완료. ${task.results.size?'완료된 결과는 ‘리뷰 보고서’에서 볼 수 있습니다.':'생성된 리뷰 보고서는 없습니다.'}\n${[...task.failures].map(([id,error])=>SCOPES[id].name+': '+error).join('\n')}`,'warn');}
  else status($('ai-run-status'),`${task.results.size}개 범위의 AI 리뷰가 완료되었습니다. 원문 인용을 대조한 보고서를 열었습니다.`);
 }catch(error){
  status($('ai-run-status'),aiErrorMessage(error),'error');
  $('ai-help').hidden=false;
  if(task&&!task.changed&&task.failures.size)$('retry-ai').hidden=false;
 }
 finally{busyAi(false);}
}
$('run-ai').onclick=()=>runAi();$('ai-start').onclick=()=>runAi();$('check-ai').onclick=()=>checkAiConnection().catch(()=>{});$('retry-ai').onclick=()=>runAi(true);
$('cancel-ai').onclick=()=>{const task=aiState.task;if(task){task.cancelled=true;task.controller.abort();}};
$('ai-use-chatgpt').onclick=()=>{generatePrompt();if(state.prompt)$('manual-review').scrollIntoView({behavior:'smooth',block:'start'});};
function aiSettingsChanged(resetTask=false){
 if(aiState.busy){if(aiState.task)aiState.task.changed=true;aiState.task?.controller.abort();status($('ai-run-status'),'AI 연결 설정이 변경되어 분석을 취소했습니다. 다시 실행하세요.','warn');}
 if(resetTask&&!aiState.busy){aiState.task=null;$('retry-ai').hidden=true;$('ai-progress').replaceChildren();}
 resetAiConnection();$('ai-connection-status').hidden=true;
}
for(const id of ['ai-api-key','ai-service-url','ai-access'])$(id).addEventListener('input',()=>aiSettingsChanged());
for(const id of ['ai-mode','ai-model'])$(id).addEventListener('change',()=>{aiSettingsChanged(true);updateAiMode();});
$('clear-ai-key').onclick=()=>{$('ai-api-key').value='';aiSettingsChanged();status($('ai-connection-status'),'API 키를 비웠습니다. 다시 실행하려면 키를 입력하세요.');};
// Clear password inputs on departure, including back/forward cache restoration.
addEventListener('pagehide',()=>{$('ai-api-key').value='';$('ai-access').value='';aiSettingsChanged();});
addEventListener('pageshow',event=>{if(event.persisted)resetAiConnection();});
document.addEventListener('change',event=>{if(event.target.name==='scope')refreshAiInfo();});
updateAiMode();
refreshAiInfo();
