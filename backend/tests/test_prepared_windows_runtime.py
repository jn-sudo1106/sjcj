import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from backend.runner_management.portable_package import runtime_archive, runtime_version
from backend.runner_management.server import ApiError
from backend.tests import test_runner_management as baseline


class PreparedWindowsRuntimeTest(unittest.TestCase):
    def test_prepared_runtime_does_not_depend_on_server_interpreter(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'windows.zip'
            with zipfile.ZipFile(path, 'w') as archive:
                for name in ('python.exe', 'python3.dll', 'python312.dll', 'Lib/encodings/__init__.py'):
                    archive.writestr(name, b'fixture')
            with patch.dict(os.environ, RUNNER_WINDOWS_RUNTIME=str(path), RUNNER_WINDOWS_PYTHON_VERSION='3.12.10'), patch('backend.runner_management.portable_package.runtime_files', side_effect=AssertionError('must not inspect Linux Python')):
                self.assertEqual(runtime_archive(None), path)
                self.assertEqual(runtime_version(), '3.12.10')

    def test_invalid_and_escaping_runtime_archives_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'windows.zip'
            for bad in ('missing', '../outside', 'C:/outside'):
                with zipfile.ZipFile(path, 'w') as archive:
                    if bad != 'missing':
                        for name in ('python.exe', 'python3.dll', 'python312.dll', 'Lib/encodings/__init__.py', bad):
                            archive.writestr(name, b'fixture')
                with patch.dict(os.environ, RUNNER_WINDOWS_RUNTIME=str(path)), self.assertRaises(ApiError):
                    runtime_archive(None)


class CrossPlatformReleaseTest(unittest.TestCase):
    setUp = baseline.ManagementIntegrationTest.setUp
    tearDown = baseline.ManagementIntegrationTest.tearDown

    def test_pure_python_runner_release_is_available_for_windows_on_linux_server(self):
        from backend.runner_management.portable_package import package_info
        from backend.runner_management import server
        with patch.object(server.sys, 'platform', 'linux'):
            release = self.app.publish_runner()
        info = package_info(self.app, 'http://192.168.1.32:8092')
        self.assertIn(release['digest'], [row['digest'] for row in info['releases']])
