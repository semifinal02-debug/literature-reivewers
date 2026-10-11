"""Browser-to-real-handler workflow with a synthetic model provider, never a real key."""
import json
from pathlib import Path
import subprocess
import tempfile
from playwright.sync_api import sync_playwright
from review_browser_smoke import review_fixture

ROOT = Path(__file__).resolve().parents[1]


def verify():
    fixture_file = tempfile.NamedTemporaryFile(suffix='.json', delete=False)
    fixture_path = Path(fixture_file.name)
    fixture_file.close()
    server = None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
            page = browser.new_page(viewport={'width': 1440, 'height': 1050})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            # Build fixture from the displayed synthetic manuscript, with identical numbering.
            html = (ROOT / 'preview/index.html').read_text()
            page.set_content(html)
            page.locator('#load-demo').click()
            snapshot = page.evaluate('snapshot()')
            source_id = page.evaluate('sourceId(snapshot())')
            fixture_path.write_text(json.dumps(review_fixture(snapshot, source_id), ensure_ascii=False))
            server = subprocess.Popen(['node', 'tests/ai_fixture_server.mjs', str(fixture_path)], cwd=ROOT,
                                      stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            line = server.stdout.readline()
            assert line.startswith('TEST_PORT '), line
            base = 'http://127.0.0.1:' + line.split()[1]
            page.goto(base)
            page.locator('#load-demo').click()
            page.locator('[data-view=connect]').first.click()
            # Check fails cleanly when the service is configured but the user is unauthorized.
            page.locator('#check-ai').click()
            page.locator('#ai-connection-status').filter(has_text='접속 암호').wait_for()
            assert not page.evaluate('aiState.configured')
            # Do not accept a provider key in the browser's access-code field.
            page.locator('#ai-access').fill('sk-synthetic-must-stay-on-server')
            page.locator('#check-ai').click()
            page.locator('#ai-connection-status').filter(has_text='서버 환경 변수').wait_for()
            page.locator('#ai-access').fill('synthetic-access')
            page.locator('#check-ai').click()
            page.locator('#ai-connection-state').filter(has_text='연결됨').wait_for()
            page.screenshot(path='/workspace/plans/direct-ai-connect.png', full_page=True)
            page.locator('#ai-start').click()
            page.wait_for_function('!aiState.busy && aiState.task?.results.size === 5')
            assert '5/6' in page.locator('#ai-run-status').inner_text()
            assert page.locator('#retry-ai').is_visible()
            page.locator('[data-view=report]').first.click()
            assert page.locator('#report-content').is_visible()
            assert 'AI API 심사 응답' in page.locator('#report-content').inner_text()
            assert '방법론' in page.locator('.report-warning').last.inner_text()
            # Retry only the missing scope and preserve completed reviewer opinions.
            page.locator('[data-view=connect]').first.click()
            page.locator('#retry-ai').click()
            page.wait_for_function('!aiState.busy && aiState.task?.results.size === 6')
            page.locator('#report-view:not([hidden])').wait_for()
            assert page.locator('.stat.revision strong').inner_text() == '2'
            assert page.locator('.stat.strength strong').inner_text() == '1'
            assert page.locator('.criterion').count() == 36
            with page.expect_download() as download:
                page.locator('#save-project').click()
            project_bytes = Path(download.value.path()).read_bytes()
            project = json.loads(project_bytes)
            assert project['ai']['model'] == 'synthetic-test-model'
            assert 'synthetic-access' not in project_bytes.decode()
            assert 'synthetic-key' not in project_bytes.decode()
            page.locator('#project-file').set_input_files({'name': 'ai-project.json', 'mimeType': 'application/json', 'buffer': project_bytes})
            assert page.evaluate('state.report.mode') == 'api'
            # If the manuscript changes while a call is running, its response must be discarded.
            page.locator('[data-view=connect]').first.click()
            page.locator('#ai-start').click()
            page.wait_for_function('aiState.busy && aiState.task?.current === "gap"')
            page.locator('[data-view=upload]').first.click()
            page.locator('#manuscript').fill('수정된 원고\n새 연구 질문')
            page.wait_for_function('!aiState.busy')
            assert page.evaluate('state.report === null')
            assert '변경' in page.locator('#ai-run-status').inner_text()
            assert page.locator('#manuscript').input_value() == '수정된 원고\n새 연구 질문'
            page.set_viewport_size({'width': 390, 'height': 844})
            page.locator('[data-view=connect]').first.click()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path='/workspace/plans/direct-ai-mobile.png', full_page=True)
            assert not errors, errors
            browser.close()
    finally:
        if server:
            server.terminate()
            output, _ = server.communicate(timeout=10)
            # First run six scopes, retry methods, then one cancelled gap call.
            assert output.count('TEST_MODEL_CALL methods') == 2, output
            assert output.count('TEST_MODEL_CALL results') == 1, output
        fixture_path.unlink(missing_ok=True)
    print('PASS: actual browser/API handlers, access check, provider-key rejection, six scopes, partial failure, retry only failed scope, AI project restore, no secrets exported, stale/cancelled response rejection, mobile. Provider mocked; live AI not tested.')


if __name__ == '__main__':
    verify()
