import base64
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from urllib.error import HTTPError
from unittest.mock import patch

from backend.tests import test_runner_management as fixtures
from backend.runner_management.runner import Runner


class ExecutableEntryTest(unittest.TestCase):
    setUp = fixtures.ManagementIntegrationTest.setUp
    tearDown = fixtures.ManagementIntegrationTest.tearDown
    request = fixtures.ManagementIntegrationTest.request
    directory_fixture = fixtures.ManagementIntegrationTest.directory_fixture
    deliver_runtime_fixture = fixtures.ManagementIntegrationTest.deliver_runtime_fixture

    @classmethod
    def setUpClass(cls):
        compiler = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
        if os.name != 'nt' or not compiler.is_file():
            raise unittest.SkipTest('Real EXE integration requires Windows and the installed .NET compiler')
        cls.build = tempfile.TemporaryDirectory()
        root = Path(cls.build.name)
        source = root / 'entry.cs'
        source.write_text('using System; using System.IO; using System.Threading; class Entry { static void Main() { '
                          'Console.WriteLine("native-ready"); File.WriteAllText("native-started.txt", '
                          'Environment.CurrentDirectory + "|" + Environment.GetEnvironmentVariable("RUNNER_CONFIG_ID")); '
                          'while (true) Thread.Sleep(100); } }', encoding='utf8')
        subprocess.run([str(compiler), '/nologo', '/target:exe', '/out:' + str(root / 'entry.exe'), str(source)], check=True, capture_output=True, timeout=30)
        cls.image = (root / 'entry.exe').read_bytes()

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, 'build'):
            cls.build.cleanup()

    def native_fixture(self, image=None):
        self.directory_fixture()
        repo = self.request('/api/runner-management/settings/code-repos')[0]
        result = self.app.upload_repository_files(repo['repoId'], {'folder': 'native', 'files': [
            {'name': 'newslink.exe', 'data': base64.b64encode(self.image if image is None else image).decode()},
            {'name': 'requirements.txt', 'data': base64.b64encode(b'never-install-for-native-exe==0.0.0\n').decode()},
        ]})
        layout = self.request('/api/runner-management/deployment-configurations', {
            'name': 'native executable', 'pathStyle': 'custom', 'directoryTemplate': 'native-program', 'entryPoint': '',
            'nodes': [{'id': str(i), 'parentId': '', 'name': file['path'].split('/')[-1], 'kind': 'file', 'repoId': repo['repoId'],
                       'sourcePath': file['path'], 'sourceType': 'file', 'gitCommit': result['gitCommit']} for i, file in enumerate(result['files'])]})
        self.runner = Runner(Path(self.tmp.name) / 'native-instance', self.url); self.runner.enroll()
        runtime = self.request('/api/runner-management/runtime-configurations', {'deploymentId': layout['deploymentId'],
            'layoutRevision': layout['revision'], 'runnerId': self.runner.identity['runnerId'], 'environment': 'test', 'concurrency': 1})
        return layout, runtime

    def select(self, runtime):
        return self.request('/api/runner-management/runtime-configurations/' + runtime['runtimeId'] + '/entry', {
            'entryPoint': 'newslink.exe', 'revision': runtime['revision'], 'layoutRevision': runtime['layoutRevision']})

    def test_real_exe_selection_signed_delivery_native_launch_and_stop(self):
        layout, runtime = self.native_fixture()
        choices = self.request('/api/runner-management/runtime-configurations/' + runtime['runtimeId'] + '/entry')
        self.assertEqual(choices['files'], ['newslink.exe'])
        self.request('/api/runner-management/deployment-configurations/' + layout['deploymentId'] + '/entry', {
            'entryPoint': 'newslink.exe', 'revision': layout['revision']})
        layout = self.request('/api/runner-management/deployment-configurations/' + layout['deploymentId'])
        runtime = self.deliver_runtime_fixture(layout, self.runner)
        route = '/api/runner-management/runtime-configurations/' + runtime['runtimeId']
        started = self.request(route + '/start', {'revision': runtime['revision']})
        with patch('backend.runner_management.program_dependencies.dependency_python', side_effect=AssertionError('EXE must not install Python dependencies')), \
                patch.object(self.runner, 'python_for', side_effect=AssertionError('EXE must not use a Python interpreter')):
            self.runner.tick()
        self.assertEqual(len(self.runner.processes), 1)
        child = next(iter(self.runner.processes.values()))[1]
        self.assertEqual(child.args, [str(self.runner.directory / 'native-program/newslink.exe')])
        self.assertTrue((self.runner.directory / 'native-program/native-started.txt').read_text().startswith(str(self.runner.directory / 'native-program') + '|'))
        self.request(route + '/stop', {'revision': started['revision']}); self.runner.tick()
        self.assertEqual(self.runner.processes, {})
        self.assertIsNotNone(child.poll())

    def test_invalid_exe_is_rejected_without_adopting_entry(self):
        layout, runtime = self.native_fixture(b'not an executable')
        with self.assertRaises(HTTPError) as failure:
            self.select(runtime)
        self.assertEqual(failure.exception.code, 422)
        self.assertIn('不是有效的 Windows', failure.exception.read().decode())
        saved = self.request('/api/runner-management/deployment-configurations/' + layout['deploymentId'])
        self.assertEqual(saved['entryPoint'], '')

    def test_old_runner_and_non_windows_targets_cannot_adopt_exe(self):
        _, runtime = self.native_fixture()
        with self.app.store.connect() as db:
            db.execute('UPDATE runners SET capabilities=? WHERE runner_id=?', ('["deployment-entry"]', runtime['runnerId']))
        with self.assertRaises(HTTPError) as old:
            self.select(runtime)
        self.assertIn('升级 Runner', old.exception.read().decode())
        with self.app.store.connect() as db:
            db.execute('UPDATE runners SET platform=? WHERE runner_id=?', ('linux', runtime['runnerId']))
        with self.assertRaises(HTTPError) as linux:
            self.select(runtime)
        self.assertIn('仅支持 Windows', linux.exception.read().decode())


if __name__ == '__main__':
    unittest.main()
