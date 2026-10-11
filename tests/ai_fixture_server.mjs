// Test-only provider fixture. Production handlers never select a mock through configuration.
import {readFileSync} from 'node:fs';
import {createApp} from '../server/dev.mjs';
const fixture=JSON.parse(readFileSync(process.argv[2],'utf8'));
const counts=new Map();
const server=createApp({env:{REVIEWER_API_KEY:'synthetic-key',REVIEWER_ACCESS_TOKEN:'synthetic-access',REVIEWER_MODEL:'synthetic-test-model'},fetchImpl:async(url,options)=>{
 const payload=JSON.parse(options.body),scope=payload.text.format.schema.properties.scopes.items.properties.id.enum[0],id=payload.text.format.schema.properties.source_id.enum[0];
 const n=(counts.get(scope)||0)+1;counts.set(scope,n);console.log('TEST_MODEL_CALL '+scope);
 if(scope==='methods'&&n===1)return new Response('{}',{status:500});
 if(n>1)await new Promise(resolve=>setTimeout(resolve,1000));
 const review={...fixture,source_id:id,scopes:fixture.scopes.filter(s=>s.id===scope),comments:fixture.comments.filter(c=>c.scope===scope),metrics:scope==='results'?fixture.metrics:[]};
 return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(review)}]}]}),{status:200});
}});
server.listen(0,'127.0.0.1',()=>console.log('TEST_PORT '+server.address().port));
