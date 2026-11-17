import io
import json
import hashlib
import sys
import os
from pathlib import Path
import unittest
from unittest.mock import patch
import zipfile

from backend.tests import test_runner_management as fixtures
from backend.runner_management.portable_package import build_package
from backend.runner_management.server import ApiError


class PortableEnrollmentOptionTest(unittest.TestCase):
    setUp = fixtures.ManagementIntegrationTest.setUp
    tearDown = fixtures.ManagementIntegrationTest.tearDown

    def test_automatic_package_enrolls_and_restarts_without_prompting_for_a_code(self):
        release = self.app.publish_runner()
        runtime = Path(self.tmp.name) / 'runtime-fixture.zip'
        with zipfile.ZipFile(runtime, 'w') as archive: archive.writestr('python.exe', b'fixture-runtime')
        def count():
            with self.app.store.connect() as db:
                return db.execute('SELECT COUNT(*) total FROM settings WHERE setting_key LIKE ?', ('portable-enroll:%',)).fetchone()['total']
        before = count()
        with patch('backend.runner_management.portable_package.runtime_archive', return_value=runtime):
            _, data = build_package(self.app, {'server': self.url, 'digest': release['digest'], 'includeEnrollmentCode': False})
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                config = json.loads(archive.read('Runner/runner.json'))
                self.assertTrue(config['autoEnroll'])
                self.assertTrue(config['packageToken'])
                self.assertNotIn('enrollExpiresAt', config)
                self.assertNotIn('enrollCode', config)
                self.assertFalse(any('identity.json' in name for name in archive.namelist()))
                readme = archive.read('Runner/使用说明.txt').decode('utf-8-sig')
                self.assertIn('免接入码启动', readme)
                destination = Path(self.tmp.name) / 'automatic-package'
                archive.extractall(destination)
            self.assertEqual(count(), before + 1)
            with self.app.store.connect() as db:
                grant = json.loads(db.execute('SELECT setting_value FROM settings WHERE setting_key=?', (
                    'portable-enroll:' + hashlib.sha256(config['packageToken'].encode()).hexdigest(),)).fetchone()['setting_value'])
            self.assertEqual(grant['mode'], 'automatic')
            self.assertIsNone(grant['expiresAt'])
            root = destination / 'Runner'
            from backend.runner_management.portable_package import LAUNCHER
            namespace = {'__name__': 'portable_contract', '__file__': str(root / 'start.py')}
            old_path, old_argv = sys.path[:], sys.argv[:]
            try:
                with patch.dict(sys.modules), patch.dict(os.environ), patch('builtins.input', side_effect=AssertionError('Must not ask for enrollment code')), patch('runpy.run_path'):
                    exec(compile(LAUNCHER, 'portable_start.py', 'exec'), namespace)
                    sys.argv = [str(root / 'start.py')]
                    namespace['main']()
                    first = (root / 'instance/identity.json').read_bytes()
                    sys.argv = [str(root / 'start.py')]
                    namespace['main']()
                    self.assertEqual((root / 'instance/identity.json').read_bytes(), first)
                    with self.app.store.connect() as db:
                        self.assertEqual(db.execute('SELECT COUNT(*) total FROM runners WHERE install_directory=?', (str(root / 'instance'),)).fetchone()['total'], 1)
            finally:
                sys.path[:] = old_path; sys.argv[:] = old_argv
            _, default = build_package(self.app, {'server': self.url, 'digest': release['digest']})
            with zipfile.ZipFile(io.BytesIO(default)) as archive:
                config = json.loads(archive.read('Runner/runner.json'))
                self.assertTrue(config['packageToken'])
                self.assertTrue(config['enrollExpiresAt'])
            self.assertEqual(count(), before + 2)

    def test_anonymous_unknown_and_malformed_package_authorizations_are_still_rejected(self):
        payload = {'installDirectory': r'D:\Runner\instance', 'ipAddress': '10.0.0.20', 'platform': 'win32'}
        for token in ('', 'unknown-package-token'):
            with self.assertRaises(ApiError): self.app.enroll({**payload, 'packageToken': token})
        token = 'missing-expiry-without-explicit-automatic-mode'
        with self.app.store.connect() as db:
            db.execute('INSERT INTO settings VALUES (?,?)', ('portable-enroll:' + hashlib.sha256(token.encode()).hexdigest(), json.dumps({'expiresAt': None})))
        with self.assertRaises(ApiError): self.app.enroll({**payload, 'packageToken': token})

    def test_option_rejects_non_boolean_values_before_packaging(self):
        for value in ('false', 0, 1, None):
            with self.subTest(value=value), self.assertRaises(ApiError) as error:
                build_package(self.app, {'includeEnrollmentCode': value})
            self.assertEqual(error.exception.status, 422)


del fixtures
