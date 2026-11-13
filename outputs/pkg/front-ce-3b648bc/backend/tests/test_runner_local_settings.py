import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from backend.runner_management.local_settings import load_local_settings, protect_password, unprotect_password


class RunnerLocalSettingsTest(unittest.TestCase):
    def setUp(self):
        test_root = Path(__file__).resolve().parents[1] / '.runtime' / 'local-settings-tests'
        test_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=test_root)
        self.addCleanup(self.temp.cleanup)
        self.file = Path(self.temp.name) / 'settings.json'
        self.environment = patch.dict(os.environ, {key: value for key, value in os.environ.items() if not key.startswith('RUNNER_')}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def saved(self, **changes):
        config = {'version': 1, 'environment': {'RUNNER_DB_HOST': 'db.example', 'RUNNER_DB_PORT': '8102',
                  'RUNNER_DB_NAME': 'app001', 'RUNNER_DB_USER': 'local', 'RUNNER_DEV_MODE': '1'}, 'passwordProtected': 'encrypted'}
        config.update(changes)
        self.file.write_text(json.dumps(config), encoding='utf-8')

    def test_saved_mysql_settings_restore_after_a_new_terminal_without_environment(self):
        self.saved()
        with patch('backend.runner_management.local_settings.unprotect_password', return_value='test-password'):
            self.assertTrue(load_local_settings(self.file))
        self.assertEqual(os.environ['RUNNER_DB_HOST'], 'db.example')
        self.assertEqual(os.environ['RUNNER_DB_PASSWORD'], 'test-password')
        self.assertEqual(os.environ['RUNNER_DEV_MODE'], '1')

    def test_explicit_environment_wins_without_reading_saved_credentials(self):
        self.saved()
        os.environ.update(RUNNER_DB_HOST='other-db', RUNNER_DB_NAME='other', RUNNER_DB_USER='other', RUNNER_DB_PASSWORD='explicit')
        with patch('backend.runner_management.local_settings.unprotect_password') as decrypt:
            self.assertFalse(load_local_settings(self.file))
            decrypt.assert_not_called()
        self.assertEqual(os.environ['RUNNER_DB_HOST'], 'other-db')

    def test_incomplete_or_unreadable_settings_fail_without_silent_sqlite_fallback(self):
        self.file.write_text('{', encoding='utf-8')
        with self.assertRaisesRegex(RuntimeError, '已停止启动'):
            load_local_settings(self.file)
        self.saved()
        with patch('backend.runner_management.local_settings.unprotect_password', side_effect=RuntimeError('无法解密')):
            with self.assertRaises(RuntimeError):
                load_local_settings(self.file)
        self.assertNotIn('RUNNER_DB_HOST', os.environ)
        os.environ['RUNNER_DB_HOST'] = 'other-db'
        with self.assertRaisesRegex(RuntimeError, '环境变量不完整'):
            load_local_settings(self.file)

    def test_missing_default_keeps_legacy_sqlite_but_missing_explicit_file_fails(self):
        self.assertFalse(load_local_settings(self.file))
        os.environ['RUNNER_SETTINGS_FILE'] = str(self.file)
        with self.assertRaisesRegex(RuntimeError, '不存在'):
            load_local_settings()

    def test_explicit_separate_runtime_never_loads_another_runtime_mysql_credentials(self):
        self.saved()
        os.environ['RUNNER_DATA_DIR'] = str(Path(self.temp.name) / 'separate-runtime')
        with patch('backend.runner_management.local_settings.SETTINGS_FILE', self.file), \
             patch('backend.runner_management.local_settings.unprotect_password') as decrypt:
            self.assertFalse(load_local_settings())
            decrypt.assert_not_called()
        self.assertNotIn('RUNNER_DB_HOST', os.environ)

    @unittest.skipUnless(os.name == 'nt', 'Windows DPAPI only')
    def test_password_is_user_bound_encrypted_and_round_trips(self):
        ciphertext = protect_password('example-test-only-password')
        self.assertNotIn('example-test-only-password', ciphertext)
        self.assertEqual(unprotect_password(ciphertext), 'example-test-only-password')
