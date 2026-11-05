import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.runner_management import bundle_install as install, live_deployment as policy
from backend.runner_management.artifacts import ArtifactStore


class LiveDeploymentTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.target = self.root/'instance/links/101'; self.cache = self.root/'cache'
        self.artifacts = ArtifactStore(self.root/'artifacts')
        self.old = {'main.py': b'import time\ntime.sleep(100)\n', 'requirements.txt': b''}
        self.install(self.old)

    def install(self, files, programs=None):
        manifest = {'kind':'script','layoutSchema':2,'configId':'101','queueName':'news','entry':'main.py','directories':[]}
        digest, signature = self.artifacts.publish(files,manifest)
        install.cache_bundle(self.cache,digest,self.artifacts.read(digest),signature)
        result = install.install_bundle(self.target,files,manifest,digest,self.cache,self.artifacts.public_key,protected_programs=programs)
        return digest, result

    def test_standalone_script_is_written_without_swapping_directory_or_unchanged_files(self):
        inode = self.target.stat().st_ino; before = (self.target/'main.py').stat().st_mtime_ns
        original = install.atomic_write; writes=[]
        def capture(path, data): writes.append(Path(path)); return original(path,data)
        with patch.object(install,'atomic_write',side_effect=capture):
            digest, registry = self.install({**self.old,'www.mkky.cn.py':b'VALUE=2\n'},[self.old])
        self.assertEqual(self.target.stat().st_ino,inode)
        self.assertEqual((self.target/'main.py').stat().st_mtime_ns,before)
        self.assertNotIn(self.target/'main.py',writes)
        self.assertTrue((self.target/'www.mkky.cn.py').is_file())
        self.assertIn(digest,registry['current'].values())
        self.assertFalse(install.live_journal(self.target,self.cache).exists())

    def test_shared_dependency_modification_removal_and_module_shadowing_are_blocked(self):
        for after in ({**self.old,'main.py':b'changed=1'}, {**self.old,'requirements.txt':b'new-package'},
                      {'main.py':self.old['main.py']}, {**self.old,'time.py':b'VALUE=1'}, {**self.old,'lib/helper.py':b'VALUE=1'}):
            with self.subTest(after=tuple(after)), self.assertRaises(ValueError): policy.validate(self.old,after,[self.old])
        self.assertEqual((self.target/'main.py').read_bytes(),self.old['main.py'])

    def test_failure_rolls_back_added_file_and_version_receipt(self):
        registry = (self.target/'version.json').read_bytes(); original = install.atomic_write
        def fail(path,data):
            if Path(path)==self.target/'version.json' and data!=registry: raise OSError('disk full')
            return original(path,data)
        with patch.object(install,'atomic_write',side_effect=fail), self.assertRaises(OSError):
            self.install({**self.old,'www.mkky.cn.py':b'VALUE=2'},[self.old])
        self.assertFalse((self.target/'www.mkky.cn.py').exists())
        self.assertEqual((self.target/'version.json').read_bytes(),registry)

    def test_interrupted_live_update_is_recovered_before_next_install(self):
        original = install.atomic_write
        def crash(path,data):
            if Path(path)==self.target/'version.json': raise KeyboardInterrupt()
            return original(path,data)
        with patch.object(install,'atomic_write',side_effect=crash), self.assertRaises(KeyboardInterrupt):
            self.install({**self.old,'www.mkky.cn.py':b'VALUE=2'},[self.old])
        self.assertTrue(install.live_journal(self.target,self.cache).exists())
        self.install({**self.old,'www.mkky.cn.py':b'VALUE=3'},[self.old])
        self.assertEqual((self.target/'www.mkky.cn.py').read_bytes(),b'VALUE=3')
        self.assertFalse(install.live_journal(self.target,self.cache).exists())

    def test_signed_legacy_bytecode_is_not_treated_as_a_running_dependency(self):
        from types import SimpleNamespace
        digest, signature = self.artifacts.publish({**self.old,'__pycache__/main.pyc':b'old cache'}, {'kind':'processor','executionSchema':2})
        db = SimpleNamespace(execute=lambda *args: SimpleNamespace(fetchone=lambda: {'digest':digest,'signature':signature}))
        programs = policy.server_programs(SimpleNamespace(artifacts=self.artifacts),db,[{'assignmentId':'test'}])
        self.assertEqual(programs,[self.old])

    def test_unreferenced_website_script_can_be_updated_again_while_old_program_runs(self):
        self.install({**self.old,'www.mkky.cn.py':b'VALUE=2'},[self.old])
        before=(self.target/'main.py').stat().st_mtime_ns
        self.install({**self.old,'www.mkky.cn.py':b'VALUE=3'},[self.old])
        self.assertEqual((self.target/'www.mkky.cn.py').read_bytes(),b'VALUE=3')
        self.assertEqual((self.target/'main.py').stat().st_mtime_ns,before)
