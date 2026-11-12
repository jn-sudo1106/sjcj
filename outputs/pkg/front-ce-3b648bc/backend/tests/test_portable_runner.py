"""Download and launch a relocated package with no system Python on PATH."""
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zipfile
from unittest.mock import patch

from backend.tests import test_runner_management as baseline
from backend.runner_management.server import ApiError


class PortableRunnerTest(unittest.TestCase):
    setUp = baseline.ManagementIntegrationTest.setUp
    tearDown = baseline.ManagementIntegrationTest.tearDown
    request = baseline.ManagementIntegrationTest.request

    def test_bundled_python_can_install_offline_program_dependencies_in_a_venv(self):
        from types import SimpleNamespace
        from backend.runner_management.portable_package import build_package
        from backend.runner_management.program_dependencies import clean_environment
        from backend.tests.test_program_dependencies import ProgramDependenciesTest
        release = self.app.publish_runner()
        _, data = build_package(self.app, {'server': self.url, 'digest': release['digest']})
        destination = Path(self.tmp.name) / '便携环境依赖'
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            archive.extractall(destination)
        root = destination / 'Runner'
        snapshot = destination / 'signed-code'
        snapshot.mkdir()
        ProgramDependenciesTest.write_wheel(SimpleNamespace(snapshot=snapshot, working=destination / 'program'))
        python = root / 'runtime/python.exe'
        environment = destination / 'business-env'
        env = clean_environment()
        result = subprocess.run([str(python), '-m', 'venv', '--copies', str(environment)], env=env,
                                capture_output=True, text=True, encoding='utf-8', timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        business = environment / 'Scripts/python.exe'
        result = subprocess.run([str(business), '-m', 'pip', 'install', '-r', str(snapshot / 'requirements.txt')],
                                cwd=snapshot, env=env, capture_output=True, text=True, encoding='utf-8', timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run([str(business), '-c', 'import runner_test_dependency; print(runner_test_dependency.VALUE)'],
                                env=env, capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'installed')

    def test_console_titles_and_output_identify_both_new_and_restarted_instances(self):
        import contextlib
        import ctypes
        import sys
        from types import SimpleNamespace
        from unittest.mock import Mock, mock_open
        from backend.runner_management.runner import announce_instance as native_announce
        from backend.runner_management.portable_package import LAUNCHER
        namespace = {'__name__': 'launcher_contract', '__file__': str(Path(self.tmp.name) / 'start.py')}
        original_path = sys.path[:]
        try:
            exec(compile(LAUNCHER, 'portable_start.py', 'exec'), namespace)
        finally:
            sys.path[:] = original_path
        for announce in (native_announce, lambda identifier, directory, version: namespace['announce_instance']({'runnerId': identifier}, directory, version)):
            title = Mock()
            console = mock_open()
            old, new = 'sha256:' + 'a' * 64, 'sha256:' + 'b' * 64
            with patch.object(ctypes, 'windll', SimpleNamespace(kernel32=SimpleNamespace(SetConsoleTitleW=title)), create=True), patch('os.name', 'nt'), patch('builtins.open', console):
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    for identifier, folder, version in [('instance-first', 'Runner 1', old), ('instance-second', 'Runner 2', old), ('instance-first', 'Runner 1', old), ('instance-first', 'Runner 1', new), ('instance-first', 'Runner 1', old)]:
                        announce(identifier, Path(self.tmp.name) / folder, version)
                titles = [call.args[0] for call in title.call_args_list]
                self.assertEqual(len(titles), 5)
                self.assertEqual(titles[0], titles[2])
                self.assertNotEqual(titles[0], titles[1])
                self.assertIn('instance-first', titles[0])
                self.assertIn('Runner 2', titles[1])
                self.assertEqual(output.getvalue().count('Runner 实例 ID：instance-first'), 4)
                self.assertIn('版本 aaaaaaaaaaaa', titles[0])
                self.assertIn('版本 bbbbbbbbbbbb', titles[3])
                self.assertEqual(titles[0], titles[4])
                self.assertIn('Runner 版本 ID：' + new, output.getvalue())
                if announce is native_announce:
                    self.assertIn('Runner 版本 ID：' + new, ''.join(call.args[0] for call in console().write.call_args_list))

    def test_first_enrollment_timeout_is_logged_without_credentials_and_lan_bypasses_proxy(self):
        import sys
        from backend.runner_management.portable_package import LAUNCHER
        root = Path(self.tmp.name) / 'network failure'
        sources = root / 'runner_management'
        sources.mkdir(parents=True)
        (sources / '__init__.py').write_text('', encoding='utf-8')
        (sources / 'artifacts.py').write_text('def verify_artifact(*args): pass\n', encoding='utf-8')
        (sources / 'runner.py').write_text('''import os
from pathlib import Path
from urllib.error import URLError
class Runner:
    def __init__(self, directory, server):
        self.directory = directory.resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.identity = None
        self.ip_address = '192.168.1.201'
def json_request(server, path, payload):
    assert '192.168.1.36' in os.environ['no_proxy'].split(',')
    assert 'existing-host' in os.environ['no_proxy'].split(',')
    raise URLError(TimeoutError('timed out'))
''', encoding='utf-8')
        cache = root / 'instance/runner-versions'
        cache.mkdir(parents=True)
        (cache / 'test.zip').write_bytes(b'test')
        (cache / 'test.sig').write_text('signature', encoding='ascii')
        (root / 'runner.json').write_text(json.dumps({'server': 'http://192.168.1.36:8092', 'packageToken': 'SECRET-PACKAGE-TOKEN'}), encoding='utf-8')
        (root / 'package.json').write_text(json.dumps({'runnerDigest': 'sha256:test', 'publicKey': 'public'}), encoding='utf-8')
        (root / 'start.py').write_text(LAUNCHER, encoding='utf-8')
        result = subprocess.run([sys.executable, '-X', 'utf8', str(root / 'start.py')],
                                env={**os.environ, 'NO_PROXY': 'existing-host', 'no_proxy': 'existing-host'},
                                capture_output=True, text=True, encoding='utf-8', timeout=20)
        self.assertEqual(result.returncode, 1)
        self.assertIn('startup.log', result.stderr)
        self.assertNotIn('Traceback', result.stderr)
        saved = (root / 'instance/logs/startup.log').read_text(encoding='utf-8')
        self.assertIn('URLError', saved)
        self.assertIn('timed out', saved)
        self.assertIn('http://192.168.1.36:8092', saved)
        self.assertNotIn('SECRET-PACKAGE-TOKEN', saved + result.stdout + result.stderr)


    def test_package_authorization_is_reusable_but_ordinary_codes_remain_single_use(self):
        import hashlib
        credential = 'test-package-credential'
        key = 'portable-enroll:' + hashlib.sha256(credential.encode()).hexdigest()
        with self.app.store.connect() as db:
            db.execute('INSERT INTO settings VALUES (?,?)', (key, json.dumps({'expiresAt': '2999-01-01T00:00:00+00:00'})))
        payload = {'packageToken': credential, 'installDirectory': str(Path(self.tmp.name) / 'first'),
                   'ipAddress': '192.168.50.123', 'platform': 'win32'}
        first = self.app.enroll(payload)
        second = self.app.enroll({**payload, 'installDirectory': str(Path(self.tmp.name) / 'second')})
        self.assertNotEqual(first['runnerId'], second['runnerId'])
        self.assertNotEqual(first['token'], second['token'])
        with self.assertRaises(ApiError) as duplicate:
            self.app.enroll(payload)
        self.assertEqual(duplicate.exception.status, 409)
        for invalid in ('not-a-real-package', []):
            with self.assertRaises(ApiError):
                self.app.enroll({**payload, 'packageToken': invalid})
        with self.app.store.connect() as db:
            db.execute('UPDATE settings SET setting_value=? WHERE setting_key=?', (json.dumps({'expiresAt': '2000-01-01T00:00:00+00:00'}), key))
        with self.assertRaises(ApiError) as expired:
            self.app.enroll({**payload, 'installDirectory': str(Path(self.tmp.name) / 'third')})
        self.assertEqual(expired.exception.status, 403)
        code = self.request('/api/runner-management/runners/enrollment-codes', {})['code']
        ordinary = {**payload, 'packageToken': '', 'code': code, 'installDirectory': str(Path(self.tmp.name) / 'ordinary')}
        self.app.enroll(ordinary)
        with self.assertRaises(ApiError):
            self.app.enroll({**ordinary, 'installDirectory': str(Path(self.tmp.name) / 'ordinary-copy')})

    def test_portable_zip_starts_two_independent_instances_with_bundled_python(self):
        self.app.publish_runner()
        info = self.request('/api/runner-management/runner-package')
        self.assertTrue(info['ready'])
        self.assertEqual(info['enrollmentMinutes'], 15)
        digest = info['releases'][0]['digest']
        req = Request(self.url + '/api/runner-management/runner-package',
                      data=json.dumps({'server': self.url, 'digest': digest}).encode(), headers={'Content-Type': 'application/json'})
        with urlopen(req, timeout=60) as response:
            self.assertEqual(response.headers['Content-Type'], 'application/zip')
            self.assertIn('Runner-windows-x64-', response.headers['Content-Disposition'])
            data = response.read()
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = archive.namelist()
            self.assertIn('Runner/runtime/python.exe', names)
            self.assertIn('Runner/runtime/Lib/encodings/__init__.py', names)
            self.assertIn('Runner/runtime/Lib/site-packages/cryptography/__init__.py', names)
            self.assertIn('Runner/启动Runner.cmd', names)
            self.assertFalse(any(name.endswith('identity.json') or '/logs/' in name or 'signing-key' in name or '__pycache__' in name for name in names))
            config = json.loads(archive.read('Runner/runner.json'))
            self.assertEqual(config['server'], self.url)
            self.assertTrue(config['packageToken'])
            self.assertNotIn('enrollCode', config)
            self.assertEqual(json.loads(archive.read('Runner/instance/pip.json')), {'indexUrl': 'https://pypi.org/simple', 'proxy': ''})
        clients = []
        try:
            for index in range(2):
                destination = Path(self.tmp.name) / ('复制 Runner ' + str(index))
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    archive.extractall(destination)
                root = destination / 'Runner'
                if index:
                    # Even a copied registered folder must not reuse the first identity.
                    first_identity = Path(self.tmp.name) / '复制 Runner 0/Runner/instance/identity.json'
                    (root / 'instance/identity.json').write_bytes(first_identity.read_bytes())
                env = {key: value for key, value in os.environ.items() if not key.startswith('RUNNER_') and key not in ('PYTHONHOME', 'PYTHONPATH')}
                windows = Path(os.environ.get('SystemRoot', r'C:\Windows'))
                env.update(PYTHONHOME=str(root / 'runtime'), PYTHONNOUSERSITE='1',
                           PATH=str(windows / 'System32') + ';' + str(windows / 'System32/WindowsPowerShell/v1.0'),
                           RUNNER_ADVERTISE_IP='192.168.50.123')
                command = [str(root / 'runtime/python.exe'), '-X', 'utf8', str(root / 'start.py')]
                result = subprocess.run([*command, '--check'], cwd=destination, env=env, capture_output=True, text=True, encoding='utf-8', timeout=20)
                self.assertEqual(result.returncode, 0, result.stderr)
                checked = json.loads(result.stdout)
                self.assertEqual(Path(checked['python']).resolve(), (root / 'runtime/python.exe').resolve())
                self.assertEqual(Path(checked['pythonHome']).resolve(), (root / 'runtime').resolve())
                self.assertTrue(Path(checked['cryptography']).resolve().is_relative_to(root / 'runtime'))
                if index:
                    self.assertEqual((root / 'instance/identity.json').read_bytes(), first_identity.read_bytes())
                else:
                    self.assertFalse((root / 'instance/identity.json').exists())
                log = (destination / 'launch.log').open('wb')
                process = subprocess.Popen(command, cwd=destination, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                           creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
                clients.append((process, log))
                deadline = time.monotonic() + 25
                while time.monotonic() < deadline:
                    self.assertIsNone(process.poll(), (destination / 'launch.log').read_text(encoding='utf-8'))
                    machines = self.request('/api/runner-management/runners')
                    row = next((row for row in machines if Path(row['installDirectory']).resolve() == (root / 'instance').resolve()), None)
                    if row and row['actualDigest'] == digest and row.get('runnerPid'):
                        break
                    time.sleep(.25)
                else:
                    self.fail('便携 Runner 未收到健康心跳')
                self.assertEqual(row['status'], 'online')
                self.assertIn('process-control', row['capabilities'])
                self.assertIn('Runner 实例 ID：' + row['runnerId'], (destination / 'launch.log').read_text(encoding='utf-8'))
                self.assertIn('Runner 版本 ID：' + digest, (destination / 'launch.log').read_text(encoding='utf-8'))
                if index:
                    self.assertNotIn('Runner 实例 ID：' + json.loads(first_identity.read_text(encoding='utf-8'))['runnerId'],
                                     (destination / 'launch.log').read_text(encoding='utf-8'))
            self.assertEqual(len({row['runnerId'] for row in self.request('/api/runner-management/runners')}), 2)
            first_root = Path(self.tmp.name) / '复制 Runner 0/Runner'
            identity_before = (first_root / 'instance/identity.json').read_bytes()
            clients[0][0].send_signal(signal.CTRL_BREAK_EVENT)
            clients[0][0].wait(timeout=25)
            import hashlib
            key = 'portable-enroll:' + hashlib.sha256(config['packageToken'].encode()).hexdigest()
            with self.app.store.connect() as db:
                db.execute('UPDATE settings SET setting_value=? WHERE setting_key=?', (
                    json.dumps({'expiresAt': '2000-01-01T00:00:00+00:00'}), key))
            restart_env = {**env, 'PYTHONHOME': str(first_root / 'runtime')}
            restart = subprocess.Popen([str(first_root / 'runtime/python.exe'), '-X', 'utf8', str(first_root / 'start.py')],
                                       env=restart_env, stdin=subprocess.DEVNULL, stdout=clients[0][1], stderr=clients[0][1],
                                       creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
            clients.append((restart, clients[0][1]))
            time.sleep(2)
            self.assertIsNone(restart.poll(), '已登记实例应可在包内凭据过期后直接重启')
            self.assertEqual((first_root / 'instance/identity.json').read_bytes(), identity_before)
            self.assertEqual(len(self.request('/api/runner-management/runners')), 2)
            self.assertGreaterEqual((first_root.parent / 'launch.log').read_text(encoding='utf-8').count(
                'Runner 实例 ID：' + json.loads(identity_before)['runnerId']), 2)
            self.assertGreaterEqual((first_root.parent / 'launch.log').read_text(encoding='utf-8').count('Runner 版本 ID：' + digest), 2)
        finally:
            for process, log in clients:
                if process.poll() is None:
                    process.send_signal(signal.CTRL_BREAK_EVENT)
                try:
                    process.wait(timeout=25)
                except subprocess.TimeoutExpired:
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True)
            for _, log in clients:
                log.close()

    def test_package_validation_and_admin_access_reject_before_enrollment(self):
        release = self.app.publish_runner()
        from backend.runner_management.portable_package import build_package
        for server in ('file:///tmp', 'http://user:pass@host:8092', 'http://host:8092/api/runners', 'http://host:bad', ''):
            with self.assertRaises(ApiError):
                build_package(self.app, {'server': server, 'digest': release['digest']})
        with patch.dict(os.environ, {'RUNNER_DEV_MODE': '0', 'RUNNER_AUTH_URL': '', 'RUNNER_ADMIN_TOKEN': ''}):
            with self.assertRaises(HTTPError) as denied:
                self.request('/api/runner-management/runner-package', {'server': self.url, 'digest': release['digest']})
            self.assertEqual(denied.exception.code, 503)
        with self.app.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM enrollment_codes').fetchone()[0], 0)
