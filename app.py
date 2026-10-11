"""Local review request app with in-memory PDF import; no external requests."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from pdf_import import MAX_PDF_BYTES, PDFImportError, extract_pdf
from reviewers import ROLES, build_requests

ROOT = Path(__file__).resolve().parent
MAX_BODY = 1_000_000


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, body, content_type="application/json; charset=utf-8"):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/":
            self.respond(200, (ROOT / "index.html").read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/api/roles":
            self.respond(200, ROLES)
        elif self.path == "/health":
            self.respond(200, {"status": "ok", "mode": "prompt_only", "pdf_import": True})
        else:
            self.respond(404, {"error": "찾을 수 없습니다."})

    def do_POST(self):
        path = urlsplit(self.path)
        if path.path not in ("/api/requests", "/api/pdf"):
            return self.respond(404, {"error": "찾을 수 없습니다."})
        if self.headers.get("Origin") and self.headers["Origin"] != "http://" + self.headers.get("Host", ""):
            return self.respond(403, {"error": "다른 사이트의 요청은 허용하지 않습니다."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if path.path == '/api/pdf':
                if self.headers.get('Content-Type', '').split(';')[0].strip().lower() != 'application/pdf':
                    return self.respond(415, {'error': 'PDF 파일을 업로드하세요.'})
                if not 0 < length <= MAX_PDF_BYTES:
                    return self.respond(413, {'error': 'PDF는 20MB 이하로 업로드하세요.'})
                query = parse_qs(path.query)
                try:
                    start = int(query['start'][0]) if 'start' in query else None
                    end = int(query['end'][0]) if 'end' in query else None
                except ValueError:
                    return self.respond(400, {'error': '페이지 번호는 정수로 입력하세요.'})
                try:
                    result = extract_pdf(self.rfile.read(length), start, end)
                except PDFImportError as exc:
                    return self.respond(422, {'error': str(exc)})
                return self.respond(200, result)
            if not 0 < length <= MAX_BODY:
                return self.respond(413, {"error": "입력은 UTF-8 기준 1MB 이하로 보내세요."})
            data = json.loads(self.rfile.read(length))
            result = build_requests(data)
        except (ValueError, UnicodeError) as exc:
            return self.respond(400, {"error": str(exc)})
        self.respond(200, result)

    def log_message(self, fmt, *args):
        # Log request status only, never manuscript contents.
        super().log_message(fmt, *args)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
