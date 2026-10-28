import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from backend.tests import test_runner_management as baseline


class RepositoryTypeCatalogTest(unittest.TestCase):
    setUp = baseline.ManagementIntegrationTest.setUp
    request = baseline.ManagementIntegrationTest.request

    def tearDown(self):
        self.doCleanups()
        baseline.ManagementIntegrationTest.tearDown(self)

    def upstream(self, payload=None, status=200):
        calls = []
        class Catalog(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                calls.append((self.path, dict(self.headers)))
                self.send_response(status); self.send_header('Content-Type', 'application/json'); self.end_headers()
                self.wfile.write(json.dumps(payload).encode())
        server = ThreadingHTTPServer(('127.0.0.1', 0), Catalog)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        self.addCleanup(server.server_close); self.addCleanup(server.shutdown)
        env = patch.dict('os.environ', {'RUNNER_NODE_TYPE_BACKEND': f'http://127.0.0.1:{server.server_port}'})
        env.start(); self.addCleanup(env.stop)
        return calls

    def save(self, type_code='95', name='下载代码', path='download'):
        repo = self.request('/api/runner-management/settings/code-repos')[0]
        request = Request(self.url + '/api/runner-management/settings/code-repos/' + repo['repoId'] + '/directories',
            data=json.dumps({'name': name, 'path': path, 'configType': type_code, 'configTypeName': '客户端伪造名称'}).encode(),
            headers={'Content-Type': 'application/json', 'Cookie': 'test-session=only-for-mock', 'Access-Token': 'mock-token'})
        with urlopen(request, timeout=5) as response:
            return json.load(response)

    def test_type_95_directory_uses_authenticated_business_catalog(self):
        calls = self.upstream({'code': None, 'data': {'list': [{'sourceType': 95, 'typeName': '下载'}]}})
        saved = self.save()
        self.assertEqual(saved['configType'], '95')
        self.assertEqual(saved['configTypeName'], '下载')
        self.assertEqual(saved['path'], 'download')
        self.assertEqual(calls[0][0], '/api/v1/config/sourceTypes')
        self.assertEqual(calls[0][1]['Cookie'], 'test-session=only-for-mock')
        self.assertEqual(calls[0][1]['Access-Token'], 'mock-token')
        with self.assertRaises(HTTPError) as caught:
            self.save('999', '不存在', 'unknown')
        self.assertEqual(caught.exception.code, 400)
        self.assertIn('ID=999', json.load(caught.exception)['message'])

    def test_unavailable_catalog_does_not_accept_client_supplied_name(self):
        self.upstream({}, 503)
        with self.assertRaises(HTTPError) as caught:
            self.save()
        self.assertEqual(caught.exception.code, 502)

    def test_expired_catalog_session_reports_login_error(self):
        self.upstream({}, 302)
        with self.assertRaises(HTTPError) as caught:
            self.save()
        self.assertEqual(caught.exception.code, 401)
