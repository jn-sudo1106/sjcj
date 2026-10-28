import io
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import uuid
import zipfile

from backend.runner_management import program_dependencies as deps
from backend.runner_management.runtime_logs import LogQueue


class ProgramDependenciesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.snapshot = self.root / 'signed-code'
        self.snapshot.mkdir()
        self.working = self.root / 'instance/program'
        self.runner = SimpleNamespace(directory=self.root / 'instance', running=True,
                                      post=lambda *args: {}, heartbeat_payload=lambda: {},
                                      get=lambda *args: [{'assignmentId': 'a', 'releaseDigest': 'signed'}])
        self.runner.logs = LogQueue(self.runner.directory, self.runner.post)
        self.info = {'runId': uuid.uuid4().hex, 'runtimeId': 'runtime-test',
                     'assignment': {'assignmentId': 'a', 'releaseDigest': 'signed'}}
        self.manifest = {'deploymentId': 'deployment-test'}

    def tearDown(self):
        if self.runner.logs.thread:
            self.runner.logs.thread.join(timeout=5)
        self.tmp.cleanup()

    def write_wheel(self):
        content = {'runner_test_dependency/__init__.py': 'VALUE = "installed"\n',
                   'runner_test_dependency-1.0.dist-info/METADATA': 'Metadata-Version: 2.1\nName: runner-test-dependency\nVersion: 1.0\n',
                   'runner_test_dependency-1.0.dist-info/WHEEL': 'Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n'}
        content['runner_test_dependency-1.0.dist-info/RECORD'] = ''.join(name + ',,\n' for name in [*content, 'runner_test_dependency-1.0.dist-info/RECORD'])
        with zipfile.ZipFile(self.snapshot / 'runner_test_dependency-1.0-py3-none-any.whl', 'w') as wheel:
            for name, data in content.items():
                wheel.writestr(name, data)
        (self.snapshot / 'requirements.txt').write_text('# 自动化爬虫依赖清单：中文注释必须按 UTF-8 读取\n--no-index\n--find-links .\nrunner-test-dependency==1.0\n', encoding='utf-8')
        shutil.copytree(self.snapshot, self.working, dirs_exist_ok=True)

    def test_install_in_isolated_environment_reuse_and_changed_requirements(self):
        self.write_wheel()
        with patch.dict(os.environ, {'PYTHONHOME': sys.base_prefix, 'PYTHONPATH': 'do-not-inherit', 'PYTHONUTF8': '0'}), patch.object(deps, 'run_install', wraps=deps.run_install) as install:
            self.assertEqual(deps.clean_environment()['PYTHONUTF8'], '1')
            python = deps.dependency_python(self.runner, self.snapshot, self.working, self.manifest, self.info)
            self.assertNotEqual(python, Path(sys.executable))
            self.assertTrue(python.is_relative_to(self.runner.directory))
            self.assertEqual(install.call_count, 2)
            result = subprocess.run([str(python), '-c', 'import runner_test_dependency; print(runner_test_dependency.VALUE)'],
                                    env=deps.clean_environment(), capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), 'installed')
            self.assertEqual(deps.dependency_python(self.runner, self.snapshot, self.working, self.manifest, self.info), python)
            self.assertEqual(install.call_count, 2)
            for root in (self.snapshot, self.working):
                with (root / 'requirements.txt').open('a', encoding='utf-8') as output:
                    output.write('# changed dependency declaration\n')
            deps.dependency_python(self.runner, self.snapshot, self.working, self.manifest, self.info)
            self.assertEqual(install.call_count, 4)
        marker = next((self.runner.directory / '.runtime/program-env').glob('*/requirements-state.json'))
        self.assertIn('requirements.txt', json.loads(marker.read_text())['files'])
        saved = ''.join(path.read_text(encoding='utf-8') for path in self.runner.logs.root.glob('programs/*/*/*.log'))
        self.assertIn('runner-test-dependency', saved)

    def test_no_requirements_preserves_existing_interpreter_and_tampering_rejected(self):
        self.assertEqual(deps.dependency_python(self.runner, self.snapshot, self.working, self.manifest, self.info), Path(sys.executable))
        self.write_wheel()
        (self.working / 'requirements.txt').write_text('unverified-package\n')
        with patch.object(deps, 'run_install') as install, self.assertRaisesRegex(ValueError, '与配置不一致'):
            deps.dependency_python(self.runner, self.snapshot, self.working, self.manifest, self.info)
        install.assert_not_called()

    def test_runner_upgrade_seeds_missing_pip_settings_without_overwriting_custom_config(self):
        from backend.runner_management.runner import Runner
        first = Runner(self.root / 'runner-1', 'http://127.0.0.1:1')
        second = Runner(self.root / 'runner-2', 'http://127.0.0.1:1')
        try:
            path = first.directory / 'pip.json'
            self.assertEqual(json.loads(path.read_text(encoding='utf-8')), deps.DEFAULT_PIP_SETTINGS)
            custom = '{\n  "indexUrl": "https://packages.example/simple",\n  "proxy": "http://127.0.0.1:8080"\n}\n'
            path.write_text(custom, encoding='utf-8')
            restarted = Runner(first.directory, 'http://127.0.0.1:1')
            restarted.close()
            self.assertEqual(path.read_text(encoding='utf-8'), custom)
            self.assertEqual(json.loads((second.directory / 'pip.json').read_text(encoding='utf-8')), deps.DEFAULT_PIP_SETTINGS)
        finally:
            first.close()
            second.close()

    def test_pip_ignores_broken_machine_proxy_and_config_and_downloads_from_instance_index(self):
        self.write_wheel()
        index = self.snapshot / 'simple/runner-test-dependency'
        index.mkdir(parents=True)
        wheel = 'runner_test_dependency-1.0-py3-none-any.whl'
        (index / 'index.html').write_text(f'<a href="/{wheel}">{wheel}</a>', encoding='utf-8')
        for root in (self.snapshot, self.working):
            (root / 'requirements.txt').write_text('runner-test-dependency==1.0\n', encoding='utf-8')
        class QuietHandler(SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(self.snapshot)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.runner.directory.mkdir(parents=True, exist_ok=True)
        (self.runner.directory / 'pip.json').write_text(json.dumps({'indexUrl': f'http://127.0.0.1:{server.server_port}/simple', 'proxy': ''}), encoding='utf-8')
        bad_config = self.root / 'bad-pip.ini'
        bad_config.write_text('[global]\nproxy = http://127.0.0.1:1\nno-index = true\n')
        inherited = {'HTTPS_PROXY': 'http://127.0.0.1:1', 'http_proxy': 'http://127.0.0.1:1',
                     'ALL_PROXY': 'http://127.0.0.1:1', 'NO_PROXY': '', 'PIP_CONFIG_FILE': str(bad_config),
                     'PIP_PROXY': 'http://127.0.0.1:1', 'PIP_INDEX_URL': 'http://127.0.0.1:1/simple',
                     'PIP_NO_INDEX': '1', 'PIP_TARGET': str(self.root / 'wrong-site-packages')}
        try:
            with patch.dict(os.environ, inherited):
                env = deps.installation_environment(self.runner.directory)
                self.assertEqual(env['PIP_CONFIG_FILE'], os.devnull)
                self.assertEqual(env['NO_PROXY'], '*')
                self.assertNotIn('PIP_TARGET', env)
                self.assertNotIn('PIP_PROXY', env)
                python = deps.dependency_python(self.runner, self.snapshot, self.working, self.manifest, self.info)
                result = subprocess.run([str(python), '-c', 'import runner_test_dependency; print(runner_test_dependency.VALUE)'], env=deps.clean_environment(), capture_output=True, text=True, timeout=20)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), 'installed')
                self.assertEqual(os.environ['HTTPS_PROXY'], inherited['HTTPS_PROXY'])
                self.assertFalse((self.root / 'wrong-site-packages').exists())
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_explicit_instance_proxy_preserves_tls_and_does_not_leak_into_runner(self):
        self.runner.directory.mkdir(parents=True, exist_ok=True)
        (self.runner.directory / 'pip.json').write_text(json.dumps({'indexUrl': 'https://packages.example/simple', 'proxy': 'http://127.0.0.1:8080'}))
        with patch.dict(os.environ, {'PIP_TRUSTED_HOST': 'untrusted.example', 'PIP_CERT': 'company-ca.pem', 'REQUESTS_CA_BUNDLE': 'requests-ca.pem'}):
            env = deps.installation_environment(self.runner.directory)
        self.assertEqual(env['PIP_PROXY'], 'http://127.0.0.1:8080')
        self.assertEqual(env['PIP_INDEX_URL'], 'https://packages.example/simple')
        self.assertEqual(env['PIP_CERT'], 'company-ca.pem')
        self.assertEqual(env['REQUESTS_CA_BUNDLE'], 'requests-ca.pem')
        self.assertNotIn('PIP_TRUSTED_HOST', env)

    def test_invalid_instance_pip_config_is_rejected_without_exposing_values(self):
        self.runner.directory.mkdir(parents=True, exist_ok=True)
        config = self.runner.directory / 'pip.json'
        for content in ('[]', '{invalid', '{"indexUrl": "secret-value"}', '{"proxy": false}', '{"unknown": "secret-value"}'):
            config.write_text(content, encoding='utf-8')
            with self.assertRaises(ValueError) as error:
                deps.installation_environment(self.runner.directory)
            self.assertNotIn('secret-value', str(error.exception))

    def test_included_requirements_participate_in_hash_and_cannot_escape_snapshot(self):
        (self.snapshot / 'requirements.txt').write_text('-r dependencies/base.txt\n')
        (self.snapshot / 'dependencies').mkdir()
        included = self.snapshot / 'dependencies/base.txt'
        included.write_text('pika==1.3.2\n')
        first = deps.requirement_files(self.snapshot)
        included.write_text('pika==1.3.1\n')
        self.assertNotEqual(first, deps.requirement_files(self.snapshot))
        (self.root / 'outside.txt').write_text('package\n')
        (self.snapshot / 'requirements.txt').write_text('-r ../outside.txt\n')
        with self.assertRaisesRegex(ValueError, '已下发'):
            deps.requirement_files(self.snapshot)

    def test_failed_install_does_not_mark_environment_ready(self):
        self.write_wheel()
        (self.snapshot / 'requirements.txt').write_text('--no-index\nmissing-test-package==0.0\n')
        shutil.copyfile(self.snapshot / 'requirements.txt', self.working / 'requirements.txt')
        with self.assertRaisesRegex(RuntimeError, '依赖安装失败'):
            deps.dependency_python(self.runner, self.snapshot, self.working, self.manifest, self.info)
        self.assertFalse(list(self.runner.directory.glob('.runtime/program-env/*/requirements-state.json')))

    def test_stopped_start_request_cancels_installer(self):
        self.runner.get = lambda *args: []
        with self.assertRaisesRegex(InterruptedError, '已停止或更新'):
            deps.run_install(self.runner, [sys.executable, '-c', 'import time; time.sleep(30)'], self.snapshot, self.info)

    def test_install_still_processes_stop_requests_for_other_programs(self):
        self.runner.processes = {'other': ('old', SimpleNamespace(pid=999), None)}
        stopped = []
        def stop(key, timeout):
            stopped.append(key)
            self.runner.processes.pop(key)
            self.runner.running = False
        self.runner.stop = stop
        with self.assertRaisesRegex(RuntimeError, '依赖安装已取消'):
            deps.run_install(self.runner, [sys.executable, '-c', 'import time; time.sleep(30)'], self.snapshot, self.info)
        self.assertEqual(stopped, ['other'])

    def test_configured_program_launches_using_installed_dependency_environment(self):
        from backend.runner_management.runner import Runner
        self.write_wheel()
        code = 'import sys, time, pathlib, runner_test_dependency\npathlib.Path("started.txt").write_text(sys.prefix + "\\n" + runner_test_dependency.VALUE)\ntime.sleep(30)\n'
        (self.working / 'main.py').write_text(code, encoding='utf-8')
        runner = Runner(self.runner.directory, 'http://127.0.0.1:1')
        runner.identity = {'runnerId': 'test', 'token': 'fake', 'publicKey': 'fake'}
        runner.post = self.runner.post
        assignment = {'assignmentId': 'a', 'releaseDigest': 'signed', 'processorType': 'deployment-entry', 'queue': 'test', 'environment': 'test'}
        runner.get = lambda *args: [assignment]
        runner.logs = self.runner.logs
        manifest = {**self.manifest, 'executionSchema': 2, 'processorType': 'deployment-entry', 'entry': 'main.py'}
        try:
            with patch.dict(os.environ, {'PYTHONHOME': sys.base_prefix, 'PYTHONPATH': 'do-not-inherit'}), patch.object(runner, 'prepare', return_value=(self.snapshot, manifest)), patch.object(runner, 'program_directory', return_value=self.working):
                runner.start(assignment)
            self.assertTrue(runner.processes)
            prefix, value = (self.working / 'started.txt').read_text().splitlines()
            self.assertTrue(Path(prefix).is_relative_to(self.runner.directory / '.runtime/program-env'))
            self.assertEqual(value, 'installed')
        finally:
            runner.close()


if __name__ == '__main__':
    unittest.main()
