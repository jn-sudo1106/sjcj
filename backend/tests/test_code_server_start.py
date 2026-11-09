import os
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from backend.code_generation_server import start


class CodeServerStartTest(unittest.TestCase):
    def test_package_connection_updates_existing_config_once_and_preserves_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = {'platform': 'http://old:8092', 'enrollCode': 'old-code', 'port': 8094,
                      'workspace': 'D:\\existing-code', 'advertiseUrl': 'http://machine:8094'}
            (root / 'config.json').write_text(json.dumps(config))
            (root / 'identity.json').write_text('existing identity')
            (root / 'config.package.json').write_text(json.dumps({'platform': 'http://192.168.1.32:8092', 'enrollCode': 'new-code'}))
            with patch.object(start, 'HERE', root):
                result = start.load_configuration()
                self.assertEqual(result, {**config, 'platform': 'http://192.168.1.32:8092', 'enrollCode': 'new-code'})
                self.assertEqual((root / 'identity.json').read_text(), 'existing identity')
                self.assertFalse((root / 'config.package.json').exists())
                result['platform'] = 'http://manually-edited:8092'
                (root / 'config.json').write_text(json.dumps(result))
                self.assertEqual(start.load_configuration()['platform'], 'http://manually-edited:8092')

    def test_package_connection_initializes_a_new_machine(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'config.example.json').write_text(json.dumps({'platform': 'http://old:8092', 'enrollCode': 'placeholder',
                                                                 'workspace': './workspace', 'port': 8093}))
            (root / 'config.package.json').write_text(json.dumps({'platform': 'http://192.168.1.32:8092', 'enrollCode': 'new-code'}))
            with patch.object(start, 'HERE', root):
                result = start.load_configuration()
            self.assertEqual(result, {'platform': 'http://192.168.1.32:8092', 'enrollCode': 'new-code', 'workspace': './workspace', 'port': 8093})
            self.assertTrue((root / 'config.json').is_file())

    def test_copied_environment_with_missing_base_python_is_backed_up_and_rebuilt(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            environment = root / '.runtime' / 'python'
            python = environment / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
            python.parent.mkdir(parents=True)
            python.write_text('old interpreter')
            config = environment / 'pyvenv.cfg'
            config.write_text('home = C:\\old-machine\\Python312')
            results = [
                subprocess.CompletedProcess([], 103),
                subprocess.CompletedProcess([], 0),
                subprocess.CompletedProcess([], 1),
                subprocess.CompletedProcess([], 0),
            ]
            with patch.object(start, 'HERE', root), patch.object(start.importlib.util, 'find_spec', return_value=None), \
                    patch.object(start.subprocess, 'run', side_effect=results) as run, \
                    patch.object(start.subprocess, 'call', return_value=0) as launch:
                with self.assertRaises(SystemExit) as exited:
                    start.ensure_verifier()
            self.assertEqual(exited.exception.code, 0)
            backups = list(environment.parent.glob('python.invalid-*'))
            self.assertEqual(len(backups), 1)
            self.assertEqual((backups[0] / 'pyvenv.cfg').read_text(), 'home = C:\\old-machine\\Python312')
            self.assertEqual(run.call_args_list[1].args[0], [start.sys.executable, '-m', 'venv', str(environment)])
            self.assertEqual(run.call_args_list[3].args[0], [str(python), '-m', 'pip', 'install', '-r', str(root / 'requirements.txt')])
            self.assertEqual(launch.call_args.args[0], [str(python), '-X', 'utf8', str(root / 'start.py')])

    def test_valid_private_environment_is_reused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            environment = root / '.runtime' / 'python'
            python = environment / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
            python.parent.mkdir(parents=True)
            python.write_text('valid interpreter')
            with patch.object(start, 'HERE', root), patch.object(start.importlib.util, 'find_spec', return_value=None), \
                    patch.object(start.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run, \
                    patch.object(start.subprocess, 'call', return_value=0):
                with self.assertRaises(SystemExit):
                    start.ensure_verifier()
            self.assertEqual(run.call_count, 2)
            self.assertFalse(list(environment.parent.glob('python.invalid-*')))
            self.assertTrue(python.exists())
