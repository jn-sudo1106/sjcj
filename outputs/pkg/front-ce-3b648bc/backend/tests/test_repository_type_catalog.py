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

    def test_reclassify_referenced_directory_preserves_node_code_and_versions(self):
        self.upstream({'code': None, 'data': {'list': [
            {'sourceType': 90, 'typeName': '网页抓取'},
            {'sourceType': 95, 'typeName': '文件下载'}]}})
        directory = self.save('90', 'dongws', 'dongws')
        route = '/api/runner-management'
        payload = {'configId': '1401081', 'queueName': 'web', 'configType': '90',
                   'repositoryId': directory['repoId'], 'directoryId': directory['directoryId'],
                   'codeType': 'default', 'code': 'def scrape(url):\n    return []\n'}
        code = self.request(route + '/site-scripts/publish', payload)
        with self.app.store.connect() as db:
            asset_before = dict(db.execute('SELECT * FROM code_assets WHERE code_id=?', (code['codeId'],)).fetchone())
            versions_before = [dict(row) for row in db.execute('SELECT * FROM code_versions WHERE code_id=?', (code['codeId'],)).fetchall()]
        from backend.runner_management.repository_directories import save_directory, get_directory
        update = Request(self.url + route + '/settings/code-repos/' + directory['repoId'] + '/directories/' + directory['directoryId'],
            data=json.dumps({**directory, 'configType': '95'}).encode(),
            headers={'Content-Type': 'application/json', 'Cookie': 'test-session=only-for-mock'})
        with urlopen(update, timeout=5) as response:
            changed = json.load(response)
        self.assertEqual(changed['configTypeName'], '文件下载')
        self.assertEqual(changed['path'], 'dongws')
        self.assertEqual(changed['directoryId'], directory['directoryId'])
        with self.app.store.connect() as db:
            self.assertEqual(dict(db.execute('SELECT * FROM code_assets WHERE code_id=?', (code['codeId'],)).fetchone()), asset_before)
            self.assertEqual([dict(row) for row in db.execute('SELECT * FROM code_versions WHERE code_id=?', (code['codeId'],)).fetchall()], versions_before)
            get_directory(self.app, db, directory['repoId'], directory['directoryId'], '95')
            from backend.runner_management.server import ApiError
            with self.assertRaises(ApiError):
                get_directory(self.app, db, directory['repoId'], directory['directoryId'], '90')
        from pathlib import Path
        repo = self.request(route + '/settings/code-repos')[0]
        self.assertEqual((Path(repo['path']) / code['storagePath']).read_text(encoding='utf8'), payload['code'])
        with self.assertRaises(ApiError):
            save_directory(self.app, directory['repoId'], directory, directory['directoryId'])

    def test_expired_catalog_session_reports_login_error(self):
        self.upstream({}, 302)
        with self.assertRaises(HTTPError) as caught:
            self.save()
        self.assertEqual(caught.exception.code, 401)
