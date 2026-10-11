// PDF.js and supporting data are embedded in index.html. No upload server is required.
let pdfEnginePromise;
function base64Bytes(value){return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
async function pdfEngine(){
 if(!pdfEnginePromise){pdfEnginePromise=(async()=>{
  if(!Promise.withResolvers)throw Error('PDF 읽기를 지원하는 최신 Chrome, Edge 또는 Firefox에서 열어주세요.');
  const module=await import('data:text/javascript;base64,'+APP_DATA.pdfModule);
  // The in-page worker also works when iframe policy disallows separate workers.
  globalThis.pdfjsWorker=await import('data:text/javascript;base64,'+APP_DATA.pdfWorker);
  module.GlobalWorkerOptions.workerSrc='data:text/javascript;base64,'+APP_DATA.pdfWorker;
  return module;
 })();}
 return pdfEnginePromise;
}
class EmbeddedBinaryFactory{
 async fetch({kind,filename}){
  const value=kind==='cMapUrl'?APP_DATA.cmaps[filename.replace(/\.bcmap$/,'')]:kind==='standardFontDataUrl'?APP_DATA.fonts[filename]:null;
  if(!value)throw Error('PDF 글꼴 또는 문자 매핑 자료를 읽지 못했습니다.');
  return base64Bytes(value);
 }
}
async function extractBrowserPDF(file,start,end,onProgress){
 if(!file.size||file.size>20*1024*1024)throw Error('PDF는 비어 있지 않은 20MB 이하 파일이어야 합니다.');
 onProgress('PDF 읽기 도구를 준비하고 있습니다…',0);
 const engine=await pdfEngine();
 const data=new Uint8Array(await file.arrayBuffer());
 if(!new TextDecoder().decode(data.slice(0,1024)).trimStart().startsWith('%PDF-'))throw Error('올바른 PDF 파일을 선택하세요.');
 let loading,timedOut=false;
 const timeout=setTimeout(()=>{timedOut=true;loading?.destroy().catch(()=>{});},90000);
 try{
  onProgress('PDF 페이지를 확인하고 있습니다…',0);
  loading=engine.getDocument({data,BinaryDataFactory:EmbeddedBinaryFactory,useWorkerFetch:false,useWasm:false,disableFontFace:true,enableXfa:false,verbosity:0});
  const pdf=await loading.promise;
  const first=start??1,last=end??pdf.numPages;
  if(!Number.isInteger(first)||!Number.isInteger(last)||first<1||first>last||last>pdf.numPages)throw Error(`페이지 범위를 확인하세요. 이 PDF는 ${pdf.numPages}페이지입니다.`);
  if(last-first+1>100)throw Error('한 번에 최대 100페이지를 추출합니다. 해당 장의 페이지 범위를 지정하세요.');
  const pages=[],emptyPages=[];let count=0;
  for(let number=first;number<=last;number++){
   onProgress(`PDF ${number}페이지를 추출하고 있습니다 (${number-first+1}/${last-first+1})…`,Math.round((number-first)/(last-first+1)*100));
   const page=await pdf.getPage(number),content=await page.getTextContent();
   const text=content.items.filter(item=>typeof item.str==='string').map(item=>item.str+(item.hasEOL?'\n':' ')).join('').trim();
   count+=text.length;if(count>250000)throw Error('추출 원고가 너무 깁니다. 페이지 범위를 줄이세요 (최대 25만 자).');
   if(!text)emptyPages.push(number);pages.push({page:number,text});page.cleanup();
  }
  if(!count)throw Error('선택한 페이지에 추출할 텍스트가 없습니다. 스캔본은 OCR 처리 후 업로드하거나 본문을 직접 입력하세요.');
  const warnings=[];
  if(emptyPages.length)warnings.push('텍스트를 추출하지 못한 페이지: '+emptyPages.join(', ')+'. 이미지·스캔·빈 페이지일 수 있습니다. 원본을 확인하세요.');
  warnings.push('표·수식·단 나눔·읽기 순서는 원본과 다를 수 있습니다. 확인 후 분석하세요.');
  return {text:pages.map(p=>`[PDF ${p.page}페이지]\n${p.text||'[텍스트 추출 없음 — 원본 확인 필요]'}`).join('\n\n'),total_pages:pdf.numPages,start_page:first,end_page:last,pages,empty_pages:emptyPages,warnings};
 }catch(error){
  if(timedOut)throw Error('PDF 처리 시간이 초과되었습니다. 페이지 범위를 줄여 다시 시도하세요.');
  if(error.name==='PasswordException')throw Error('암호화된 PDF입니다. 잠금이 해제된 사본을 선택하세요.');
  if(['InvalidPDFException','UnknownErrorException'].includes(error.name))throw Error('PDF를 읽지 못했습니다. 파일이 손상되었거나 지원되지 않는 형식입니다.');
  throw error;
 }finally{clearTimeout(timeout);if(loading)await loading.destroy().catch(()=>{});}
}
function buildBrowserRequests(data){
 const profile={};for(const key of ['title','question','outline','references','feedback'])profile[key]=(data[key]||'').trim()||'미제공';
 profile.level=data.level;profile.scope=APP_DATA.scope;
 const requests=data.roles.map(role=>{
  const text=data.chapters[role].trim();
  if(!text)throw Error(APP_DATA.roles[role].name+' 원고를 입력하세요.');
  const lines=text.split('\n');
  const values={__PROFILE_JSON__:JSON.stringify(profile,null,2),__SOURCE_TEXT__:lines.map((line,i)=>`L${i+1}: ${line}`).join('\n'),__COVERAGE__:data.coverage==='complete'?'해당 장 전체(사용자 선언)':'해당 장 일부 발췌. 누락 내용은 전체 장의 결함으로 단정하지 않는다.',__LENSES__:data.lenses.map(lens=>APP_DATA.roles[lens].name+': '+APP_DATA.roles[lens].focus).join('\n')||'추가 심화 항목 미선택'};
  return {role,name:APP_DATA.roles[role].name,criteria:APP_DATA.roles[role].criteria,lines:lines.length,prompt:APP_DATA.templates[role].replace(/__PROFILE_JSON__|__SOURCE_TEXT__|__COVERAGE__|__LENSES__/g,token=>values[token])};
 });
 return {mode:'prompt_only',requests};
}
