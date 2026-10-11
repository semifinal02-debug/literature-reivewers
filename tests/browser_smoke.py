"""Optional browser regression checks: run with Python that has Playwright installed."""
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright
from reviewers import build_requests
from test_pdf import make_pdf

ROOT = Path(__file__).resolve().parents[1]


def verify():
    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
            page = browser.new_page(viewport={'width':1440, 'height':1100})
            page.set_content('<html lang="ko"><meta charset="utf-8"><style>section{break-after:page;font:20px sans-serif}</style><section><h1>1장 서론</h1><p>서론전용원고: 건설 로봇의 안전 대책.</p></section><section><h1>2장 문헌 검토</h1><p>문헌전용원고: 기술과 작업계획을 비교한다.</p></section></html>')
            pdf = page.pdf(format='A4')
            base = f'http://127.0.0.1:{server.server_port}'
            page.goto(base + '/chapters/')
            page.wait_for_selector('.chapter-button')
            errors, requests = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: requests.append(request.url) if request.url.startswith(('http:', 'https:')) else None)
            page.locator('[data-key=literature]').click()
            page.locator('#pdf-start').fill('2')
            page.locator('#pdf-end').fill('2')
            with page.expect_file_chooser() as chooser:
                page.locator('#choose-file').click()
            chooser.value.set_files({'name':'한글논문.pdf', 'mimeType':'application/pdf', 'buffer':pdf})
            page.wait_for_function("document.getElementById('upload-status').textContent.includes('완료')", timeout=60000)
            assert page.locator('#upload-status').is_visible()
            text = page.locator('#manuscript').input_value()
            assert '문헌전용원고' in text and '서론전용원고' not in text
            assert '[PDF 2페이지]' in text
            page.locator('#generate').click()
            page.wait_for_selector('#output:not([hidden])')
            prompt = page.locator('.result-card textarea').input_value()
            assert '문헌 비교 매트릭스' in prompt and '문헌전용원고' in prompt
            for role in ['intro', 'literature', 'methods', 'cases', 'synthesis']:
                data = {'title':'주제 __PROFILE_JSON__', 'question':'질문', 'level':'박사',
                        'chapters':{role:'원고 __SOURCE_TEXT__ </script>\n두 번째 줄'},
                        'roles':[role], 'coverage':'complete', 'lenses':['safety', 'planning']}
                actual = page.evaluate('(data)=>buildBrowserRequests(data)', data)['requests'][0]['prompt']
                assert actual == build_requests(data)['requests'][0]['prompt'], role
            page.on('dialog', lambda dialog: dialog.accept())
            page.locator('#pdf-start').fill('1')
            page.locator('#pdf-end').fill('1')
            for name, content, message in [('blank.pdf', make_pdf([None]), 'OCR'),
                                            ('encrypted.pdf', make_pdf(['locked'], encrypted=True), '암호화'),
                                            ('corrupt.pdf', b'%PDF-1.7\ninvalid', '읽지 못했습니다')]:
                page.locator('#file').set_input_files({'name':name, 'mimeType':'application/pdf', 'buffer':content})
                page.wait_for_function('(text)=>document.getElementById("upload-status").textContent.includes(text)', arg=message)
                assert page.locator('#upload-status').is_visible()
                assert page.locator('#manuscript').input_value() == text
            assert not requests, requests
            page.set_viewport_size({'width':390, 'height':844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            # An opaque sandboxed iframe approximates a preview without an API or worker permission.
            page.set_content(f'<iframe src="{base}/chapters/" sandbox="allow-scripts allow-downloads" style="width:100%;height:900px"></iframe>')
            frame = page.frame_locator('iframe')
            frame.locator('.chapter-button').first.wait_for()
            frame.locator('#file').set_input_files({'name':'한글논문.pdf', 'mimeType':'application/pdf', 'buffer':pdf})
            frame.locator('#upload-status').filter(has_text='완료').wait_for(timeout=60000)
            assert '서론전용원고' in frame.locator('#manuscript').input_value()
            frame.locator('#generate').click()
            frame.locator('#output:not([hidden])').wait_for()
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    print('PASS: native chooser, Korean PDF, page range, browser-only prompt parity, visible errors with draft preservation, no API requests, mobile layout, sandboxed preview.')


if __name__ == '__main__':
    verify()
