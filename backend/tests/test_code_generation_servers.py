"""Real HTTP checks for code-server enrollment, workspace relay and model streams."""
import base64
import errno
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
from backend.code_generation_server import service as service_module, start as starter
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

    def test_inaccessible_residual_file_remains_visible_and_prevents_empty_delete(self):
        folder = self.root / '1401218/tasks'; folder.mkdir(parents=True)
        leftover = folder / 'task.json'; leftover.write_text('{}', encoding='utf8')
        original = self.workspace.info
        def denied(item, include_data=False):
            if item == leftover: raise PermissionError(errno.EACCES, 'denied', str(leftover))
            return original(item, include_data)
        with patch.object(self.workspace, 'info', side_effect=denied):
            result = self.workspace.operation({'action': 'list', 'path': '1401218/tasks'})
        self.assertEqual(result['items'][0]['path'], '1401218/tasks/task.json')
        self.assertIn('系统拒绝访问', result['items'][0]['accessError'])
        with self.assertRaises(ServiceError) as failure:
            self.workspace.operation({'action': 'delete', 'path': '1401218/tasks'})
        self.assertEqual(failure.exception.status, 409)
        self.assertIn('task.json', str(failure.exception))
        self.assertTrue(leftover.exists())
        leftover.unlink()
        self.workspace.operation({'action': 'delete', 'path': '1401218/tasks'})
        self.assertFalse(folder.exists())

    def test_hidden_protected_entry_explains_nonempty_directory_without_deleting_it(self):
        folder = self.root / 'tasks'; (folder / '__pycache__').mkdir(parents=True)
        self.assertEqual(self.workspace.operation({'action': 'list', 'path': 'tasks'})['items'], [])
        with self.assertRaises(ServiceError) as failure:
            self.workspace.operation({'action': 'delete', 'path': 'tasks'})
        self.assertIn('__pycache__', str(failure.exception))
        self.assertIn('受保护', str(failure.exception))
        self.assertTrue((folder / '__pycache__').exists())

    def test_directory_permission_failure_reports_relative_path_and_system_error(self):
        folder = self.root / 'tasks'; folder.mkdir()
        for method, action in (('iterdir', 'list'), ('rmdir', 'delete')):
            with patch.object(Path, method, side_effect=PermissionError(errno.EACCES, 'denied', str(folder))):
                with self.assertRaises(ServiceError) as failure:
                    self.workspace.operation({'action': action, 'path': 'tasks'})
                self.assertEqual(failure.exception.status, 403)
                self.assertIn('tasks', str(failure.exception))
                self.assertIn('系统拒绝访问', str(failure.exception))
                self.assertNotIn(str(self.root), str(failure.exception))

    def test_empty_directory_delete_does_not_require_listing_permission(self):
        folder = self.root / 'tasks'; folder.mkdir()
        with patch.object(Path, 'iterdir', side_effect=PermissionError(errno.EACCES, 'denied', str(folder))):
            self.assertEqual(self.workspace.operation({'action': 'delete', 'path': 'tasks'}), {'ok': True})
        self.assertFalse(folder.exists())


class CodeServerAccountTest(unittest.TestCase):
    def test_builtin_service_accounts_are_rejected_before_creating_any_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            instance = Path(temporary) / 'instance'
            workspace = Path(temporary) / 'workspace'
            for sid in ('S-1-5-18', 'S-1-5-19', 'S-1-5-20'):
                with self.subTest(sid=sid), patch.object(service_module, 'current_account', return_value={'name': 'service-account', 'sid': sid}):
                    with self.assertRaisesRegex(ServiceError, '普通用户'):
                        Service(instance, {'workspace': str(workspace)})
                self.assertFalse(instance.exists())
                self.assertFalse(workspace.exists())

    def test_regular_user_is_accepted_without_changing_accounts(self):
        with patch.object(service_module, 'current_account', return_value={'name': r'home171\leo', 'sid': 'S-1-5-21-1-2-3-1001'}):
            self.assertEqual(service_module.require_user_account(), r'home171\leo')

    def test_launcher_checks_account_before_preparing_config_or_dependencies(self):
        with patch.object(starter, 'require_user_account', side_effect=ServiceError('请以普通用户运行')), patch.object(starter, 'ensure_verifier') as prepare:
            with self.assertRaisesRegex(SystemExit, '普通用户'):
                starter.main()
            prepare.assert_not_called()


class CodeServerTest(unittest.TestCase):
    def test_running_user_is_reported_and_legacy_heartbeat_does_not_leave_stale_identity(self):
        service, endpoint, identity, payload = self.start_remote()
        self.assertTrue(payload['runUser'])
        self.assertEqual(service.control('status')['runUser'], payload['runUser'])
        saved = self.request('/api/runner-management/code-servers')['items'][0]
        self.assertEqual(saved['runUser'], payload['runUser'])
        legacy = {key: value for key, value in payload.items() if key != 'runUser'}
        self.request('/api/code-servers/me/heartbeat', {**legacy, 'serverId': identity['serverId'], 'pid': 1234}, identity['token'])
        self.assertEqual(code_servers.read(self.app, identity['serverId'])['runUser'], '')

    def test_directory_git_binding_validates_target_path_and_write_permission(self):
        service, endpoint, identity, payload = self.start_remote()
        route = '/api/runner-management/code-servers/' + identity['serverId'] + '/generation-git-binding'
        repo = self.request('/api/runner-management/settings/code-repos')[0]
        for body in ({'path': '../outside', 'repositoryId': repo['repoId'], 'directoryId': 'default'},
                     {'path': 'news', 'repositoryId': 'missing', 'directoryId': 'default'},
                     {'path': 'news', 'repositoryId': repo['repoId'], 'directoryId': 'missing'}):
            with self.assertRaises(HTTPError): self.request(route, body)
        self.assertFalse(code_servers.read(self.app, identity['serverId']).get('generationGitBindings'))
        with patch.object(self.app, 'authenticate_admin', side_effect=ApiError('无写入权限', 403)) as authorize:
            with self.assertRaises(HTTPError) as error:
                self.request(route, {'path': '', 'repositoryId': ''})
            self.assertEqual(error.exception.code, 403)
            self.assertTrue(authorize.call_args.kwargs['write'])

    def test_generation_directory_is_per_instance_persists_heartbeat_and_can_reset(self):
        service, endpoint, identity, payload = self.start_remote()
        base = '/api/runner-management/code-servers/' + identity['serverId'] + '/generation-directory'
        root = str(service.workspace.root / 'agent-projects')
        saved = self.request(base, {'generationRoot': root})
        self.assertEqual(saved['generationRoot'], root)
        self.assertNotIn('tokenHash', saved)
        self.request('/api/code-servers/me/heartbeat', {**payload, 'serverId': identity['serverId'], 'pid': 1234,
                     'generationRoot': 'not-a-heartbeat-setting'}, identity['token'])
        self.assertEqual(self.request('/api/runner-management/code-servers')['items'][0]['generationRoot'], root)
        code = self.request('/api/runner-management/code-servers/enrollment-code', {})['code']
        second = self.request('/api/code-servers/enroll', {**payload, 'code': code, 'installDirectory': 'other-instance'})
        self.assertNotIn('generationRoot', code_servers.read(self.app, second['serverId']))
        reset = self.request(base, {'generationRoot': ''})
        self.assertEqual(reset['generationRoot'], '')
        self.assertEqual(code_servers.generation_root(reset), str(service.workspace.root))

    def test_generation_directory_rejects_invalid_paths_and_requires_write_authorization(self):
        service, endpoint, identity, payload = self.start_remote()
        base = '/api/runner-management/code-servers/' + identity['serverId'] + '/generation-directory'
        for value in (None, 3, '../outside', str(service.workspace.root.parent / 'outside'),
                      str(service.workspace.root / '..' / 'outside'), str(service.workspace.root / '.git'),
                      str(service.workspace.root / 'node_modules')):
            with self.subTest(value=value), self.assertRaises(HTTPError) as error:
                self.request(base, {'generationRoot': value})
            self.assertEqual(error.exception.code, 400)
        with patch.object(self.app, 'authenticate_admin', side_effect=ApiError('无写入权限', 403)) as authorize:
            with self.assertRaises(HTTPError) as error:
                self.request(base, {'generationRoot': str(service.workspace.root)})
            self.assertEqual(error.exception.code, 403)
            self.assertTrue(authorize.call_args.kwargs['write'])
        windows = {'workspace': r'D:\codeserver\workspace'}
        self.assertEqual(code_servers.generation_root(windows, r'D:\codeserver\workspace\projects'), r'D:\codeserver\workspace\projects')
        with self.assertRaises(ApiError):
            code_servers.generation_root(windows, r'D:\codeserver\other')

    def test_supervisor_logs_are_authenticated_and_restricted_to_known_types(self):
        service,endpoint,identity,payload=self.start_remote()
        (service.directory/'logs/launcher.log').write_text('upgrade fixture',encoding='utf8')
        route='/api/runner-management/code-servers/'+identity['serverId']+'/files'
        self.assertEqual(self.request(route,{'action':'logs','kind':'launcher'})['content'],'upgrade fixture')
        with self.assertRaises(HTTPError):self.request(route,{'action':'logs','kind':'../identity'})
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
            self.assertNotIn('allowedModelOrigins', config)

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
        agent.update(endpoint=origin + '/wb/agent', generationServerId=identity['serverId'], generationServerMode='manual', prjDir='.', codeDir='code', outputFileDir='output', cdpPort=9333)
        model_interfaces.save(self.app, config)
        _, request = model_interfaces.prepare_test(self.app, {'interfaceId': agent['id'], 'prompt': '测试', 'taskId': 'task-100'})
        self.assertEqual(request.full_url, endpoint + '/api/model')
        with urlopen(request, timeout=5) as response:
            self.assertTrue(first.wait(1))
            self.assertEqual(response.read1(4096).decode(), '第一段')
            release.set(); self.assertEqual(response.read().decode(), '第二段')
        self.assertEqual(calls[0]['cdp_port'], 9333)
        base = service.workspace.root
        self.assertEqual(calls[0]['code_dir'], str(base / 'code'))
        self.assertEqual(calls[0]['input_file_dir'], str(base / 'input'))
        self.assertEqual(calls[0]['output_file_dir'], str(base / 'output'))
        self.assertTrue(all((base / name).is_dir() for name in ('code', 'input', 'output')))
        # An empty or stale allowlist no longer blocks configured HTTP model services.
        service.config['allowedModelOrigins'] = []
        with service.model({'url': origin + '/wb/agent', 'method': 'POST', 'body': {}}) as response:
            self.assertEqual(response.status, 200)
        for address in ('file:///etc/passwd', 'ftp://example.com/a', 'http://user:password@example.com/a', 'http://', 'http://example.com:bad/a'):
            with self.subTest(address=address), self.assertRaises(ServiceError):
                service.model({'url': address, 'method': 'POST', 'body': {}})
        with self.assertRaises(ServiceError):
            service.model({'url': origin + '/wb/agent', 'method': 'POST', 'body': {'code_dir': '../escape'}})
