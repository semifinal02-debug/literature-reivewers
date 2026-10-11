"""Build a standalone HTML app with local, verified PDF.js assets."""
import base64
import json
from pathlib import Path
from reviewers import ROLES, CHAPTERS, build_requests

ROOT = Path(__file__).resolve().parent
SCOPE = '스마트 건설 로보틱스: 기술, 안전, 대응 대책, 작업계획. 자율주행 제외.'


def web_data():
    templates = {}
    profile = {key: '미제공' for key in ('title', 'question', 'outline', 'references', 'feedback')}
    profile.update(level='석·박사 공통', scope=SCOPE)
    for role in CHAPTERS:
        prompt = build_requests({'manuscript': '__SOURCE_TEXT__', 'roles': [role]})['requests'][0]['prompt']
        prompt = prompt.replace(json.dumps(profile, ensure_ascii=False, indent=2), '__PROFILE_JSON__')
        prompt = prompt.replace('L1: __SOURCE_TEXT__', '__SOURCE_TEXT__')
        prompt = prompt.replace('해당 장 일부 발췌. 누락 내용은 전체 장의 결함으로 단정하지 않는다.', '__COVERAGE__')
        prompt = prompt.replace('추가 심화 항목 미선택', '__LENSES__')
        assert all(token in prompt for token in ('__PROFILE_JSON__', '__SOURCE_TEXT__', '__COVERAGE__', '__LENSES__'))
        templates[role] = prompt
    vendor = ROOT / 'vendor/pdfjs'
    return {'roles': ROLES, 'templates': templates, 'scope': SCOPE, 'pdfVersion': '6.4.299',
            'pdfModule': base64.b64encode((vendor / 'pdf.min.mjs').read_bytes()).decode(),
            'pdfWorker': base64.b64encode((vendor / 'pdf.worker.min.mjs').read_bytes()).decode(),
            'cmaps': json.loads((vendor / 'cmaps.json').read_text()),
            'fonts': json.loads((vendor / 'fonts.json').read_text())}


def build_chapters():
    data = json.dumps(web_data(), ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
    template = (ROOT / 'ui.html').read_text()
    assert template.count('__APP_DATA_JSON__') == 1
    assert template.count('__PDF_IMPORT_JS__') == 1
    output = template.replace('__APP_DATA_JSON__', data).replace('__PDF_IMPORT_JS__', (ROOT / 'pdf_browser.js').read_text())
    (ROOT / 'chapters').mkdir(exist_ok=True)
    (ROOT / 'chapters/index.html').write_text(output)


def build():
    # Imported here so build_preview can reuse the verified asset loader above.
    from build_preview import build as build_workbench
    build_workbench()
    preview = (ROOT / 'preview/index.html').read_text()
    (ROOT / 'index.html').write_text(preview.replace(
        '<span class="preview-pill">수정본 미리보기</span>',
        '<span class="preview-pill">원문 근거 기반 리뷰</span>'))
    build_chapters()


if __name__ == '__main__':
    build()
