from io import BytesIO
import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
from app import Handler
from pdf_import import MAX_PDF_BYTES, PDFImportError, extract_pdf


def make_pdf(texts, encrypted=False):
    writer = PdfWriter()
    for text in texts:
        page = writer.add_blank_page(width=612, height=792)
        if text:
            font = DictionaryObject({NameObject('/Type'): NameObject('/Font'),
                                     NameObject('/Subtype'): NameObject('/Type1'),
                                     NameObject('/BaseFont'): NameObject('/Helvetica')})
            page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})})
            stream = DecodedStreamObject()
            safe = text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
            stream.set_data(f'BT /F1 12 Tf 72 720 Td ({safe}) Tj ET'.encode('ascii'))
            page[NameObject('/Contents')] = writer._add_object(stream)
    if encrypted:
        writer.encrypt('synthetic-test-password')
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


class PDFTests(unittest.TestCase):
    def test_page_range_preserves_original_page_numbers(self):
        result = extract_pdf(make_pdf(['INTRO_ONLY', 'LITERATURE_ONLY', 'METHODS_ONLY']), 2, 2)
        self.assertEqual(result['total_pages'], 3)
        self.assertEqual(result['pages'][0]['page'], 2)
        self.assertIn('[PDF 2페이지]', result['text'])
        self.assertIn('LITERATURE_ONLY', result['text'])
        self.assertNotIn('INTRO_ONLY', result['text'])
        self.assertNotIn('METHODS_ONLY', result['text'])

    def test_mixed_text_and_blank_pages_report_missing_content(self):
        result = extract_pdf(make_pdf(['SAFETY', None]))
        self.assertEqual(result['empty_pages'], [2])
        self.assertIn('원본 확인 필요', result['text'])
        self.assertTrue(result['warnings'])

    def test_no_text_gives_ocr_guidance(self):
        with self.assertRaisesRegex(PDFImportError, 'OCR'):
            extract_pdf(make_pdf([None]))

    def test_invalid_and_encrypted_documents(self):
        for content in [b'not a pdf', b'%PDF-1.7\ninvalid', make_pdf(['locked'], encrypted=True)]:
            with self.subTest(content_length=len(content)), self.assertRaises(PDFImportError):
                extract_pdf(content)

    def test_invalid_ranges_and_large_selection(self):
        content = make_pdf(['INTRO', 'LITERATURE'])
        for start, end in [(0, 1), (2, 1), (1, 3), (-1, 2)]:
            with self.subTest(start=start, end=end), self.assertRaisesRegex(PDFImportError, '범위'):
                extract_pdf(content, start, end)
        with self.assertRaisesRegex(PDFImportError, '100페이지'):
            extract_pdf(make_pdf([None] * 101))


class PDFHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_upload_and_review_request(self):
        request = urllib.request.Request(self.base + '/api/pdf?start=2&end=2',
            data=make_pdf(['INTRO', 'LITERATURE']), headers={'Content-Type': 'application/pdf'})
        with urllib.request.urlopen(request) as response:
            result = json.load(response)
        payload = json.dumps({'chapters': {'literature': result['text']}}).encode()
        request = urllib.request.Request(self.base + '/api/requests', data=payload)
        with urllib.request.urlopen(request) as response:
            prompt = json.load(response)['requests'][0]['prompt']
        self.assertIn('[PDF 2페이지]', prompt)
        self.assertIn('LITERATURE', prompt)
        self.assertNotIn('L1: INTRO', prompt)

    def test_bad_uploads_are_rejected(self):
        cases = [('/api/pdf', b'abc', {'Content-Type': 'text/plain'}, 415),
                 ('/api/pdf', b'abc', {'Content-Type': 'application/pdf'}, 422),
                 ('/api/pdf?start=abc', make_pdf(['text']), {'Content-Type': 'application/pdf'}, 400),
                 ('/api/pdf', b'a', {'Content-Type': 'application/pdf', 'Content-Length': str(MAX_PDF_BYTES + 1)}, 413),
                 ('/api/pdf', b'abc', {'Content-Type': 'application/pdf', 'Origin': 'http://elsewhere.example'}, 403)]
        for path, body, headers, status in cases:
            with self.subTest(status=status):
                request = urllib.request.Request(self.base + path, data=body, headers=headers)
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request)
                self.assertEqual(error.exception.code, status)
