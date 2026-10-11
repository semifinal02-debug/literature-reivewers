"""Extract selected PDF pages in memory; no document files are retained."""
from io import BytesIO
from pypdf import PdfReader

MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_SELECTED_PAGES = 100
MAX_TEXT_CHARS = 250_000


class PDFImportError(ValueError):
    pass


def extract_pdf(content, start=None, end=None):
    if not content or len(content) > MAX_PDF_BYTES:
        raise PDFImportError('PDF는 비어 있지 않은 20MB 이하 파일이어야 합니다.')
    if not content[:1024].lstrip().startswith(b'%PDF-'):
        raise PDFImportError('올바른 PDF 파일을 선택하세요.')
    try:
        reader = PdfReader(BytesIO(content))
        if reader.is_encrypted:
            raise PDFImportError('암호화된 PDF입니다. 잠금이 해제된 사본을 업로드하세요.')
        total = len(reader.pages)
        first = 1 if start is None else start
        last = total if end is None else end
        if not total or not 1 <= first <= last <= total:
            raise PDFImportError(f'페이지 범위를 확인하세요. 이 PDF는 {total}페이지입니다.')
        if last - first + 1 > MAX_SELECTED_PAGES:
            raise PDFImportError('한 번에 최대 100페이지를 추출합니다. 해당 장의 페이지 범위를 지정하세요.')
        pages, empty_pages, count = [], [], 0
        for number in range(first, last + 1):
            text = (reader.pages[number - 1].extract_text() or '').strip()
            count += len(text)
            if count > MAX_TEXT_CHARS:
                raise PDFImportError('추출 원고가 너무 깁니다. 페이지 범위를 줄이세요 (최대 25만 자).')
            if not text:
                empty_pages.append(number)
            pages.append({'page': number, 'text': text})
        if not count:
            raise PDFImportError('선택한 페이지에 추출할 텍스트가 없습니다. 스캔본은 OCR 처리 후 업로드하거나 본문을 직접 입력하세요.')
        warnings = []
        if empty_pages:
            warnings.append('텍스트를 추출하지 못한 페이지: ' + ', '.join(map(str, empty_pages)) + '. 이미지·스캔·빈 페이지일 수 있습니다. 필요한 내용인지 확인하세요.')
        warnings.append('PDF의 표·수식·단 나눔·읽기 순서는 달라질 수 있습니다. 원본과 대조한 뒤 분석하세요.')
        manuscript = '\n\n'.join(f'[PDF {p["page"]}페이지]\n{p["text"] or "[텍스트 추출 없음 — 원본 확인 필요]"}' for p in pages)
        return {'text': manuscript, 'total_pages': total, 'start_page': first, 'end_page': last,
                'pages': pages, 'empty_pages': empty_pages, 'warnings': warnings}
    except PDFImportError:
        raise
    except Exception as exc:
        raise PDFImportError('PDF를 읽지 못했습니다. 파일이 손상되었거나 지원되지 않는 형식입니다.') from exc
