import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from app import Handler
from reviewers import ROLES, build_requests


class RequestTests(unittest.TestCase):
    def test_all_roles_preserve_manuscript_and_scope(self):
        text = '건설 로봇의 안전 대책을 검토한다.\n작업계획은 아직 미정이다.'
        result = build_requests({'manuscript': text, 'level': '박사'})
        self.assertEqual(len(result['requests']), 7)
        self.assertEqual(result['mode'], 'prompt_only')
        for request in result['requests']:
            self.assertIn('L1: 건설 로봇의 안전 대책을 검토한다.', request['prompt'])
            self.assertIn('L2: 작업계획은 아직 미정이다.', request['prompt'])
            self.assertIn('자율주행 제외', request['prompt'])
            self.assertIn(ROLES[request['role']]['focus'], request['prompt'])

    def test_selection_and_incomplete_profile(self):
        result = build_requests({'manuscript': '원고', 'roles': ['safety', 'planning', 'safety']})
        self.assertEqual([r['role'] for r in result['requests']], ['safety', 'planning'])
        self.assertIn('미제공', result['requests'][0]['prompt'])
        self.assertIn('판단 보류', result['requests'][0]['prompt'])

    def test_invalid_inputs(self):
        for data in [None, {}, {'manuscript': ' '}, {'manuscript': 3},
                     {'manuscript': '원고', 'roles': []},
                     {'manuscript': '원고', 'roles': ['unknown']},
                     {'manuscript': '원고', 'roles': [{}]},
                     {'manuscript': '원고', 'level': '학부'}]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                build_requests(data)

    def test_chapter_manuscripts_are_never_mixed(self):
        result = build_requests({'chapters': {'intro': '서론전용원고', 'literature': '문헌전용원고'},
                                 'lenses': ['safety', 'planning']})
        intro, literature = result['requests']
        self.assertIn('서론전용원고', intro['prompt'])
        self.assertNotIn('문헌전용원고', intro['prompt'])
        self.assertIn('문헌전용원고', literature['prompt'])
        self.assertNotIn('서론전용원고', literature['prompt'])
        self.assertIn('연구 논리 사슬', intro['prompt'])
        self.assertIn('문헌 비교 매트릭스', literature['prompt'])
        self.assertEqual(len(intro['criteria']), 6)
        self.assertEqual(len(literature['criteria']), 6)
        self.assertIn('안전 · 대응 대책:', intro['prompt'])

    def test_missing_selected_chapter_does_not_use_other_text(self):
        with self.assertRaisesRegex(ValueError, '2장'):
            build_requests({'chapters': {'intro': '서론'}, 'roles': ['literature'], 'manuscript': '대체 원고'})

    def test_excerpt_cannot_establish_whole_chapter_missing_content(self):
        request = build_requests({'chapters': {'intro': '발췌'}})['requests'][0]['prompt']
        self.assertIn('누락 내용은 전체 장의 결함으로 단정하지 않는다', request)
        self.assertIn('발췌에서 보이지 않는 내용을 전체 장의 결함이라고 판정하지 않는다', request)

    def test_invalid_chapter_options(self):
        for update in [{'chapters': {}}, {'chapters': {'intro': 1}}, {'chapters': {'unknown': '원고'}},
                       {'lenses': ['driving']}, {'coverage': 'unknown'}]:
            with self.subTest(update=update), self.assertRaises(ValueError):
                build_requests({'manuscript': '원고', **update})


class HTTPTests(unittest.TestCase):
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

    def test_functional_request(self):
        with urllib.request.urlopen(self.base + '/') as response:
            self.assertIn('내 논문에 맞춘 리뷰어 팀', response.read().decode())
        with urllib.request.urlopen(self.base + '/api/roles') as response:
            self.assertEqual(len(json.load(response)), 7)
        payload = json.dumps({'manuscript': '로봇 고장 시 작업을 중지한다.', 'roles': ['safety']}).encode()
        request = urllib.request.Request(self.base + '/api/requests', data=payload,
                                         headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request) as response:
            result = json.load(response)
        self.assertEqual(result['requests'][0]['role'], 'safety')
        self.assertIn('L1: 로봇 고장 시 작업을 중지한다.', result['requests'][0]['prompt'])

    def test_empty_manuscript_rejected(self):
        request = urllib.request.Request(self.base + '/api/requests', data=b'{}')
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request)
        self.assertEqual(error.exception.code, 400)

    def test_cross_origin_rejected(self):
        request = urllib.request.Request(self.base + '/api/requests', data=b'{}',
                                         headers={'Origin': 'http://example.org'})
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request)
        self.assertEqual(error.exception.code, 403)


if __name__ == '__main__':
    unittest.main()
