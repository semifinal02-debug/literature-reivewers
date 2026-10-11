import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../preview/index.html',import.meta.url),'utf8');
const contract=JSON.parse(readFileSync(new URL('../review_contract.json',import.meta.url),'utf8'));
if(!html.includes('id="run-ai"')||!html.includes('id="ai-api-key"')||html.includes('__MODEL_JS__')||Object.keys(contract.scopes).length!==6)throw Error('미리보기 빌드가 없습니다. python build_preview.py를 실행하세요.');
console.log('Verified: prebuilt manual-key AI preview and six reviewer scopes.');
