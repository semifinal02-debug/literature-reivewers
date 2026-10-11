"""Build the proposed review workbench without replacing the published app."""
import json
from build_web import ROOT, web_data
from review_schema import SCOPES, REVIEW_RULES


def build():
    contract = {'scopes': SCOPES, 'reviewRules': REVIEW_RULES}
    (ROOT / 'review_contract.json').write_text(json.dumps(contract, ensure_ascii=False, indent=2) + '\n')
    data = web_data()
    data.update(scopes=SCOPES, reviewRules=REVIEW_RULES)
    encoded = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
    pdf_js = (ROOT / 'pdf_browser.js').read_text().split('function buildBrowserRequests')[0]
    template = (ROOT / 'review_ui.html').read_text()
    for token in ('__APP_DATA_JSON__', '__PDF_IMPORT_JS__', '__WORKBENCH_JS__', '__MODEL_JS__', '__AI_JS__'):
        assert template.count(token) == 1
    output = template.replace('__APP_DATA_JSON__', encoded).replace('__PDF_IMPORT_JS__', pdf_js)
    output = output.replace('__WORKBENCH_JS__', (ROOT / 'review_workbench.js').read_text())
    model_js = (ROOT / 'review_model.mjs').read_text()
    assert model_js.count('export function createReviewModel') == 1
    output = output.replace('__MODEL_JS__', model_js.replace('export function createReviewModel', 'function createReviewModel'))
    output = output.replace('__AI_JS__', (ROOT / 'review_ai.js').read_text())
    (ROOT / 'preview').mkdir(exist_ok=True)
    (ROOT / 'preview/index.html').write_text(output)


if __name__ == '__main__':
    build()
