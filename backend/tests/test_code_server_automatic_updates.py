import io
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import unittest
from unittest.mock import Mock, patch
from urllib.request import Request, urlopen
import zipfile

from backend.tests import test_runner_management as baseline
from backend.tests.test_code_generation_servers import CodeServerTest
from backend.runner_management import code_servers, code_server_upgrades, generation_workspaces
from backend.runner_management.directory_layout import store_layout
from backend.code_generation_server.launcher_host import LauncherHost
from backend.code_generation_server import launcher_bridge


class AutomaticCodeServerUpdateTest(unittest.TestCase):
    setUp = baseline.ManagementIntegrationTest.setUp
    tearDown = CodeServerTest.tearDown
    request = baseline.ManagementIntegrationTest.request
    _start_remote = CodeServerTest.start_remote

    def start_remote(self):
        service, endpoint, identity, payload = self._start_remote()
        root = service.directory
        (root / 'config.json').write_text(json.dumps(service.config))
        (root / 'identity.json').write_text(json.dumps({**identity, 'publicKey': self.app.artifacts.public_key}))
        return root, endpoint, identity

    def personal(self, identity, path, body=None):
        headers = {'Authorization': 'Bearer ' + identity['token'], 'X-Code-Server-ID': identity['serverId'], 'Content-Type': 'application/json'}
        request = Request(self.url + '/api/code-servers/me/' + path, headers=headers,
                          data=json.dumps(body).encode() if body is not None else None)
        with urlopen(request) as response:
            return json.load(response)

    def test_auto_service_and_launcher_targets_wait_for_idle_and_failed_digest_is_not_retried(self):
        root, remote, identity = self.start_remote()
        release = code_server_upgrades.publish(self.app)
        with generation_workspaces.serialized(identity['serverId'], 'workspace', 1):
            desired = self.personal(identity, 'desired')
            self.assertIsNone(desired['digest'])
            self.assertTrue(desired['waiting'])
        desired = self.personal(identity, 'desired')
        self.assertEqual(desired['digest'], release['digest'])
        self.assertTrue(code_server_upgrades.read(self.app, identity['serverId'])['automatic'])
        launcher = self.personal(identity, 'launcher-desired')
        self.assertTrue(launcher['waiting'])
        self.assertIsNone(launcher['digest'])
        from backend.runner_management.database_generation import claim
        self.assertEqual(claim(self.app, {'serverId': identity['serverId']}), {'job': None})
        self.personal(identity, 'upgrade-result', {'requestId': desired['requestId'], 'status': 'failed', 'message': 'health check failed'})
        self.assertIsNone(self.personal(identity, 'desired')['digest'])
        launcher = self.personal(identity, 'launcher-desired')
        self.assertTrue(launcher['digest'].startswith('sha256:'))
        self.personal(identity, 'launcher-result', {'requestId': launcher['requestId'], 'status': 'failed'})
        self.assertIsNone(self.personal(identity, 'launcher-desired')['digest'])

    def test_launcher_bundle_rejects_tampering_and_configuration_files(self):
        digest = code_server_upgrades.publish_launcher(self.app)
        with self.app.store.connect() as db:
            signature = db.execute('SELECT signature FROM releases WHERE digest=?', (digest,)).fetchone()['signature']
        data = self.app.artifacts.read(digest)
        files = launcher_bridge.verify_bundle(data, digest, signature, self.app.artifacts.public_key)
        self.assertIn('start.py', files)
        self.assertNotIn('config.json', files)
        self.assertNotIn('identity.json', files)
        with self.assertRaises(Exception):
            launcher_bridge.verify_bundle(data + b'tamper', digest, signature, self.app.artifacts.public_key)
        wrong, signed = self.app.artifacts.publish({'config.json': b'{}'}, {'kind': 'code-server-launcher', 'entryModule': 'code_generation_server.start'})
        with self.assertRaises(ValueError):
            launcher_bridge.verify_bundle(self.app.artifacts.read(wrong), wrong, signed, self.app.artifacts.public_key)

    def new_config(self, root):
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0)); port = reservation.getsockname()[1]
        return {'platform': self.url, 'host': '127.0.0.1', 'port': port, 'workspace': './workspace',
                'advertiseUrl': f'http://127.0.0.1:{port}',
                'enrollCode': self.request('/api/runner-management/code-servers/enrollment-code', {})['code']}

    def test_real_signed_launcher_switch_and_failed_candidate_roll_back_without_changing_instance(self):
        root = Path(self.tmp.name) / 'hosted'; root.mkdir()
        config = self.new_config(root)
        (root / 'config.json').write_text(json.dumps(config))
        release = code_server_upgrades.publish(self.app)
        host = LauncherHost(root, config)
        def cleanup():
            host.stop()
            for logger in (host.client.logs.logger, host.client.service.logger):
                for handler in logger.handlers[:]: handler.close(); logger.removeHandler(handler)
        self.addCleanup(cleanup)
        original_identity = (root / 'identity.json').read_bytes()
        (root / 'workspace/keep.py').write_text('KEEP = True')
        desired = host.client.get('/api/runners/me/desired-runner')
        self.assertTrue(desired['digest'])
        host.switch(desired['digest'])
        self.assertTrue(host.healthy(desired['digest']))
        self.assertEqual((root / 'identity.json').read_bytes(), original_identity)
        self.assertEqual(json.loads((root / 'config.json').read_text()), config)
        broken, signature = self.app.artifacts.publish({'code_generation_server/__init__.py': b'',
            'code_generation_server/start.py': b'raise SystemExit(3)\n'}, {'kind': 'code-server-launcher', 'entryModule': 'code_generation_server.start'})
        with self.app.store.connect() as db:
            db.execute('INSERT INTO releases (digest,kind,name,platform,git_commit,status,published_at,signature,entry,git_url) VALUES (?,?,?,?,?,?,?,?,?,?)', (broken, 'code-server-launcher', 'broken', 'any', 'test', 'published', '2026-11-14', signature, 'code_generation_server.start', 'test'))
            store_layout(db, 'code-server-latest-launcher', {'digest': broken})
        # Wait for the independent service upgrade before scheduling a launcher switch.
        until = time.monotonic() + 30
        while time.monotonic() < until:
            next_target = host.client.get('/api/runners/me/desired-runner')
            if next_target['digest']: break
            time.sleep(0.5)
        self.assertEqual(next_target['digest'], broken)
        with self.assertRaisesRegex(RuntimeError, '已恢复上一版本'):
            host.switch(broken)
        self.assertTrue(host.healthy(desired['digest']))
        self.assertEqual(json.loads(host.current_path.read_text())['digest'], desired['digest'])
        self.assertEqual((root / 'workspace/keep.py').read_text(), 'KEEP = True')

    def test_legacy_migration_rolls_back_managed_files_and_never_modifies_user_data(self):
        root, remote, identity = self.start_remote()
        migration = launcher_bridge.Migration(root)
        (root / 'start.py').write_bytes(b'old launcher')
        (root / 'workspace/keep.py').write_bytes(b'user code')
        config = (root / 'config.json').read_bytes()
        identity_bytes = (root / 'identity.json').read_bytes()
        migration.report = Mock()
        child = Mock(); child.poll.return_value = 3
        migration.start = Mock(return_value=child)
        migration.wait_health = Mock(return_value=False)
        with patch.object(launcher_bridge, 'stop_exact') as stop:
            with self.assertRaisesRegex(RuntimeError, '健康检查失败'):
                migration.apply('sha256:' + 'a' * 64, b'verified', 'signature', {'start.py': b'candidate'}, 10, '1', 20, '2')
        self.assertEqual(stop.call_count, 2)
        self.assertEqual(migration.start.call_count, 2)
        self.assertEqual((root / 'start.py').read_bytes(), b'old launcher')
        self.assertEqual((root / 'config.json').read_bytes(), config)
        self.assertEqual((root / 'identity.json').read_bytes(), identity_bytes)
        self.assertEqual((root / 'workspace/keep.py').read_bytes(), b'user code')
        self.assertFalse((root / 'launcher-current.json').exists())

    def test_legacy_bridge_cannot_signal_reused_pid_or_arbitrary_parent(self):
        with patch.object(launcher_bridge, 'stamp', return_value='new-generation'):
            with self.assertRaisesRegex(ValueError, '进程代次'):
                launcher_bridge.stop_exact(1234, 'old-generation')
        root, remote, identity = self.start_remote()
        with self.assertRaisesRegex(ValueError, '当前服务进程'):
            launcher_bridge.Migration(root).run(1234, '1', 5678, '2')

    def test_exited_process_is_detected_even_while_subprocess_handle_is_still_open(self):
        child = subprocess.Popen([sys.executable, '-c', 'pass'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        child.wait(timeout=10)
        with self.assertRaises((ProcessLookupError, FileNotFoundError)):
            launcher_bridge.stamp(child.pid)

    def test_older_launcher_is_identified_from_ancestor_without_requiring_new_lock_file(self):
        with patch.object(launcher_bridge, 'process_details', side_effect=[('python -m code_generation_server.service', 123), ('python .\\start.py', 10)]), patch.object(launcher_bridge, 'stamp', return_value='created'):
            self.assertEqual(launcher_bridge.find_supervisor(Path('D:/coder'), 456), (123, 'created'))

    def test_legacy_migration_waits_for_local_requests_even_when_platform_has_no_busy_task(self):
        root, remote, identity = self.start_remote()
        migration = launcher_bridge.Migration(root)
        migration.call = Mock(side_effect=[{'pid': 1234}, {'digest': 'sha256:' + 'a' * 64, 'requestId': 'update'}])
        migration.control = Mock(side_effect=[{'pid': 1234}, {'activeRequests': 1, 'idleSeconds': 0}, {'activeRequests': 0, 'idleSeconds': 3}])
        migration.download = Mock(return_value=(b'signed', 'sig', {'start.py': b'candidate'}))
        migration.apply = Mock()
        with patch.object(launcher_bridge.os, 'getppid', return_value=1234), patch.object(launcher_bridge, 'find_supervisor', return_value=(123, 'old-parent')), patch.object(launcher_bridge.time, 'sleep') as wait:
            migration.run(123, 'old-parent', 1234, 'old-worker')
        wait.assert_called_once_with(0.5)
        self.assertEqual(migration.control.call_args_list[1].args, ('drain',))
        migration.apply.assert_called_once()

    def test_existing_installed_machine_automatically_migrates_without_downloading_another_package(self):
        release = code_server_upgrades.publish(self.app)
        root = Path(self.tmp.name) / 'legacy-instance'; root.mkdir()
        with zipfile.ZipFile(io.BytesIO(code_servers.package(self.app, self.url, digest=release['digest']))) as archive:
            archive.extractall(root)
        config = self.new_config(root)
        (root / 'config.json').write_text(json.dumps(config))
        (root / 'config.package.json').unlink()
        (root / 'launcher-current.json').unlink()
        legacy = '''import importlib.util,json,os,signal,sys
from pathlib import Path
root=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('code_generation_server',root/'__init__.py',submodule_search_locations=[str(root)])
module=importlib.util.module_from_spec(spec);sys.modules['code_generation_server']=module;spec.loader.exec_module(module)
from code_generation_server.bootstrapper import CodeServerBootstrapper
supervisor=CodeServerBootstrapper(root,json.loads((root/'config.json').read_text()))
signal.signal(signal.SIGTERM,lambda *_:setattr(supervisor,'running',False))
if hasattr(signal,'SIGBREAK'):signal.signal(signal.SIGBREAK,lambda *_:setattr(supervisor,'running',False))
try:supervisor.serve(interval=1)
finally:supervisor.stop()
'''
        (root / 'start.py').write_text(legacy)
        workspace = root / 'workspace'; workspace.mkdir(); (workspace / 'keep.py').write_text('USER_CODE = True')
        # Match installed Windows machines: the verifier's private venv adds a
        # redirector process between the worker and the migration helper.
        subprocess.run([sys.executable, '-m', 'venv', '--system-site-packages', str(root / '.runtime/python')], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        log = (root / 'test-output.log').open('wb')
        env = {key: value for key, value in os.environ.items() if not key.startswith('CODESERVER_') and key != 'PYTHONPATH'}
        process = subprocess.Popen([sys.executable, '-B', str(root / 'start.py')], cwd=root, env=env, stdout=log, stderr=log,
                                   creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)
        try:
            until = time.monotonic() + 100
            item = None
            while time.monotonic() < until:
                rows = code_servers.registry(self.app)
                item = next((row for row in rows if row['installDirectory'] == str(root) and row.get('launcherAutoUpdate') and row.get('launcherDigest', '').startswith('sha256:')), None)
                if item: break
                time.sleep(0.25)
            self.assertIsNotNone(item, 'legacy migration failed; inspect launcher-migration.log and launcher-restart.log')
            identity = json.loads((root / 'identity.json').read_text())
            self.assertEqual(identity['serverId'], item['serverId'])
            self.assertEqual(json.loads((root / 'config.json').read_text()), config)
            self.assertEqual((workspace / 'keep.py').read_text(), 'USER_CODE = True')
            self.assertNotEqual((root / 'start.py').read_text(), legacy)
            self.assertTrue((root / 'launcher-current.json').exists())
        finally:
            tracked = root / '.launcher-restart.json'
            if tracked.exists():
                try:
                    launcher_bridge.request_shutdown(root)
                except (ProcessLookupError, FileNotFoundError): pass
            if process.poll() is None:
                process.send_signal(signal.CTRL_BREAK_EVENT if os.name == 'nt' else signal.SIGTERM)
            try: process.wait(timeout=25)
            except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)
            log.close()


del CodeServerTest
