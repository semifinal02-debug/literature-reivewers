"""Static Pages UI → fixed OpenAI protocol, with synthetic API responses only."""
from copy import deepcopy
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright
from review_browser_smoke import review_fixture

ROOT = Path(__file__).resolve().parents[1]
KEY = 'sk-synthetic-browser-test-key'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def verify():
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
            page = browser.new_page(viewport={'width': 1440, 'height': 1050})
            errors, requests, calls, held = [], [], [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: requests.append(request))
            base = 'http://127.0.0.1:' + str(server.server_port) + '/preview/'
            page.goto(base)
            page.locator('#load-demo').click()
            fixture = review_fixture(page.evaluate('snapshot()'), page.evaluate('sourceId(snapshot())'))
            failures = {'methods': 1}
            provider = {'quota': False, 'limit_code': 'insufficient_quota', 'stall': None}

            def model_reply(scope, model):
                review = deepcopy(fixture)
                review['scopes'] = [x for x in review['scopes'] if x['id'] == scope]
                review['comments'] = [x for x in review['comments'] if x['scope'] == scope]
                if scope != 'results':
                    review['metrics'] = []
                return {'status': 'completed', 'model': model, 'output': [
                    {'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(review, ensure_ascii=False)}]}]}

            def handle(route):
                request = route.request
                assert request.headers.get('authorization') in ('Bearer ' + KEY, 'Bearer sk-invalid-test-key')
                assert 'referer' not in request.headers
                if '/v1/models/' in request.url:
                    if request.headers['authorization'].endswith('sk-invalid-test-key'):
                        route.fulfill(status=401, json={'error': {'message': 'echo sk-invalid-test-key'}})
                    else:
                        route.fulfill(json={'id': request.url.rsplit('/', 1)[1]})
                    return
                assert request.url == 'https://api.openai.com/v1/responses'
                assert request.method == 'POST'
                payload = request.post_data_json
                assert payload['store'] is False and payload['text']['format']['strict'] is True
                assert payload['model'] in ('gpt-4.1', 'gpt-4.1-mini')
                assert KEY not in request.post_data
                assert '원자료를 재검정하거나 외부 문헌 검색을 수행했다고 주장하지 않는다' in payload['input'][0]['content']
                assert 'L1: [합성 예시' in payload['input'][1]['content']
                schema = payload['text']['format']['schema']
                scope = schema['properties']['scopes']['items']['properties']['id']['enum'][0]
                assert schema['properties']['source_id']['enum'] == [fixture['source_id']]
                calls.append(scope)
                if provider['quota']:
                    route.fulfill(status=429, json={'error': {'code': provider['limit_code'], 'message': 'echo ' + KEY}})
                elif failures.get(scope, 0):
                    failures[scope] -= 1
                    route.fulfill(status=500, json={'error': {'message': 'echo ' + KEY}})
                elif provider['stall'] == scope:
                    held.append((route, model_reply(scope, payload['model'])))
                else:
                    route.fulfill(json=model_reply(scope, payload['model']))

            page.route('https://api.openai.com/**', handle)
            page.locator('[data-view=connect]').first.click()
            assert page.locator('#ai-mode').input_value() == 'direct'
            assert page.locator('#ai-api-key').input_value() == ''
            assert page.locator('#ai-server-fields').is_hidden()
            page.screenshot(path='/workspace/plans/manual-key-desktop.png', full_page=True)
            # Missing key and unauthorized key never become fake reviews.
            page.locator('#ai-start').click()
            page.locator('#ai-run-status').filter(has_text='API 키를 입력').wait_for()
            assert not [r for r in requests if 'api.openai.com' in r.url]
            page.locator('#ai-api-key').fill('sk-invalid-test-key')
            page.locator('#check-ai').click()
            page.locator('#ai-connection-status').filter(has_text='만료').wait_for()
            assert 'sk-invalid' not in page.locator('#ai-connection-status').inner_text()
            assert not page.evaluate('aiState.configured')
            page.locator('#ai-api-key').fill(KEY)
            page.locator('#check-ai').click()
            page.locator('#ai-connection-state').filter(has_text='연결됨').wait_for()
            assert not calls  # Model permission check sends no manuscript and generates no review.
            page.locator('#ai-start').click()
            page.wait_for_function('!aiState.busy && aiState.task?.results.size === 5')
            assert calls == ['gap', 'methods', 'results', 'cases', 'safety', 'planning'], calls
            assert '5/6' in page.locator('#ai-run-status').inner_text()
            assert KEY not in page.locator('#ai-run-status').inner_text()
            # A bad replacement key must not lose completed reviews or hide retry.
            page.locator('#ai-api-key').fill('sk-invalid-test-key')
            page.locator('#retry-ai').click()
            page.locator('#ai-run-status').filter(has_text='만료').wait_for()
            assert page.locator('#retry-ai').is_visible()
            assert page.evaluate('aiState.task.results.size') == 5
            assert len(calls) == 6
            page.locator('#ai-api-key').fill(KEY)
            page.locator('#retry-ai').click()
            page.wait_for_function('!aiState.busy && aiState.task?.results.size === 6')
            page.locator('#report-view:not([hidden])').wait_for()
            assert calls.count('methods') == 2 and calls.count('results') == 1
            assert page.locator('.criterion').count() == 36
            assert page.locator('.stat.strength strong').inner_text() == '1'
            assert page.locator('.stat.revision strong').inner_text() == '2'
            assert page.evaluate('state.report.model') == 'gpt-4.1'
            page.screenshot(path='/workspace/plans/manual-key-report.png', full_page=True)
            with page.expect_download() as downloaded:
                page.locator('#save-project').click()
            project = Path(downloaded.value.path()).read_bytes()
            with page.expect_download() as downloaded:
                page.locator('#download-report').click()
            markdown = Path(downloaded.value.path()).read_text()
            assert KEY not in project.decode() and KEY not in markdown
            assert page.evaluate('localStorage.length === 0 && sessionStorage.length === 0')
            assert page.evaluate('indexedDB.databases().then(x => x.length)') == 0
            assert not any('/api/review' in r.url or '/api/status' in r.url for r in requests)
            assert not any(r.headers.get('authorization') for r in requests if not r.url.startswith('https://api.openai.com/'))
            # Reload clears the key. Work files restore manuscript/review but no credentials.
            page.reload()
            assert page.locator('#ai-api-key').input_value() == ''
            page.locator('#project-file').set_input_files({'name': 'work.json', 'mimeType': 'application/json', 'buffer': project})
            page.locator('#report-view:not([hidden])').wait_for()
            assert page.evaluate('state.report.mode') == 'api'
            assert page.locator('#ai-api-key').input_value() == ''
            page.locator('[data-view=connect]').first.click()
            page.locator('#ai-api-key').fill(KEY)
            # Quota failure stops subsequent paid calls and shows an actionable message.
            provider['quota'] = True
            before = len(calls)
            page.locator('#ai-start').click()
            page.wait_for_function('!aiState.busy && aiState.task?.failures.size === 6')
            assert len(calls) == before + 1
            assert '크레딧' in page.locator('#ai-run-status').inner_text()
            assert KEY not in page.locator('#ai-run-status').inner_text()
            assert page.evaluate('state.report === null')
            assert '생성된 리뷰 보고서는 없습니다' in page.locator('#ai-run-status').inner_text()
            assert '완료된 결과는' not in page.locator('#ai-run-status').inner_text()
            assert page.locator('#ai-progress .badge').all_text_contents() == ['실패'] + ['미실행'] * 5
            assert page.locator('#ai-help').is_visible()
            page.screenshot(path='/workspace/plans/review-quota-help.png', full_page=True)
            # An API-free request preserves the original scope and exact manuscript.
            before = len(calls)
            page.locator('#ai-use-chatgpt').click()
            assert page.locator('#manual-review').evaluate('(x) => x.open')
            assert 'L1: [합성 예시' in page.locator('#review-prompt').input_value()
            assert 'planning' in page.locator('#review-prompt').input_value()
            assert KEY not in page.locator('#review-prompt').input_value()
            assert len(calls) == before
            # Rate limits and unknown 429 responses must not be labelled confirmed credit failures.
            for code, expected in [('rate_limit_exceeded', '분당 요청량'), (None, '확인할 수 없습니다')]:
                provider['limit_code'] = code
                before = len(calls)
                page.locator('#ai-start').click()
                page.wait_for_function('!aiState.busy && aiState.task?.failures.size === 6')
                assert len(calls) == before + 1
                assert expected in page.locator('#ai-run-status').inner_text()
                assert '크레딧이 없거나' not in page.locator('#ai-run-status').inner_text()
                assert KEY not in page.locator('#ai-run-status').inner_text()
                assert page.locator('#ai-progress .badge').all_text_contents() == ['실패'] + ['미실행'] * 5
            provider['quota'] = False
            # Cancelling keeps completed scopes; a delayed response cannot override them.
            provider['stall'] = 'methods'
            page.locator('#ai-start').click()
            page.wait_for_function('aiState.task?.current === "methods" && aiState.task?.results.size === 1')
            assert held
            page.locator('#cancel-ai').click()
            page.wait_for_function('!aiState.busy')
            route, reply = held.pop()
            route.fulfill(json=reply)
            assert page.evaluate('aiState.task.results.size') == 1
            assert page.evaluate('state.report.scopes[0].id') == 'gap'
            assert '취소' in page.locator('#ai-run-status').inner_text()
            assert page.locator('#retry-ai').is_visible()
            # Clearing the key and switching models reset connection state and retry state.
            page.locator('#clear-ai-key').click()
            assert page.locator('#ai-api-key').input_value() == ''
            assert not page.evaluate('aiState.configured')
            page.locator('#ai-model').select_option('gpt-4.1-mini')
            assert page.locator('#retry-ai').is_hidden()
            # The second supported model must generate and label a genuine API-mode result.
            provider['stall'] = None
            page.locator('[data-view=scope]').first.click()
            for scope in ['methods', 'results', 'cases', 'safety', 'planning']:
                page.locator(f'[name=scope][value={scope}]').uncheck()
            fixture = review_fixture(page.evaluate('snapshot()'), page.evaluate('sourceId(snapshot())'))
            page.locator('[data-view=connect]').first.click()
            page.locator('#ai-api-key').fill(KEY)
            page.locator('#ai-start').click()
            page.wait_for_function('!aiState.busy && state.report?.model === "gpt-4.1-mini"')
            assert page.locator('.criterion').count() == 6
            page.locator('[data-view=connect]').first.click()
            page.locator('#clear-ai-key').click()
            page.set_viewport_size({'width': 390, 'height': 844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path='/workspace/plans/manual-key-mobile.png', full_page=True)
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print('PASS: static browser OpenAI protocol, six scopes, retry, distinct quota/rate/unknown errors, honest skipped/zero-report state, API-free ChatGPT request, cancel, key clearing, two models, no secret persistence, fixed destination, mobile. Synthetic provider; no live AI review.')


if __name__ == '__main__':
    verify()
