import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createHandler,sourceId,validateRequest,callModel,modelPayload} from '../server/reviewer.mjs';

const env={REVIEWER_API_KEY:'synthetic-provider-key',REVIEWER_ACCESS_TOKEN:'synthetic-access-code'};
const profile={title:'테스트 논문',degree:'박사',study_type:'experimental',question:'질문',sections:'방법·결과',feedback:''};
function requestData(){const data={manuscript:'작업 시간을 비교한다.\np < 0.05를 보고했다.',profile,coverage:'excerpt',selected:['gap','methods','results'],scope:'gap'};data.source_id=sourceId(data);return data;}
function completed(data){return {source_id:data.source_id,summary:'합성 응답. 실제 모델 미실행.',scopes:[{id:data.scope,overview:'자료가 부족하여 보류합니다.',criteria:modelPayload(data,'gpt-4.1').text.format.schema.properties.scopes.items.properties.criteria.items.properties.id.enum.map(id=>({id,status:'insufficient_evidence',assessment:'근거 자료 필요',evidence:[],actions:['원문 자료 확인']}))}],comments:[],metrics:[],questions:[],limitations:['검증용 합성 응답']};}
function providerResponse(data){return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(completed(data))}]}]}),{status:200,headers:{'Content-Type':'application/json'}});}
async function withServer(handler,run){
 const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');
 try{await run('http://127.0.0.1:'+server.address().port);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
const auth={'Content-Type':'application/json',Authorization:'Bearer synthetic-access-code'};

test('validates current manuscript, scope selection and profile',()=>{
 const data=requestData();assert.deepEqual(validateRequest(data),data);
 for(const patch of [{source_id:'wrong'},{scope:'safety'},{selected:['gap','gap']},{selected:['__proto__']},{profile:[]},{profile:{...profile,model:'override'}},{manuscript:''}])assert.throws(()=>validateRequest({...data,...patch}));
});
test('keeps the model endpoint and API key on the server; disables response storage',async()=>{
 const data=requestData();let call;
 const result=await callModel(data,{env,fetchImpl:async(url,options)=>{call={url,options};return providerResponse(data);}});
 assert.equal(call.url,'https://api.openai.com/v1/responses');assert.equal(call.options.headers.Authorization,'Bearer synthetic-provider-key');
 const body=JSON.parse(call.options.body);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(body.model,'gpt-4.1');
 assert.match(body.input[0].content,/정성 연구에 p값을 강요하지 않는다/);assert.match(body.input[1].content,/L2: p < 0.05/);
 assert.equal(result.review.scopes[0].criteria.length,6);assert(!JSON.stringify(result).includes(env.REVIEWER_API_KEY));
});
test('successful HTTP request returns a scoped review',async()=>{
 const data=requestData();await withServer(createHandler({env,fetchImpl:async()=>providerResponse(data)}),async(base)=>{
  const response=await fetch(base,{method:'POST',headers:auth,body:JSON.stringify(data)});assert.equal(response.status,200);assert.equal((await response.json()).review.source_id,data.source_id);
 });
});
test('authentication fails before any model call',async()=>{
 let calls=0;await withServer(createHandler({env,fetchImpl:async()=>{calls++;throw Error();}}),async(base)=>{
  for(const authorization of ['', 'Bearer wrong']){const response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json',Authorization:authorization},body:JSON.stringify(requestData())});assert.equal(response.status,401);}
  assert.equal(calls,0);
 });
});
test('public deployment requires both key and access code',async()=>{
 await withServer(createHandler({env:{REVIEWER_API_KEY:'synthetic-provider-key'}}),async(base)=>{
  const response=await fetch(base,{method:'POST',headers:auth,body:'{}'});assert.equal(response.status,503);assert.equal((await response.json()).code,'access_not_configured');
 });
 await assert.rejects(callModel(requestData(),{env:{}}),e=>e.status===503&&e.code==='not_configured');
});
test('development without access code is limited to same-origin loopback',async()=>{
 const data=requestData();await withServer(createHandler({env:{REVIEWER_API_KEY:'synthetic-provider-key'},local:true,fetchImpl:async()=>providerResponse(data)}),async(base)=>{
  const headers={'Content-Type':'application/json',Origin:base};
  assert.equal((await fetch(base,{method:'POST',headers,body:JSON.stringify(data)})).status,200);
  assert.equal((await fetch(base,{method:'POST',headers:{...headers,Origin:'https://semifinal02-debug.github.io'},body:JSON.stringify(data)})).status,503);
 });
});
test('status distinguishes configured service from authorized user and exposes no key',async()=>{
 await withServer(createHandler({kind:'status',env}),async(base)=>{
  const anonymous=await (await fetch(base)).json();assert.equal(anonymous.configured,true);assert.equal(anonymous.authorized,false);
  const authorized=await (await fetch(base,{headers:auth})).json();assert.equal(authorized.authorized,true);assert(!JSON.stringify(authorized).includes(env.REVIEWER_API_KEY));
  assert.equal((await fetch(base,{headers:{Authorization:'Bearer wrong'}})).status,401);
 });
});
test('CORS permits the Pages origin and rejects others; preflight never calls model',async()=>{
 await withServer(createHandler({env}),async(base)=>{
  const good=await fetch(base,{method:'OPTIONS',headers:{Origin:'https://semifinal02-debug.github.io'}});assert.equal(good.status,204);assert.equal(good.headers.get('Access-Control-Allow-Origin'),'https://semifinal02-debug.github.io');
  const bad=await fetch(base,{method:'POST',headers:{...auth,Origin:'https://unrelated.invalid'},body:'{}'});assert.equal(bad.status,403);
 });
});
test('invalid input, content type and oversized payload never reaches model',async()=>{
 let calls=0;await withServer(createHandler({env,fetchImpl:async()=>{calls++;throw Error();}}),async(base)=>{
  assert.equal((await fetch(base,{method:'POST',headers:{Authorization:auth.Authorization},body:'{}'})).status,415);
  assert.equal((await fetch(base,{method:'POST',headers:auth,body:'{' })).status,400);
  assert.equal((await fetch(base,{method:'POST',headers:auth,body:' '.repeat(1500001)})).status,413);
  assert.equal((await fetch(base)).status,405);assert.equal(calls,0);
 });
});
test('provider failures are sanitized without exposing provider error data',async()=>{
 for(const [upstream,expected,code] of [[401,502,'provider_auth'],[403,502,'provider_auth'],[429,429,'provider_limit'],[500,502,'provider_error']]){
  await assert.rejects(callModel(requestData(),{env,fetchImpl:async()=>new Response(JSON.stringify({error:'private provider details '+env.REVIEWER_API_KEY}),{status:upstream})}),e=>e.status===expected&&e.code===code&&!e.message.includes(env.REVIEWER_API_KEY));
 }
 for(const [code,expected,phrase] of [['insufficient_quota','provider_quota','크레딧이 없거나'],['rate_limit_exceeded','provider_rate_limit','분당 요청량'],['unknown','provider_limit','확인할 수 없습니다']]){
  await assert.rejects(callModel(requestData(),{env,fetchImpl:async()=>new Response(JSON.stringify({error:{code,message:'private '+env.REVIEWER_API_KEY}}),{status:429})}),e=>e.status===429&&e.code===expected&&e.message.includes(phrase)&&!e.message.includes(env.REVIEWER_API_KEY));
 }
});
test('incomplete, refused and malformed output does not become a review',async()=>{
 for(const [body,code] of [[{status:'incomplete'},'incomplete_response'],[{status:'completed',output:[{content:[{type:'refusal'}]}]},'model_refusal'],[{status:'completed',output:[{content:[{type:'output_text',text:'not JSON'}]}]},'invalid_response']])await assert.rejects(callModel(requestData(),{env,fetchImpl:async()=>new Response(JSON.stringify(body))}),e=>e.code===code);
});
test('missing, duplicated, or incorrect scope criteria are rejected',async()=>{
 for(const mutate of [r=>r.scopes[0].criteria.pop(),r=>r.scopes[0].criteria[0]=r.scopes[0].criteria[1],r=>r.scopes[0].id='results',r=>r.source_id='wrong']){
  const data=requestData(),review=completed(data);mutate(review);
  await assert.rejects(callModel(data,{env,fetchImpl:async()=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(review)}]}]}))}),e=>e.code==='invalid_response');
 }
});
test('upstream cancellation is reported as timeout rather than fabricated review',async()=>{
 const controller=new AbortController();controller.abort();
 await assert.rejects(callModel(requestData(),{env,signal:controller.signal,fetchImpl:async()=>{throw Error('cancelled');}}),e=>e.status===504&&e.code==='timeout');
});
