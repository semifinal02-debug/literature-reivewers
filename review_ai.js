// Service credentials live only in this tab; no provider key is accepted here.
const aiState={busy:false,task:null,configured:false,model:null};
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
async function checkAiConnection(quiet=false,signal){
 try{
  const origin=serviceOrigin(),headers=accessHeaders();
  if(!quiet)status($('ai-connection-status'),'AI 서비스 연결을 확인하고 있습니다…');
  const deadline=AbortSignal.timeout(12000);
  const response=await fetch(origin+'/api/status',{headers,signal:signal?AbortSignal.any([signal,deadline]):deadline}),data=await readApi(response);
  if(!data.configured)throw Error('AI 서비스의 API 키 또는 앱 접속 암호가 아직 설정되지 않았습니다. 서버 설정을 완료하세요.');
  if(!data.authorized)throw Error('앱 접속 암호를 입력한 뒤 연결을 확인하세요.');
  aiState.configured=true;aiState.model=data.model;
  $('ai-connection-state').textContent='연결됨 · '+data.model;$('ai-connection-state').className='badge strength';
  status($('ai-connection-status'),'AI 서비스가 연결되었습니다. 원고를 준비하고 선택 범위 분석을 시작하세요.');
  return {origin,headers};
 }catch(error){
  aiState.configured=false;$('ai-connection-state').textContent='서비스 연결 필요';$('ai-connection-state').className='badge insufficient_evidence';
  const message=error.name==='AbortError'?'AI 서비스 연결 확인을 취소했습니다.':error.name==='TimeoutError'?'연결 확인 시간이 초과되었습니다. 서비스 주소와 서버 상태를 확인하세요.':error instanceof TypeError?'AI 서비스에 연결하지 못했습니다. 서비스 주소·공개 접근·허용 웹 주소 설정을 확인하세요.':error.message;
  status($('ai-connection-status'),message,'error');throw Error(message);
 }
}
function refreshAiInfo(){const scopes=selectedScopes();$('ai-run-info').textContent=`${scopes.length}개 범위 · AI 요청 ${scopes.length}회 · 본문 ${$('manuscript').value.trim().length.toLocaleString()}자`;}
function busyAi(value){
 aiState.busy=value;for(const id of ['run-ai','ai-start','check-ai','retry-ai'])$(id).disabled=value;
 $('cancel-ai').hidden=!value;
}
function progressAi(task){
 $('ai-progress').innerHTML=task.snapshot.selected.map(id=>{
  const done=task.results.has(id),failed=task.failures.has(id),running=task.current===id&&!done&&!failed;
  return `<div style="display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid var(--line);font-size:13px"><span>${esc(SCOPES[id].name)}</span><span class="badge ${done?'strength':failed?'needs_revision':'insufficient_evidence'}">${done?'완료':failed?'실패':running?'심사 중…':'대기'}</span></div>`;
 }).join('');
}
function aggregateAi(task){
 const values=[...task.results.entries()];
 return {source_id:task.source_id,summary:values.map(([id,item])=>SCOPES[id].name+'\n'+item.review.summary).join('\n\n'),scopes:values.flatMap(([,item])=>item.review.scopes),comments:values.flatMap(([,item])=>item.review.comments??[]),metrics:values.filter(([id])=>id==='results').flatMap(([,item])=>item.review.metrics??[]),questions:[...new Set(values.flatMap(([,item])=>item.review.questions??[]))],limitations:[...new Set(values.flatMap(([,item])=>item.review.limitations??[]))]};
}
function cancelAiForChange(){
 if(aiState.busy&&aiState.task){aiState.task.changed=true;aiState.task.controller.abort();status($('ai-run-status'),'원고·설정이 변경되어 진행 중인 리뷰를 취소했습니다. 현재 원고로 다시 실행하세요.','warn');}
 if(!aiState.busy){aiState.task=null;$('retry-ai').hidden=true;$('ai-progress').replaceChildren();$('ai-run-status').hidden=true;}
 refreshAiInfo();
}
async function runAi(retry=false){
 if(aiState.busy)return;
 let s,task,connection;
 try{
  s=snapshot();show('connect');refreshAiInfo();busyAi(true);
  if(retry&&aiState.task&&aiState.task.source_id===sourceId(s)){
   task=aiState.task;task.controller=new AbortController();task.changed=false;task.cancelled=false;
  }else{
   task={snapshot:s,source_id:sourceId(s),controller:new AbortController(),results:new Map(),failures:new Map(),current:null,changed:false,cancelled:false};
  }
  aiState.task=task;$('retry-ai').hidden=true;
  connection=await checkAiConnection(true,task.controller.signal);
  if(task.controller.signal.aborted||sourceId(snapshot())!==sourceId(s))throw Error('연결 확인 중 원고·설정이 바뀌었거나 취소되었습니다. 현재 원고로 다시 실행하세요.');
  if(connection.origin!==serviceOrigin()||JSON.stringify(connection.headers)!==JSON.stringify(accessHeaders()))throw Error('AI 서비스 연결 설정이 바뀌었습니다. 다시 실행하세요.');
  if(!retry){state.report=null;state.done.clear();renderReport();}
  const pending=s.selected.filter(id=>!task.results.has(id));for(const id of pending)task.failures.delete(id);
  progressAi(task);
  for(let index=0;index<pending.length;index++){
   const id=pending[index];if(task.controller.signal.aborted)break;
   task.current=id;progressAi(task);status($('ai-run-status'),`${SCOPES[id].name} 리뷰어가 원고를 읽고 있습니다… (${task.results.size}/${s.selected.length} 완료)`);
   try{
    const response=await fetch(connection.origin+'/api/review',{method:'POST',headers:{'Content-Type':'application/json',...connection.headers},body:JSON.stringify({source_id:task.source_id,manuscript:s.text,selected:s.selected,scope:id,profile:s.profile,coverage:s.coverage}),signal:AbortSignal.any([task.controller.signal,AbortSignal.timeout(170000)])});
    const item=await readApi(response);
    if(!item.review||typeof item.model!=='string')throw Error('AI 응답의 형식이 올바르지 않습니다.');
    // Validate against this request's scope before allowing it into the aggregate.
    if(!Array.isArray(item.review.scopes)||item.review.scopes.length!==1||item.review.scopes[0].id!==id)throw Error('AI 응답이 요청한 심사 범위와 맞지 않습니다.');
    parseReview(JSON.stringify(item.review),s);
    task.results.set(id,item);
   }catch(error){
    if(task.controller.signal.aborted)break;
    task.failures.set(id,error.name==='TimeoutError'?'응답 시간이 초과되었습니다. 원고 범위를 줄여 다시 실행하세요.':error.message);
    if([401,403,429,503].includes(error.status)||error instanceof TypeError){
     for(const rest of pending.slice(index+1))task.failures.set(rest,'연결·인증 또는 요청 한도 문제로 실행하지 않았습니다.');break;
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
  if(task.cancelled){for(const id of remaining)task.failures.set(id,'사용자가 분석을 취소했습니다.');$('retry-ai').hidden=!remaining.length;status($('ai-run-status'),`분석을 취소했습니다. 완료된 ${task.results.size}개 범위는 보고서에 보존했습니다.`,'warn');}
  else if(task.failures.size)status($('ai-run-status'),`${task.results.size}/${s.selected.length}개 범위 완료. 완료된 결과는 ‘리뷰 보고서’에서 볼 수 있습니다.\n${[...task.failures].map(([id,error])=>SCOPES[id].name+': '+error).join('\n')}`,'warn');
  else status($('ai-run-status'),`${task.results.size}개 범위의 AI 리뷰가 완료되었습니다. 원문 인용을 대조한 보고서를 열었습니다.`);
 }catch(error){status($('ai-run-status'),error.message,'error');}
 finally{busyAi(false);}
}
$('run-ai').onclick=()=>runAi();$('ai-start').onclick=()=>runAi();$('check-ai').onclick=()=>checkAiConnection().catch(()=>{});$('retry-ai').onclick=()=>runAi(true);
$('cancel-ai').onclick=()=>{const task=aiState.task;if(task){task.cancelled=true;task.controller.abort();}};
for(const id of ['ai-service-url','ai-access'])$(id).addEventListener('input',()=>{if(aiState.busy){aiState.task?.controller.abort();if(aiState.task)aiState.task.changed=true;}aiState.configured=false;$('ai-connection-state').textContent='서비스 연결 필요';$('ai-connection-state').className='badge insufficient_evidence';});
document.addEventListener('change',event=>{if(event.target.name==='scope')refreshAiInfo();});
refreshAiInfo();
