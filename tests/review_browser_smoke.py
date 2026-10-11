"""Exercise the proposed reviewer workflow against static hosting, without an AI key."""
import functools
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright
from review_schema import SCOPES
from test_pdf import make_pdf

ROOT = Path(__file__).resolve().parents[1]


def review_fixture(snapshot, source_id):
    # Synthetic reviewer response to test transport and validation, not AI quality.
    def evidence(needle):
        for i, line in enumerate(snapshot['lines'], 1):
            if needle in line:
                return [{'line_start': i, 'line_end': i, 'quote': needle}]
        raise AssertionError(needle)

    scopes = []
    for scope in snapshot['selected']:
        criteria = [{'id': c[0], 'status': 'insufficient_evidence',
                     'assessment': '합성 응답: 상세 자료와 원문 확인이 필요합니다.',
                     'evidence': [], 'actions': ['근거 자료를 보완하세요.']}
                    for c in SCOPES[scope]['criteria']]
        scopes.append({'id': scope, 'overview': '브라우저 검증용 합성 심사 응답', 'criteria': criteria})
    for scope in scopes:
        for c in scope['criteria']:
            if c['id'] == 'gap-boundary':
                c.update(status='needs_revision', assessment='검색 범위를 제시하지 않은 연구 부재 주장은 확인이 필요합니다.',
                         evidence=evidence('안전 대책을 작업계획에 반영한 연구는 없다.'))
            if c['id'] == 'methods-measure':
                c.update(status='strength', assessment='작업 시간의 측정 시작점과 종료점, 단위를 정의했습니다.',
                         evidence=evidence('작업 시간은 시작부터 완료까지의 초 단위 시간이다.'))
            if c['id'] == 'results-effect':
                c.update(status='needs_revision', assessment='보고된 p값과 효과 크기의 의미를 구분하고 구간을 보완하세요.',
                         evidence=evidence('t 검정에서 p < 0.05였다.'))
    return {
        'source_id': source_id, 'summary': '브라우저 검증용 합성 리뷰. 실제 모델을 호출하지 않았습니다.',
        'scopes': scopes,
        'comments': [{'id': 'M1', 'scope': 'gap', 'severity': 'major',
                      'title': '검색 범위와 연구 공백 주장 연결', 'issue': '연구 부재를 단정하는 근거를 제시하세요.',
                      'why': '독창성 주장과 연구 필요성을 판단하는 근거입니다.',
                      'action': '문헌 검색 범위와 관련 연구 비교를 제시하세요.',
                      'evidence': evidence('안전 대책을 작업계획에 반영한 연구는 없다.')},
                     {'id': 'M2', 'scope': 'results', 'severity': 'minor', 'title': '효과 크기 보고',
                      'issue': '구간과 반복 수를 함께 보고하세요.', 'why': '결과 해석의 불확실성을 읽기 위해 필요합니다.',
                      'action': '원자료에서 효과 크기와 구간을 계산해 보고하세요.',
                      'evidence': evidence('t 검정에서 p < 0.05였다.')}],
        'metrics': [{'axis': 'statistical', 'assessment': '실제 재검정을 수행하지 않았습니다.',
                     'items': [{'name': '보고된 p값', 'value': 'p < 0.05', 'unit': '미제공',
                                'conditions': '실험실 모형', 'baseline': '기준 계획', 'uncertainty': '미제공',
                                'interpretation': '효과 크기 또는 현장 효과를 뜻하지 않습니다.',
                                'evidence': evidence('t 검정에서 p < 0.05였다.')}]}],
        'questions': ['실험 순서와 참가자 숙련도는 어떻게 통제했나요?'],
        'limitations': ['합성 자료이며 문헌 검색·통계 재검정은 수행하지 않았습니다.'],
    }


def verify():
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(SimpleHTTPRequestHandler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
            page = browser.new_page(viewport={'width': 1440, 'height': 1100})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('dialog', lambda d: d.accept())
            page.set_content('<html lang="ko"><meta charset="utf-8"><style>section{break-after:page;font:20px sans-serif}</style><section>1장 서론 전용 원고</section><section>3장 방법론 전용 원고 · 로봇 작업 안전</section></html>')
            pdf = page.pdf(format='A4')
            base = f'http://127.0.0.1:{server.server_port}'
            page.goto(base + '/preview/')
            page.locator('#scope-grid .scope-card').first.wait_for(state='attached')
            network = []
            page.on('request', lambda r: network.append(r.url) if r.url.startswith(('http:', 'https:')) else None)
            Path('/workspace/plans').mkdir(exist_ok=True)
            page.screenshot(path='/workspace/plans/review-initial.png', full_page=True)
            page.locator('[data-view=scope]').first.click()
            page.locator('#run-precheck').click()
            assert '먼저' in page.locator('#toast').inner_text()
            page.locator('[data-view=upload]').first.click()
            page.locator('#pdf-start').fill('2')
            page.locator('#pdf-end').fill('2')
            with page.expect_file_chooser() as chooser:
                page.locator('#choose-file').click()
            chooser.value.set_files({'name': '한국어논문.pdf', 'mimeType': 'application/pdf', 'buffer': pdf})
            page.wait_for_function("document.getElementById('upload-status').textContent.includes('완료')", timeout=60000)
            text = page.locator('#manuscript').input_value()
            assert '방법론 전용 원고' in text and '서론 전용 원고' not in text
            assert '[PDF 2페이지]' in text
            for name, data, message in [('blank.pdf', make_pdf([None]), 'OCR'),
                                        ('encrypted.pdf', make_pdf(['locked'], encrypted=True), '암호화'),
                                        ('corrupt.pdf', b'%PDF-1.7\ninvalid', '읽지 못했습니다')]:
                page.locator('#pdf-start').fill('1')
                page.locator('#pdf-end').fill('1')
                page.locator('#paper-file').set_input_files({'name': name, 'mimeType': 'application/pdf', 'buffer': data})
                page.wait_for_function('(m)=>document.getElementById("upload-status").textContent.includes(m)', arg=message)
                assert page.locator('#manuscript').input_value() == text
            page.locator('#load-demo').click()
            page.locator('#report-content').wait_for()
            assert page.locator('.stat.revision strong').inner_text() == '0'
            assert page.locator('.stat.strength strong').inner_text() == '0'
            assert len(page.locator('.criterion').all()) == 36
            page.locator('[data-report-tab=comments]').click()
            assert len(page.locator('.finding').all()) == 4
            page.locator('[data-source-start]').first.click()
            assert page.locator('#source-dialog').is_visible()
            assert '연구는 없다' in page.locator('.source-line.hit').inner_text()
            page.locator('#close-source').click()
            page.locator('#from-report-prompt').click()
            prompt = page.locator('#review-prompt').input_value()
            assert '원자료 없이 재계산' in prompt and 'statistical' in prompt
            assert '자율주행은 범위에서 제외' in prompt
            snapshot = page.evaluate('snapshot()')
            source_id = page.evaluate('sourceId(snapshot())')
            fixture = review_fixture(snapshot, source_id)
            page.locator('#review-response').fill('```json\n' + json.dumps(fixture, ensure_ascii=False) + '\n```')
            page.locator('#import-review').click()
            page.locator('#report-view:not([hidden])').wait_for()
            assert page.locator('.stat.revision strong').inner_text() == '2'
            assert page.locator('.stat.strength strong').inner_text() == '1'
            page.locator('#report-scope').select_option('gap')
            assert page.locator('.criterion').count() == 6
            assert page.locator('.review-block').count() == 1
            page.locator('[data-filter=needs_revision]').click()
            assert page.locator('.criterion').count() == 1
            page.locator('[data-filter=all]').click()
            page.locator('#report-scope').select_option('all')
            page.screenshot(path='/workspace/plans/review-report.png', full_page=True)
            page.locator('[data-report-tab=comments]').click()
            assert len(page.locator('.finding').all()) == 2
            page.locator('[data-done]').first.check()
            assert page.locator('.finding.done').count() == 1
            with page.expect_download() as saved:
                page.locator('#save-project').click()
            project_bytes = Path(saved.value.path()).read_bytes()
            with page.expect_download() as report_download:
                page.locator('#download-report').click()
            exported = Path(report_download.value.path()).read_text()
            assert '심사 의견과 수정' in exported and '보고된 p값' in exported and '확인 질문' in exported
            page.locator('[data-report-tab=metrics]').click()
            assert len(page.locator('.metric-card').all()) == 4
            assert '효과 크기 또는 현장 효과' in page.locator('#report-content').inner_text()
            # Exact-source checks must not trust claims or supplied verified flags.
            corrupted = json.loads(json.dumps(fixture))
            corrupted['scopes'][0]['criteria'][5]['evidence'][0].update(quote='입력에 없는 가짜 인용', verified=True)
            corrupted['summary'] = '<img src=x onerror="window.injected=true"> 합성 검증'
            page.locator('[data-view=connect]').first.click()
            page.locator('#review-response').fill(json.dumps(corrupted, ensure_ascii=False))
            page.locator('#import-review').click()
            assert page.locator('.stat.revision strong').inner_text() == '1'
            assert '인용 불일치' in page.locator('#report-content').inner_text()
            assert page.locator('#report-content img').count() == 0
            assert not page.evaluate('Boolean(window.injected)')
            # Changing the manuscript clears the old review and rejects old response.
            page.locator('#report-scope').select_option('safety')
            page.locator('[data-view=upload]').first.click()
            page.locator('#manuscript').fill('수정 원고\n새 내용')
            page.locator('[data-view=connect]').first.click()
            page.locator('#review-response').fill(json.dumps(fixture, ensure_ascii=False))
            page.locator('#import-review').click()
            assert '일치하지 않습니다' in page.locator('#import-status').inner_text()
            assert page.evaluate('state.report === null')
            page.locator('#project-file').set_input_files({'name': '작업.json', 'mimeType': 'application/json', 'buffer': project_bytes})
            page.locator('#report-view:not([hidden])').wait_for()
            assert page.locator('.stat.revision strong').inner_text() == '2'
            assert page.locator('.criterion').count() == 36
            page.locator('[data-report-tab=comments]').click()
            assert page.locator('.finding.done').count() == 1
            # Invalid project must leave the current manuscript and report intact.
            previous = page.evaluate('sourceId(snapshot())')
            page.locator('#project-file').set_input_files({'name': 'bad.json', 'mimeType': 'application/json', 'buffer': b'{"version":2,"snapshot":null}'})
            assert page.evaluate('sourceId(snapshot())') == previous
            page.set_viewport_size({'width': 390, 'height': 844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path='/workspace/plans/review-mobile.png', full_page=True)
            assert not network, network
            # Default app and preview expose the same completed review workflow.
            page.goto(base)
            page.locator('#paper-file').wait_for()
            assert '원문 근거 기반 리뷰' in page.locator('.preview-pill').inner_text()
            # PDF import must continue to work inside restricted preview iframes.
            page.set_content(f'<iframe src="{base}/preview/" sandbox="allow-scripts allow-downloads" style="width:100%;height:1000px"></iframe>')
            frame = page.frame_locator('iframe')
            frame.locator('#scope-grid .scope-card').first.wait_for(state='attached')
            frame.locator('#paper-file').set_input_files({'name': '논문.pdf', 'mimeType': 'application/pdf', 'buffer': pdf})
            frame.locator('#upload-status').filter(has_text='완료').wait_for(timeout=60000)
            assert '서론 전용 원고' in frame.locator('#manuscript').input_value()
            frame.locator('[data-view=scope]').first.click()
            frame.locator('#make-review').click()
            assert 'L1: [PDF 1페이지]' in frame.locator('#review-prompt').input_value()
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    print('PASS: Korean PDF picker/range/errors, scoped precheck, structured reviewer import, quote verification, stale response rejection, XSS escaping, report export, project restore, mobile, sandbox. AI quality not tested.')


if __name__ == '__main__':
    verify()
