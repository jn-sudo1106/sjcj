"""Cross-OS registration must preserve the Runner's directory and host identity."""
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from backend.runner_management.runner_identity import install_directory
from backend.tests import test_runner_management as baseline


class RunnerIdentityTest(unittest.TestCase):
    setUp = baseline.ManagementIntegrationTest.setUp
    tearDown = baseline.ManagementIntegrationTest.tearDown
    request = baseline.ManagementIntegrationTest.request

    def enroll(self, directory=r'D:\Runner\instance', platform='win32', **extra):
        return self.request('/api/runners/enroll', {
            'installDirectory': directory, 'platform': platform, 'ipAddress': '192.168.1.171', **extra})

    def rows(self):
        return self.request('/api/runner-management/runners')

    def test_windows_registration_keeps_client_path_and_hostname(self):
        with patch('socket.gethostname', return_value='wwapp32'):
            self.enroll(hostName='home171')
        row = self.rows()[0]
        self.assertEqual(row['installDirectory'], r'D:\Runner\instance')
        self.assertEqual(row['name'], 'home171')

    def test_linux_registration_on_windows_api_does_not_add_drive(self):
        self.enroll('/home/worker/runner/instance', 'linux', hostName='linux-worker')
        self.assertEqual(self.rows()[0]['installDirectory'], '/home/worker/runner/instance')

    def test_legacy_missing_hostname_falls_back_to_client_ip(self):
        with patch('socket.gethostname', return_value='wwapp32'):
            self.enroll()
        self.assertEqual(self.rows()[0]['name'], '192.168.1.171')

    def test_duplicate_windows_directory_case_and_separators_are_rejected(self):
        self.enroll()
        with self.assertRaises(HTTPError) as raised:
            self.enroll('d:/runner/INSTANCE/')
        self.assertEqual(raised.exception.code, 409)
        self.assertEqual(len(self.rows()), 1)

    def test_legacy_corrupt_directory_does_not_allow_duplicate_registration(self):
        identity = self.enroll()
        with self.app.store.connect() as db:
            db.execute('UPDATE runners SET install_directory=? WHERE runner_id=?',
                       (r'/home/leo/D:\Runner\instance', identity['runnerId']))
        with self.assertRaises(HTTPError) as raised:
            self.enroll()
        self.assertEqual(raised.exception.code, 409)

    def test_different_directories_on_same_machine_remain_independent(self):
        self.enroll()
        self.enroll(r'D:\Runner2\instance')
        self.assertEqual(len(self.rows()), 2)

    def test_hostname_heartbeat_repairs_fallback_but_preserves_custom_name(self):
        identity = self.enroll()
        self.request('/api/runners/me/heartbeat', {'hostName': 'home171'}, token=identity['token'])
        self.assertEqual(self.rows()[0]['name'], 'home171')
        with self.app.store.connect() as db:
            db.execute('UPDATE runners SET name=? WHERE runner_id=?', ('测试资源', identity['runnerId']))
        self.request('/api/runners/me/heartbeat', {'hostName': 'home171'}, token=identity['token'])
        self.assertEqual(self.rows()[0]['name'], '测试资源')
        self.request('/api/runners/me/heartbeat', {}, token=identity['token'])
        self.assertEqual(self.rows()[0]['name'], '测试资源')

    def test_runner_reports_own_hostname_on_enroll_and_heartbeat(self):
        from pathlib import Path
        from backend.runner_management.runner import Runner
        self.runner = Runner(Path(self.tmp.name) / 'instance', self.url)
        with patch('backend.runner_management.runner.socket.gethostname', return_value='client-host'):
            self.runner.enroll()
            self.assertEqual(self.runner.heartbeat_payload()['hostName'], 'client-host')
        self.assertEqual(self.rows()[0]['name'], 'client-host')

    def test_relative_and_wrong_os_directories_are_rejected(self):
        for directory, platform in [('instance', 'win32'), (r'D:instance', 'win32'),
                                     ('/home/leo/D:\\Runner', 'win32'), ('relative/instance', 'linux')]:
            with self.subTest(directory=directory), self.assertRaises(HTTPError) as raised:
                self.enroll(directory, platform)
            self.assertEqual(raised.exception.code, 400)
        self.assertEqual(self.rows(), [])


class DirectoryNormalizationTest(unittest.TestCase):
    def test_unc_and_legacy_paths(self):
        self.assertEqual(install_directory(r'\\server\share\Runner\instance', 'win32'), r'\\server\share\Runner\instance')
        self.assertEqual(install_directory(r'/home/leo/D:\Runner\instance', 'win32', legacy=True), r'D:\Runner\instance')
        self.assertEqual(install_directory('/home/leo/runner/instance', 'linux'), '/home/leo/runner/instance')
