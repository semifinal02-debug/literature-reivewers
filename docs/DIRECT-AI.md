# 앱에서 직접 AI 리뷰 실행

현재 변경은 `/preview/` 미리보기에만 적용한다. 기본 GitHub Pages 화면 `index.html`은 사용자의 확인 전까지 교체하지 않는다. API 서버와 미리보기 소스는 같은 저장소에 포함한다.

## Vercel에 별도 미리보기 서버 만들기

1. [Vercel 프로젝트 가져오기](https://vercel.com/new)에서 GitHub 저장소 `semifinal02-debug/literature-reivewers`를 선택한다. 별도 프로젝트로 만들면 기존 GitHub Pages 주소를 유지할 수 있다.
2. Framework는 **Other**, Root Directory는 저장소 루트로 둔다. 저장소의 `vercel.json`이 `npm run build`와 Output Directory `preview`를 지정한다. HTML은 미리 빌드되어 있으므로 Vercel에서 Python이나 PDF 도구를 설치하지 않는다. Node.js 22 이상을 사용한다.
3. Environment Variables에 다음 값을 등록한다. 키와 접속 암호는 Vercel의 서버 환경 변수에만 넣고 GitHub·채팅·HTML에는 넣지 않는다.
   - `REVIEWER_API_KEY`: [OpenAI API 계정에서 발급한 키](https://platform.openai.com/api-keys). ChatGPT 구독과 API 사용은 별도이며 API 계정의 크레딧·사용 한도가 적용된다.
   - `REVIEWER_ACCESS_TOKEN`: 이 앱의 접속 암호. 길고 추측하기 어려운 값을 직접 정한다. 브라우저에는 API 키 대신 이 암호를 입력한다.
   - `REVIEWER_MODEL`: `gpt-4.1`. Responses API와 Structured Outputs를 지원하며 해당 계정에서 접근 가능한 모델을 사용한다.
4. Deploy를 실행한다. Vercel이 실제 배포 주소를 표시한 뒤 그 주소를 사용한다. 이 문서는 배포가 완료되었다고 주장하지 않는다. 키 변경 후에는 재배포한다.

배포한 Vercel 주소에서 앱을 열면 API가 같은 서비스에 있으므로 **AI 서비스 주소**를 비워두고 앱 접속 암호를 입력한다. GitHub Pages 미리보기에서는 실제 Vercel 배포 주소의 도메인을 **AI 서비스 주소**에 넣는다. 주소에는 `/api` 경로·쿼리·암호를 넣지 않는다.

공개 미리보기 URL에 Vercel 자체의 Deployment Protection이 적용되어 있으면 먼저 Vercel에서 접근 권한을 설정해야 한다. GitHub Pages에서 호출할 서버는 사용자에게 접근 가능한 배포 주소가 필요하다. 앱의 API는 별도로 접속 암호를 확인한다. 배포 플랫폼의 함수 실행 시간이 180초 설정을 지원하지 않으면 계정의 지원 범위에 맞게 조정하고 원고 범위를 줄인다.

외부 프런트엔드 주소가 달라지면 `REVIEWER_ALLOWED_ORIGINS`에 정확한 origin을 쉼표로 구분해 등록한다. 기본값은 `https://semifinal02-debug.github.io`이며 같은 Vercel origin도 허용한다. 와일드카드는 사용하지 않는다.

## 앱에서 사용

PDF를 업로드하고 연구 설정·범위를 선택한 뒤 **AI 리뷰 실행**을 누른다. 최초 사용 시 **AI 서비스 연결**에서 서버 주소·앱 접속 암호를 확인한다. 심사자는 선택 범위를 하나씩 평가한다. 한 범위당 API 요청 1회이며 완료된 범위와 진행 상태가 표시된다.

결과는 범위별 6개 기준, Major/Minor 의견, 정확한 원문 인용, 수정 행동, 결과 지표의 네 축, 확인 질문과 한계로 정리한다. 완료된 응답의 인용을 원고 줄과 대조하며 이 확인은 판단의 학술적 타당성을 보증하지 않는다. 일부 범위가 실패하면 완료된 보고서를 보존하고 **실패한 범위만 다시 실행**할 수 있다. 원고·설정을 바꾸면 진행 중인 요청을 취소하고 이전 원고의 응답을 표시하지 않는다. 취소 전에 서버가 모델 요청을 처리한 경우 API 사용이 이미 발생했을 수 있다.

원고는 최대 25만 자다. 전체 논문도 제공할 수 있지만 같은 원고를 각 선택 범위에 보내므로 요청 규모와 요금이 커질 수 있다. 필요한 장·페이지부터 검토하면 문맥과 근거를 확인하기 쉽다. 서버는 본문을 자동으로 잘라 일부만 검토하지 않는다.

## 자료 처리

PDF 원본은 브라우저에서 읽으며 **AI 실행 버튼을 누를 때 추출한 본문·연구 설정·평가 기준만** 서버와 OpenAI에 보낸다. 서버는 원고를 파일에 저장하지 않으며 원고·키·모델 응답을 로그로 출력하지 않는다. OpenAI 요청에는 `store: false`를 사용한다. 제공자의 별도 데이터 처리·보관 정책은 해당 API 계정 설정을 확인한다.

API 키는 서버 환경 변수에서만 읽는다. 앱 접속 암호는 브라우저 탭의 메모리에서 사용하며 작업 파일·내보내기·주소에 포함하지 않는다. **작업 저장** 파일에는 원고와 AI 리뷰가 포함된다. 저장 파일의 `ai.model`은 모델명 표시용 메타데이터이며 응답의 진위를 증명하는 서명이 아니다.

외부 문헌 검색·OCR·원자료 통계 재검정은 수행하지 않는다. 원고에 없는 값·문헌·근거를 만들지 않도록 지시하고, 자료 부족은 판단 보류로 표시한다. 모델 응답의 해석·수치·문헌은 연구자가 확인해야 한다.

## 개발 환경

현재 클라우드에는 Node.js가 설치되어 있으며 외부 npm 의존성은 없다. 코드 수정 뒤 `python build_preview.py`로 미리보기와 공통 계약 JSON만 생성한다. `python build_web.py`는 기본 앱도 교체하므로 사용자 확인 전에는 실행하지 않는다.

```sh
npm ci --ignore-scripts --cache /workspace/.npm-cache
NODE_USE_ENV_PROXY=1 npm start
```

서버는 루프백에만 바인딩한다. 이미 사용 중인 포트가 있으면 `REVIEWER_PORT`로 빈 포트를 지정한다. `.env`를 자동으로 읽지 않는다. 로컬 파일을 사용하는 경우 Node 22 이상에서 `node --env-file=.env server/dev.mjs`로 실행한다. 실제 비밀 값은 저장소에 넣지 않는다. 클라우드에서 proxy secret을 사용하면 `NODE_USE_ENV_PROXY=1`로 지원되는 프록시 경로를 사용한다. 클라우드 실행 환경을 직접 공개 웹 호스팅으로 취급하지 않는다.

`GET /api/status`는 키 값 없이 설정·접속 상태를 반환한다. 루프백에서 같은 origin으로 개발할 때는 앱 접속 암호를 생략할 수 있으며 공개 Vercel 서버에는 접속 암호가 필수다. `POST /api/review`는 JSON 본문과 `Authorization: Bearer <앱 접속 암호>`를 받는다. 입력 모델명·업스트림 주소를 받지 않고 서버에서 고정한 OpenAI 주소와 설정 모델만 사용한다.

## 검증과 남은 단계

```sh
npm test
PYTHONPATH=.:tests python tests/ai_browser_smoke.py
PYTHONPATH=.:tests python tests/review_browser_smoke.py
.venv/bin/python -m unittest discover -s tests -v
```

합성 제공자 응답으로 API 계약·인증·CORS·오류 처리, 브라우저→실제 API 핸들러, 6개 심사 범위, 부분 실패·재시도, 원고 변경·취소, 작업 복원, 비밀 미포함, 모바일 화면을 검증한다. 합성 제공자는 테스트 파일에서만 주입하며 제품의 환경 설정으로 가짜 모델을 선택할 수 없다.

실제 OpenAI 키가 없으면 모델 호출·리뷰 품질을 검증할 수 없다. 실제 키 등록과 Vercel 서버 배포 후 합성 예시로 실 호출을 확인하고, 이후 사용자 논문으로 리뷰 품질을 평가한다. 현재 환경에서 실제 서버의 `/api/status`는 `configured: false`다. 준비된 코드·통과한 테스트·미리보기 게시와 실제 AI 서비스 활성화를 구분한다.
