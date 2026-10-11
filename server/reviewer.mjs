import {readFileSync} from 'node:fs';
import {timingSafeEqual} from 'node:crypto';
import {createReviewModel} from '../review_model.mjs';

const CONTRACT=JSON.parse(readFileSync(new URL('../review_contract.json',import.meta.url),'utf8'));
const SCOPES=CONTRACT.scopes;
const ENDPOINT='https://api.openai.com/v1/responses';
export const MAX_BODY=1_500_000;
export class ApiError extends Error {constructor(status,message,code){super(message);this.status=status;this.code=code;}}
const bad=message=>{throw new ApiError(400,message,'invalid_request');};
function string(value,label,max){if(typeof value!=='string'||value.length>max)bad(label+' 형식 또는 길이를 확인하세요.');return value;}
export function sourceId(data){
 const text=JSON.stringify([data.manuscript,data.selected,data.profile,data.coverage]);let hash=2166136261;
 for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
 return 'paper-'+(hash>>>0).toString(16).padStart(8,'0')+'-'+text.length;
}
export function validateRequest(data){
 if(!data||typeof data!=='object'||Array.isArray(data))bad('JSON 객체로 요청하세요.');
 const manuscript=string(data.manuscript,'원고',250000).trim();if(!manuscript)bad('검토할 원고를 입력하세요.');
 if(!Array.isArray(data.selected)||!data.selected.length||data.selected.length>6||data.selected.some(x=>typeof x!=='string'||!Object.hasOwn(SCOPES,x))||new Set(data.selected).size!==data.selected.length)bad('심사 범위를 확인하세요.');
 if(!data.selected.includes(data.scope))bad('실행할 범위가 선택한 심사 범위에 없습니다.');
 if(!['excerpt','complete'].includes(data.coverage))bad('제공 범위를 확인하세요.');
 const p=data.profile;if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(key=>!['title','degree','study_type','question','sections','feedback'].includes(key)))bad('논문 프로필 형식을 확인하세요.');
 if(!['석사','박사'].includes(p.degree)||!['unspecified','experimental','case','review','mixed'].includes(p.study_type))bad('학위와 연구 유형을 확인하세요.');
 const profile={title:string(p.title,'제목',10000),degree:p.degree,study_type:p.study_type,question:string(p.question,'연구 질문',10000),sections:string(p.sections,'제공 절',10000),feedback:string(p.feedback,'피드백',10000)};
 const result={manuscript,selected:data.selected,scope:data.scope,profile,coverage:data.coverage,source_id:string(data.source_id,'원고 ID',100)};
 if(sourceId(result)!==result.source_id)bad('원고 ID가 현재 원고·설정과 맞지 않습니다. 다시 실행하세요.');
 return result;
}
const sharedModel=createReviewModel(CONTRACT);
export const responseSchema=sharedModel.responseSchema;
export const modelPayload=sharedModel.modelPayload;
export async function callModel(data,{env=process.env,fetchImpl=fetch,signal}={}){
 const key=env.REVIEWER_API_KEY||env.OPENAI_API_KEY;
 if(!key)throw new ApiError(503,'AI API 키가 서버에 등록되지 않았습니다. 관리자에게 서버 연결을 요청하세요.','not_configured');
 const model=env.REVIEWER_MODEL||'gpt-4.1';
 const deadline=AbortSignal.timeout(150000),abort=signal?AbortSignal.any([signal,deadline]):deadline;
 let response;
 try{response=await fetchImpl(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify(modelPayload(data,model)),signal:abort});}
 catch(error){if(abort.aborted)throw new ApiError(504,'AI 응답 시간이 초과되었거나 요청이 취소되었습니다. 범위를 줄여 다시 실행하세요.','timeout');throw new ApiError(502,'AI 서비스에 연결하지 못했습니다. 서버의 네트워크 설정을 확인하세요.','upstream_unavailable');}
 if(!response.ok){
  if([401,403].includes(response.status))throw new ApiError(502,'서버의 AI API 키 또는 모델 접근 권한을 확인하세요.','provider_auth');
  if(response.status===429){
   let body;try{body=await response.json();}catch{}
   const info=sharedModel.limitError(body);throw new ApiError(429,info.message,info.code);
  }
  throw new ApiError(502,'AI 서비스가 요청을 처리하지 못했습니다. 모델 설정을 확인하거나 잠시 뒤 다시 실행하세요.','provider_error');
 }
 let body;try{body=await response.json();}catch{throw new ApiError(502,'AI 서비스의 응답 형식을 읽지 못했습니다.','invalid_response');}
 try{return sharedModel.parseModelResponse(body,data,model);}
 catch(error){throw new ApiError(error.status||502,error.message,error.code||'invalid_response');}
}
function localRequest(req){
 const host=req.headers.host||'',origin=req.headers.origin;
 return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)&&/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)&&(!origin||origin==='http://'+host||origin==='https://'+host);
}
function cors(req,res,env){
 const origin=req.headers.origin;if(!origin)return;
 const host=req.headers.host||'',same=[`https://${host}`,`http://${host}`];
 const allowed=(env.REVIEWER_ALLOWED_ORIGINS||'https://semifinal02-debug.github.io').split(',').map(x=>x.trim()).filter(Boolean);
 if(!same.includes(origin)&&!allowed.includes(origin))throw new ApiError(403,'이 웹 주소에서 AI 서비스에 연결할 수 없습니다.','origin_denied');
 res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
 res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Max-Age','600');
}
function authenticate(req,env,local){
 const token=env.REVIEWER_ACCESS_TOKEN;
 if(!token){if(local&&localRequest(req))return;throw new ApiError(503,'서버의 앱 접속 암호가 아직 설정되지 않았습니다.','access_not_configured');}
 const supplied=(req.headers.authorization||'').replace(/^Bearer /,'');const a=Buffer.from(supplied),b=Buffer.from(token);
 if(a.length!==b.length||!timingSafeEqual(a,b))throw new ApiError(401,'앱 접속 암호를 확인하세요.','unauthorized');
}
async function readBody(req){
 if(req.body!==undefined){const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(Buffer.byteLength(raw)>MAX_BODY)throw new ApiError(413,'원고가 너무 큽니다. 나누어 검토하세요.','too_large');try{return typeof req.body==='object'?req.body:JSON.parse(raw);}catch{bad('JSON 요청을 읽지 못했습니다.');}}
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw new ApiError(413,'원고가 너무 큽니다. 나누어 검토하세요.','too_large');chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{bad('JSON 요청을 읽지 못했습니다.');}
}
export function createHandler({kind='review',env=process.env,fetchImpl=fetch,local=false}={}){
 return async (req,res)=>{
  const send=(code,payload)=>{if(res.destroyed)return;res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(payload));};
  try{
   cors(req,res,env);if(req.method==='OPTIONS'){res.statusCode=204;return res.end();}
   if(kind==='status'){
    if(req.method!=='GET')return send(405,{error:'GET으로 연결 상태를 확인하세요.'});
    const configured=!!(env.REVIEWER_API_KEY||env.OPENAI_API_KEY)&&!!(env.REVIEWER_ACCESS_TOKEN||(local&&localRequest(req)));
    let authorized=false;
    if(configured){if(req.headers.authorization||!env.REVIEWER_ACCESS_TOKEN){authenticate(req,env,local);authorized=true;}}
    return send(200,{configured,authorized,requires_access:!!env.REVIEWER_ACCESS_TOKEN,model:configured?(env.REVIEWER_MODEL||'gpt-4.1'):null});
   }
   if(req.method!=='POST')return send(405,{error:'POST로 리뷰를 실행하세요.'});
   authenticate(req,env,local);
   if((req.headers['content-type']||'').split(';')[0].trim()!=='application/json')throw new ApiError(415,'JSON 형식으로 요청하세요.','unsupported_type');
   const data=validateRequest(await readBody(req));
   const controller=new AbortController();const onClose=()=>{if(!res.writableEnded)controller.abort();};res.on('close',onClose);
   try{send(200,await callModel(data,{env,fetchImpl,signal:controller.signal}));}finally{res.off('close',onClose);}
  }catch(error){const known=error instanceof ApiError;send(known?error.status:500,{error:known?error.message:'리뷰 요청을 처리하지 못했습니다.',code:known?error.code:'internal_error'});}
 };
}
