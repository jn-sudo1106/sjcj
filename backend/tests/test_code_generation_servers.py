"""Real HTTP checks for code-server enrollment, workspace relay and model streams."""
import base64
import io
import json
import tempfile
import threading
import unittest
import zipfile
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from backend.tests import test_runner_management as baseline
from backend.runner_management import code_servers, model_interfaces
from backend.runner_management.server import ApiError
from backend.code_generation_server.start import Service, Handler, Workspace, ServiceError


class WorkspaceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'workspace'
        self.workspace = Workspace(self.root)

    def test_file_edit_hash_export_and_atomic_conflicts(self):
        created = self.workspace.operation({'action': 'write', 'path': 'news/client.py', 'content': 'print("中文")'})
        self.assertEqual(self.workspace.operation({'action': 'read', 'path': created['path']})['content'], 'print("中文")')
        with self.assertRaises(ServiceError):
            self.workspace.operation({'action': 'write', 'path': created['path'], 'content': 'overwritten'})
        edited = self.workspace.operation({'action': 'write', 'path': created['path'], 'content': 'print(2)', 'expectedHash': created['sha256']})
        exported = self.workspace.operation({'action': 'export', 'paths': ['news', created['path']]})['files']
        self.assertEqual(len(exported), 1)
        self.assertEqual(exported[0]['sha256'], edited['sha256'])
        download = self.workspace.operation({'action': 'download', 'paths': ['news']})
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(download['data']))) as archive:
            self.assertEqual(archive.read(created['path']), b'print(2)')
        self.workspace.operation({'action': 'delete', 'path': created['path'], 'expectedHash': edited['sha256']})
        self.workspace.operation({'action': 'delete', 'path': 'news'})

    def test_path_and_upload_validation_prevents_escape_and_partial_invalid_batch(self):
        for path in ('../outside', '/outside', 'C:/outside', 'a/../../b', '.git/config', 'a/CON.py', 'a/foo:bar', 'a/./b'):
            with self.subTest(path=path), self.assertRaises(ServiceError):
                self.workspace.operation({'action': 'write', 'path': path, 'content': 'bad'})
        self.workspace.operation({'action': 'mkdir', 'path': 'existing'})
        for files in ([{'path': 'good.py', 'data': 'eA=='}, {'path': '../escape.py', 'data': 'eA=='}],
                      [{'path': 'a', 'data': 'eA=='}, {'path': 'a/b.py', 'data': 'eA=='}]):
            with self.assertRaises(ServiceError):
                self.workspace.operation({'action': 'upload', 'files': files})
        self.assertFalse((self.root / 'good.py').exists())
        with self.assertRaises(ServiceError):
            self.workspace.operation({'action': 'delete', 'path': ''})
        self.workspace.operation({'action': 'write', 'path': 'existing/main.py', 'content': 'x'})
        with self.assertRaises(ServiceError):
            self.workspace.operation({'action': 'delete', 'path': 'existing'})


class CodeServerTest(unittest.TestCase):
    setUp = baseline.ManagementIntegrationTest.setUp
    request = baseline.ManagementIntegrationTest.request

    def tearDown(self):
        self.doCleanups()
        baseline.ManagementIntegrationTest.tearDown(self)

    def test_package_default_uses_platform_lan_ip_and_actual_port(self):
        with patch.dict('os.environ', {'RUNNER_LAN_HOST': '192.168.1.36'}):
            info = self.request('/api/runner-management/code-servers/package')
        self.assertEqual(info['platform'], f'http://192.168.1.36:{self.server.server_port}')
        with patch.dict('os.environ', {'RUNNER_LAN_HOST': ''}), patch('backend.runner_management.runner.machine_ip', return_value='192.168.1.40'):
            info = self.request('/api/runner-management/code-servers/package')
        self.assertEqual(info['platform'], f'http://192.168.1.40:{self.server.server_port}')

    def start_remote(self):
        directory = Path(self.tmp.name) / 'code-server'
        directory.mkdir(exist_ok=True)
        service = Service(directory, {'workspace': './workspace', 'platform': self.url, 'allowedModelOrigins': []})
        remote = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        remote.daemon_threads = True
        remote.service = service
        thread = threading.Thread(target=remote.serve_forever, daemon=True)
        thread.start()
        def cleanup():
            remote.shutdown(); remote.server_close(); thread.join(2)
            for handler in service.logger.handlers[:]:
                handler.close(); service.logger.removeHandler(handler)
        self.addCleanup(cleanup)
        endpoint = f'http://127.0.0.1:{remote.server_port}'
        code = self.request('/api/runner-management/code-servers/enrollment-code', {})['code']
        payload = {**service.report(), 'endpoint': endpoint, 'code': code}
        identity = self.request('/api/code-servers/enroll', payload)
        service.identity = identity
        return service, endpoint, identity, payload

    def test_enrollment_heartbeat_scope_offline_and_no_credentials_in_list(self):
        service, endpoint, identity, payload = self.start_remote()
        with self.assertRaises(HTTPError):
            self.request('/api/code-servers/enroll', payload)
        # The existing Runner code cannot authorize this distinct server role.
        code = self.request('/api/runner-management/runners/enrollment-codes', {})['code']
        with self.assertRaises(HTTPError):
            self.request('/api/code-servers/enroll', {**payload, 'code': code})
        with self.assertRaises(ApiError):
            code_servers.heartbeat(self.app, {}, {**payload, 'serverId': identity['serverId']})
        report = {**payload, 'serverId': identity['serverId'], 'pid': 1234}
        self.request('/api/code-servers/me/heartbeat', report, identity['token'])
        item = self.request('/api/runner-management/code-servers')['items'][0]
        self.assertEqual(item['status'], 'online'); self.assertEqual(item['pid'], 1234)
        self.assertNotIn('token', item)
        self.assertNotIn(identity['token'], json.dumps(item))
        self.assertNotIn(identity['token'], json.dumps(code_servers.read(self.app, identity['serverId'])))
        stale = code_servers.read(self.app, identity['serverId'])
        stale['lastHeartbeat'] = (datetime.now(timezone.utc) - timedelta(seconds=16)).isoformat()
        with self.app.store.connect() as db:
            code_servers.write(db, stale)
        self.assertEqual(code_servers.listing(self.app)['items'][0]['status'], 'offline')
        with self.assertRaises(ApiError):
            code_servers.relay_request(self.app, identity['serverId'], 'files', {'action': 'list'})

    def test_real_file_relay_auth_package_and_repository_import(self):
        service, endpoint, identity, payload = self.start_remote()
        with self.assertRaises(HTTPError) as caught:
            urlopen(Request(endpoint + '/api/files', data=b'{"action":"list"}', headers={'Content-Type': 'application/json'}))
        self.assertEqual(caught.exception.code, 401)
        base = '/api/runner-management/code-servers/' + identity['serverId']
        self.request(base + '/files', {'action': 'upload', 'files': [{'path': 'client.py', 'data': base64.b64encode('print("中文")'.encode()).decode()},
                      {'path': 'news/helper.py', 'data': 'eA=='}]})
        listing = self.request(base + '/files', {'action': 'list'})
        self.assertEqual([row['name'] for row in listing['items']], ['news', 'client.py'])
        read = self.request(base + '/files', {'action': 'read', 'path': 'client.py'})
        self.assertEqual(read['content'], 'print("中文")')
        with self.assertRaises(HTTPError) as caught:
            self.request(base + '/files', {'action': 'read', 'path': '../identity.json'})
        self.assertEqual(caught.exception.code, 403)
        with patch.object(self.app, 'upload_repository_files', return_value={'pushed': True}) as upload:
            self.request(base + '/import', {'paths': ['client.py', 'news'], 'repositoryId': 'repo', 'directoryId': 'default', 'overwrite': False})
            args = upload.call_args.args[1]
            self.assertEqual({row['relativePath'] for row in args['files']}, {'client.py', 'news/helper.py'})
        repository = self.request('/api/runner-management/settings/code-repos')[0]
        root = Path(repository['path']); root.mkdir(parents=True, exist_ok=True)
        self.app.git(root, 'init', '-b', 'main')
        origin = Path(self.tmp.name) / 'origin.git'; origin.mkdir()
        self.app.git(origin, 'init', '--bare')
        self.app.configure_repository_git(repository['repoId'], origin.as_uri(), 'main')
        imported = self.request(base + '/import', {'paths': ['client.py', 'news'], 'repositoryId': repository['repoId'], 'directoryId': 'default', 'overwrite': False})
        self.assertTrue(imported['pushed'])
        self.assertEqual(self.app.git(origin, 'show', 'main:default/client.py').strip(), 'print("中文")')
        self.assertEqual(self.app.git(origin, 'show', 'main:default/news/helper.py').strip(), 'x')
        with zipfile.ZipFile(io.BytesIO(code_servers.package(self.app, self.url))) as archive:
            self.assertIn('start.py', archive.namelist())
            config = json.loads(archive.read('config.json'))
            self.assertEqual(config['platform'], self.url)
            self.assertTrue(config['enrollCode'])

    def test_remote_model_stream_and_workspace_boundaries(self):
        service, endpoint, identity, payload = self.start_remote()
        calls = []
        first, release = threading.Event(), threading.Event()
        class Model(BaseHTTPRequestHandler):
            def do_POST(self):
                calls.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                self.send_response(200); self.send_header('Content-Type', 'text/plain; charset=utf-8'); self.end_headers()
                self.wfile.write('第一段'.encode()); self.wfile.flush(); first.set()
                release.wait(3); self.wfile.write('第二段'.encode()); self.wfile.flush()
            def log_message(self, *args): pass
        upstream = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        threading.Thread(target=upstream.serve_forever, daemon=True).start()
        self.addCleanup(upstream.server_close); self.addCleanup(upstream.shutdown); self.addCleanup(release.set)
        origin = f'http://127.0.0.1:{upstream.server_port}'
        service.config['allowedModelOrigins'] = [origin]
        config = model_interfaces.listing(self.app)
        agent = config['items'][1]
        agent.update(endpoint=origin + '/wb/agent', generationServerId=identity['serverId'], prjDir='.', codeDir='code', outputFileDir='output', cdpPort=9333)
        model_interfaces.save(self.app, config)
        _, request = model_interfaces.prepare_test(self.app, {'interfaceId': agent['id'], 'prompt': '测试', 'taskId': 'task-100'})
        self.assertEqual(request.full_url, endpoint + '/api/model')
        with urlopen(request, timeout=5) as response:
            self.assertTrue(first.wait(1))
            self.assertEqual(response.read1(4096).decode(), '第一段')
            release.set(); self.assertEqual(response.read().decode(), '第二段')
        self.assertEqual(calls[0]['cdp_port'], 9333)
        base = service.workspace.root / identity['serverId'] / 'task-100'
        self.assertEqual(calls[0]['code_dir'], str(base / 'code'))
        self.assertEqual(calls[0]['input_file_dir'], str(base / 'input'))
        self.assertEqual(calls[0]['output_file_dir'], str(base / 'output'))
        self.assertTrue(all((base / name).is_dir() for name in ('code', 'input', 'output')))
        with self.assertRaises(ServiceError):
            service.model({'url': 'http://unconfigured.invalid/wb/agent', 'method': 'POST', 'body': {}})
        with self.assertRaises(ServiceError):
            service.model({'url': origin + '/wb/agent', 'method': 'POST', 'body': {'code_dir': '../escape'}})
