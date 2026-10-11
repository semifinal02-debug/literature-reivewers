import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHandler} from './reviewer.mjs';
import {fileURLToPath} from 'node:url';

export function createApp({env=process.env,fetchImpl=fetch}={}){
 const review=createHandler({env,fetchImpl,local:true}),status=createHandler({kind:'status',env,local:true});
 return createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/api/review')return review(req,res);
  if(path==='/api/status')return status(req,res);
  const pages={'/':'preview/index.html','/preview/':'preview/index.html','/preview/index.html':'preview/index.html','/chapters/':'chapters/index.html'};
  if(!Object.hasOwn(pages,path)){res.statusCode=404;return res.end('Not found');}
  try{const data=await readFile(new URL('../'+pages[path],import.meta.url));res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(data);}catch{res.statusCode=500;res.end('Build preview first');}
 });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const port=Number(process.env.REVIEWER_PORT||8000);if(!Number.isInteger(port)||port<1||port>65535)throw Error('REVIEWER_PORT must be a valid port');
 createApp().listen(port,'127.0.0.1',()=>console.log(`Reviewer server listening on port ${port}. API key values are never logged.`));
}
