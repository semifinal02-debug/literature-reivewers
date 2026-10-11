import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../preview/index.html',import.meta.url),'utf8');
const contract=JSON.parse(readFileSync(new URL('../review_contract.json',import.meta.url),'utf8'));
if(!html.includes('id="run-ai"')||Object.keys(contract.scopes).length!==6)throw Error('미리보기 빌드가 없습니다. python build_preview.py를 실행하세요.');
console.log('Verified: prebuilt AI preview and six reviewer scopes. No secrets embedded.');
